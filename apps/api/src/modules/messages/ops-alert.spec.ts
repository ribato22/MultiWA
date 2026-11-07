// An ops alert goes through ANOTHER connected profile of the organization (the alert may be about a profile whose own
// session is in doubt), never to that profile's own number; a failed send is logged, never thrown.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { profile: { findFirst: vi.fn() } } }));

import { prisma } from '@multiwa/database';
import { sendOpsAlert } from './ops-alert';

const findFirst = (prisma as any).profile.findFirst;
const alert = { what: 'Test alert for p1', organizationId: 'o1', excludeProfileId: 'p1', ownPhone: '+62 811-1000-111', recipients: ['628111000111', '628222000222'], text: 'hi' };

describe('sendOpsAlert', () => {
  let messages: { sendText: ReturnType<typeof vi.fn> };
  let logger: { warn: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue({ id: 'p2' });
    messages = { sendText: vi.fn().mockResolvedValue({ success: true }) };
    logger = { warn: vi.fn() };
  });

  it("sends through another connected profile not in a quiet alarm, skipping the profile's own number", async () => {
    await sendOpsAlert(messages as any, logger, alert);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: { not: 'p1' }, status: 'connected', quietAlarmAt: null, workspace: { organizationId: 'o1' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    expect(messages.sendText.mock.calls).toEqual([[{ profileId: 'p2', to: '628222000222', text: 'hi' }]]);
  });

  it('sends only to the string entries of the numbers it is given', async () => {
    await sendOpsAlert(messages as any, logger, { ...alert, recipients: ['628222000222', 628333000333, null, { to: '628444000444' }] });
    expect(messages.sendText.mock.calls).toEqual([[{ profileId: 'p2', to: '628222000222', text: 'hi' }]]);
  });

  // The numbers are kept as typed: one phone entered on two profiles, or twice on one, would get the alert again each time.
  it('one phone typed several ways gets it once', async () => {
    await sendOpsAlert(messages as any, logger, { ...alert, ownPhone: null, recipients: ['628222000222', '+62 822-2000-222', '08222000222', '628333000333'] });
    expect(messages.sendText.mock.calls.map(([m]) => m.to)).toEqual(['628222000222', '628333000333']);
  });

  it('no recipients: nothing is looked up; no other profile: the bell only, said once', async () => {
    await sendOpsAlert(messages as any, logger, { ...alert, recipients: undefined });
    expect(findFirst).not.toHaveBeenCalled();
    findFirst.mockResolvedValue(null);
    await sendOpsAlert(messages as any, logger, alert);
    expect(messages.sendText).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Test alert for p1: no other connected profile to send it through, bell only');
  });

  it('a send that fails or is refused is logged, without line breaks, and the next recipient still gets it', async () => {
    messages.sendText.mockRejectedValueOnce(Object.assign(new Error('Http Exception'), { getResponse: () => ({ error: 'REPEAT\nSUPPRESSED' }) }));
    await sendOpsAlert(messages as any, logger, { ...alert, ownPhone: null });
    expect(messages.sendText).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith('Test alert for p1 not sent through p2: REPEATSUPPRESSED');
  });

  it("the reason logged is the exception's body, as text or as JSON when it names none, else the error's message", async () => {
    messages.sendText
      .mockRejectedValueOnce(Object.assign(new Error('Http Exception'), { getResponse: () => 'Too many requests' }))
      .mockRejectedValueOnce(Object.assign(new Error('Http Exception'), { getResponse: () => ({ statusCode: 503 }) }))
      .mockRejectedValueOnce(new Error('Profile is not connected'));
    await sendOpsAlert(messages as any, logger, { ...alert, ownPhone: null, recipients: ['628111000111', '628222000222', '628333000333'] });
    expect(logger.warn.mock.calls).toEqual([
      ['Test alert for p1 not sent through p2: Too many requests'],
      ['Test alert for p1 not sent through p2: {"statusCode":503}'],
      ['Test alert for p1 not sent through p2: Profile is not connected'],
    ]);
  });
});
