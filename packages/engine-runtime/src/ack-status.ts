// MultiWA Gateway - Shared WhatsApp delivery-ack status update
// packages/engine-runtime/src/ack-status.ts
//
// Single implementation of the ack DB mutation, shared by the api and worker
// engine-manager forks (which otherwise carry an identical ~1300-line copy and
// drift). The guard here is load-bearing — see below.

import { prisma } from '@multiwa/database';
import { withDeadlockRetry } from './db-retry';

export interface AckPriorState {
  status: string;
  lane: string | null;
}

export interface AckUpdateResult {
  /** The message's status/lane BEFORE this ack (for first-terminal-transition logic). */
  prior: AckPriorState | null;
  /** How many message rows this ack updated. */
  count: number;
}

/**
 * Apply a WhatsApp delivery ack (`delivered`/`read`/`played`/…) to the messages
 * table, keyed by the engine's WhatsApp message id.
 *
 * Returns `null` when the ack has NO resolvable id — callers MUST treat that as
 * "skip". This guard is critical: `prisma.message.updateMany({ where: { messageId:
 * undefined } })` is treated by Prisma as an EMPTY filter (`WHERE 1=1`) and would
 * rewrite EVERY message's status — silent corruption plus table-wide lock
 * contention that deadlocks against concurrent acks (the production incident this
 * helper was extracted to lock down).
 */
export async function applyAckStatusUpdate(
  messageId: string | undefined | null,
  status: string,
): Promise<AckUpdateResult | null> {
  if (!messageId) {
    return null;
  }

  // Read prior state before updating so the caller can fire cold-circuit / terminal
  // logic only on the FIRST terminal transition (a message emits delivered→read→played).
  const prior = await prisma.message.findFirst({
    where: { messageId },
    select: { status: true, lane: true },
  });

  // Retry the hot-row write on a transient Postgres deadlock / write conflict:
  // concurrent acks for overlapping message rows periodically deadlock under load.
  const { count } = await withDeadlockRetry(() =>
    prisma.message.updateMany({
      where: { messageId },
      data: { status },
    }),
  );

  return { prior, count };
}
