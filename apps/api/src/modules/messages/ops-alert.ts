// MultiWA Gateway - WhatsApp alerts to an organization's ops numbers
// apps/api/src/modules/messages/ops-alert.ts
//
// Sent through ANOTHER connected profile of the organization, one not in a quiet alarm itself: the alert may be about a
// profile whose own session is in doubt. Never to that profile's own number (it would arrive there as an incoming
// message). A failed send is logged, never thrown: an alert must not break what raised it. The quiet-profile alarm and
// the call media alert use it.
import { prisma } from '@multiwa/database';
import type { MessagesService } from './messages.service';

// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
// The send gate's 429 keeps its reason in the body ({ error: 'REPEAT_SUPPRESSED', ... }) and its .message is only "Http Exception".
// `message` goes first: Nest bodies carry both ({ message: 'Invalid recipient: ...', error: 'Bad Request' }) and the message is the useful one.
const reason = (e: unknown) => {
  const thrown: { getResponse?: unknown; message?: unknown } = typeof e === 'object' && e !== null ? e : {};
  const body: unknown = typeof thrown.getResponse === 'function' ? thrown.getResponse() : thrown.message;
  if (typeof body === 'string') return clean(body);
  const fields: { message?: unknown; error?: unknown } = typeof body === 'object' && body !== null ? body : {};
  return clean(fields.message ?? fields.error ?? JSON.stringify(body));
};
// Digits of a number or JID ("+62 812-3456-789", "62812…@s.whatsapp.net"). A local 08… counts as 628…, the way normalizeJid sends it.
const digits = (s: unknown) => String(s).replace(/@.*$/, '').replace(/\D/g, '').replace(/^0/, '62');

export interface OpsAlert {
  /** Names the alert in the logs, e.g. "Quiet-profile alarm for <profile id>". */
  what: string;
  organizationId: string;
  /** The profile the alert is about: never the sender. */
  excludeProfileId: string;
  /** That profile's own number: never a recipient. */
  ownPhone: string | null;
  /** The numbers (a profile's settings, unchecked here): only the strings of an array are sent to. */
  recipients: unknown;
  text: string;
}

export async function sendOpsAlert(messages: Pick<MessagesService, 'sendText'>, logger: { warn: (m: string) => void }, alert: OpsAlert): Promise<void> {
  const to = Array.isArray(alert.recipients) ? alert.recipients.filter((r): r is string => typeof r === 'string') : [];
  if (!to.length) return;
  const sender = await prisma.profile.findFirst({
    where: { id: { not: alert.excludeProfileId }, status: 'connected', quietAlarmAt: null, workspace: { organizationId: alert.organizationId } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!sender) {
    logger.warn(`${alert.what}: no other connected profile to send it through, bell only`);
    return;
  }
  const own = alert.ownPhone ? digits(alert.ownPhone) : '';
  // The numbers come as typed: one phone entered as 628…, +62 8… and 08… (on two profiles, or twice) is sent to once.
  const sent = new Set<string>();
  for (const recipient of to) {
    const phone = digits(recipient);
    if ((own && phone === own) || sent.has(phone)) continue;
    sent.add(phone);
    try {
      const res = await messages.sendText({ profileId: sender.id, to: recipient, text: alert.text });
      if (res?.success === false) logger.warn(`${alert.what} not sent through ${sender.id}: ${clean(res.error ?? 'failed')}`);
    } catch (e) {
      logger.warn(`${alert.what} not sent through ${sender.id}: ${reason(e)}`);
    }
  }
}
