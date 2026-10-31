// The media server's worker died, through the quiet-profile alarm's channel: the bell for every user of each
// organization that answers calls in the dashboard, told only of its own calls (and, when it lost none, at most every
// ten minutes), and WhatsApp to the alarm numbers of the profiles whose calls were cut.
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

  // The organizations whose bell one death rang.
  const rings = async (cutProfileIds: string[], minutes: number) => {
    notifications.createForOrg.mockClear();
    await alerts.workerDied(cutProfileIds, later(minutes));
    return notifications.createForOrg.mock.calls.map((c) => c[0]).sort();
  };

  it('a crash loop that cuts a call of o1 at every death: o1 is told every time, o2 (no call cut) at most every ten minutes', async () => {
    const told: string[][] = [];
    for (let minute = 0; minute <= 12; minute++) told.push(await rings(['p1'], minute));
    expect(told.filter((orgs) => orgs.includes('o1'))).toHaveLength(13);
    expect(told.flatMap((orgs, minute) => (orgs.includes('o2') ? [minute] : []))).toEqual([0, 10]);
    expect(sendOpsAlert).toHaveBeenCalledTimes(13);
  });

  it("an organization's quiet window restarts at every bell it was sent, for a cut call or not", async () => {
    expect(await rings([], 0)).toEqual(['o1', 'o2']);
    expect(await rings(['p1'], 2)).toEqual(['o1']); // a cut call is always told
    expect(await rings([], 5)).toEqual([]);
    expect(await rings([], 11)).toEqual(['o2']); // 11 minutes after the first round, 9 after o1's bell at +2
    expect(await rings([], 13)).toEqual(['o1']);
  });

  it('a bell that failed starts no quiet window', async () => {
    notifications.createForOrg.mockImplementation(async (orgId: string) => {
      if (orgId === 'o1') throw new Error('db down');
      return [];
    });
    await alerts.workerDied([], AT);
    notifications.createForOrg.mockReset().mockResolvedValue([]);
    expect(await rings([], 1)).toEqual(['o1']);
  });
});

// The recordings storage failed a privacy check: found public (by any check), or not checkable (at night). One bell per
// organization, naming only its own profiles, and WhatsApp to its profiles' alarm numbers (each once). The storage's
// address is never in it: one storage serves every organization of the server.
describe('CallAlerts.recordingStorage', () => {
  const PUBLIC = 'The storage of call recordings serves its files without credentials: anyone who has an address can read them. ';
  const FIX = 'Make the storage private, then turn recording on again.';
  let notifications: { createForOrg: ReturnType<typeof vi.fn> };
  let alerts: CallAlerts;
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([
      { id: 'p1', displayName: 'Line 1', settings: { quietAlarmNotify: ['628111000111', '628111000222'] }, workspace: { organizationId: 'o1' } },
      { id: 'p2', displayName: null, settings: { quietAlarmNotify: ['628111000111'] }, workspace: { organizationId: 'o1' } },
      { id: 'p3', displayName: 'Line 3', settings: {}, workspace: { organizationId: 'o2' } },
    ]);
    (sendOpsAlert as any).mockReset().mockResolvedValue(undefined);
    notifications = { createForOrg: vi.fn().mockResolvedValue([]) };
    alerts = new CallAlerts(notifications as any, {} as any);
  });

  it('public: each organization told of its own profiles turned off; WhatsApp to their alarm numbers, once each', async () => {
    await alerts.recordingStorage('not_private', ['p1', 'p2', 'p3'], ['p1', 'p2']);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['p1', 'p2', 'p3'] } } }));
    const o1 = `${PUBLIC}Recording was turned off for Line 1, p2. ${FIX}`;
    const o2 = `${PUBLIC}${FIX}`;
    expect(notifications.createForOrg.mock.calls).toEqual([
      ['o1', 'system', 'Call recordings can be read without a login', o1, { kind: 'call_recordings_storage', status: 'not_private' }],
      ['o2', 'system', 'Call recordings can be read without a login', o2, { kind: 'call_recordings_storage', status: 'not_private' }],
    ]);
    expect((sendOpsAlert as any).mock.calls).toEqual([
      [{}, expect.anything(), {
        what: 'Call recordings storage alert for o1', organizationId: 'o1', excludeProfileId: '', ownPhone: null,
        recipients: ['628111000111', '628111000222'], text: `⚠️ Call recordings can be read without a login. ${o1}`,
      }],
      [{}, expect.anything(), {
        what: 'Call recordings storage alert for o2', organizationId: 'o2', excludeProfileId: '', ownPhone: null,
        recipients: [], text: `⚠️ Call recordings can be read without a login. ${o2}`,
      }],
    ]);
  });

  it('unchecked: the bell says recording stays on, for those profiles', async () => {
    findMany.mockResolvedValue([{ id: 'p3', displayName: 'Line 3', settings: {}, workspace: { organizationId: 'o2' } }]);
    await alerts.recordingStorage('check_failed', ['p3'], []);
    expect(notifications.createForOrg).toHaveBeenCalledWith('o2', 'system', 'Call recordings storage could not be checked',
      'MultiWA could not check that the storage of call recordings refuses requests without credentials. Recording stays on for Line 3.',
      { kind: 'call_recordings_storage', status: 'check_failed' });
  });

  it('nobody concerned: nothing at all', async () => {
    await alerts.recordingStorage('not_private', [], []);
    expect(findMany).not.toHaveBeenCalled();
    expect(notifications.createForOrg).not.toHaveBeenCalled();
  });

  it('a bell that fails still sends the WhatsApp alert, and the next organization gets its own', async () => {
    notifications.createForOrg.mockRejectedValueOnce(new Error('db down'));
    await alerts.recordingStorage('not_private', ['p1', 'p2', 'p3'], []);
    expect(notifications.createForOrg).toHaveBeenCalledTimes(2);
    expect(sendOpsAlert).toHaveBeenCalledTimes(2);
  });
});
