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
// organization, for its owner and admins only, naming only its own profiles, and WhatsApp to its profiles' alarm numbers
// (each once). The storage's address is never in it: one storage serves every organization of the server, so the
// alert asks whoever runs the server to fix it.
describe('CallAlerts.recordingStorage', () => {
  const PUBLIC = 'The storage of call recordings serves its files without credentials: anyone who has an address can read them. ';
  const FIX = 'Whoever runs this MultiWA server must make the storage private; recording can then be turned on again.';
  // A member or viewer can do nothing about it, and the bell should not tell them that recordings can be read.
  const ADMINS = ['owner', 'admin'];
  let notifications: { createForOrg: ReturnType<typeof vi.fn> };
  let alerts: CallAlerts;
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([
      { id: 'p1', displayName: 'Line 1', settings: { quietAlarmNotify: ['628111000111', '628111000222'] }, workspace: { organizationId: 'o1' } },
      { id: 'p2', displayName: null, settings: { quietAlarmNotify: ['628111000111'] }, workspace: { organizationId: 'o1' } },
      { id: 'p3', displayName: 'Line 3', settings: {}, workspace: { organizationId: 'o2' } },
      // No workspace, so no organization: grouped under undefined, its bell and its WhatsApp alert would lose their
      // organization filter (Prisma drops an undefined condition), and it is left out.
      { id: 'p4', displayName: 'Line 4', settings: { quietAlarmNotify: ['628444000444'] }, workspace: null },
    ]);
    (sendOpsAlert as any).mockReset().mockResolvedValue(undefined);
    notifications = { createForOrg: vi.fn().mockResolvedValue([]) };
    alerts = new CallAlerts(notifications as any, {} as any);
  });

  it('public: each organization told of its own profiles turned off; WhatsApp to their alarm numbers, once each', async () => {
    const warn = vi.spyOn((alerts as any).logger, 'warn').mockImplementation(() => {});
    expect(await alerts.recordingStorage('not_private', ['p1', 'p2', 'p3', 'p4'], ['p1', 'p2', 'p4'])).toBe(true);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['p1', 'p2', 'p3', 'p4'] } } }));
    const o1 = `${PUBLIC}Recording was turned off for Line 1, p2. ${FIX}`;
    const o2 = `${PUBLIC}${FIX}`;
    expect(notifications.createForOrg.mock.calls).toEqual([
      ['o1', 'system', 'Call recordings can be read without a login', o1, { kind: 'call_recordings_storage', status: 'not_private' }, ADMINS],
      ['o2', 'system', 'Call recordings can be read without a login', o2, { kind: 'call_recordings_storage', status: 'not_private' }, ADMINS],
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
    expect(warn).toHaveBeenCalledWith('Call recordings storage alert for p4 skipped: the profile has no organization');
  });

  it('unchecked: the bell says recording stays on, for those profiles, to the owner and admins', async () => {
    findMany.mockResolvedValue([{ id: 'p3', displayName: 'Line 3', settings: {}, workspace: { organizationId: 'o2' } }]);
    await alerts.recordingStorage('check_failed', ['p3'], []);
    expect(notifications.createForOrg).toHaveBeenCalledWith('o2', 'system', 'Call recordings storage could not be checked',
      'MultiWA could not check that the storage of call recordings refuses requests without credentials. Recording stays on for Line 3. ' +
        'If this repeats, ask whoever runs this MultiWA server to check the storage.',
      { kind: 'call_recordings_storage', status: 'check_failed' }, ADMINS);
  });

  it('nobody concerned, or none in an organization: nothing at all, and nobody told', async () => {
    expect(await alerts.recordingStorage('not_private', [], [])).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
    vi.spyOn((alerts as any).logger, 'warn').mockImplementation(() => {});
    findMany.mockResolvedValue([{ id: 'p4', displayName: 'Line 4', settings: {}, workspace: null }]);
    expect(await alerts.recordingStorage('not_private', ['p4'], ['p4'])).toBe(false);
    expect(notifications.createForOrg).not.toHaveBeenCalled();
  });

  it('a bell that fails still sends the WhatsApp alert, and the next organization gets its own: someone was told', async () => {
    notifications.createForOrg.mockRejectedValueOnce(new Error('db down'));
    expect(await alerts.recordingStorage('not_private', ['p1', 'p2', 'p3'], [])).toBe(true);
    expect(notifications.createForOrg).toHaveBeenCalledTimes(2);
    expect(sendOpsAlert).toHaveBeenCalledTimes(2);
  });

  // The database failing after the profiles were read: each failure is only logged, so it resolves all the same, and
  // says that no bell went out, for the caller not to count it as an alert.
  it('every bell failing: resolves, saying that nobody was told', async () => {
    const warn = vi.spyOn((alerts as any).logger, 'warn').mockImplementation(() => {});
    notifications.createForOrg.mockRejectedValue(new Error('db down'));
    expect(await alerts.recordingStorage('not_private', ['p1', 'p2', 'p3'], [])).toBe(false);
    expect(sendOpsAlert).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('Call recordings storage bell for o1 failed: db down');
  });
});

describe('CallAlerts.recordingFailed', () => {
  let notifications: { createForOrg: ReturnType<typeof vi.fn> };
  let alerts: CallAlerts;
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([profile('p1', 'o1', ['628111000111'], '628111000100')]);
    (sendOpsAlert as any).mockReset().mockResolvedValue(undefined);
    notifications = { createForOrg: vi.fn().mockResolvedValue([]) };
    alerts = new CallAlerts(notifications as any, {} as any);
  });

  it('a call not recorded: the bell to the owners and admins, WhatsApp to the alarm numbers, never through that profile', async () => {
    await alerts.recordingFailed('announcement_failed', 'p1', AT);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['p1'] } } }));
    expect(notifications.createForOrg).toHaveBeenCalledWith(
      'o1', 'system', 'Call not recorded: Line p1',
      'A call on Line p1 was answered in the dashboard but not recorded: the announcement did not play to the caller. The call was connected without it.',
      { kind: 'call_recording_failed', status: 'announcement_failed' }, ['owner', 'admin'],
    );
    expect((sendOpsAlert as any).mock.calls[0][2]).toEqual({
      what: 'Call recording alert for p1', organizationId: 'o1', excludeProfileId: 'p1', ownPhone: '628111000100', recipients: ['628111000111'],
      text: '⚠️ Call not recorded: Line p1. A call on Line p1 was answered in the dashboard but not recorded: the announcement did not play to the caller. The call was connected without it.',
    });
  });

  it.each([
    ['recorder_failed', 'Call not recorded: Line p1', 'A call on Line p1 was answered in the dashboard but not recorded: the recorder did not start. The call was connected.'],
    ['upload_failed', 'Call recording not stored: Line p1', 'A call recording of Line p1 could not be stored: the recordings storage did not take it. It is kept on this server and tried again at the next restart and each night.'],
  ] as const)('%s says so', async (kind, title, text) => {
    await alerts.recordingFailed(kind, 'p1', AT);
    expect(notifications.createForOrg.mock.calls[0].slice(2, 4)).toEqual([title, text]);
  });

  // A recorder that is broken fails every call: one alert an hour says it.
  it('at most once an hour per profile and kind; a bell that failed starts no hour', async () => {
    await alerts.recordingFailed('recorder_failed', 'p1', AT);
    await alerts.recordingFailed('recorder_failed', 'p1', later(59));
    await alerts.recordingFailed('announcement_failed', 'p1', later(59)); // another kind
    findMany.mockResolvedValueOnce([profile('p2', 'o1')]);
    await alerts.recordingFailed('recorder_failed', 'p2', later(59)); // another profile
    expect(notifications.createForOrg).toHaveBeenCalledTimes(3);
    expect(sendOpsAlert).toHaveBeenCalledTimes(3);
    await alerts.recordingFailed('recorder_failed', 'p1', later(61));
    expect(notifications.createForOrg).toHaveBeenCalledTimes(4);
    notifications.createForOrg.mockRejectedValueOnce(new Error('db down'));
    await alerts.recordingFailed('upload_failed', 'p1', later(62));
    await alerts.recordingFailed('upload_failed', 'p1', later(63));
    expect(notifications.createForOrg).toHaveBeenCalledTimes(6);
    expect(sendOpsAlert).toHaveBeenCalledTimes(6);
  });

  // The recorder does not wait for its alerts, and the passes at boot and at night fail a profile's kept recordings
  // back to back.
  it('failures at the same moment send one alert; a profile read that failed starts no hour', async () => {
    await Promise.all([alerts.recordingFailed('upload_failed', 'p1', AT), alerts.recordingFailed('upload_failed', 'p1', AT)]);
    expect(notifications.createForOrg).toHaveBeenCalledTimes(1);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(alerts.recordingFailed('recorder_failed', 'p1', AT)).rejects.toThrow('db down');
    await alerts.recordingFailed('recorder_failed', 'p1', later(1));
    expect(notifications.createForOrg).toHaveBeenCalledTimes(2);
  });

  it('a profile with no organization is left out', async () => {
    findMany.mockResolvedValue([{ ...profile('p1', 'o1'), workspace: null }]);
    await alerts.recordingFailed('recorder_failed', 'p1', AT);
    expect(notifications.createForOrg).not.toHaveBeenCalled();
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });
});
