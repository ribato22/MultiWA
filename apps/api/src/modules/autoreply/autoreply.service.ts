// MultiWA Gateway - Autoreply Service
// apps/api/src/modules/autoreply/autoreply.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { assertWebhookUrlSafe } from '@multiwa/engine-runtime';
import { CreateAutoreplyDto, UpdateAutoreplyDto, QuickReplyDto } from './dto';

// In-memory storage for quick replies and configs (would be database in production)
const quickReplies = new Map<string, any[]>();
const webhookConfigs = new Map<string, any>();
const aiConfigs = new Map<string, any>();

@Injectable()
export class AutoreplyService {
  // ============================================
  // Quick Replies (preset responses)
  // ============================================

  async createQuickReply(dto: QuickReplyDto) {
    const replies = quickReplies.get(dto.profileId) || [];
    const newReply = {
      id: `qr_${Date.now()}`,
      profileId: dto.profileId,
      shortcut: dto.shortcut,
      title: dto.title,
      message: dto.message,
      createdAt: new Date(),
    };
    replies.push(newReply);
    quickReplies.set(dto.profileId, replies);
    return newReply;
  }

  async listQuickReplies(profileId: string) {
    return quickReplies.get(profileId) || [];
  }

  async deleteQuickReply(id: string) {
    for (const [profileId, replies] of quickReplies.entries()) {
      const index = replies.findIndex(r => r.id === id);
      if (index >= 0) {
        replies.splice(index, 1);
        quickReplies.set(profileId, replies);
        return { success: true };
      }
    }
    throw new NotFoundException('Quick reply not found');
  }

  // ============================================
  // Keyword Autoreplies (uses Automation table)
  // ============================================

  async create(dto: CreateAutoreplyDto) {
    return prisma.automation.create({
      data: {
        profileId: dto.profileId,
        name: `Autoreply: ${dto.keywords.slice(0, 3).join(', ')}...`,
        isActive: dto.isActive ?? true,
        priority: 0,
        triggerType: 'keyword',
        triggerConfig: {
          keywords: dto.keywords,
          matchMode: dto.matchMode || 'contains',
          caseSensitive: false,
        },
        conditions: dto.privateOnly ? [{ type: 'not_group' }] : [],
        actions: [
          {
            type: 'reply',
            message: dto.response,
            messageType: 'text',
          },
        ],
        cooldownSecs: dto.cooldownSecs || 60,
        stats: { triggerCount: 0, lastTriggered: null, todayCount: 0 },
      },
    });
  }

  async findAll(profileId: string) {
    return prisma.automation.findMany({
      where: {
        profileId,
        triggerType: 'keyword',
        name: { startsWith: 'Autoreply:' },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const autoreply = await prisma.automation.findUnique({ where: { id } });
    if (!autoreply) throw new NotFoundException('Autoreply not found');
    return autoreply;
  }

  async update(id: string, dto: UpdateAutoreplyDto) {
    const autoreply = await this.findOne(id);
    
    const updates: any = {};
    
    if (dto.keywords) {
      updates.triggerConfig = {
        ...(autoreply.triggerConfig as any),
        keywords: dto.keywords,
        matchMode: dto.matchMode || (autoreply.triggerConfig as any).matchMode,
      };
      updates.name = `Autoreply: ${dto.keywords.slice(0, 3).join(', ')}...`;
    }
    
    if (dto.response) {
      updates.actions = [
        {
          type: 'reply',
          message: dto.response,
          messageType: 'text',
        },
      ];
    }
    
    if (dto.isActive !== undefined) {
      updates.isActive = dto.isActive;
    }
    
    if (dto.cooldownSecs !== undefined) {
      updates.cooldownSecs = dto.cooldownSecs;
    }
    
    if (dto.privateOnly !== undefined) {
      updates.conditions = dto.privateOnly ? [{ type: 'not_group' }] : [];
    }

    return prisma.automation.update({
      where: { id },
      data: updates,
    });
  }

  async delete(id: string) {
    await this.findOne(id);
    await prisma.automation.delete({ where: { id } });
    return { success: true };
  }

  async toggle(id: string) {
    const autoreply = await this.findOne(id);
    return prisma.automation.update({
      where: { id },
      data: { isActive: !autoreply.isActive },
    });
  }

  // ============================================
  // Webhook Dynamic Reply
  // ============================================

  async configureWebhookReply(profileId: string, webhookUrl: string, enabled: boolean) {
    const config = {
      profileId,
      webhookUrl,
      enabled,
      updatedAt: new Date(),
    };
    webhookConfigs.set(profileId, config);
    
    // Update profile settings
    await prisma.profile.update({
      where: { id: profileId },
      data: { webhookUrl, webhookSecret: config.enabled ? 'auto' : null },
    });
    
    return config;
  }

  async getWebhookReply(profileId: string) {
    const config = webhookConfigs.get(profileId);
    if (!config) {
      const profile = await prisma.profile.findUnique({ where: { id: profileId } });
      return {
        profileId,
        webhookUrl: profile?.webhookUrl || null,
        enabled: !!profile?.webhookUrl,
      };
    }
    return config;
  }

  // Process webhook reply (called when message received)
  async processWebhookReply(profileId: string, message: any): Promise<string | null> {
    const config = await this.getWebhookReply(profileId);
    if (!config.enabled || !config.webhookUrl) return null;

    try {
      const safeUrl = await assertWebhookUrlSafe(config.webhookUrl);
      const response = await fetch(safeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'message.received',
          profileId,
          message,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) return null;

      const data = await response.json();
      return data.reply || null;
    } catch {
      return null;
    }
  }

  // ============================================
  // AI Bot Hook
  // ============================================

  async configureAiHook(profileId: string, provider: string, config: any, enabled: boolean) {
    const aiConfig = {
      profileId,
      provider, // 'openai', 'dialogflow', 'langchain', 'custom'
      config,   // API keys, model, system prompt, etc
      enabled,
      updatedAt: new Date(),
    };
    aiConfigs.set(profileId, aiConfig);
    return { success: true, provider, enabled };
  }

  async getAiHook(profileId: string) {
    const config = aiConfigs.get(profileId);
    if (!config) {
      return { profileId, provider: null, enabled: false };
    }
    // Don't expose API keys
    return {
      profileId: config.profileId,
      provider: config.provider,
      enabled: config.enabled,
      hasConfig: !!config.config,
    };
  }

  // Process AI reply (called when message received)
  async processAiReply(profileId: string, message: string, context?: any): Promise<string | null> {
    const config = aiConfigs.get(profileId);
    if (!config?.enabled) return null;

    switch (config.provider) {
      case 'openai':
        return this.callOpenAI(config.config, message, context);
      case 'dialogflow':
        return this.callDialogflow(config.config, message, context);
      case 'custom':
        return this.callCustomAI(config.config, message, context);
      default:
        return null;
    }
  }

  // OpenAI integration
  private async callOpenAI(cfg: any, message: string, _context?: any): Promise<string | null> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model || 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: cfg.systemPrompt || 'You are a helpful WhatsApp assistant.' },
            { role: 'user', content: message },
          ],
          max_tokens: cfg.maxTokens || 500,
        }),
      });

      const data = await response.json();
      return data.choices?.[0]?.message?.content || null;
    } catch {
      return null;
    }
  }

  // Dialogflow integration (not yet implemented)
  private async callDialogflow(_cfg: any, _message: string, _context?: any): Promise<string | null> {
    // Dialogflow CX/ES integration can be added here
    return null;
  }

  // Custom AI endpoint
  private async callCustomAI(cfg: any, message: string, context?: any): Promise<string | null> {
    try {
      const safeEndpoint = await assertWebhookUrlSafe(cfg.endpoint);
      const response = await fetch(safeEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.headers || {}),
        },
        body: JSON.stringify({ message, context, ...cfg.body }),
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });

      const data = await response.json();
      return data.reply || data.response || data.text || null;
    } catch {
      return null;
    }
  }
}
