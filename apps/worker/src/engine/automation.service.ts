// MultiWA Gateway - Worker automation runtime
// apps/worker/src/engine/automation.service.ts
//
// Worker-local copy of the runtime parts of the API AutomationService (cooldown /
// daily-limit / trigger-count). CRUD lives only in the API. Keep in sync with
// apps/api/src/modules/automation/automation.service.ts.

import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@multiwa/database';

@Injectable()
export class WorkerAutomationService {
  private async findOne(id: string) {
    const automation = await prisma.automation.findUnique({ where: { id } });
    if (!automation) throw new NotFoundException('Automation not found');
    return automation;
  }

  async incrementTrigger(id: string): Promise<void> {
    const automation = await this.findOne(id);
    const stats = (automation.stats as any) || {};

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

  async checkCooldown(id: string, _contactJid: string): Promise<boolean> {
    const automation = await this.findOne(id);
    if (!automation.cooldownSecs) return true;
    const stats = (automation.stats as any) || {};
    if (!stats.lastTriggered) return true;
    const elapsed = (Date.now() - new Date(stats.lastTriggered).getTime()) / 1000;
    return elapsed >= automation.cooldownSecs;
  }

  async checkDailyLimit(id: string): Promise<boolean> {
    const automation = await this.findOne(id);
    if (!automation.maxTriggersPerDay) return true;
    const stats = (automation.stats as any) || {};
    const today = new Date().toDateString();
    const lastDate = stats.lastTriggered ? new Date(stats.lastTriggered).toDateString() : null;
    if (lastDate !== today) return true;
    return (stats.todayCount || 0) < automation.maxTriggersPerDay;
  }
}
