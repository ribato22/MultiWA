// MultiWA Gateway - Chatwoot Integration Service
// apps/api/src/modules/integrations/chatwoot.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ChatwootContact {
  id: number;
  name: string;
  phone: string;
}

export interface ChatwootMessage {
  id: number;
  content: string;
  messageType: 'incoming' | 'outgoing';
  createdAt: string;
}

@Injectable()
export class ChatwootService {
  private readonly logger = new Logger(ChatwootService.name);
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly accountId: string;
  private readonly inboxId: string;
  private readonly enabled: boolean;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get('CHATWOOT_URL', '');
    this.apiToken = this.configService.get('CHATWOOT_API_TOKEN', '');
    this.accountId = this.configService.get('CHATWOOT_ACCOUNT_ID', '');
    this.inboxId = this.configService.get('CHATWOOT_INBOX_ID', '');
    this.enabled = !!(this.baseUrl && this.apiToken && this.accountId);

    if (this.enabled) {
      this.logger.log(`Chatwoot integration enabled: ${this.baseUrl}`);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Find or create a Chatwoot contact by phone number.
   */
  async findOrCreateContact(phone: string, name?: string): Promise<ChatwootContact | null> {
    if (!this.enabled) return null;

    try {
      // Search for existing contact
      const searchRes = await this.apiCall(
        'GET',
        `/contacts/search?q=${encodeURIComponent(phone)}&include_contacts=true`,
      );

      if (searchRes?.payload?.length > 0) {
        return searchRes.payload[0];
      }

      // Create new contact
      const createRes = await this.apiCall('POST', '/contacts', {
        name: name || phone,
        phone_number: phone,
        inbox_id: this.inboxId,
      });

      return createRes?.payload?.contact || null;
    } catch (error: any) {
      this.logger.error(`Chatwoot contact error: ${error.message}`);
      return null;
    }
  }

  /**
   * Create or find a conversation for a contact.
   */
  async getOrCreateConversation(contactId: number): Promise<number | null> {
    if (!this.enabled) return null;

    try {
      // Search for open conversation
      const searchRes = await this.apiCall(
        'GET',
        `/contacts/${contactId}/conversations`,
      );

      const openConversation = searchRes?.payload?.find(
        (c: any) => c.status === 'open' && c.inbox_id?.toString() === this.inboxId,
      );

      if (openConversation) {
        return openConversation.id;
      }

      // Create new conversation
      const createRes = await this.apiCall('POST', '/conversations', {
        contact_id: contactId,
        inbox_id: this.inboxId,
        status: 'open',
      });

      return createRes?.id || null;
    } catch (error: any) {
      this.logger.error(`Chatwoot conversation error: ${error.message}`);
      return null;
    }
  }

  /**
   * Sync an incoming WhatsApp message to Chatwoot.
   */
  async syncIncomingMessage(
    phone: string,
    contactName: string,
    message: string,
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const contact = await this.findOrCreateContact(phone, contactName);
      if (!contact) return;

      const conversationId = await this.getOrCreateConversation(contact.id);
      if (!conversationId) return;

      await this.apiCall('POST', `/conversations/${conversationId}/messages`, {
        content: message,
        message_type: 'incoming',
      });

      this.logger.debug(`Synced incoming message from ${phone} to Chatwoot`);
    } catch (error: any) {
      this.logger.error(`Chatwoot sync error: ${error.message}`);
    }
  }

  /**
   * Sync an outgoing WhatsApp message to Chatwoot.
   */
  async syncOutgoingMessage(
    phone: string,
    message: string,
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const contact = await this.findOrCreateContact(phone);
      if (!contact) return;

      const conversationId = await this.getOrCreateConversation(contact.id);
      if (!conversationId) return;

      await this.apiCall('POST', `/conversations/${conversationId}/messages`, {
        content: message,
        message_type: 'outgoing',
        private: false,
      });
    } catch (error: any) {
      this.logger.error(`Chatwoot sync error: ${error.message}`);
    }
  }

  /**
   * Generic Chatwoot API call.
   */
  private async apiCall(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'api_access_token': this.apiToken,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Chatwoot API ${method} ${path} → ${response.status}`);
    }

    return response.json();
  }
}
