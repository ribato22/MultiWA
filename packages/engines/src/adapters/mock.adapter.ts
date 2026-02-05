// MultiWA Gateway - Mock Adapter (TESTING)
// packages/engines/src/adapters/mock.adapter.ts

import type {
  IWhatsAppEngine,
  EngineConfig,
  EngineStatus,
  MessageResult,
  MediaOptions,
  LocationOptions,
  ContactOptions,
  PollOptions,
  SendMessageOptions,
} from '../types';

/**
 * Mock adapter for testing and development
 * Simulates WhatsApp behavior without actual connection
 */
export class MockAdapter implements IWhatsAppEngine {
  readonly engineType = 'mock' as const;

  private config: EngineConfig | null = null;
  private status: EngineStatus = {
    isConnected: false,
    isAuthenticated: false,
  };
  private qrCallbacks: ((qr: string) => void)[] = [];
  private messageCounter = 0;

  async initialize(config: EngineConfig): Promise<void> {
    this.config = config;
    console.log(`[Mock] Initialized for profile ${config.profileId}`);
  }

  async connect(): Promise<void> {
    console.log(`[Mock] Connecting profile ${this.config?.profileId}...`);

    // Simulate QR code generation
    setTimeout(() => {
      const mockQR = `mock-qr-${Date.now()}`;
      this.qrCallbacks.forEach((cb) => cb(mockQR));
      this.config?.onQR?.(mockQR);
    }, 500);

    // Simulate successful connection after 2 seconds
    setTimeout(() => {
      this.status = {
        isConnected: true,
        isAuthenticated: true,
        phone: '6281234567890',
        pushName: 'Mock User',
        lastConnectedAt: new Date(),
      };
      this.config?.onReady?.('6281234567890', 'Mock User');
    }, 2000);
  }

  async disconnect(): Promise<void> {
    this.status = { isConnected: false, isAuthenticated: false };
    this.config?.onDisconnected?.('Manual disconnect');
    console.log(`[Mock] Disconnected profile ${this.config?.profileId}`);
  }

  async destroy(): Promise<void> {
    await this.disconnect();
    console.log(`[Mock] Destroyed profile ${this.config?.profileId}`);
  }

  getStatus(): EngineStatus {
    return { ...this.status };
  }

  isReady(): boolean {
    return this.status.isConnected && this.status.isAuthenticated;
  }

  // ========== MESSAGING ==========

  async sendText(
    to: string,
    text: string,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    console.log(`[Mock] Sending text to ${to}: ${text.substring(0, 50)}...`);
    return this.mockSend('text');
  }

  async sendImage(
    to: string,
    media: MediaOptions,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    console.log(`[Mock] Sending image to ${to}`);
    return this.mockSend('image');
  }

  async sendVideo(
    to: string,
    media: MediaOptions,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    console.log(`[Mock] Sending video to ${to}`);
    return this.mockSend('video');
  }

  async sendAudio(
    to: string,
    media: MediaOptions,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    console.log(`[Mock] Sending audio to ${to}`);
    return this.mockSend('audio');
  }

  async sendDocument(
    to: string,
    media: MediaOptions,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    console.log(`[Mock] Sending document to ${to}`);
    return this.mockSend('document');
  }

  async sendLocation(
    to: string,
    location: LocationOptions,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    console.log(`[Mock] Sending location to ${to}: ${location.latitude}, ${location.longitude}`);
    return this.mockSend('location');
  }

  async sendContact(
    to: string,
    contact: ContactOptions,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    console.log(`[Mock] Sending contact to ${to}: ${contact.name}`);
    return this.mockSend('contact');
  }

  async sendReaction(messageId: string, emoji: string): Promise<MessageResult> {
    console.log(`[Mock] Sending reaction ${emoji} to ${messageId}`);
    return { success: true, messageId };
  }

  async sendPoll(
    to: string,
    poll: PollOptions,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    console.log(`[Mock] Sending poll to ${to}: ${poll.question} (${poll.options.length} options)`);
    return this.mockSend('poll');
  }


  // ========== PRESENCE & CHAT STATE (MOCK) ==========

  async sendPresenceUpdate(to: string, state: 'composing' | 'available' | 'recording'): Promise<void> {
    console.log(`[Mock] Presence update: ${state} -> ${to}`);
  }

  async markAsRead(chatId: string, messageIds?: string[]): Promise<void> {
    console.log(`[Mock] Marked as read: ${chatId}, messages: ${messageIds?.length || 'all'}`);
  }

  async deleteForEveryone(chatId: string, messageId: string): Promise<void> {
    console.log(`[Mock] Deleted message ${messageId} for everyone in ${chatId}`);
  }

  private mockSend(type: string): MessageResult {
    if (!this.isReady()) {
      return { success: false, error: 'Client not ready' };
    }

    this.messageCounter++;
    const messageId = `mock_${type}_${Date.now()}_${this.messageCounter}`;

    // Simulate async ACK updates
    setTimeout(() => {
      this.config?.onMessageAck?.(messageId, 'sent');
    }, 100);

    setTimeout(() => {
      this.config?.onMessageAck?.(messageId, 'delivered');
    }, 500);

    setTimeout(() => {
      this.config?.onMessageAck?.(messageId, 'read');
    }, 1000);

    return {
      success: true,
      messageId,
      timestamp: new Date(),
    };
  }

  // ========== QR CODE ==========

  async getQRCode(): Promise<string | null> {
    return `mock-qr-${Date.now()}`;
  }

  onQR(callback: (qr: string) => void): void {
    this.qrCallbacks.push(callback);
  }

  // ========== SESSION ==========

  async getSessionData(): Promise<any> {
    return { mock: true, profileId: this.config?.profileId };
  }

  async restoreSession(data: any): Promise<boolean> {
    console.log(`[Mock] Restoring session for profile ${this.config?.profileId}`);
    return true;
  }

  // ========== SIMULATION HELPERS ==========

  /**
   * Simulate receiving a message (for testing)
   */
  simulateIncomingMessage(from: string, body: string): void {
    const message = {
      id: `mock_incoming_${Date.now()}`,
      from: from.includes('@') ? from : `${from}@s.whatsapp.net`,
      to: this.status.phone,
      body,
      type: 'text',
      timestamp: new Date(),
      isGroup: from.includes('@g.us'),
      hasMedia: false,
      fromMe: false,
    };

    this.config?.onMessage?.(message);
  }

  // ========== GROUPS (MOCK STUBS) ==========

  async getGroups(): Promise<import('../types').GroupInfo[]> {
    console.log(`[Mock] Getting groups`);
    return [
      { id: 'mock-group-1@g.us', name: 'Mock Group 1', participants: [{ id: '628xxx@s.whatsapp.net', isAdmin: true }] },
      { id: 'mock-group-2@g.us', name: 'Mock Group 2', participants: [{ id: '628xxx@s.whatsapp.net', isAdmin: false }] },
    ];
  }

  async getGroupInfo(groupId: string): Promise<import('../types').GroupInfo> {
    console.log(`[Mock] Getting group info: ${groupId}`);
    return { id: groupId, name: 'Mock Group', participants: [{ id: '628xxx@s.whatsapp.net', isAdmin: true }] };
  }

  // ========== CONTACTS (MOCK STUBS) ==========

  async getContacts(): Promise<import('../types').ContactInfo[]> {
    console.log(`[Mock] Getting contacts`);
    return [
      { id: '6281234567890@s.whatsapp.net', phone: '6281234567890', name: 'Mock Contact 1', isGroup: false },
      { id: '6289876543210@s.whatsapp.net', phone: '6289876543210', name: 'Mock Contact 2', pushName: 'MockUser', isGroup: false },
    ];
  }

  async createGroup(name: string, participants: string[]): Promise<import('../types').GroupInfo> {
    console.log(`[Mock] Creating group: ${name} with ${participants.length} participants`);
    return { id: `mock-group-${Date.now()}@g.us`, name, participants: participants.map(p => ({ id: p, isAdmin: false })) };
  }

  async setGroupName(groupId: string, name: string): Promise<void> {
    console.log(`[Mock] Setting group name: ${groupId} -> ${name}`);
  }

  async setGroupDescription(groupId: string, description: string): Promise<void> {
    console.log(`[Mock] Setting group description: ${groupId} -> ${description.substring(0, 50)}...`);
  }

  async addGroupParticipants(groupId: string, participants: string[]): Promise<void> {
    console.log(`[Mock] Adding participants to ${groupId}: ${participants.join(', ')}`);
  }

  async removeGroupParticipants(groupId: string, participants: string[]): Promise<void> {
    console.log(`[Mock] Removing participants from ${groupId}: ${participants.join(', ')}`);
  }

  async promoteGroupParticipants(groupId: string, participants: string[]): Promise<void> {
    console.log(`[Mock] Promoting participants in ${groupId}: ${participants.join(', ')}`);
  }

  async demoteGroupParticipants(groupId: string, participants: string[]): Promise<void> {
    console.log(`[Mock] Demoting participants in ${groupId}: ${participants.join(', ')}`);
  }

  async leaveGroup(groupId: string): Promise<void> {
    console.log(`[Mock] Leaving group: ${groupId}`);
  }

  async getGroupInviteLink(groupId: string): Promise<string> {
    console.log(`[Mock] Getting invite link for: ${groupId}`);
    return `https://chat.whatsapp.com/mock-invite-${Date.now()}`;
  }

  async revokeGroupInviteLink(groupId: string): Promise<string> {
    console.log(`[Mock] Revoking invite link for: ${groupId}`);
    return `https://chat.whatsapp.com/mock-new-invite-${Date.now()}`;
  }
}

