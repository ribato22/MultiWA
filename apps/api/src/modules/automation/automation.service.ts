// MultiWA Gateway - Automation Service
// apps/api/src/modules/automation/automation.service.ts

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { CreateAutomationDto, UpdateAutomationDto } from './dto';

@Injectable()
export class AutomationService {
  // Create automation
  async create(dto: CreateAutomationDto) {
    // Get max priority
    const maxPriority = await prisma.automation.aggregate({
      where: { profileId: dto.profileId },
      _max: { priority: true },
    });

    return prisma.automation.create({
      data: {
        profileId: dto.profileId,
        name: dto.name,
        isActive: dto.isActive ?? true,
        priority: (maxPriority._max.priority || 0) + 1,
        triggerType: dto.triggerType,
        triggerConfig: dto.triggerConfig,
        conditions: (dto.conditions || []) as any,
        actions: dto.actions as any,
        cooldownSecs: dto.cooldownSecs || 0,
        maxTriggersPerDay: dto.maxTriggersPerDay,
        stats: {
          triggerCount: 0,
          lastTriggered: null,
          todayCount: 0,
        },
      },
    });
  }

  // List automations
  async findAll(profileId: string, options: { triggerType?: string; isActive?: boolean }) {
    const where: any = { profileId };
    if (options.triggerType) where.triggerType = options.triggerType;
    if (options.isActive !== undefined) where.isActive = options.isActive;

    return prisma.automation.findMany({
      where,
      orderBy: { priority: 'asc' },
    });
  }

  // Get automation by ID
  async findOne(id: string) {
    const automation = await prisma.automation.findUnique({ where: { id } });
    if (!automation) throw new NotFoundException('Automation not found');
    return automation;
  }

  // Update automation
  async update(id: string, dto: UpdateAutomationDto) {
    await this.findOne(id);
    return prisma.automation.update({
      where: { id },
      data: dto as any,
    });
  }

  // Delete automation
  async delete(id: string) {
    await this.findOne(id);
    await prisma.automation.delete({ where: { id } });
    return { success: true };
  }

  // Toggle active state
  async toggle(id: string) {
    const automation = await this.findOne(id);
    return prisma.automation.update({
      where: { id },
      data: { isActive: !automation.isActive },
    });
  }

  // Test rule with sample message
  async testRule(id: string, message: string) {
    const automation = await this.findOne(id);
    const config = automation.triggerConfig as any;
    
    let matches = false;
    let matchDetails: any = {};

    switch (automation.triggerType) {
      case 'keyword':
        const keywords = config.keywords || [];
        const matchMode = config.matchMode || 'contains';
        const caseSensitive = config.caseSensitive || false;
        
        const testMsg = caseSensitive ? message : message.toLowerCase();
        
        for (const keyword of keywords) {
          const testKeyword = caseSensitive ? keyword : keyword.toLowerCase();
          
          if (matchMode === 'exact' && testMsg === testKeyword) {
            matches = true;
            matchDetails.matchedKeyword = keyword;
            break;
          } else if (matchMode === 'startsWith' && testMsg.startsWith(testKeyword)) {
            matches = true;
            matchDetails.matchedKeyword = keyword;
            break;
          } else if (matchMode === 'contains' && testMsg.includes(testKeyword)) {
            matches = true;
            matchDetails.matchedKeyword = keyword;
            break;
          }
        }
        break;

      case 'regex':
        try {
          const regex = new RegExp(config.pattern, config.flags || 'i');
          const regexMatch = message.match(regex);
          if (regexMatch) {
            matches = true;
            matchDetails.match = regexMatch[0];
            matchDetails.groups = regexMatch.groups || {};
          }
        } catch (e: any) {
          return { error: `Invalid regex: ${e.message}` };
        }
        break;

      case 'new_contact':
        matches = true; // Always matches for new contacts
        matchDetails.note = 'This trigger fires for new contacts only';
        break;

      case 'schedule':
        matches = false;
        matchDetails.note = 'Schedule triggers cannot be tested with messages';
        break;

      case 'webhook':
        matches = true;
        matchDetails.note = 'This trigger fires from external webhooks';
        break;
    }

    return {
      automation: {
        id: automation.id,
        name: automation.name,
        triggerType: automation.triggerType,
      },
      testMessage: message,
      matches,
      matchDetails,
      actions: matches ? automation.actions : null,
    };
  }

  // Get automation stats
  async getStats(id: string) {
    const automation = await this.findOne(id);
    const stats = automation.stats as any;

    return {
      id: automation.id,
      name: automation.name,
      isActive: automation.isActive,
      triggerCount: stats.triggerCount || 0,
      lastTriggered: stats.lastTriggered,
      todayCount: stats.todayCount || 0,
      maxTriggersPerDay: automation.maxTriggersPerDay,
      cooldownSecs: automation.cooldownSecs,
    };
  }

  // Reorder priorities
  async reorder(profileId: string, order: string[]) {
    const updates = order.map((id, index) =>
      prisma.automation.update({
        where: { id },
        data: { priority: index + 1 },
      })
    );

    await prisma.$transaction(updates);
    return { success: true };
  }

  // Increment trigger count (called by rule engine)
  async incrementTrigger(id: string) {
    const automation = await this.findOne(id);
    const stats = automation.stats as any;

    // Reset today count if needed
    const today = new Date().toDateString();
    const lastDate = stats.lastTriggered ? new Date(stats.lastTriggered).toDateString() : null;
    const todayCount = lastDate === today ? (stats.todayCount || 0) + 1 : 1;

    await prisma.automation.update({
      where: { id },
      data: {
        stats: {
          triggerCount: (stats.triggerCount || 0) + 1,
          lastTriggered: new Date().toISOString(),
          todayCount,
        },
      },
    });
  }

  // Check cooldown
  async checkCooldown(id: string, contactJid: string): Promise<boolean> {
    const automation = await this.findOne(id);
    if (!automation.cooldownSecs) return true;

    // In production, this would check a cooldown cache (Redis)
    // For now, just check last triggered time globally
    const stats = automation.stats as any;
    if (!stats.lastTriggered) return true;

    const elapsed = (Date.now() - new Date(stats.lastTriggered).getTime()) / 1000;
    return elapsed >= automation.cooldownSecs;
  }

  // Check daily limit
  async checkDailyLimit(id: string): Promise<boolean> {
    const automation = await this.findOne(id);
    if (!automation.maxTriggersPerDay) return true;

    const stats = automation.stats as any;
    const today = new Date().toDateString();
    const lastDate = stats.lastTriggered ? new Date(stats.lastTriggered).toDateString() : null;
    
    if (lastDate !== today) return true;
    return (stats.todayCount || 0) < automation.maxTriggersPerDay;
  }
}
