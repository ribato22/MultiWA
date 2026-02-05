/**
 * MultiWA ↔ Chatwoot Bridge
 * 
 * Bridges WhatsApp messages between MultiWA Gateway and Chatwoot.
 * - Receives webhooks from MultiWA → creates/updates Chatwoot conversations
 * - Receives webhooks from Chatwoot → sends messages via MultiWA
 */

import express from 'express';
import axios, { AxiosInstance } from 'axios';

// ─── Configuration ────────────────────────────────────────────────────────

export interface ChatwootBridgeConfig {
  /** MultiWA API base URL */
  multiwaUrl: string;
  /** MultiWA API key */
  multiwaApiKey: string;
  /** MultiWA Profile ID */
  multiwaProfileId: string;
  /** Chatwoot API base URL */
  chatwootUrl: string;
  /** Chatwoot API access token (user or agent bot) */
  chatwootAccessToken: string;
  /** Chatwoot Account ID */
  chatwootAccountId: number;
  /** Chatwoot Inbox ID for WhatsApp */
  chatwootInboxId: number;
  /** Port to listen on */
  port?: number;
}

// ─── Chatwoot Bridge Class ────────────────────────────────────────────────

export class ChatwootBridge {
  private config: ChatwootBridgeConfig;
  private multiwaClient: AxiosInstance;
  private chatwootClient: AxiosInstance;
  private app: express.Application;

  constructor(config: ChatwootBridgeConfig) {
    this.config = config;

    this.multiwaClient = axios.create({
      baseURL: config.multiwaUrl,
      headers: { 'x-api-key': config.multiwaApiKey },
    });

    this.chatwootClient = axios.create({
      baseURL: `${config.chatwootUrl}/api/v1/accounts/${config.chatwootAccountId}`,
      headers: { api_access_token: config.chatwootAccessToken },
    });

    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes() {
    // Webhook from MultiWA: incoming WhatsApp messages
    this.app.post('/webhook/multiwa', async (req, res) => {
      try {
        await this.handleMultiwaWebhook(req.body);
        res.json({ success: true });
      } catch (error) {
        console.error('[Bridge] Error handling MultiWA webhook:', error);
        res.status(500).json({ error: 'Internal error' });
      }
    });

    // Webhook from Chatwoot: agent replies
    this.app.post('/webhook/chatwoot', async (req, res) => {
      try {
        await this.handleChatwootWebhook(req.body);
        res.json({ success: true });
      } catch (error) {
        console.error('[Bridge] Error handling Chatwoot webhook:', error);
        res.status(500).json({ error: 'Internal error' });
      }
    });

    // Health check
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', bridge: 'multiwa-chatwoot' });
    });
  }

  /**
   * Handle incoming MultiWA webhook (WhatsApp message received).
   * Creates or finds a Chatwoot conversation and adds the message.
   */
  private async handleMultiwaWebhook(payload: any) {
    const { event, data } = payload;
    if (event !== 'message.received') return;

    const { from, body, type } = data;
    const phoneNumber = from.replace('@c.us', '').replace('@s.whatsapp.net', '');

    // 1. Find or create contact in Chatwoot
    const contact = await this.findOrCreateChatwootContact(phoneNumber, data.pushName);

    // 2. Find or create conversation
    const conversation = await this.findOrCreateConversation(contact.id);

    // 3. Create message in conversation
    const content = type === 'text' ? body : `[${type}] ${body || 'Media message'}`;
    await this.chatwootClient.post(
      `/conversations/${conversation.id}/messages`,
      {
        content,
        message_type: 'incoming',
        private: false,
      }
    );

    console.log(`[Bridge] MultiWA → Chatwoot: ${phoneNumber} → Conv #${conversation.id}`);
  }

  /**
   * Handle Chatwoot webhook (agent sends reply).
   * Forwards the message to WhatsApp via MultiWA.
   */
  private async handleChatwootWebhook(payload: any) {
    const { event, message_type, content, conversation } = payload;

    // Only forward outgoing messages from agents
    if (event !== 'message_created' || message_type !== 'outgoing') return;
    if (!content || !conversation) return;

    // Get contact phone from conversation
    const phone = conversation.meta?.sender?.phone_number;
    if (!phone) {
      console.warn('[Bridge] No phone number in Chatwoot conversation');
      return;
    }

    // Send via MultiWA
    const jid = phone.replace('+', '') + '@s.whatsapp.net';
    await this.multiwaClient.post('/messages/text', {
      profileId: this.config.multiwaProfileId,
      to: jid,
      text: content,
    });

    console.log(`[Bridge] Chatwoot → MultiWA: Conv #${conversation.id} → ${phone}`);
  }

  private async findOrCreateChatwootContact(phone: string, name?: string) {
    // Search existing contacts
    const { data: searchResult } = await this.chatwootClient.get(
      `/contacts/search?q=${phone}&include_contacts=true`
    );
    if (searchResult?.payload?.length > 0) {
      return searchResult.payload[0];
    }

    // Create new contact
    const { data: newContact } = await this.chatwootClient.post('/contacts', {
      name: name || phone,
      phone_number: `+${phone}`,
      inbox_id: this.config.chatwootInboxId,
    });
    return newContact.payload?.contact || newContact;
  }

  private async findOrCreateConversation(contactId: number) {
    // List conversations for contact
    const { data: convResponse } = await this.chatwootClient.get(
      `/contacts/${contactId}/conversations`
    );
    const openConv = convResponse?.payload?.find(
      (c: any) => c.status === 'open' && c.inbox_id === this.config.chatwootInboxId
    );
    if (openConv) return openConv;

    // Create new conversation
    const { data: newConv } = await this.chatwootClient.post('/conversations', {
      contact_id: contactId,
      inbox_id: this.config.chatwootInboxId,
      status: 'open',
    });
    return newConv;
  }

  /** Start the bridge server */
  start() {
    const port = this.config.port || 3100;
    this.app.listen(port, () => {
      console.log(`[MultiWA ↔ Chatwoot Bridge] Running on port ${port}`);
      console.log(`  MultiWA webhook: POST http://localhost:${port}/webhook/multiwa`);
      console.log(`  Chatwoot webhook: POST http://localhost:${port}/webhook/chatwoot`);
    });
  }
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────

if (require.main === module) {
  const config: ChatwootBridgeConfig = {
    multiwaUrl: process.env.MULTIWA_URL || 'http://localhost:3001',
    multiwaApiKey: process.env.MULTIWA_API_KEY || '',
    multiwaProfileId: process.env.MULTIWA_PROFILE_ID || '',
    chatwootUrl: process.env.CHATWOOT_URL || 'http://localhost:3000',
    chatwootAccessToken: process.env.CHATWOOT_ACCESS_TOKEN || '',
    chatwootAccountId: parseInt(process.env.CHATWOOT_ACCOUNT_ID || '1'),
    chatwootInboxId: parseInt(process.env.CHATWOOT_INBOX_ID || '1'),
    port: parseInt(process.env.BRIDGE_PORT || '3100'),
  };

  const bridge = new ChatwootBridge(config);
  bridge.start();
}
