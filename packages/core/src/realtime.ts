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
