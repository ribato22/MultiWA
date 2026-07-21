// packages/engine-runtime/src/system-message.ts
//
// WhatsApp system/protocol message types that are NOT real chat content:
// E2E-encryption notices, business notification templates, call logs,
// group-system events (gp2), ciphertext placeholders, protocol frames, and
// deleted-message markers. Persisting them produced bogus "conversations" with
// unresolved @lid numbers and fired noisy "New message" notifications.
//
// Shared between apps/api (ENGINE_HOST=api) and apps/worker (ENGINE_HOST=worker)
// so both engine-managers drop the same set; see
// architecture/engine-worker-migration-sop.md.

export const SYSTEM_MESSAGE_TYPES = new Set<string>([
  'e2e_notification', 'notification_template', 'notification',
  'call_log', 'gp2', 'ciphertext', 'protocol', 'revoked',
]);

export function isSystemMessageType(type: string | null | undefined): boolean {
  return !!type && SYSTEM_MESSAGE_TYPES.has(type);
}
