// The call helpers of lib/calls.ts (no browser).
import { test, expect } from '@playwright/test';
import {
  OUTCOME_LABEL, answeredFacts, endedText, formatDuration, fromPayload, reasonTexts, ringingCallerLabel, type CallUpdatePayload,
} from '@/lib/calls';
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

test('durations read as m:ss, and h:mm:ss past an hour', () => {
  expect([0, 59.9, 192, 3725].map(formatDuration)).toEqual(['0:00', '0:59', '3:12', '1:02:05']);
});

test('the banner names the caller by the chat name, else the number; a hidden number says so', () => {
  expect(ringingCallerLabel({ name: 'Pak Joko', number: '628111' })).toBe('Pak Joko');
  expect(ringingCallerLabel({ name: '628111', number: '628111' })).toBe('+628111'); // a chat named after its number
  expect(ringingCallerLabel({ name: null, number: '628111' })).toBe('+628111');
  expect(ringingCallerLabel({ name: '123456789012345', number: null })).toBe('Unknown number'); // a LID
});

test('how a call ended, from each shape of call:ended', () => {
  expect(endedText({ callId: 'c', outcome: 'missed' })).toBeNull(); // it stopped ringing: the banner just closes
  expect(endedText({ callId: 'c', endReason: 'media_failed' })).toBe('Could not connect audio');
  expect(endedText({ callId: 'c', endReason: 'cancelled' })).toBe('The call ended before it connected');
  expect(endedText({ callId: 'c', endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 7 })).toBe('The caller hung up · 0:07');
  expect(endedText({ callId: 'c', endedBy: 'agent', endReason: 'hangup', talkSeconds: 42 })).toBe('You hung up · 0:42');
  expect(endedText({ callId: 'c', endedBy: 'server', endReason: 'agent_lost', talkSeconds: null })).toBe('The call dropped: this browser lost its connection');
});

test('a refusal’s reasons read once each, and an unknown one shows as it came', () => {
  expect(reasonTexts(['voip_stack_unavailable', 'module_missing', 'no_announcement', 'brand_new'])).toEqual([
    'WhatsApp Web changed or is still loading: answer on the phone',
    'Upload an announcement first',
    'brand_new',
  ]);
});

test('an answered row says who, how fast and how long', () => {
  expect(answeredFacts({ answeredBy: { id: 'u', name: 'Jane' }, startedAt: '2026-11-01T03:00:00.000Z', answeredAt: '2026-11-01T03:00:06.000Z', talkSeconds: 192 }))
    .toBe('Answered by Jane · 6 s to answer · Talk 3:12');
  expect(answeredFacts({ answeredBy: null, startedAt: '2026-11-01T03:00:00.000Z', answeredAt: null, talkSeconds: null })).toBe('Answered by an agent');
});
