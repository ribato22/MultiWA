import { describe, it, expect } from 'vitest';
import {
  nextOutcome, outcomeForState, followUpAfter, toCallPayload, CALL_OUTCOMES, CALL_FOLLOW_UPS, type CallOutcome,
} from '@multiwa/engine-runtime';

describe('call outcome rules', () => {
  it('maps engine states to outcomes', () => {
    expect(outcomeForState('ringing')).toBeNull();
    expect(outcomeForState('accepted')).toBe('answered_elsewhere');
    expect(outcomeForState('rejected')).toBe('rejected');
    expect(outcomeForState('missed')).toBe('missed');
    expect(outcomeForState('ended')).toBe('unknown');
  });

  it('exports the outcome list', () => {
    expect(CALL_OUTCOMES).toEqual(['ringing', 'answered', 'missed', 'rejected', 'answered_elsewhere', 'unknown']);
  });

  it('exports the follow-up list', () => {
    expect(CALL_FOLLOW_UPS).toEqual(['open', 'in_progress', 'done']);
  });

  // [current, target, expected]; null means the stored outcome stays.
  it.each<[CallOutcome, CallOutcome, CallOutcome | null]>([
    ['ringing', 'ringing', null],
    ['ringing', 'missed', 'missed'],
    ['ringing', 'rejected', 'rejected'],
    ['ringing', 'answered_elsewhere', 'answered_elsewhere'],
    ['ringing', 'unknown', 'unknown'],
    ['missed', 'ringing', null],
    ['missed', 'missed', null],
    ['missed', 'rejected', null],
    ['missed', 'answered_elsewhere', null],
    ['missed', 'unknown', null],
    ['rejected', 'ringing', null],
    ['rejected', 'missed', null],
    ['rejected', 'rejected', null],
    ['rejected', 'answered_elsewhere', null],
    ['rejected', 'unknown', null],
    ['answered_elsewhere', 'ringing', null],
    ['answered_elsewhere', 'missed', null],
    ['answered_elsewhere', 'rejected', null],
    ['answered_elsewhere', 'answered_elsewhere', null],
    ['answered_elsewhere', 'unknown', null],
    ['unknown', 'ringing', null],
    ['unknown', 'missed', 'missed'],
    ['unknown', 'rejected', 'rejected'],
    ['unknown', 'answered_elsewhere', 'answered_elsewhere'],
    ['unknown', 'unknown', null],
  ])('%s -> %s', (current, target, expected) => {
    expect(nextOutcome(current, target)).toBe(expected);
  });

  it.each(CALL_OUTCOMES.filter((o) => o !== 'answered_elsewhere' && o !== 'answered'))('%s leaves an open follow-up open', (outcome) => {
    expect(followUpAfter(outcome, 'open')).toBe('open');
  });

  it('answered_elsewhere closes an open follow-up and keeps the others', () => {
    expect(followUpAfter('answered_elsewhere', 'open')).toBe('done');
    expect(followUpAfter('answered_elsewhere', 'in_progress')).toBe('in_progress');
    expect(followUpAfter('answered_elsewhere', 'done')).toBe('done');
  });
});

describe('answered (a call answered in the dashboard)', () => {
  it('is a known outcome, and final: no later signal, call log or timeout changes it', () => {
    expect(CALL_OUTCOMES).toContain('answered');
    for (const target of ['missed', 'rejected', 'answered_elsewhere', 'unknown', 'ringing'] as const) {
      expect(nextOutcome('answered', target)).toBeNull();
    }
  });

  it('a ringing call can become answered', () => {
    expect(nextOutcome('ringing', 'answered')).toBe('answered');
  });

  it('needs no follow-up, like a call answered on the phone (an open follow-up becomes done; others stay)', () => {
    expect(followUpAfter('answered', 'open')).toBe('done');
    expect(followUpAfter('answered', 'in_progress')).toBe('in_progress');
  });
});

describe('the call payload', () => {
  it('carries who answered in the dashboard, when, and how the call ended (null for other calls)', () => {
    const base = {
      id: 'c1', profileId: 'p1', waCallId: 'W1', fromJid: '628111000111@c.us', isVideo: false, isGroup: false,
      direction: 'incoming', outcome: 'answered', rejectedBy: null, startedAt: new Date('2026-10-30T01:00:00Z'),
      endedAt: new Date('2026-10-30T01:05:00Z'), followUp: 'done', assignedUserId: null, autoReplySentAt: null, conversationId: null,
    };
    expect(toCallPayload({ ...base, answeredByUserId: 'u1', answeredAt: new Date('2026-10-30T01:00:12Z'), endedBy: 'agent', endReason: 'hangup', talkSeconds: 288 })).toMatchObject({
      answeredByUserId: 'u1', answeredAt: '2026-10-30T01:00:12.000Z', endedBy: 'agent', endReason: 'hangup', talkSeconds: 288,
    });
    expect(toCallPayload(base)).toMatchObject({ answeredByUserId: null, answeredAt: null, endedBy: null, endReason: null, talkSeconds: null });
  });
});
