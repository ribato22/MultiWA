// MultiWA Gateway - Broadcast Service
// apps/api/src/modules/broadcast/broadcast.service.ts

import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger, OnModuleInit } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { CreateBroadcastDto, UpdateBroadcastDto, ScheduleBroadcastDto } from './dto';
import { MessagesService } from '../messages/messages.service';

@Injectable()
export class BroadcastService implements OnModuleInit {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
  ) {}

  /**
   * Crash recovery. On boot, any broadcast left in `running` status is orphaned —
   * its in-process execution loop died with the previous process. Re-launch each
   * from its persisted cursor. Because the cursor advances BEFORE every send
   * (at-most-once), recovery never re-sends an already-attempted recipient.
   *
   * Runs only in the API process (BroadcastModule is API-only). Assumes a single
   * API instance; with multiple replicas each would recover, so guard with a lock
   * before scaling out (tracked as a follow-up — PLN is single-instance today).
   */
  async onModuleInit() {
    try {
      const orphaned = await prisma.broadcast.findMany({
        where: { status: 'running' },
        select: { id: true, profileId: true, cursor: true },
      });
      if (orphaned.length === 0) return;

      this.logger.warn(
        `Recovering ${orphaned.length} orphaned broadcast(s) left running after restart: ` +
          orphaned.map((b) => `${b.id}@${b.cursor}`).join(', '),
      );
      for (const b of orphaned) {
        this.launchExecution(b.id);
      }
    } catch (err: any) {
      // Never let recovery crash boot; a stuck broadcast can still be resumed manually.
      this.logger.error(`Broadcast recovery failed: ${err.message}`);
    }
  }

  /**
   * Fire the (resumable) execution loop without blocking the caller, logging any
   * unhandled error. Used by start(), resume(), and boot recovery.
   */
  private launchExecution(broadcastId: string) {
    this.runExecution(broadcastId).catch((err) =>
      this.logger.error(`Broadcast ${broadcastId} execution error: ${err.message}`),
    );
  }

  // Create broadcast
  async create(dto: CreateBroadcastDto) {
    return prisma.broadcast.create({
      data: {
        profileId: dto.profileId,
        name: dto.name,
        message: dto.message,
        recipients: dto.recipients as any,
        status: 'draft',
        settings: (dto.settings || {
          delayMin: 3000,   // 3-10 seconds between messages
          delayMax: 10000,
          batchSize: 50,
          retryFailed: true,
          retryAttempts: 3,
        }) as any,
        stats: {
          total: 0,
          pending: 0,
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
        },
      },
    });
  }

  // List broadcasts
  async findAll(profileId: string, options: { status?: string }) {
    const where: any = { profileId };
    if (options.status) where.status = options.status;

    return prisma.broadcast.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get broadcast by ID
  async findOne(id: string) {
    const broadcast = await prisma.broadcast.findUnique({ where: { id } });
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    return broadcast;
  }

  // Update broadcast
  async update(id: string, dto: UpdateBroadcastDto) {
    const broadcast = await this.findOne(id);
    
    // Only restrict editing name/message/recipients on non-drafts
    if (broadcast.status !== 'draft' && (dto as any).name) {
      throw new BadRequestException('Can only update name/message on broadcasts in draft status');
    }

    return prisma.broadcast.update({
      where: { id },
      data: dto as any,
    });
  }

  // Delete broadcast
  async delete(id: string) {
    const broadcast = await this.findOne(id);
    
    if (['running'].includes(broadcast.status)) {
      throw new BadRequestException('Cannot delete running broadcast. Pause or cancel first.');
    }

    await prisma.broadcast.delete({ where: { id } });
    return { success: true };
  }

  // Schedule broadcast
  async schedule(id: string, dto: ScheduleBroadcastDto) {
    const broadcast = await this.findOne(id);
    
    if (!['draft', 'paused'].includes(broadcast.status)) {
      throw new BadRequestException('Can only schedule draft or paused broadcasts');
    }

    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt <= new Date()) {
      throw new BadRequestException('Scheduled time must be in the future');
    }

    // Calculate recipient count
    const recipientCount = await this.calculateRecipientCount(broadcast);

    return prisma.broadcast.update({
      where: { id },
      data: {
        status: 'scheduled',
        scheduledAt,
        stats: {
          ...(broadcast.stats as any),
          total: recipientCount,
          pending: recipientCount,
        },
      },
    });
  }

  // Start broadcast immediately
  async start(id: string) {
    const broadcast = await this.findOne(id);

    if (!['draft', 'scheduled', 'paused'].includes(broadcast.status)) {
      throw new BadRequestException('Cannot start broadcast in current status');
    }

    // Resolve actual recipient phone numbers once and snapshot them, so execution
    // (and any later crash recovery) always walks the exact same list by index.
    // Re-resolving on resume would be non-deterministic if contacts/tags changed.
    const recipientPhones = await this.resolveRecipients(broadcast);

    if (recipientPhones.length === 0) {
      throw new BadRequestException('No recipients found for this broadcast');
    }

    await prisma.broadcast.update({
      where: { id },
      data: {
        status: 'running',
        startedAt: broadcast.startedAt || new Date(),
        resolvedRecipients: recipientPhones,
        cursor: 0,
        stats: {
          total: recipientPhones.length,
          pending: recipientPhones.length,
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
        },
      },
    });

    // Execute broadcast asynchronously (don't await). Survives restart via onModuleInit.
    this.launchExecution(id);

    return { success: true, message: 'Broadcast started', recipientCount: recipientPhones.length };
  }

  // Resolve recipients to phone numbers
  private async resolveRecipients(broadcast: any): Promise<string[]> {
    const recipients = broadcast.recipients as any;
    
    switch (recipients.type) {
      case 'tags': {
        const contacts = await prisma.contact.findMany({
          where: {
            profileId: broadcast.profileId,
            tags: { hasSome: recipients.value },
          },
          select: { phone: true },
        });
        return contacts.map(c => c.phone).filter(Boolean);
      }
      case 'contacts': {
        // recipients.value contains contact IDs or phone numbers
        const contacts = await prisma.contact.findMany({
          where: {
            profileId: broadcast.profileId,
            id: { in: recipients.value },
          },
          select: { phone: true },
        });
        // If no contacts found by ID, treat values as phone numbers
        if (contacts.length === 0) {
          return recipients.value;
        }
        return contacts.map(c => c.phone).filter(Boolean);
      }
      case 'all': {
        const contacts = await prisma.contact.findMany({
          where: { profileId: broadcast.profileId },
          select: { phone: true },
        });
        return contacts.map(c => c.phone).filter(Boolean);
      }
      default:
        return [];
    }
  }

  // Execute a broadcast from its persisted cursor. Resumable and crash-safe: all
  // execution state (recipient snapshot, cursor, running counters) lives in the DB,
  // so a fresh call after start(), resume(), or restart continues from where it left
  // off. Pacing (per-message randomized delay + batch pause) and the send path
  // (messagesService → send-gate) are unchanged, preserving anti-ban governance.
  private async runExecution(broadcastId: string) {
    const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
    if (!broadcast || broadcast.status !== 'running') {
      this.logger.log(`Broadcast ${broadcastId}: Nothing to execute (status: ${broadcast?.status})`);
      return;
    }

    const profileId = broadcast.profileId;
    const message = broadcast.message as any;
    const settings = (broadcast.settings as any) || {};
    const phones: string[] = Array.isArray(broadcast.resolvedRecipients)
      ? (broadcast.resolvedRecipients as string[])
      : [];

    const delayMin = settings?.delayMin || 3000;
    const delayMax = settings?.delayMax || 10000;
    const batchSize = settings?.batchSize || 50;
    const retryFailed = settings?.retryFailed ?? true;
    const retryAttempts = settings?.retryAttempts || 3;

    // Resume from persisted cursor; seed counters from persisted stats so a resumed
    // or recovered run keeps counting rather than resetting to zero.
    let cursor = broadcast.cursor || 0;
    const persistedStats = (broadcast.stats as any) || {};
    let sentCount = persistedStats.sent || 0;
    let failedCount = persistedStats.failed || 0;

    this.logger.log(
      `Broadcast ${broadcastId}: Executing from index ${cursor}/${phones.length} recipients`,
    );

    for (let i = cursor; i < phones.length; i++) {
      // Check if broadcast was paused or cancelled between messages.
      const current = await prisma.broadcast.findUnique({
        where: { id: broadcastId },
        select: { status: true },
      });
      if (!current || current.status !== 'running') {
        this.logger.log(`Broadcast ${broadcastId}: Stopped (status: ${current?.status})`);
        return;
      }

      // Advance the cursor BEFORE sending. If we crash during the send, recovery
      // resumes at i+1 and this recipient is skipped rather than re-sent — we
      // prefer a missed message over a duplicate (spam/ban risk).
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { cursor: i + 1 } });

      const phone = phones[i];
      let success = false;
      let attempts = 0;

      while (!success && attempts < (retryFailed ? retryAttempts : 1)) {
        attempts++;
        try {
          // Resolve message content with template variables
          const messageText = this.resolveTemplate(message, phone);

          // Send based on message type
          switch (message.type) {
            case 'image':
              await this.messagesService.sendImage({
                profileId,
                to: phone,
                url: message.url,
                caption: messageText || undefined,
                mimetype: message.mimetype,
              });
              break;
            case 'video':
              await this.messagesService.sendVideo({
                profileId,
                to: phone,
                url: message.url,
                caption: messageText || undefined,
                mimetype: message.mimetype,
              });
              break;
            case 'audio':
              await this.messagesService.sendAudio({
                profileId,
                to: phone,
                url: message.url,
                mimetype: message.mimetype,
              });
              break;
            case 'document':
              await this.messagesService.sendDocument({
                profileId,
                to: phone,
                url: message.url,
                filename: message.filename,
                caption: messageText || undefined,
                mimetype: message.mimetype,
              });
              break;
            default:
              // Text message
              await this.messagesService.sendText({
                profileId,
                to: phone,
                text: messageText,
              });
          }

          sentCount++;
          success = true;
          this.logger.debug(`Broadcast ${broadcastId}: Sent ${sentCount}/${phones.length} to ${phone}`);
        } catch (error: any) {
          this.logger.warn(`Broadcast ${broadcastId}: Failed to send to ${phone} (attempt ${attempts}): ${error.message}`);
          if (attempts >= (retryFailed ? retryAttempts : 1)) {
            failedCount++;
          } else {
            // Wait before retry
            await this.delay(1000);
          }
        }
      }

      // Update stats periodically (every message)
      await prisma.broadcast.update({
        where: { id: broadcastId },
        data: {
          stats: {
            total: phones.length,
            pending: phones.length - sentCount - failedCount,
            sent: sentCount,
            delivered: sentCount, // Assume delivered = sent for now
            read: 0,
            failed: failedCount,
          },
        },
      });

      // Delay between messages (randomized)
      if (i < phones.length - 1) {
        const delayMs = Math.floor(Math.random() * (delayMax - delayMin) + delayMin);
        this.logger.debug(`Broadcast ${broadcastId}: Waiting ${delayMs}ms before next message`);
        await this.delay(delayMs);
      }

      // Batch pause
      if (batchSize > 0 && (i + 1) % batchSize === 0 && i < phones.length - 1) {
        this.logger.log(`Broadcast ${broadcastId}: Batch of ${batchSize} complete, pausing 30s`);
        await this.delay(30000);
      }
    }

    // Mark as completed
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        stats: {
          total: phones.length,
          pending: 0,
          sent: sentCount,
          delivered: sentCount,
          read: 0,
          failed: failedCount,
        },
      },
    });

    this.logger.log(`Broadcast ${broadcastId}: Completed. Sent: ${sentCount}, Failed: ${failedCount}`);
  }

  // Resolve template variables in message
  private resolveTemplate(message: any, phone: string): string {
    if (typeof message === 'string') return message;
    if (message?.text) return message.text;
    if (message?.type === 'text' && message?.text) return message.text;
    return JSON.stringify(message);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Pause broadcast
  async pause(id: string) {
    const broadcast = await this.findOne(id);
    
    if (broadcast.status !== 'running') {
      throw new BadRequestException('Can only pause running broadcasts');
    }

    return prisma.broadcast.update({
      where: { id },
      data: { status: 'paused' },
    });
  }

  // Resume broadcast
  async resume(id: string) {
    const broadcast = await this.findOne(id);

    if (broadcast.status !== 'paused') {
      throw new BadRequestException('Can only resume paused broadcasts');
    }

    // A paused broadcast retains its recipient snapshot and cursor, so we simply flip
    // it back to running and re-launch — execution continues from the exact recipient
    // it stopped on. (The old code re-resolved recipients and sliced by stats.sent,
    // which mis-aligned whenever a send had failed or the underlying contacts changed.)
    if (!Array.isArray(broadcast.resolvedRecipients)) {
      // Legacy broadcast started before durable execution existed — restart cleanly.
      return this.start(id);
    }

    await prisma.broadcast.update({
      where: { id },
      data: { status: 'running' },
    });

    this.launchExecution(id);

    return { success: true, message: 'Broadcast resumed' };
  }

  // Cancel broadcast
  async cancel(id: string) {
    const broadcast = await this.findOne(id);
    
    if (['completed', 'failed'].includes(broadcast.status)) {
      throw new BadRequestException('Broadcast already completed or failed');
    }

    return prisma.broadcast.update({
      where: { id },
      data: { 
        status: 'failed',
        completedAt: new Date(),
      },
    });
  }

  // Get detailed stats
  async getStats(id: string) {
    const broadcast = await this.findOne(id);
    const stats = broadcast.stats as any;

    return {
      id: broadcast.id,
      name: broadcast.name,
      status: broadcast.status,
      scheduledAt: broadcast.scheduledAt,
      startedAt: broadcast.startedAt,
      completedAt: broadcast.completedAt,
      stats: {
        ...stats,
        successRate: stats.total > 0 
          ? Math.round((stats.delivered / stats.total) * 100) 
          : 0,
        progress: stats.total > 0 
          ? Math.round(((stats.sent + stats.failed) / stats.total) * 100) 
          : 0,
      },
      duration: broadcast.startedAt && broadcast.completedAt
        ? Math.round((broadcast.completedAt.getTime() - broadcast.startedAt.getTime()) / 1000)
        : null,
    };
  }

  // Get recipients with status
  async getRecipients(id: string, options: { status?: string; limit?: number; offset?: number }) {
    // This would query a broadcast_recipients table in production
    // For now, return mock data structure
    return {
      recipients: [],
      total: 0,
      limit: options.limit || 50,
      offset: options.offset || 0,
    };
  }

  // Calculate recipient count based on recipients config
  private async calculateRecipientCount(broadcast: any): Promise<number> {
    const recipients = broadcast.recipients as any;
    
    switch (recipients.type) {
      case 'tags':
        return prisma.contact.count({
          where: {
            profileId: broadcast.profileId,
            tags: { hasSome: recipients.value },
          },
        });
        
      case 'contacts':
        return recipients.value.length;
        
      case 'all':
        return prisma.contact.count({
          where: { profileId: broadcast.profileId },
        });
        
      default:
        return 0;
    }
  }

  // Update broadcast stats (called by worker)
  async updateStats(id: string, updates: Partial<{
    sent: number;
    delivered: number;
    read: number;
    failed: number;
  }>) {
    const broadcast = await this.findOne(id);
    const currentStats = broadcast.stats as any;

    const newStats = {
      ...currentStats,
      ...Object.fromEntries(
        Object.entries(updates).map(([k, v]) => [k, (currentStats[k] || 0) + v])
      ),
    };
    
    newStats.pending = newStats.total - newStats.sent - newStats.failed;

    // Check if completed
    const isComplete = newStats.pending <= 0;

    return prisma.broadcast.update({
      where: { id },
      data: {
        stats: newStats,
        status: isComplete ? 'completed' : broadcast.status,
        completedAt: isComplete ? new Date() : undefined,
      },
    });
  }
}
