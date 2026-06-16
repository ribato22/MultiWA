// MultiWA Gateway Core - Realtime relay contract
// packages/core/src/realtime.ts
//
// Shared contract for the worker -> API realtime bridge used when
// ENGINE_HOST=worker. The worker (RealtimePublisherService) publishes these
// messages to Redis; the API (RealtimeBridgeService) subscribes and re-emits
// them through the Socket.IO EventsGateway. Both sides import this single
// definition so the channel name and payload shapes cannot drift.

export const REALTIME_CHANNEL = 'multiwa:realtime';

export type RealtimeMessage =
  | { type: 'qr:update'; profileId: string; payload: { qrCode: string } }
  | { type: 'connection:status'; profileId: string; payload: { status: string; phoneOrReason?: string } }
  | { type: 'message'; profileId: string; payload: { message: any; conversation?: any } }
  | { type: 'message:ack'; profileId: string; payload: { messageId: string; status: string } }
  | { type: 'heartbeat'; profileId: string; payload: { ts: number; workerPid: number } };

/**
 * Sink for engine realtime events. Decouples the engine runtime from the API's
 * Socket.IO gateway so the engine can run in either process:
 *   - API   (ENGINE_HOST=api):    EventsGateway implements this (emits to Socket.IO)
 *   - Worker (ENGINE_HOST=worker): RealtimePublisher implements this (publishes to
 *     Redis; the API's RealtimeBridge re-emits via Socket.IO)
 * The method shapes match EventsGateway's existing emit methods.
 */
export interface RealtimeEmitter {
  emitQrUpdate(profileId: string, qrCode: string): void;
  emitConnectionStatus(profileId: string, status: string, phoneOrReason?: string): void;
  emitMessage(profileId: string, message: any): void;
  emitMessageAck(profileId: string, messageId: string, status: string): void;
}

/** DI token for the RealtimeEmitter implementation. */
export const REALTIME_EMITTER = 'REALTIME_EMITTER';
