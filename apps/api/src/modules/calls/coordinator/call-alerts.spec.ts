// The media server's worker died, through the quiet-profile alarm's channel: the bell for every user of each
// organization that answers calls in the dashboard, WhatsApp to the alarm numbers of the profiles whose calls were cut.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { profile: { findMany: vi.fn() } } }));
vi.mock('../../messages/ops-alert', () => ({ sendOpsAlert: vi.fn() }));
vi.mock('../../messages/messages.service', () => ({ MessagesService: class {} }));

import { prisma } from '@multiwa/database';
import { sendOpsAlert } from '../../messages/ops-alert';
import { CallAlerts } from './call-alerts';

const findMany = (prisma as any).profile.findMany;
const AT = new Date('2026-10-30T08:04:00Z');
const profile = (id: string, org: string, notify?: string[]) => ({
  id, displayName: `Line ${id}`, phoneNumber: null, settings: { callsAnswerInDashboard: true, quietAlarmNotify: notify }, workspace: { organizationId: org },
});

describe('CallAlerts.workerDied', () => {
  let notifications: { createForOrg: ReturnType<typeof vi.fn> };
  let alerts: CallAlerts;
  beforeEach(() => {
    vi.stubEnv('QUIET_ALARM_TIMEZONE', 'Asia/Jakarta');
    findMany.mockReset().mockResolvedValue([profile('p1', 'o1', ['628111000111']), profile('p2', 'o1'), profile('p3', 'o2', ['628333000333'])]);
    (sendOpsAlert as any).mockReset().mockResolvedValue(undefined);
    notifications = { createForOrg: vi.fn().mockResolvedValue([]) };
    alerts = new CallAlerts(notifications as any, {} as any);
  });

  it('one bell per organization that answers in the dashboard; WhatsApp only for the profiles whose calls were cut', async () => {
    await alerts.workerDied(['p1'], AT);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ settings: { path: ['callsAnswerInDashboard'], equals: true } }, { id: { in: ['p1'] } }] },
    }));
    expect(notifications.createForOrg.mock.calls.map((c) => c[0]).sort()).toEqual(['o1', 'o2']);
    expect(notifications.createForOrg).toHaveBeenCalledWith('o1', 'system', 'Call audio server restarted: 1 call(s) cut off', expect.stringContaining('stopped at 15:04 (Asia/Jakarta)'), { kind: 'calls_media_worker_died', calls: 1 });
    expect((sendOpsAlert as any).mock.calls).toEqual([[
      {},
      expect.anything(),
      expect.objectContaining({ organizationId: 'o1', excludeProfileId: 'p1', recipients: ['628111000111'], text: expect.stringContaining('Line p1') }),
    ]]);
  });

  it('a worker that died with no call on it still rings the bell, and sends no WhatsApp', async () => {
    await alerts.workerDied([], AT);
    expect(notifications.createForOrg).toHaveBeenCalledWith('o1', 'system', 'Call audio server restarted', expect.stringContaining('No call was in progress'), { kind: 'calls_media_worker_died', calls: 0 });
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it('a bell that fails does not stop the others', async () => {
    notifications.createForOrg.mockRejectedValueOnce(new Error('db down'));
    await alerts.workerDied(['p1'], AT);
    expect(notifications.createForOrg).toHaveBeenCalledTimes(2);
  });
});
