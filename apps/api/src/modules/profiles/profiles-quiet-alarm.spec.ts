// ProfilesService.update merges the quiet-profile alarm settings into settings without touching other keys.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: { profile: { findUnique: vi.fn(), update: vi.fn() } },
}));

import { prisma } from '@multiwa/database';
import { ProfilesService } from './profiles.service';

const db = prisma as any;
const svc = new (ProfilesService as any)({}, {}) as ProfilesService;
const settingsWritten = () => db.profile.update.mock.calls[0][0].data.settings;

beforeEach(() => {
  db.profile.findUnique.mockReset().mockResolvedValue({ id: 'p1', settings: { autoRejectCalls: true }, workspace: {} });
  db.profile.update.mockReset().mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data }));
});

describe('ProfilesService.update — quiet-profile alarm', () => {
  it('merges both settings and keeps the other keys', async () => {
    await svc.update('p1', { quietAlarmHours: 2, quietAlarmNotify: ['628123456789'] } as any);
    expect(settingsWritten()).toEqual({ autoRejectCalls: true, quietAlarmHours: 2, quietAlarmNotify: ['628123456789'] });
  });

  it('null hours turns the alarm off', async () => {
    db.profile.findUnique.mockResolvedValue({ id: 'p1', settings: { quietAlarmHours: 2, quietAlarmNotify: ['628123456789'] }, workspace: {} });
    await svc.update('p1', { quietAlarmHours: null } as any);
    expect(settingsWritten()).toEqual({ quietAlarmHours: null, quietAlarmNotify: ['628123456789'] });
  });

  it('an update without them leaves settings alone', async () => {
    await svc.update('p1', { messageDelayMs: 1500 } as any);
    expect(settingsWritten()).toBeUndefined();
  });
});
