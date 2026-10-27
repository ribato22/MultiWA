import { describe, it, expect } from 'vitest';
import { nextOutcome, outcomeForState, followUpAfter } from '@multiwa/engine-runtime';

describe('call outcome rules', () => {
  it('maps engine states to outcomes', () => {
    expect(outcomeForState('ringing')).toBeNull();
    expect(outcomeForState('accepted')).toBe('answered_elsewhere');
    expect(outcomeForState('rejected')).toBe('rejected');
    expect(outcomeForState('missed')).toBe('missed');
    expect(outcomeForState('ended')).toBe('unknown');
  });

  it('a ringing call can move to any outcome', () => {
    for (const t of ['missed', 'rejected', 'answered_elsewhere', 'unknown'] as const) {
      expect(nextOutcome('ringing', t)).toBe(t);
    }
  });

  it('unknown can only be refined by a final outcome', () => {
    expect(nextOutcome('unknown', 'missed')).toBe('missed');
    expect(nextOutcome('unknown', 'answered_elsewhere')).toBe('answered_elsewhere');
    expect(nextOutcome('unknown', 'unknown')).toBeNull();
    expect(nextOutcome('unknown', 'ringing')).toBeNull();
  });

  it('final outcomes never change', () => {
    for (const from of ['missed', 'rejected', 'answered_elsewhere'] as const) {
      for (const t of ['missed', 'rejected', 'answered_elsewhere', 'unknown', 'ringing'] as const) {
        expect(nextOutcome(from, t)).toBeNull();
      }
    }
  });

  it('a call answered on another device needs no follow-up', () => {
    expect(followUpAfter('answered_elsewhere', 'open')).toBe('done');
    expect(followUpAfter('answered_elsewhere', 'in_progress')).toBe('in_progress');
    expect(followUpAfter('missed', 'open')).toBe('open');
  });
});
