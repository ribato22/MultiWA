// The media server's worker died, through the quiet-profile alarm's channel: the bell for every user of each
// organization that answers calls in the dashboard, told only of its own calls, and WhatsApp to the alarm numbers of
// the profiles whose calls were cut.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { profile: { findMany: vi.fn() } } }));
vi.mock('../../messages/ops-alert', () => ({ sendOpsAlert: vi.fn() }));
vi.mock('../../messages/messages.service', () => ({ MessagesService: class {} }));

import { prisma } from '@multiwa/database';
import { sendOpsAlert } from '../../messages/ops-alert';
import { CallAlerts } from './call-alerts';

const findMany = (prisma as any).profile.findMany;
const AT = new Date('2026-10-30T08:04:00Z');
const later = (minutes: number) => new Date(AT.getTime() + minutes * 60_000);
const STOPPED = 'server that carries the audio of calls answered in the dashboard stopped at 15:04 (Asia/Jakarta) and is restarting.';
const profile = (id: string, org: string, notify?: string[], phoneNumber: string | null = null) => ({
  id, displayName: `Line ${id}`, phoneNumber, settings: { callsAnswerInDashboard: true, quietAlarmNotify: notify }, workspace: { organizationId: org },
});

describe('CallAlerts.workerDied', () => {
  let notifications: { createForOrg: ReturnType<typeof vi.fn> };
  let alerts: CallAlerts;
  beforeEach(() => {
    vi.stubEnv('QUIET_ALARM_TIMEZONE', 'Asia/Jakarta');
    findMany.mockReset().mockResolvedValue([
      profile('p1', 'o1', ['628111000111'], '628111000100'), profile('p2', 'o1'), profile('p3', 'o2', ['628333000333']),
    ]);
    (sendOpsAlert as any).mockReset().mockResolvedValue(undefined);
    notifications = { createForOrg: vi.fn().mockResolvedValue([]) };
    alerts = new CallAlerts(notifications as any, {} as any);
  });

  it("each organization's bell tells only of its own calls; WhatsApp only for the profiles whose calls were cut", async () => {
    await alerts.workerDied(['p1'], AT);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ settings: { path: ['callsAnswerInDashboard'], equals: true } }, { id: { in: ['p1'] } }] },
    }));
    expect(notifications.createForOrg).toHaveBeenCalledTimes(2);
    expect(notifications.createForOrg).toHaveBeenCalledWith('o1', 'system', 'Call audio server restarting: 1 call(s) cut off',
      `The ${STOPPED} 1 call(s) lost their audio and were ended.`, { kind: 'calls_media_worker_died', calls: 1 });
    expect(notifications.createForOrg).toHaveBeenCalledWith('o2', 'system', 'Call audio server restarting',
      `The ${STOPPED} No call was in progress.`, { kind: 'calls_media_worker_died', calls: 0 });
    expect((sendOpsAlert as any).mock.calls).toEqual([[
      {},
      expect.anything(),
      {
        what: 'Call media alert for p1',
        organizationId: 'o1',
        excludeProfileId: 'p1',
        // an alert sent to the profile's own number would arrive there as an incoming message
        ownPhone: '628111000100',
        recipients: ['628111000111'],
        text: `⚠️ Line p1: the ${STOPPED} This profile's call lost its audio and was ended.`,
      },
    ]]);
  });

  it('a worker that died with no call on it still rings the bell, and sends no WhatsApp', async () => {
    await alerts.workerDied([], AT);
    expect(notifications.createForOrg).toHaveBeenCalledWith('o1', 'system', 'Call audio server restarting', expect.stringContaining('No call was in progress'), { kind: 'calls_media_worker_died', calls: 0 });
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it('a bell that fails does not stop the others', async () => {
    notifications.createForOrg.mockRejectedValueOnce(new Error('db down'));
    await alerts.workerDied(['p1'], AT);
    expect(notifications.createForOrg).toHaveBeenCalledTimes(2);
  });

  it('a WhatsApp alert that fails does not stop the others, and is logged without line breaks', async () => {
    const warn = vi.spyOn((alerts as any).logger, 'warn').mockImplementation(() => {});
    (sendOpsAlert as any).mockRejectedValueOnce(new Error('db\ndown'));
    await alerts.workerDied(['p1', 'p3'], AT);
    expect((sendOpsAlert as any).mock.calls.map((c: any[]) => c[2].excludeProfileId)).toEqual(['p1', 'p3']);
    expect(warn).toHaveBeenCalledWith('Call media alert for p1 failed: dbdown');
  });

  it('a crash loop that cuts no call rings the bell at most every ten minutes; a death that cuts a call always alerts', async () => {
    await alerts.workerDied([], AT);
    await alerts.workerDied([], later(1));
    expect(notifications.createForOrg).toHaveBeenCalledTimes(2); // one round: o1 and o2
    await alerts.workerDied(['p1'], later(2));
    expect(notifications.createForOrg).toHaveBeenCalledTimes(4);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    await alerts.workerDied([], later(13));
    expect(notifications.createForOrg).toHaveBeenCalledTimes(6);
  });
});
