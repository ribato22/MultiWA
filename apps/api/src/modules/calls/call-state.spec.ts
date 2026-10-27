import { describe, it, expect } from 'vitest';
import {
  nextOutcome, outcomeForState, followUpAfter, CALL_OUTCOMES, CALL_FOLLOW_UPS, type CallOutcome,
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
    expect(CALL_OUTCOMES).toEqual(['ringing', 'missed', 'rejected', 'answered_elsewhere', 'unknown']);
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

  it.each(CALL_OUTCOMES.filter((o) => o !== 'answered_elsewhere'))('%s leaves an open follow-up open', (outcome) => {
    expect(followUpAfter(outcome, 'open')).toBe('open');
  });

  it('answered_elsewhere closes an open follow-up and keeps the others', () => {
    expect(followUpAfter('answered_elsewhere', 'open')).toBe('done');
    expect(followUpAfter('answered_elsewhere', 'in_progress')).toBe('in_progress');
    expect(followUpAfter('answered_elsewhere', 'done')).toBe('done');
  });
});
