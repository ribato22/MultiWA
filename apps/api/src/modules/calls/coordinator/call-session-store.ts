// MultiWA Gateway - the call coordinator's writes to the calls table
// apps/api/src/modules/calls/coordinator/call-session-store.ts
//
// Each write is a compare-and-set on the row: the coordinator and the call runtime (which moves outcomes on the
// engine's signals, the call log and the ring timeout) race without undoing each other. A claim needs a ringing call
// nobody claimed; the answer needs that claim on a call still ringing; an end needs an answered call not ended yet. A
// write that lost changes nothing and says so (false / null).
import { prisma } from '@multiwa/database';
import { followUpAfter, type CallEndReason, type CallEndedBy, type CallRecord } from '@multiwa/engine-runtime';

export type { CallEndReason, CallEndedBy };

/** What answering a call needs: the row, its profile (settings, organization) and the caller's name. */
export interface CallForAnswer {
  call: CallRecord;
  profile: { id: string; displayName: string | null; settings: Record<string, unknown>; organizationId: string | null };
  /** The name of the caller's conversation, when the call has one. */
  callerName: string | null;
}

export async function findCallForAnswer(callId: string): Promise<CallForAnswer | null> {
  const row = await prisma.call.findUnique({
    where: { id: callId },
    include: {
      profile: { select: { id: true, displayName: true, settings: true, workspace: { select: { organizationId: true } } } },
      conversation: { select: { name: true } },
    },
  });
  if (!row) return null;
  const { profile, conversation, ...call } = row;
  return {
    call: call as unknown as CallRecord,
    profile: {
      id: profile.id,
      displayName: profile.displayName,
      settings: (profile.settings ?? {}) as Record<string, unknown>,
      organizationId: profile.workspace?.organizationId ?? null,
    },
    callerName: conversation?.name ?? null,
  };
}

/** Claim a ringing call nobody has claimed. True when this user won it. */
export async function claimCall(callId: string, userId: string): Promise<boolean> {
  const res = await prisma.call.updateMany({ where: { id: callId, outcome: 'ringing', answeredByUserId: null }, data: { answeredByUserId: userId } });
  return res.count === 1;
}

/** Give back the claim of a call that was not answered: its audio did not connect, or it stopped ringing. */
export async function releaseClaim(callId: string, userId: string): Promise<boolean> {
  const res = await prisma.call.updateMany({
    where: { id: callId, answeredByUserId: userId, outcome: { not: 'answered' } },
    data: { answeredByUserId: null },
  });
  return res.count === 1;
}

/** WhatsApp connected the claimed call: it is answered (final), its open follow-up done. Null when it stopped ringing meanwhile. */
export async function markAnswered(callId: string, userId: string, at: Date): Promise<CallRecord | null> {
  const res = await prisma.call.updateMany({
    where: { id: callId, outcome: 'ringing', answeredByUserId: userId },
    data: { outcome: 'answered', answeredAt: at },
  });
  if (res.count !== 1) return null;
  await prisma.call.updateMany({ where: { id: callId, followUp: 'open' }, data: { followUp: followUpAfter('answered', 'open') } });
  return (await prisma.call.findUnique({ where: { id: callId } })) as unknown as CallRecord | null;
}

/** The end of an answered call: when, by whom, why, and its talk time from the answer. Null when it was ended already. */
export async function markEnded(callId: string, endedBy: CallEndedBy, endReason: CallEndReason, at: Date): Promise<CallRecord | null> {
  const row = (await prisma.call.findUnique({ where: { id: callId } })) as unknown as CallRecord | null;
  if (!row || row.outcome !== 'answered' || row.endedAt || !row.answeredAt) return null;
  const talkSeconds = Math.max(0, Math.round((at.getTime() - row.answeredAt.getTime()) / 1000));
  const res = await prisma.call.updateMany({
    where: { id: callId, outcome: 'answered', endedAt: null },
    data: { endedAt: at, endedBy, endReason, talkSeconds },
  });
  return res.count === 1 ? { ...row, endedAt: at, endedBy, endReason, talkSeconds } : null;
}

/**
 * Boot: the previous process's sessions went with it (the engines and the media server restart too). An answered call
 * with no end gets one (server_restart, talking until now); a claim whose call was never answered is let go. Run it
 * before the gateway takes agents' commands.
 */
export async function reconcileAfterRestart(at: Date): Promise<{ ended: number; released: number }> {
  const open = await prisma.call.findMany({ where: { outcome: 'answered', endedAt: null }, select: { id: true } });
  let ended = 0;
  for (const { id } of open) if (await markEnded(id, 'server', 'server_restart', at)) ended++;
  const released = await prisma.call.updateMany({ where: { answeredByUserId: { not: null }, outcome: { not: 'answered' } }, data: { answeredByUserId: null } });
  return { ended, released: released.count };
}
