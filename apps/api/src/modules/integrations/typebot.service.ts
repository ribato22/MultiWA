// MultiWA Gateway - TypeBot Integration Service
// apps/api/src/modules/integrations/typebot.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TypeBotSession {
  sessionId: string;
  typebotId: string;
  lastMessageAt: Date;
}

export interface TypeBotMessage {
  type: 'text' | 'image' | 'audio' | 'video';
  content: string;
  options?: { label: string; value: string }[];
}

@Injectable()
export class TypeBotService {
  private readonly logger = new Logger(TypeBotService.name);
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private sessions = new Map<string, TypeBotSession>();

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get('TYPEBOT_API_URL', '');
    this.enabled = !!this.baseUrl;

    if (this.enabled) {
      this.logger.log(`TypeBot integration enabled: ${this.baseUrl}`);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Start or continue a TypeBot conversation.
   */
  async sendMessage(
    typebotId: string,
    contactJid: string,
    message: string,
  ): Promise<TypeBotMessage[]> {
    if (!this.enabled) {
      this.logger.warn('TypeBot integration not configured');
      return [];
    }

    try {
      const sessionKey = `${typebotId}:${contactJid}`;
      let session = this.sessions.get(sessionKey);

      let url: string;
      let body: any;

      if (session) {
        // Continue existing conversation
        url = `${this.baseUrl}/api/v1/sessions/${session.sessionId}/continueChat`;
        body = { message };
      } else {
        // Start new conversation
        url = `${this.baseUrl}/api/v1/typebots/${typebotId}/startChat`;
        body = {
          message,
          isStreamEnabled: false,
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`TypeBot API error: ${response.status}`);
      }

      const data = await response.json();

      // Save/update session
      if (data.sessionId) {
        this.sessions.set(sessionKey, {
          sessionId: data.sessionId,
          typebotId,
          lastMessageAt: new Date(),
        });
      }

      // Convert TypeBot messages to our format
      return this.parseMessages(data.messages || []);
    } catch (error: any) {
      this.logger.error(`TypeBot error: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * End a TypeBot session.
   */
  endSession(typebotId: string, contactJid: string): void {
    const key = `${typebotId}:${contactJid}`;
    this.sessions.delete(key);
  }

  /**
   * Parse TypeBot messages into our standard format.
   */
  private parseMessages(messages: any[]): TypeBotMessage[] {
    return messages
      .map((msg: any) => {
        if (msg.type === 'text') {
          return {
            type: 'text' as const,
            content: msg.content?.richText?.map((b: any) =>
              b.children?.map((c: any) => c.text).join('')
            ).join('\n') || msg.content?.plainText || '',
          };
        }
        if (msg.type === 'image') {
          return { type: 'image' as const, content: msg.content?.url || '' };
        }
        if (msg.type === 'audio') {
          return { type: 'audio' as const, content: msg.content?.url || '' };
        }
        if (msg.type === 'video') {
          return { type: 'video' as const, content: msg.content?.url || '' };
        }
        // Input blocks — return as text with options
        if (msg.type === 'input') {
          return {
            type: 'text' as const,
            content: msg.content?.plainText || 'Please select:',
            options:
              msg.content?.items?.map((i: any) => ({
                label: i.content,
                value: i.content,
              })) || [],
          };
        }
        return null;
      })
      .filter((m: TypeBotMessage | null): m is TypeBotMessage => m !== null);
  }
}
