// packages/core/src/value-objects/wa-message-id.ts
//
// Canonical WhatsApp message-id resolution — the single source of truth for
// turning whatever shape the engine hands us into the serialized id string.
//
// WhatsApp Web keeps moving this target:
//   * For GROUP messages from @lid participants the id arrives as the raw
//     MessageId OBJECT instead of a string.
//   * WhatsApp Web >= 2.3000.1042401057 renamed the cached serialized value on
//     `WAWebMsgKey` from `_serialized` to the minified `$1`, so every
//     `message.id._serialized` read silently became `undefined`.
//
// Reading `_serialized` blindly therefore yields either an object or undefined,
// which (a) threw `PrismaClientValidationError` when written to the String
// `messageId` column — silently dropping inbound messages and firing no
// `message.received` webhook — and (b) made delivery acks unmatchable, freezing
// every outbound row at `pending`.
//
// This lives in @multiwa/core (which has no workspace dependencies) so BOTH
// packages/engines (the adapters, at the library boundary) and
// packages/engine-runtime (the shared inbound handler) can use it — engines
// cannot depend on engine-runtime without a cycle.

/**
 * Resolve the serialized WhatsApp message id, or `null` when it genuinely
 * cannot be determined.
 *
 * Use this where a wrong id is worse than no id — e.g. delivery-ack
 * correlation, where a fabricated id would never match a stored row.
 */
export function resolveWaMessageId(message: any): string | null {
  if (!message) return null;

  // Some adapters copy the serialized id to the top level.
  if (typeof message._serialized === 'string' && message._serialized) return message._serialized;
  if (typeof message.$1 === 'string' && message.$1) return message.$1;

  const id = message.id;
  if (typeof id === 'string' && id) return id;

  if (id && typeof id === 'object') {
    if (typeof id._serialized === 'string' && id._serialized) return id._serialized;
    // WhatsApp Web >= 2.3000.1042401057 surfaces the serialized value as `$1`.
    if (typeof id.$1 === 'string' && id.$1) return id.$1;
    // Last resort: rebuild the canonical form `fromMe_remote_id[_participant]`.
    const parts = [id.fromMe, id.remote, id.id, id.participant].filter(
      (v) => v !== undefined && v !== null && v !== '',
    );
    if (parts.length >= 3) return parts.join('_');
  }

  return null;
}

/**
 * Resolve the serialized WhatsApp message id, falling back to a unique
 * synthetic id.
 *
 * Use this where a value is REQUIRED — e.g. persisting an inbound message to a
 * non-null String column. The synthetic id carries a random suffix so two
 * unresolvable messages in the same millisecond cannot collide.
 */
export function serializeWaMessageId(message: any): string {
  return (
    resolveWaMessageId(message) ??
    `in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
}
