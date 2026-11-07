// The call helpers of lib/calls.ts, and the outcome icons (no browser).
import { test, expect } from '@playwright/test';
import { PhoneCall, PhoneMissed } from 'lucide-react';
import {
  CAMERA_TEXT, OUTCOME_LABEL, VIDEO_TEXT, answeredFacts, cameraProblem, endedText, formatDuration, fromPayload, knownOutcome, reasonTexts, recordingDeletedText,
  ringingCallerLabel, type CallUpdatePayload,
} from '@/lib/calls';
import type { CallOutcome, CallRecord } from '@/lib/api';
import { outcomeIcon } from '@/components/calls/outcome-icon';

const REC = { id: 'rec-1', durationSec: 190, bytes: 95_000, partial: false, announcementPlayed: true, createdAt: '2026-11-01T03:10:00.000Z', deletedAt: null, deleteReason: null };
const payload: CallUpdatePayload = {
  profileId: 'p-1', callId: 'c-1', waCallId: 'W1', from: '628111000111@s.whatsapp.net', isVideo: false, isGroup: false,
  direction: 'incoming', outcome: 'answered', rejectedBy: null, startedAt: '2026-11-01T03:00:00.000Z', endedAt: '2026-11-01T03:03:18.000Z',
  followUp: 'done', assignedUserId: null, answeredByUserId: 'u-jane', answeredAt: '2026-11-01T03:00:06.000Z', endedBy: 'caller',
  endReason: 'caller_hangup', talkSeconds: 192,
};
const previous = { ...fromPayload(payload), answeredBy: { id: 'u-jane', name: 'Jane' }, recording: REC } as CallRecord;

test('a call answered in the dashboard has its label', () => {
  expect(OUTCOME_LABEL.answered).toBe('Answered');
});

test('an outcome this admin does not know yet shows the missed-call icon, never nothing', () => {
  expect(outcomeIcon('answered')).toBe(PhoneCall);
  expect(outcomeIcon('call_x' as CallOutcome)).toBe(PhoneMissed);
});

test('an outcome this admin does not know yet reads as unknown, so its label, colour and icon are the unknown ones', () => {
  expect(knownOutcome('answered_elsewhere')).toBe('answered_elsewhere');
  expect(knownOutcome('call_x')).toBe('unknown');
  expect(knownOutcome('toString')).toBe('unknown'); // a name every object has is no outcome either
  expect(OUTCOME_LABEL[knownOutcome('call_x')]).toBe('Unknown');
});

test('a deleted recording says why; a reason this admin does not know yet (the column is plain text) reads as deleted, never as nothing', () => {
  expect(recordingDeletedText('retention')).toBe('Recording deleted after its retention period');
  expect(recordingDeletedText('admin')).toBe('Recording deleted by an admin');
  expect(recordingDeletedText('purge')).toBe('Recording deleted');
  expect(recordingDeletedText('toString')).toBe('Recording deleted'); // a name every object has is no reason either
});

test('a realtime update keeps what its payload lacks: the recording, and who answered while it is still them', () => {
  expect(fromPayload(payload, previous)).toMatchObject({ answeredBy: { name: 'Jane' }, recording: REC, talkSeconds: 192, endReason: 'caller_hangup' });
  expect(fromPayload({ ...payload, answeredByUserId: null }, previous)).toMatchObject({ answeredBy: null, recording: REC });
});

test('durations read as m:ss, and h:mm:ss past an hour; a negative or broken one reads 0:00', () => {
  expect([0, 59.9, 192, 3599, 3600, 3725, -5, NaN].map(formatDuration)).toEqual(['0:00', '0:59', '3:12', '59:59', '1:00:00', '1:02:05', '0:00', '0:00']);
});

test('the banner names the caller by the chat name, else the number; a hidden number says so', () => {
  expect(ringingCallerLabel({ name: 'Pak Joko', number: '628111' })).toBe('Pak Joko');
  expect(ringingCallerLabel({ name: '628111', number: '628111' })).toBe('+628111'); // a chat named after its number
  expect(ringingCallerLabel({ name: '628111@c.us', number: '628111' })).toBe('+628111'); // a chat named after its JID
  expect(ringingCallerLabel({ name: null, number: '628111' })).toBe('+628111');
  expect(ringingCallerLabel({ name: '123456789012345', number: null })).toBe('Unknown number'); // a LID
  expect(ringingCallerLabel({ name: '123456789012345@lid', number: null })).toBe('Unknown number');
});

test('how a call ended, from each shape of call:ended', () => {
  expect(endedText({ callId: 'c', outcome: 'missed' })).toBeNull(); // it stopped ringing: the banner just closes
  expect(endedText({ callId: 'c', endReason: 'media_failed' })).toBe('Could not connect audio');
  expect(endedText({ callId: 'c', endReason: 'cancelled' })).toBe('The call was not connected');
  expect(endedText({ callId: 'c', endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 7 })).toBe('The caller hung up · 0:07');
  expect(endedText({ callId: 'c', endedBy: 'agent', endReason: 'hangup', talkSeconds: 42 })).toBe('You hung up · 0:42');
  expect(endedText({ callId: 'c', endedBy: 'server', endReason: 'agent_lost', talkSeconds: null })).toBe('The call dropped: the connection was lost');
  expect(endedText({ callId: 'c', endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 0 })).toBe('The caller hung up');
  expect(endedText({ callId: 'c', endedBy: 'server', endReason: 'brand_new' })).toBe('Call ended');
});

test('a refusal’s reasons read once each, and an unknown one shows as it came', () => {
  expect(reasonTexts(['voip_stack_unavailable', 'module_missing', 'no_announcement', 'brand_new'])).toEqual([
    'WhatsApp Web changed, or is still loading',
    'Upload an announcement first',
    'brand_new',
  ]);
});

test('an answered row says who, how fast and how long', () => {
  expect(answeredFacts({ answeredBy: { id: 'u', name: 'Jane' }, startedAt: '2026-11-01T03:00:00.000Z', answeredAt: '2026-11-01T03:00:06.000Z', talkSeconds: 192 }))
    .toBe('Answered by Jane · 6 s to answer · Talk 3:12');
  expect(answeredFacts({ answeredBy: null, startedAt: '2026-11-01T03:00:00.000Z', answeredAt: null, talkSeconds: null })).toBe('Answered by an agent');
  // The name the page knows wins over the one the row came with.
  expect(answeredFacts({ answeredBy: { id: 'u', name: 'Jane' }, startedAt: '2026-11-01T03:00:00.000Z', answeredAt: null, talkSeconds: null }, 'Jane Doe'))
    .toBe('Answered by Jane Doe');
  // An answer stamped before the start (clock skew) took no time.
  expect(answeredFacts({ answeredBy: null, startedAt: '2026-11-01T03:00:06.000Z', answeredAt: '2026-11-01T03:00:00.000Z', talkSeconds: null }))
    .toBe('Answered by an agent · 0 s to answer');
});

test('the camera says why it did not open, and why it did not switch; a video call says how it is answered', () => {
  const err = (name: string) => Object.assign(new Error(name), { name });
  expect(cameraProblem(err('NotAllowedError'))).toBe('Allow the camera for this site to turn it on');
  expect(cameraProblem(err('NotFoundError'))).toBe('No camera found: plug one in and try again');
  expect(cameraProblem(err('NotReadableError'))).toBe('The camera is in use by another app');
  expect(cameraProblem(new Error('boom'))).toBe('The camera could not be opened');
  for (const reason of ['no_video', 'no_video_producer', 'camera_failed', 'not_in_call', 'timeout', 'unavailable', 'error', 'off_failed']) {
    expect(CAMERA_TEXT[reason], reason).toEqual(expect.any(String));
  }
  for (const video of ['available', 'server_busy', 'unsupported', 'disabled', 'unknown']) expect(VIDEO_TEXT[video], video).toEqual(expect.any(String));
  expect(VIDEO_TEXT.available).toBe('Video call: your camera starts off');
});
