// apps/api/src/modules/profiles/wa-message-id.ts
//
// The WhatsApp engine normally hands us a message whose id is the serialized string,
// but for GROUP messages from @lid participants (and across some engine/serialization
// boundaries) `message.id` arrives as the raw MessageId OBJECT — sometimes with
// `_serialized` renamed to `$1`, sometimes missing it entirely. Passing that object
// into prisma.message.create({ data: { messageId } }) (a String column) throws a
// PrismaClientValidationError, which silently dropped every such inbound message → no
// `message.received` webhook fired → downstream bots/integrations stopped responding.
//
// This coerces any of those shapes to the canonical serialized id string.

export function serializeWaMessageId(message: any): string {
  const fallback = () => `in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!message) return fallback();

  // The adapter also copies the serialized id to the top level.
  if (typeof message._serialized === 'string' && message._serialized) return message._serialized;

  const id = message.id;
  if (typeof id === 'string' && id) return id;

  if (id && typeof id === 'object') {
    if (typeof id._serialized === 'string' && id._serialized) return id._serialized;
    // Some engine/serialization paths surface the serialized value under `$1`.
    if (typeof id.$1 === 'string' && id.$1) return id.$1;
    // Reconstruct the canonical form: fromMe_remote_id[_participant].
    const parts = [id.fromMe, id.remote, id.id, id.participant].filter(
      (v) => v !== undefined && v !== null && v !== '',
    );
    if (parts.length >= 3) return parts.join('_');
  }

  return fallback();
}
