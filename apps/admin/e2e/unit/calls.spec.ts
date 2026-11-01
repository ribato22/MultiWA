// The call helpers of lib/calls.ts (no browser).
import { test, expect } from '@playwright/test';
import { OUTCOME_LABEL, fromPayload, type CallUpdatePayload } from '@/lib/calls';
import type { CallRecord } from '@/lib/api';

const REC = { id: 'rec-1', durationSec: 190, bytes: 95_000, partial: false, announcementPlayed: true, createdAt: '2026-11-01T03:10:00.000Z', deletedAt: null, deleteReason: null };
const payload: CallUpdatePayload = {
  profileId: 'p-1', callId: 'c-1', waCallId: 'W1', from: '628111000111@s.whatsapp.net', isVideo: false, isGroup: false,
  direction: 'incoming', outcome: 'answered', rejectedBy: null, startedAt: '2026-11-01T03:00:00.000Z', endedAt: '2026-11-01T03:03:18.000Z',
  followUp: 'open', assignedUserId: null, answeredByUserId: 'u-jane', answeredAt: '2026-11-01T03:00:06.000Z', endedBy: 'caller',
  endReason: 'caller_hangup', talkSeconds: 192,
};
const previous = { ...fromPayload(payload), answeredBy: { id: 'u-jane', name: 'Jane' }, recording: REC } as CallRecord;

test('a call answered in the dashboard has its label', () => {
  expect(OUTCOME_LABEL.answered).toBe('Answered');
});

test('a realtime update keeps what its payload lacks: the recording, and who answered while it is still them', () => {
  expect(fromPayload(payload, previous)).toMatchObject({ answeredBy: { name: 'Jane' }, recording: REC, talkSeconds: 192, endReason: 'caller_hangup' });
  expect(fromPayload({ ...payload, answeredByUserId: null }, previous)).toMatchObject({ answeredBy: null, recording: REC });
});
