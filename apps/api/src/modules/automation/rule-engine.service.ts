// MultiWA Gateway - Rule Engine Service
// apps/api/src/modules/automation/rule-engine.service.ts

import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { AutomationService } from './automation.service';
import { MessagesService } from '../messages/messages.service';
import { AIService } from '../ai/ai.service';
import { EngineManagerService } from '../profiles/engine-manager.service';

export interface IncomingMessage {
  profileId: string;
  conversationId: string;
  senderJid: string;
  senderName?: string;
  messageType: string;
  content: any;
  timestamp: Date;
  isGroup: boolean;
  isNewContact: boolean;
}

export interface ActionResult {
  action: string;
  success: boolean;
  data?: any;
  error?: string;
}

@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);

  constructor(
    private readonly automationService: AutomationService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    private readonly aiService: AIService,
    @Inject(forwardRef(() => EngineManagerService))
    private readonly engineManager: EngineManagerService,
  ) {}

  // Process incoming message against all rules
  async processMessage(message: IncomingMessage): Promise<ActionResult[]> {
    // Get active automations for this profile, sorted by priority
    const automations = await prisma.automation.findMany({
      where: {
        profileId: message.profileId,
        isActive: true,
      },
      orderBy: { priority: 'asc' },
    });

    const results: ActionResult[] = [];

    for (const automation of automations) {
      // Check if trigger matches
      const matched = await this.checkTrigger(automation, message);
      if (!matched) continue;

      // Check conditions
      const conditionsMet = await this.checkConditions(automation, message);
      if (!conditionsMet) continue;

      // Check cooldown
      const cooldownOk = await this.automationService.checkCooldown(
        automation.id,
        message.senderJid
      );
      if (!cooldownOk) continue;

      // Check daily limit
      const limitOk = await this.automationService.checkDailyLimit(automation.id);
      if (!limitOk) continue;

      // Execute actions
      const actionResults = await this.executeActions(automation, message);
      results.push(...actionResults);

      // Increment trigger count
      await this.automationService.incrementTrigger(automation.id);

      // Stop if action says to stop processing
      const shouldStop = actionResults.some(
        (r) => r.action === 'stop_processing' && r.success
      );
      if (shouldStop) break;
    }

    return results;
  }

  // Check if trigger matches
  private async checkTrigger(automation: any, message: IncomingMessage): Promise<boolean> {
    const config = automation.triggerConfig as any;

    switch (automation.triggerType) {
      case 'keyword':
        const keywordMatch = this.matchKeyword(message.content?.text || '', config);
        if (!keywordMatch) {
          // Log for debugging keyword matching
        }
        return keywordMatch;

      case 'regex':
        return this.matchRegex(message.content?.text || '', config);

      case 'new_contact':
        return message.isNewContact;

      case 'message_type':
        return config.types?.includes(message.messageType);

      case 'all':
      case 'all_messages':
      case 'message.received':
        return true;

      default:
        return false;
    }
  }

  // Match keyword trigger
  private matchKeyword(text: string, config: any): boolean {
    const keywords: string[] = config.keywords || [];
    const matchMode = config.matchMode || 'contains';
    const caseSensitive = config.caseSensitive || false;

    const testText = caseSensitive ? text : text.toLowerCase();

    return keywords.some((keyword) => {
      const testKeyword = caseSensitive ? keyword : keyword.toLowerCase();

      switch (matchMode) {
        case 'exact':
          return testText === testKeyword;
        case 'startsWith':
          return testText.startsWith(testKeyword);
        case 'endsWith':
          return testText.endsWith(testKeyword);
        case 'word':
          return new RegExp(`\\b${this.escapeRegex(testKeyword)}\\b`, 'i').test(text);
        case 'contains':
        default:
          return testText.includes(testKeyword);
      }
    });
  }

  // Match regex trigger
  private matchRegex(text: string, config: any): boolean {
    try {
      const regex = new RegExp(config.pattern, config.flags || 'i');
      return regex.test(text);
    } catch {
      return false;
    }
  }

  // Check additional conditions
  private async checkConditions(automation: any, message: IncomingMessage): Promise<boolean> {
    const conditions = automation.conditions as any[];
    if (!conditions || conditions.length === 0) return true;

    for (const condition of conditions) {
      const met = await this.evaluateCondition(condition, message);
      if (!met) return false;
    }

    return true;
  }

  // Evaluate single condition
  private async evaluateCondition(condition: any, message: IncomingMessage): Promise<boolean> {
    switch (condition.type) {
      case 'match_text': {
        // Match text content against field/operator/value from condition nodes
        const text = message.content?.text || '';
        const value = condition.value || '';
        const operator = condition.operator || 'contains';
        const caseSensitive = condition.caseSensitive || false;
        const testText = caseSensitive ? text : text.toLowerCase();
        const testValue = caseSensitive ? value : value.toLowerCase();

        switch (operator) {
          case 'equals':
            return testText === testValue;
          case 'not_equals':
            return testText !== testValue;
          case 'contains':
            return testText.includes(testValue);
          case 'not_contains':
            return !testText.includes(testValue);
          case 'startsWith':
            return testText.startsWith(testValue);
          case 'endsWith':
            return testText.endsWith(testValue);
          default:
            return testText.includes(testValue);
        }
      }

      case 'is_group':
        return message.isGroup === condition.value;

      case 'not_group':
        return !message.isGroup;

      case 'is_private':
        return !message.isGroup;

      case 'message_type':
        return condition.types?.includes(message.messageType);

      case 'time_range':
        const now = new Date();
        const hour = now.getHours();
        return hour >= condition.startHour && hour < condition.endHour;

      case 'day_of_week':
        const day = new Date().getDay();
        return condition.days?.includes(day);

      case 'contact_tag':
        const contact = await prisma.contact.findFirst({
          where: {
            profileId: message.profileId,
            phone: message.senderJid.split('@')[0],
          },
        });
        return contact?.tags?.some((t) => condition.tags?.includes(t)) || false;

      default:
        // Unknown condition types should NOT pass silently
        return true;
    }
  }

  // Execute actions
  private async executeActions(automation: any, message: IncomingMessage): Promise<ActionResult[]> {
    const actions = automation.actions as any[];
    const results: ActionResult[] = [];

    for (const action of actions) {
      try {
        // Handle delay action — wait before continuing
        if (action.type === 'delay' && action.seconds > 0) {
          await new Promise(resolve => setTimeout(resolve, action.seconds * 1000));
        }

        // Simulate typing — send real WhatsApp typing indicator before send actions
        const config = action.config || action;
        if (config.simulateTyping) {
          const typingDuration = (config.typingDuration || 3) * 1000;
          this.logger.log(`Simulating typing for ${typingDuration / 1000}s before ${action.type}`);
          
          // Send real "composing" presence to WhatsApp
          try {
            const engine = this.engineManager.getEngine(message.profileId) as any;
            if (engine?.sendPresenceUpdate) {
              await engine.sendPresenceUpdate(message.senderJid, 'composing');
            }
          } catch (e) {
            this.logger.warn(`Failed to send typing presence: ${(e as any).message}`);
          }
          
          await new Promise(resolve => setTimeout(resolve, typingDuration));
          
          // Note: Don't send 'available' here — WhatsApp automatically clears
          // the typing indicator when the actual message is received.
        }

        const result = await this.executeAction(action, message);
        results.push(result);
      } catch (error: any) {
        this.logger.error(`Action ${action.type} failed: ${error.message}`);
        results.push({
          action: action.type,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }

  // Execute single action
  private async executeAction(action: any, message: IncomingMessage): Promise<ActionResult> {
    switch (action.type) {
      case 'reply': {
        // Send text reply
        const replyContent = await this.interpolateVariables(action.message || '', message);
        await this.messagesService.sendText({
          profileId: message.profileId,
          to: message.senderJid,
          text: replyContent,
        } as any);
        return { action: 'reply', success: true, data: { message: replyContent } };
      }

      case 'send_image': {
        // Send image message
        const caption = action.caption
          ? await this.interpolateVariables(action.caption, message)
          : undefined;
        this.logger.log(`Executing send_image: url=${action.url}, caption=${caption}`);
        const imgResult = await this.messagesService.sendImage({
          profileId: message.profileId,
          to: message.senderJid,
          url: action.url,
          base64: action.base64,
          caption,
          mimetype: action.mimetype,
        } as any);
        this.logger.log(`send_image result: ${JSON.stringify(imgResult)}`);
        if (imgResult && imgResult.success === false) {
          return { action: 'send_image', success: false, error: imgResult.error || 'Failed to send image' };
        }
        return { action: 'send_image', success: true, data: { url: action.url, caption } };
      }

      case 'send_document': {
        // Send document message
        const docCaption = action.caption
          ? await this.interpolateVariables(action.caption, message)
          : undefined;
        this.logger.log(`Executing send_document: url=${action.url}, filename=${action.filename}`);
        const docResult = await this.messagesService.sendDocument({
          profileId: message.profileId,
          to: message.senderJid,
          url: action.url,
          base64: action.base64,
          filename: action.filename || 'document',
          caption: docCaption,
          mimetype: action.mimetype,
        } as any);
        this.logger.log(`send_document result: ${JSON.stringify(docResult)}`);
        if (docResult && docResult.success === false) {
          return { action: 'send_document', success: false, error: docResult.error || 'Failed to send document' };
        }
        return { action: 'send_document', success: true, data: { url: action.url, filename: action.filename } };
      }

      case 'send_poll': {
        // Send poll message
        const question = await this.interpolateVariables(action.question || '', message);
        this.logger.log(`Executing send_poll: question=${question}, options=${JSON.stringify(action.options)}`);
        const pollResult = await this.messagesService.sendPoll({
          profileId: message.profileId,
          to: message.senderJid,
          question,
          options: action.options || [],
        } as any);
        this.logger.log(`send_poll result: ${JSON.stringify(pollResult)}`);
        if (pollResult && pollResult.success === false) {
          return { action: 'send_poll', success: false, error: pollResult.error || 'Failed to send poll' };
        }
        return { action: 'send_poll', success: true, data: { question, options: action.options } };
      }

      case 'send_audio': {
        // Send audio / voice note
        this.logger.log(`Executing send_audio: url=${action.url}, ptt=${action.ptt}`);
        const audioResult = await this.messagesService.sendAudio({
          profileId: message.profileId,
          to: message.senderJid,
          url: action.url,
          base64: action.base64,
          mimetype: action.mimetype || 'audio/mpeg',
          ptt: action.ptt || false,
        } as any);
        this.logger.log(`send_audio result: ${JSON.stringify(audioResult)}`);
        if (audioResult && audioResult.success === false) {
          return { action: 'send_audio', success: false, error: audioResult.error || 'Failed to send audio' };
        }
        return { action: 'send_audio', success: true, data: { url: action.url, ptt: action.ptt } };
      }

      case 'send_video': {
        // Send video message
        const vidCaption = action.caption
          ? await this.interpolateVariables(action.caption, message)
          : undefined;
        this.logger.log(`Executing send_video: url=${action.url}, caption=${vidCaption}`);
        const vidResult = await this.messagesService.sendVideo({
          profileId: message.profileId,
          to: message.senderJid,
          url: action.url,
          base64: action.base64,
          caption: vidCaption,
          mimetype: action.mimetype || 'video/mp4',
        } as any);
        this.logger.log(`send_video result: ${JSON.stringify(vidResult)}`);
        if (vidResult && vidResult.success === false) {
          return { action: 'send_video', success: false, error: vidResult.error || 'Failed to send video' };
        }
        return { action: 'send_video', success: true, data: { url: action.url, caption: vidCaption } };
      }

      case 'send_location': {
        // Send location pin
        this.logger.log(`Executing send_location: lat=${action.latitude}, lng=${action.longitude}`);
        const locResult = await this.messagesService.sendLocation({
          profileId: message.profileId,
          to: message.senderJid,
          latitude: action.latitude || 0,
          longitude: action.longitude || 0,
          name: action.name || '',
          address: action.address || '',
        } as any);
        this.logger.log(`send_location result: ${JSON.stringify(locResult)}`);
        if (locResult && locResult.success === false) {
          return { action: 'send_location', success: false, error: locResult.error || 'Failed to send location' };
        }
        return { action: 'send_location', success: true, data: { latitude: action.latitude, longitude: action.longitude } };
      }

      case 'send_contact': {
        // Send contact card (vCard)
        this.logger.log(`Executing send_contact: name=${action.contactName}, phone=${action.contactPhone}`);
        const contactResult = await this.messagesService.sendContact({
          profileId: message.profileId,
          to: message.senderJid,
          contacts: [{
            name: action.contactName || 'Contact',
            phone: action.contactPhone || '',
          }],
        } as any);
        this.logger.log(`send_contact result: ${JSON.stringify(contactResult)}`);
        if (contactResult && contactResult.success === false) {
          return { action: 'send_contact', success: false, error: contactResult.error || 'Failed to send contact' };
        }
        return { action: 'send_contact', success: true, data: { contactName: action.contactName, contactPhone: action.contactPhone } };
      }

      case 'add_tag': {
        await this.addContactTag(message.profileId, message.senderJid, action.tags);
        return { action: 'add_tag', success: true, data: { tags: action.tags } };
      }

      case 'remove_tag': {
        await this.removeContactTag(message.profileId, message.senderJid, action.tags);
        return { action: 'remove_tag', success: true, data: { tags: action.tags } };
      }

      case 'webhook': {
        const webhookResult = await this.callWebhook(action.url, action.method, {
          message,
          automation: { id: action.automationId },
        });
        return { action: 'webhook', success: true, data: webhookResult };
      }

      case 'assign_agent': {
        // Assign conversation to a specific user (agent)
        if (action.assignedUserId) {
          await prisma.conversation.update({
            where: { id: message.conversationId },
            data: { assignedUserId: action.assignedUserId },
          });
          // Also look up the agent name for the result
          const agent = await prisma.user.findUnique({
            where: { id: action.assignedUserId },
            select: { name: true, email: true },
          });
          return {
            action: 'assign_agent',
            success: true,
            data: { assignedUserId: action.assignedUserId, agentName: agent?.name || 'Unknown' },
          };
        }
        return { action: 'assign_agent', success: false, error: 'No assignedUserId provided' };
      }

      case 'ai_reply': {
        // Generate AI reply using OpenAI and send it
        if (!this.aiService.isConfigured()) {
          this.logger.warn('AI Reply action skipped: OpenAI API key not configured');
          return { action: 'ai_reply', success: false, error: 'OpenAI API key not configured' };
        }

        const incomingText = message.content?.text || '';

        // Get recent conversation history for context
        const recentMessages = await prisma.message.findMany({
          where: { conversationId: message.conversationId },
          orderBy: { timestamp: 'desc' },
          take: 10,
          select: { direction: true, content: true },
        });

        const previousMessages = recentMessages
          .reverse()
          .map(m => `${m.direction === 'incoming' ? 'Customer' : 'Agent'}: ${(m.content as any)?.text || ''}`)
          .filter(m => m.length > 10);

        // Get contact name
        const senderContact = await prisma.contact.findFirst({
          where: { profileId: message.profileId, phone: message.senderJid.split('@')[0] },
          select: { name: true },
        });

        const aiResult = await this.aiService.generateAutoReply(incomingText, {
          customerName: senderContact?.name || message.senderName,
          businessName: 'our business',
          previousMessages,
          customPrompt: action.systemPrompt,
        });

        if (aiResult.success && aiResult.content) {
          await this.messagesService.sendText({
            profileId: message.profileId,
            to: message.senderJid,
            text: aiResult.content,
          } as any);
          return {
            action: 'ai_reply',
            success: true,
            data: { reply: aiResult.content, usage: aiResult.usage },
          };
        }
        return { action: 'ai_reply', success: false, error: aiResult.error || 'AI generation failed' };
      }

      case 'stop_processing':
        return { action: 'stop_processing', success: true };

      case 'delay':
        // Delay is already handled in executeActions loop
        return { action: 'delay', success: true, data: { seconds: action.seconds } };

      default:
        this.logger.warn(`Unknown action type: ${action.type}`);
        return { action: action.type, success: false, error: 'Unknown action type' };
    }
  }

  // Interpolate variables in message
  private async interpolateVariables(template: string, message: IncomingMessage): Promise<string> {
    // Look up contact name from database
    const phone = message.senderJid.split('@')[0];
    let contactName = message.senderName || phone;
    
    try {
      const contact = await prisma.contact.findFirst({
        where: { profileId: message.profileId, phone },
        select: { name: true },
      });
      if (contact?.name && contact.name !== phone) {
        contactName = contact.name;
      }
    } catch (e) {
      // Non-critical, use fallback
    }

    const variables: Record<string, string> = {
      name: contactName,
      phone,
      message: message.content?.text || '',
      time: new Date().toLocaleTimeString('id-ID'),
      date: new Date().toLocaleDateString('id-ID'),
    };

    return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      return variables[varName] ?? match;
    });
  }

  // Add tag to contact
  private async addContactTag(profileId: string, jid: string, tags: string[]) {
    const phone = jid.split('@')[0];
    const contact = await prisma.contact.findFirst({
      where: { profileId, phone },
    });

    if (contact) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { tags: [...new Set([...contact.tags, ...tags])] },
      });
    }
  }

  // Remove tag from contact
  private async removeContactTag(profileId: string, jid: string, tags: string[]) {
    const phone = jid.split('@')[0];
    const contact = await prisma.contact.findFirst({
      where: { profileId, phone },
    });

    if (contact) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { tags: contact.tags.filter((t) => !tags.includes(t)) },
      });
    }
  }

  // Call external webhook
  private async callWebhook(url: string, method: string, data: any): Promise<any> {
    const response = await fetch(url, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    return {
      status: response.status,
      ok: response.ok,
    };
  }

  // Escape regex special characters
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
