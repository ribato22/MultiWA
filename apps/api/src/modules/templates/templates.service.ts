// MultiWA Gateway - Templates Service
// apps/api/src/modules/templates/templates.service.ts

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { CreateTemplateDto, UpdateTemplateDto } from './dto';

@Injectable()
export class TemplatesService {
  // Create template
  async create(dto: CreateTemplateDto) {
    // Check for duplicate name
    const existing = await prisma.template.findFirst({
      where: { profileId: dto.profileId, name: dto.name },
    });
    if (existing) throw new ConflictException('Template with this name already exists');

    // Extract variables from content
    const variables = this.extractVariables(dto.content);

    return prisma.template.create({
      data: {
        profileId: dto.profileId,
        name: dto.name,
        category: dto.category,
        messageType: dto.messageType,
        content: dto.content,
        variables,
      },
    });
  }

  // List templates
  async findAll(profileId: string, options: { category?: string; search?: string }) {
    const where: any = { profileId };
    
    if (options.category) {
      where.category = options.category;
    }
    
    if (options.search) {
      where.OR = [
        { name: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    return prisma.template.findMany({
      where,
      orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  // Get template by ID
  async findOne(id: string) {
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  // Update template
  async update(id: string, dto: UpdateTemplateDto) {
    const template = await this.findOne(id);

    // Check for duplicate name if changing
    if (dto.name && dto.name !== template.name) {
      const existing = await prisma.template.findFirst({
        where: { profileId: template.profileId, name: dto.name, id: { not: id } },
      });
      if (existing) throw new ConflictException('Template with this name already exists');
    }

    // Re-extract variables if content changed
    let variables = template.variables;
    if (dto.content) {
      variables = this.extractVariables(dto.content);
    }

    return prisma.template.update({
      where: { id },
      data: { ...dto, variables },
    });
  }

  // Delete template
  async delete(id: string) {
    await this.findOne(id);
    await prisma.template.delete({ where: { id } });
    return { success: true };
  }

  // Preview template with variables
  async preview(id: string, variables: Record<string, string>) {
    const template = await this.findOne(id);
    const rendered = this.renderTemplate(template.content as any, variables);
    
    return {
      template: template.name,
      original: template.content,
      rendered,
      variables: template.variables,
    };
  }

  // Duplicate template
  async duplicate(id: string, newName: string) {
    const template = await this.findOne(id);
    
    return prisma.template.create({
      data: {
        profileId: template.profileId,
        name: newName,
        category: template.category,
        messageType: template.messageType,
        content: template.content as any,
        variables: template.variables,
      },
    });
  }

  // Increment usage count
  async incrementUsage(id: string) {
    return prisma.template.update({
      where: { id },
      data: { usageCount: { increment: 1 } },
    });
  }

  // Render template with variables
  renderTemplate(content: any, variables: Record<string, string>): any {
    if (typeof content === 'string') {
      return this.replaceVariables(content, variables);
    }
    
    if (typeof content === 'object' && content !== null) {
      const rendered: any = {};
      for (const [key, value] of Object.entries(content)) {
        rendered[key] = this.renderTemplate(value, variables);
      }
      return rendered;
    }
    
    return content;
  }

  // Replace variables in string
  private replaceVariables(text: string, variables: Record<string, string>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      return variables[varName] ?? match;
    });
  }

  // Extract variables from content
  private extractVariables(content: any): string[] {
    const text = JSON.stringify(content);
    const matches = text.match(/\{\{(\w+)\}\}/g) || [];
    const variables = matches.map(m => m.replace(/\{\{|\}\}/g, ''));
    return [...new Set(variables)];
  }
}
