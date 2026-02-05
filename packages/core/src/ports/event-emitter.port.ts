// MultiWA Gateway Core - Event Emitter Port
// packages/core/src/ports/event-emitter.port.ts

export interface WebhookPayload {
  event: string;
  profileId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface IEventEmitter {
  emit(event: string, payload: WebhookPayload): Promise<void>;
  sendWebhook(url: string, payload: WebhookPayload, secret?: string): Promise<boolean>;
}
