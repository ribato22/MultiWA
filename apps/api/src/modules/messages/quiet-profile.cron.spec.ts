// QuietProfileCron: one alarm per silent episode, one recovery notice, silence counted in active hours only.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    profile: { findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    message: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { QuietProfileCron } from './quiet-profile.cron';

const db = prisma as any;
const at = (iso: string) => new Date(iso);
const NOW = at('2026-10-28T06:00:00Z'); // 13:00 WIB

const profile = (over: Record<string, unknown> = {}) => ({
  id: 'p1', displayName: 'Support', phoneNumber: '628123456789', status: 'connected',
  settings: { quietAlarmHours: 2, quietAlarmNotify: ['628111000111', '628222000222'] },
  lastConnectedAt: at('2026-10-20T00:00:00Z'), quietAlarmAt: null,
  workspace: { organizationId: 'o1' }, ...over,
});

let messages: { sendText: ReturnType<typeof vi.fn> };
let notifications: { createForOrg: ReturnType<typeof vi.fn> };
let cron: QuietProfileCron;

beforeEach(() => {
  db.profile.findMany.mockReset();
  db.profile.updateMany.mockReset().mockResolvedValue({ count: 1 });
  db.profile.findFirst.mockReset().mockResolvedValue({ id: 'p2' });
  db.message.findFirst.mockReset();
  messages = { sendText: vi.fn().mockResolvedValue({ success: true }) };
  notifications = { createForOrg: vi.fn().mockResolvedValue([]) };
  cron = new QuietProfileCron(messages as any, notifications as any);
});

const lastIncoming = (iso: string | null) => db.message.findFirst.mockResolvedValue(iso ? { timestamp: at(iso) } : null);

describe('QuietProfileCron', () => {
  it('raises once after 2 active hours: bell, then WhatsApp through another connected profile', async () => {
    db.profile.findMany.mockResolvedValue([profile()]);
    lastIncoming('2026-10-28T03:30:00Z'); // 10:30 WIB, 150 active minutes ago

    await cron.checkQuietProfiles(NOW);

    expect(db.profile.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', quietAlarmAt: null }, data: { quietAlarmAt: NOW } });
    const text =
      'MultiWA alert: profile "Support" (+628123456789) has received no messages since 28 Oct 10:30 (Asia/Jakarta), 2h 30m ago. ' +
      'It may have lost its WhatsApp session: open the profile in the admin and reconnect.';
    expect(notifications.createForOrg).toHaveBeenCalledWith('o1', 'disconnection', 'Support is receiving no messages', text, {
      profileId: 'p1',
      kind: 'quiet_profile',
    });
    expect(db.profile.findFirst).toHaveBeenCalledWith({
      where: { id: { not: 'p1' }, status: 'connected', quietAlarmAt: null, workspace: { organizationId: 'o1' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    expect(messages.sendText).toHaveBeenCalledTimes(2);
    expect(messages.sendText).toHaveBeenCalledWith({ profileId: 'p2', to: '628111000111', text });
    expect(messages.sendText).toHaveBeenCalledWith({ profileId: 'p2', to: '628222000222', text });
  });

  it('counts only active hours: a silence from 21:30 WIB waits for the morning', async () => {
    db.profile.findMany.mockResolvedValue([profile()]);
    lastIncoming('2026-10-27T14:30:00Z'); // 21:30 WIB

    await cron.checkQuietProfiles(at('2026-10-27T23:59:00Z')); // 06:59 WIB: 30 active minutes
    expect(db.profile.updateMany).not.toHaveBeenCalled();

    await cron.checkQuietProfiles(at('2026-10-28T01:30:00Z')); // 08:30 WIB: 30 + 90
    expect(db.profile.updateMany).toHaveBeenCalledTimes(1);
  });

  it('a recent (re)link starts a new count', async () => {
    db.profile.findMany.mockResolvedValue([profile({ lastConnectedAt: at('2026-10-28T05:30:00Z') })]);
    lastIncoming('2026-10-25T03:00:00Z');
    await cron.checkQuietProfiles(NOW);
    expect(db.profile.updateMany).not.toHaveBeenCalled();
  });

  it('never raises for a profile that is not connected', async () => {
    db.profile.findMany.mockResolvedValue([profile({ status: 'disconnected' })]);
    lastIncoming('2026-10-28T01:00:00Z');
    await cron.checkQuietProfiles(NOW);
    expect(db.profile.updateMany).not.toHaveBeenCalled();
    expect(notifications.createForOrg).not.toHaveBeenCalled();
  });

  it('no second alarm while one is open', async () => {
    db.profile.findMany.mockResolvedValue([profile({ quietAlarmAt: at('2026-10-28T05:00:00Z') })]);
    lastIncoming('2026-10-28T03:30:00Z');
    await cron.checkQuietProfiles(NOW);
    expect(db.profile.updateMany).not.toHaveBeenCalled();
    expect(notifications.createForOrg).not.toHaveBeenCalled();
  });

  it('recovers once when a message arrives after the alarm', async () => {
    const alarmAt = at('2026-10-28T05:00:00Z'); // 12:00 WIB
    db.profile.findMany.mockResolvedValue([profile({ quietAlarmAt: alarmAt })]);
    lastIncoming('2026-10-28T05:30:00Z');

    await cron.checkQuietProfiles(NOW);

    expect(db.profile.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', quietAlarmAt: alarmAt }, data: { quietAlarmAt: null } });
    const text = 'MultiWA: profile "Support" (+628123456789) is receiving messages again. The quiet alarm was raised at 28 Oct 12:00 (Asia/Jakarta).';
    expect(notifications.createForOrg).toHaveBeenCalledWith('o1', 'connection', 'Support is receiving messages again', text, {
      profileId: 'p1',
      kind: 'quiet_profile_recovered',
    });
    expect(messages.sendText).toHaveBeenCalledWith({ profileId: 'p2', to: '628111000111', text });
  });

  it('turning the alarm off clears an open one without a notice', async () => {
    const alarmAt = at('2026-10-28T05:00:00Z');
    db.profile.findMany.mockResolvedValue([profile({ settings: { quietAlarmHours: null }, quietAlarmAt: alarmAt })]);
    await cron.checkQuietProfiles(NOW);
    expect(db.profile.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', quietAlarmAt: alarmAt }, data: { quietAlarmAt: null } });
    expect(notifications.createForOrg).not.toHaveBeenCalled();
    expect(db.message.findFirst).not.toHaveBeenCalled();
  });

  it('skips profiles without the alarm', async () => {
    db.profile.findMany.mockResolvedValue([profile({ settings: {} })]);
    await cron.checkQuietProfiles(NOW);
    expect(db.message.findFirst).not.toHaveBeenCalled();
  });

  it('no other connected profile: bell only', async () => {
    db.profile.findMany.mockResolvedValue([profile()]);
    lastIncoming('2026-10-28T03:30:00Z');
    db.profile.findFirst.mockResolvedValue(null);
    await cron.checkQuietProfiles(NOW);
    expect(notifications.createForOrg).toHaveBeenCalledTimes(1);
    expect(messages.sendText).not.toHaveBeenCalled();
  });

  it('a failed WhatsApp send does not stop the others', async () => {
    db.profile.findMany.mockResolvedValue([profile()]);
    lastIncoming('2026-10-28T03:30:00Z');
    messages.sendText.mockRejectedValueOnce(new Error('Profile is not connected; the message was not sent'));
    await expect(cron.checkQuietProfiles(NOW)).resolves.toBeUndefined();
    expect(messages.sendText).toHaveBeenCalledTimes(2);
  });

  it('another process raised it first: no duplicate notice', async () => {
    db.profile.findMany.mockResolvedValue([profile()]);
    lastIncoming('2026-10-28T03:30:00Z');
    db.profile.updateMany.mockResolvedValue({ count: 0 });
    await cron.checkQuietProfiles(NOW);
    expect(notifications.createForOrg).not.toHaveBeenCalled();
    expect(messages.sendText).not.toHaveBeenCalled();
  });
});
