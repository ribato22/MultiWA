// apps/worker/src/processors/automation.processor.ts
import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';

const prisma = new PrismaClient();
const logger = pino({ name: 'automation-processor' });

export interface AutomationJob {
  profileId: string;
  event: string;
  messageId?: string;
  messageBody?: string;
  messageType?: string;
  contactId: string;
  contactPhone?: string;
}

export class AutomationProcessor {
  async process(job: Job<AutomationJob>) {
    const { profileId, event, messageId, messageBody, contactId } = job.data;

    // Get contact
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new Error('Contact not found');
    }

    // Get active automations (schema uses "Automation" model, not "Rule")
    const automations = await prisma.automation.findMany({
      where: { profileId, isActive: true },
      orderBy: { priority: 'desc' },
    });

    if (automations.length === 0) {
      return { matched: 0 };
    }

    logger.info({ profileId, event, automationsCount: automations.length }, 'Processing automation rules');

    const results: Array<{ automationId: string; matched: boolean; duration: number; error?: string }> = [];

    // Process each automation
    for (const automation of automations) {
      const startTime = Date.now();
      const triggerConfig = automation.triggerConfig as any;
      const conditions = automation.conditions as any;
      const actions = automation.actions as any[];

      try {
        // Check trigger type matches event
        if (automation.triggerType !== event && automation.triggerType !== '*') {
          continue;
        }

        // Check conditions
        let conditionsMatched = true;

        if (conditions && Array.isArray(conditions)) {
          for (const condition of conditions) {
            if (condition.type === 'message_contains') {
              const keywords = condition.value as string[];
              const bodyLower = (messageBody || '').toLowerCase();
              const hasMatch = keywords.some(kw => bodyLower.includes(kw.toLowerCase()));
              if (!hasMatch) {
                conditionsMatched = false;
                break;
              }
            }

            if (condition.type === 'message_matches') {
              const pattern = new RegExp(condition.value as string, 'i');
              if (!pattern.test(messageBody || '')) {
                conditionsMatched = false;
                break;
              }
            }

            if (condition.type === 'contact_has_tag') {
              const requiredTag = condition.value as string;
              if (!contact.tags.includes(requiredTag)) {
                conditionsMatched = false;
                break;
              }
            }
          }
        }

        if (!conditionsMatched) {
          results.push({
            automationId: automation.id,
            matched: false,
            duration: Date.now() - startTime,
          });
          continue;
        }

        // Execute actions
        for (const action of actions) {
          if (action.type === 'send_message') {
            // Get or create conversation  
            let conversation = await prisma.conversation.findFirst({
              where: { profileId, contactId },
            });

            if (!conversation) {
              const jid = contact.phone.includes('@') ? contact.phone : `${contact.phone}@s.whatsapp.net`;
              conversation = await prisma.conversation.create({
                data: { profileId, contactId, jid },
              });
            }

            // Create reply message with all required fields
            await prisma.message.create({
              data: {
                profileId,
                conversationId: conversation.id,
                messageId: `auto_${automation.id}_${Date.now()}`,
                direction: 'outgoing',
                senderJid: 'self',
                type: 'text',
                content: { text: action.value as string },
                status: 'pending',
                timestamp: new Date(),
                metadata: { triggeredByAutomation: automation.id },
              },
            });
          }

          if (action.type === 'add_tag') {
            const newTags = [...new Set([...contact.tags, action.value as string])];
            await prisma.contact.update({
              where: { id: contactId },
              data: { tags: newTags },
            });
          }

          if (action.type === 'remove_tag') {
            const newTags = contact.tags.filter((t: string) => t !== action.value);
            await prisma.contact.update({
              where: { id: contactId },
              data: { tags: newTags },
            });
          }
        }

        results.push({
          automationId: automation.id,
          matched: true,
          duration: Date.now() - startTime,
        });

        // Update automation stats
        const currentStats = (automation.stats as any) || {};
        await prisma.automation.update({
          where: { id: automation.id },
          data: {
            stats: {
              ...currentStats,
              trigger_count: (currentStats.trigger_count || 0) + 1,
              last_triggered: new Date().toISOString(),
            },
          },
        });

      } catch (error: any) {
        results.push({
          automationId: automation.id,
          matched: true,
          duration: Date.now() - startTime,
          error: error.message,
        });

        logger.error({ automationId: automation.id, error: error.message }, 'Automation execution failed');
      }
    }

    return {
      matched: results.filter(r => r.matched).length,
      results,
    };
  }
}
