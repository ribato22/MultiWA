// MultiWA Gateway - Durable outbound send queue contract
// apps/api/src/modules/messages/outbound-send.ts
//
// When DURABLE_SEND=true, MessagesService enqueues outbound sends to the
// 'outbound-send' BullMQ queue and returns 202 { status: 'queued' } immediately.
// An in-API consumer (OutboundSendConsumer) drains the queue and performs the
// actual engine send through SendGateService — so the engine stays in the API
// process while sends gain durability (Redis-persisted jobs survive an API
// restart) and bounded retry. See architecture/durable-send-sop.md.

/** DI token for the BullMQ 'outbound-send' producer queue. */
export const OUTBOUND_SEND_QUEUE = 'OUTBOUND_SEND_QUEUE';

/** Max delivery attempts per queued send before it is marked failed. */
export const OUTBOUND_SEND_MAX_ATTEMPTS = 3;

export interface OutboundSendJob {
  messageDbId: string;
  profileId: string;
  to: string;
  type: string;
  content: any;
  quotedMessageId?: string;
}

/** Whether outbound sends are routed through the durable queue. Default: off. */
export function isDurableSend(): boolean {
  return process.env.DURABLE_SEND === 'true';
}
