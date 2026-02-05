// MultiWA Gateway - Conversations Service
// apps/api/src/modules/conversations/conversations.service.ts

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { GroupsService } from '../groups/groups.service';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly groupsService: GroupsService) {}

  // List conversations
  async findAll(profileId: string, options: {
    type?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = { profileId };
    
    if (options.type) {
      where.type = options.type;
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        take: options.limit || 50,
        skip: options.offset || 0,
        orderBy: { lastMessageAt: 'desc' },
        include: {
          _count: { select: { messages: true } },
          contact: { select: { name: true, phone: true } },
          messages: {
            take: 1,
            orderBy: { timestamp: 'desc' },
          },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    // For conversations without a contact, try to resolve names by JID phone number
    const unlinkedConvs = conversations.filter(c => !c.contact && c.jid?.includes('@s.whatsapp.net'));
    let phoneToName: Record<string, string> = {};
    
    if (unlinkedConvs.length > 0) {
      const phones = unlinkedConvs.map(c => c.jid.split('@')[0]);
      const contacts = await prisma.contact.findMany({
        where: {
          profileId,
          phone: { in: phones },
        },
        select: { phone: true, name: true },
      });
      for (const ct of contacts) {
        if (ct.phone && ct.name) {
          phoneToName[ct.phone] = ct.name;
        }
      }
    }

    // Resolve group names from WhatsApp engine (per-JID for reliability)
    const groupConvs = conversations.filter(c => 
      (c.type === 'group' || c.jid?.includes('@g.us')) &&
      (!c.name || /^[0-9]+(@g\.us|@s\.whatsapp\.net)?$/.test(c.name) || c.name === c.jid)
    );
    let groupJidToName: Record<string, string> = {};

    if (groupConvs.length > 0) {
      // Resolve each group name individually (faster than loading all 270+ groups)
      const resolvePromises = groupConvs.map(async (gc) => {
        try {
          const groupInfo = await this.groupsService.getById(profileId, gc.jid);
          if (groupInfo?.name) {
            groupJidToName[gc.jid] = groupInfo.name;
            // Update DB for future lookups
            prisma.conversation.update({
              where: { id: gc.id },
              data: { name: groupInfo.name },
            }).catch(() => {}); // fire-and-forget
          }
        } catch {
          // Engine not connected or group not found — skip silently
        }
      });
      await Promise.allSettled(resolvePromises);
    }

    return {
      conversations: conversations.map((c) => {
        const jidPhone = c.jid?.split('@')[0] || '';
        const isGroup = c.type === 'group' || c.jid?.includes('@g.us');
        const resolvedName = c.contact?.name || phoneToName[jidPhone] || null;
        
        // For groups: try real name from engine, fall back to stored name, then 'Group Chat'
        const isJidLikeName = !c.name || /^[0-9]+(@g\.us|@s\.whatsapp\.net)?$/.test(c.name) || c.name === c.jid;
        const displayName = isGroup
          ? (groupJidToName[c.jid] || (isJidLikeName ? 'Group Chat' : c.name))
          : resolvedName;

        return {
          ...c,
          messageCount: c._count.messages,
          lastMessage: c.messages[0] || null,
          contactName: displayName,
          contactPhone: c.contact?.phone || (c.jid?.includes('@s.whatsapp.net') ? jidPhone : null),
          messages: undefined,
          _count: undefined,
          contact: undefined,
        };
      }),
      total,
    };
  }

  // Get conversation with recent messages
  async findOne(id: string, messageLimit = 50) {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          take: messageLimit,
          orderBy: { timestamp: 'desc' },
        },
        contact: true,
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');
    
    // Reverse messages to chronological order
    conversation.messages.reverse();
    
    return conversation;
  }

  // Mark conversation as read
  async markAsRead(id: string) {
    await prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
    });

    // Mark all messages as read
    await prisma.message.updateMany({
      where: { conversationId: id, status: { not: 'read' } },
      data: { status: 'read' },
    });

    return { success: true };
  }

  // Archive conversation
  async archive(id: string) {
    await prisma.conversation.update({
      where: { id },
      data: { metadata: { archived: true } },
    });
    return { success: true };
  }

  // Unarchive conversation
  async unarchive(id: string) {
    await prisma.conversation.update({
      where: { id },
      data: { metadata: { archived: false } },
    });
    return { success: true };
  }

  // Toggle mute conversation
  async toggleMute(id: string) {
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const meta = (conversation.metadata as any) || {};
    const isMuted = !meta.isMuted;
    await prisma.conversation.update({
      where: { id },
      data: { metadata: { ...meta, isMuted } },
    });
    return { success: true, isMuted };
  }

  // Toggle pin conversation
  async togglePin(id: string) {
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const meta = (conversation.metadata as any) || {};
    const isPinned = !meta.isPinned;
    await prisma.conversation.update({
      where: { id },
      data: { metadata: { ...meta, isPinned } },
    });
    return { success: true, isPinned };
  }

  // Clear all messages in conversation (without deleting the conversation)
  async clearMessages(id: string) {
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    await prisma.message.deleteMany({ where: { conversationId: id } });
    await prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0, lastMessageAt: null },
    });
    return { success: true };
  }

  // Delete conversation and messages
  async delete(id: string) {
    await prisma.message.deleteMany({ where: { conversationId: id } });
    await prisma.conversation.delete({ where: { id } });
    return { success: true };
  }

  // Get messages with pagination
  async getMessages(id: string, options: { limit?: number; before?: string }) {
    const where: any = { conversationId: id };
    
    if (options.before) {
      const beforeMsg = await prisma.message.findUnique({
        where: { id: options.before },
        select: { timestamp: true },
      });
      if (beforeMsg) {
        where.timestamp = { lt: beforeMsg.timestamp };
      }
    }

    const messages = await prisma.message.findMany({
      where,
      take: options.limit || 50,
      orderBy: { timestamp: 'desc' },
    });

    // Reverse to chronological
    messages.reverse();

    return { messages, hasMore: messages.length === (options.limit || 50) };
  }

  // Get or create conversation
  async getOrCreate(profileId: string, jid: string, name?: string) {
    let conversation = await prisma.conversation.findFirst({
      where: { profileId, jid },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          profileId,
          jid,
          name: name || jid.split('@')[0],
          type: jid.includes('@g.us') ? 'group' : 'user',
        },
      });
    }

    return conversation;
  }

  // Increment unread count
  async incrementUnread(id: string) {
    await prisma.conversation.update({
      where: { id },
      data: { unreadCount: { increment: 1 }, lastMessageAt: new Date() },
    });
  }
}
