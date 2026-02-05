// MultiWA Gateway - Contacts Service (Enhanced)
// apps/api/src/modules/contacts/contacts.service.ts

import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { CreateContactDto, UpdateContactDto, ImportContactsDto, ImportCsvDto } from './dto';
import { EngineManagerService } from '../profiles/engine-manager.service';

@Injectable()
export class ContactsService {
  constructor(
    @Inject(forwardRef(() => EngineManagerService))
    private readonly engineManager: EngineManagerService,
  ) {}

  // Create contact
  async create(dto: CreateContactDto) {
    const phone = this.normalizePhone(dto.phone);
    
    const existing = await prisma.contact.findFirst({
      where: { profileId: dto.profileId, phone },
    });
    
    if (existing) {
      return prisma.contact.update({
        where: { id: existing.id },
        data: {
          name: dto.name || existing.name,
          tags: dto.tags ? [...new Set([...existing.tags, ...dto.tags])] : existing.tags,
          metadata: dto.metadata ? { ...existing.metadata as any, ...dto.metadata } : existing.metadata,
        },
      });
    }

    return prisma.contact.create({
      data: {
        profileId: dto.profileId,
        phone,
        name: dto.name,
        tags: dto.tags || [],
        metadata: dto.metadata || {},
      },
    });
  }

  // List contacts with filtering
  async findAll(profileId: string, options: {
    search?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }) {
    const where: any = { profileId };
    
    if (options.search) {
      where.OR = [
        { name: { contains: options.search, mode: 'insensitive' } },
        { phone: { contains: options.search } },
        { whatsappName: { contains: options.search, mode: 'insensitive' } },
      ];
    }
    
    if (options.tags?.length) {
      where.tags = { hasSome: options.tags };
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        take: options.limit || 50,
        skip: options.offset || 0,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.contact.count({ where }),
    ]);

    return { contacts, total, limit: options.limit || 50, offset: options.offset || 0 };
  }

  // Get contact by ID
  async findOne(id: string) {
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  // Update contact
  async update(id: string, dto: UpdateContactDto) {
    await this.findOne(id);
    return prisma.contact.update({
      where: { id },
      data: dto,
    });
  }

  // Delete contact
  async delete(id: string) {
    await this.findOne(id);
    await prisma.contact.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Sync contacts from WhatsApp profile
   * Fetches contacts exactly as saved in WhatsApp (with the same names)
   */
  async syncFromWhatsApp(profileId: string) {
    const engine = this.engineManager.getEngine(profileId);
    if (!engine) {
      throw new BadRequestException('Profile not connected. Please connect WhatsApp first.');
    }

    const results = { synced: 0, created: 0, updated: 0, errors: [] as string[] };

    try {
      const waContacts = await engine.getContacts();
      
      for (const contact of waContacts) {
        try {
          const phone = contact.phone;
          
          const existing = await prisma.contact.findFirst({
            where: { profileId, phone },
          });

          if (existing) {
            // Update with WhatsApp name if not already set or different
            if (!existing.whatsappName || existing.whatsappName !== contact.name) {
              await prisma.contact.update({
                where: { id: existing.id },
                data: {
                  whatsappName: contact.name,
                  name: existing.name || contact.name, // Keep local name if set, otherwise use WA name
                  metadata: {
                    ...(existing.metadata as object || {}),
                    lastSyncedAt: new Date().toISOString(),
                  },
                },
              });
              results.updated++;
            }
          } else {
            // Create new contact from WhatsApp
            await prisma.contact.create({
              data: {
                profileId,
                phone,
                name: contact.name,
                whatsappName: contact.name,
                tags: ['whatsapp-sync'],
                metadata: {
                  source: 'whatsapp-sync',
                  syncedAt: new Date().toISOString(),
                  pushName: contact.pushName,
                },
              },
            });
            results.created++;
          }
          results.synced++;
        } catch (error: any) {
          results.errors.push(`${contact.phone}: ${error.message}`);
        }
      }

      return {
        success: true,
        message: `Synced ${results.synced} contacts from WhatsApp`,
        ...results,
      };
    } catch (error: any) {
      throw new BadRequestException(`Failed to sync contacts: ${error.message}`);
    }
  }

  // Bulk import contacts (JSON)
  async bulkImport(dto: ImportContactsDto) {
    const results = { created: 0, updated: 0, failed: 0, errors: [] as string[] };
    
    for (const contact of dto.contacts) {
      try {
        const phone = this.normalizePhone(contact.phone);
        
        const existing = await prisma.contact.findFirst({
          where: { profileId: dto.profileId, phone },
        });

        if (existing) {
          await prisma.contact.update({
            where: { id: existing.id },
            data: {
              name: contact.name || existing.name,
              tags: contact.tags ? [...new Set([...existing.tags, ...contact.tags])] : existing.tags,
            },
          });
          results.updated++;
        } else {
          await prisma.contact.create({
            data: {
              profileId: dto.profileId,
              phone,
              name: contact.name,
              tags: contact.tags || [],
              metadata: {},
            },
          });
          results.created++;
        }
      } catch (error: any) {
        results.failed++;
        results.errors.push(`${contact.phone}: ${error.message}`);
      }
    }

    return results;
  }

  // Import from CSV string
  async importFromCsv(dto: ImportCsvDto) {
    const results = { created: 0, updated: 0, failed: 0, errors: [] as string[] };
    
    // Parse CSV
    const lines = dto.csvData.trim().split('\n');
    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    
    // Find column indices
    const phoneIdx = header.findIndex(h => ['phone', 'nomor', 'number', 'whatsapp', 'hp'].includes(h));
    const nameIdx = header.findIndex(h => ['name', 'nama'].includes(h));
    const tagsIdx = header.findIndex(h => ['tags', 'tag', 'label'].includes(h));
    
    if (phoneIdx === -1) {
      return { error: 'CSV must have a "phone" column', ...results };
    }

    // Process rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const cols = this.parseCsvLine(line);
      const phone = cols[phoneIdx];
      
      if (!phone) {
        results.failed++;
        results.errors.push(`Row ${i + 1}: Empty phone number`);
        continue;
      }

      try {
        const normalized = this.normalizePhone(phone);
        const name = nameIdx >= 0 ? cols[nameIdx] : undefined;
        const tags = tagsIdx >= 0 && cols[tagsIdx] 
          ? cols[tagsIdx].split(';').map(t => t.trim()).filter(Boolean)
          : [];

        const existing = await prisma.contact.findFirst({
          where: { profileId: dto.profileId, phone: normalized },
        });

        if (existing) {
          await prisma.contact.update({
            where: { id: existing.id },
            data: {
              name: name || existing.name,
              tags: [...new Set([...existing.tags, ...tags])],
            },
          });
          results.updated++;
        } else {
          await prisma.contact.create({
            data: {
              profileId: dto.profileId,
              phone: normalized,
              name,
              tags,
              metadata: {},
            },
          });
          results.created++;
        }
      } catch (error: any) {
        results.failed++;
        results.errors.push(`Row ${i + 1}: ${error.message}`);
      }
    }

    return results;
  }

  // Export contacts to CSV
  async exportToCsv(profileId: string, options?: { tags?: string[] }) {
    const where: any = { profileId };
    if (options?.tags?.length) {
      where.tags = { hasSome: options.tags };
    }

    const contacts = await prisma.contact.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    // Build CSV
    const header = 'phone,name,whatsapp_name,tags,created_at';
    const rows = contacts.map(c => [
      c.phone,
      this.escapeCsv(c.name || ''),
      this.escapeCsv(c.whatsappName || ''),
      this.escapeCsv(c.tags.join(';')),
      c.createdAt.toISOString(),
    ].join(','));

    return {
      csv: [header, ...rows].join('\n'),
      count: contacts.length,
      filename: `contacts_${profileId}_${Date.now()}.csv`,
    };
  }

  // Add tags to contact
  async addTags(id: string, tags: string[]) {
    const contact = await this.findOne(id);
    const newTags = [...new Set([...contact.tags, ...tags])];
    
    return prisma.contact.update({
      where: { id },
      data: { tags: newTags },
    });
  }

  // Remove tags from contact
  async removeTags(id: string, tagsToRemove: string[]) {
    const contact = await this.findOne(id);
    const newTags = contact.tags.filter((t) => !tagsToRemove.includes(t));
    
    return prisma.contact.update({
      where: { id },
      data: { tags: newTags },
    });
  }

  // Validate phone number on WhatsApp
  async validatePhone(profileId: string, phone: string) {
    const normalized = this.normalizePhone(phone);
    
    // Get profile to check engine status
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');

    // For connected profiles, we could use the engine to validate
    // For now, return validation info based on format
    const isValidFormat = /^[1-9]\d{6,14}$/.test(normalized);
    const isIndonesian = normalized.startsWith('62');
    
    return {
      phone: normalized,
      originalPhone: phone,
      validFormat: isValidFormat,
      isIndonesian,
      countryCode: isIndonesian ? '62' : normalized.substring(0, normalized.length > 10 ? 2 : 1),
      // WhatsApp check requires connected engine
      onWhatsApp: profile.status === 'connected' ? null : null, // Will be implemented with engine
      profileStatus: profile.status,
    };
  }

  // Bulk validate multiple phone numbers
  async validateBulk(profileId: string, phones: string[]) {
    const results = await Promise.all(
      phones.map(phone => this.validatePhone(profileId, phone))
    );
    
    return {
      total: phones.length,
      valid: results.filter(r => r.validFormat).length,
      results,
    };
  }

  // Normalize phone number
  private normalizePhone(phone: string): string {
    let normalized = phone.replace(/\D/g, '');
    
    // Indonesian number handling
    if (normalized.startsWith('0')) {
      normalized = '62' + normalized.slice(1);
    }
    
    // Handle +62 prefix
    if (normalized.startsWith('+')) {
      normalized = normalized.slice(1);
    }
    
    return normalized;
  }

  // Parse CSV line (handles quoted fields)
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    
    return result;
  }

  // Escape CSV field
  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
