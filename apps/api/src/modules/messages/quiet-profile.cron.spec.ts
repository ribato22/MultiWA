// QuietProfileCron: one alarm per silent episode, one recovery notice, silence counted in active hours only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, HttpException, Logger } from '@nestjs/common';

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

afterEach(() => {
  vi.restoreAllMocks();
});

// The cron reads createdAt (this host's clock), the same clock as `now`, quietAlarmAt and lastConnectedAt.
const lastIncoming = (iso: string | null) => db.message.findFirst.mockResolvedValue(iso ? { createdAt: at(iso) } : null);

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

  it('never raises for a profile that is not connected, and does not even look up its messages', async () => {
    db.profile.findMany.mockResolvedValue([profile({ status: 'disconnected' })]);
    lastIncoming('2026-10-28T01:00:00Z');
    await cron.checkQuietProfiles(NOW);
    expect(db.profile.updateMany).not.toHaveBeenCalled();
    expect(notifications.createForOrg).not.toHaveBeenCalled();
    expect(db.message.findFirst).not.toHaveBeenCalled();
  });

  it('a disconnected profile with an open alarm is still looked up, so the alarm can close', async () => {
    const alarmAt = at('2026-10-28T05:00:00Z');
    db.profile.findMany.mockResolvedValue([profile({ status: 'disconnected', quietAlarmAt: alarmAt })]);
    lastIncoming('2026-10-28T05:30:00Z');
    await cron.checkQuietProfiles(NOW);
    expect(db.message.findFirst).toHaveBeenCalledTimes(1);
    expect(db.profile.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', quietAlarmAt: alarmAt }, data: { quietAlarmAt: null } });
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

  it('logs why the send gate refused a message: the reason is in the 429 body, not in its message', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db.profile.findMany.mockResolvedValue([profile()]);
    lastIncoming('2026-10-28T03:30:00Z');
    messages.sendText.mockRejectedValueOnce(new HttpException({ error: 'REPEAT_SUPPRESSED', retryInMs: 1000 }, 429));

    await cron.checkQuietProfiles(NOW);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('REPEAT_SUPPRESSED'));
  });

  it('still logs the message of an exception that has both a message and an error code', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db.profile.findMany.mockResolvedValue([profile()]);
    lastIncoming('2026-10-28T03:30:00Z');
    messages.sendText.mockRejectedValueOnce(new BadRequestException('Invalid recipient: 628111000111'));

    await cron.checkQuietProfiles(NOW);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid recipient: 628111000111'));
  });

  it('names a profile without a display name by its id', async () => {
    db.profile.findMany.mockResolvedValue([profile({ displayName: null })]);
    lastIncoming('2026-10-28T03:30:00Z');

    await cron.checkQuietProfiles(NOW);

    const [, , title, text] = notifications.createForOrg.mock.calls[0];
    expect(title).toBe('p1 is receiving no messages');
    expect(text).toContain('profile "p1" (+628123456789)');
  });

  it('another process raised it first: no duplicate notice', async () => {
    db.profile.findMany.mockResolvedValue([profile()]);
    lastIncoming('2026-10-28T03:30:00Z');
    db.profile.updateMany.mockResolvedValue({ count: 0 });
    await cron.checkQuietProfiles(NOW);
    expect(notifications.createForOrg).not.toHaveBeenCalled();
    expect(messages.sendText).not.toHaveBeenCalled();
  });

  // --- one clock -----------------------------------------------------------------------------------------------
  it('asks for the newest message by timestamp (the index) and reads its createdAt, the host clock', async () => {
    db.profile.findMany.mockResolvedValue([profile()]);
    lastIncoming('2026-10-28T05:50:00Z');
    await cron.checkQuietProfiles(NOW);
    expect(db.message.findFirst).toHaveBeenCalledWith({
      where: { profileId: 'p1', direction: 'incoming' },
      orderBy: { timestamp: 'desc' },
      select: { createdAt: true },
    });
  });

  it('a skewed host clock is not silence: a message stamped 7 h before it was stored does not raise the alarm', async () => {
    const createdAt = at('2026-10-28T05:50:00Z'); // 10 minutes before NOW on this host's clock
    const timestamp = new Date(createdAt.getTime() - 7 * 3_600_000); // WhatsApp's clock is 7 h behind the host's
    db.profile.findMany.mockResolvedValue([profile()]);
    db.message.findFirst.mockResolvedValue({ timestamp, createdAt });

    await cron.checkQuietProfiles(NOW);

    expect(db.profile.updateMany).not.toHaveBeenCalled();
    expect(notifications.createForOrg).not.toHaveBeenCalled();
  });

  // --- no silent raise -----------------------------------------------------------------------------------------
  it('a profile without an organization is skipped with one warning, and the episode is not marked raised', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db.profile.findMany.mockResolvedValue([profile({ workspace: null })]);
    lastIncoming('2026-10-28T03:30:00Z');

    await cron.checkQuietProfiles(NOW);

    expect(db.profile.updateMany).not.toHaveBeenCalled();
    expect(notifications.createForOrg).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no organization'));
  });

  // --- never through its own number ----------------------------------------------------------------------------
  it("never sends the alarm to the quiet profile's own number, however it is written", async () => {
    db.profile.findMany.mockResolvedValue([
      profile({
        settings: {
          quietAlarmHours: 2,
          quietAlarmNotify: ['628123456789@s.whatsapp.net', '+62 812-3456-789', '0812 3456 789', '628111000111'],
        },
      }),
    ]);
    lastIncoming('2026-10-28T03:30:00Z');

    await cron.checkQuietProfiles(NOW);

    expect(notifications.createForOrg).toHaveBeenCalledTimes(1); // the bell still rings
    expect(messages.sendText).toHaveBeenCalledTimes(1);
    expect(messages.sendText).toHaveBeenCalledWith(expect.objectContaining({ to: '628111000111' }));
  });

  it('a profile without a number keeps all its recipients, even one with no digits in it', async () => {
    db.profile.findMany.mockResolvedValue([profile({ phoneNumber: null, settings: { quietAlarmHours: 2, quietAlarmNotify: ['628111000111', 'ops@lid'] } })]);
    lastIncoming('2026-10-28T03:30:00Z');
    await cron.checkQuietProfiles(NOW);
    expect(messages.sendText).toHaveBeenCalledTimes(2);
  });

  // --- the trigger ---------------------------------------------------------------------------------------------
  it('tick() runs the sweep with the current time', async () => {
    const sweep = vi.spyOn(cron, 'checkQuietProfiles').mockResolvedValue(undefined);
    await cron.tick();
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(sweep.mock.calls[0][0]).toBeInstanceOf(Date);
  });

  it('only tick() is scheduled: the cron library passes onComplete to the job as its first argument', () => {
    const cronOf = (fn: unknown) => Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', fn as object);
    expect(cronOf(QuietProfileCron.prototype.tick)).toMatchObject({ cronTime: '*/5 * * * *' });
    expect(cronOf(QuietProfileCron.prototype.checkQuietProfiles)).toBeUndefined();
  });
});
