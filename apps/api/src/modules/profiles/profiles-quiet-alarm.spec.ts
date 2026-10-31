// ProfilesService.update merges the quiet-profile alarm settings alone into settings (mergeProfileSettings).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { profile: { findUnique: vi.fn(), update: vi.fn() } } }));
vi.mock('./profile-settings', () => ({ mergeProfileSettings: vi.fn() }));

import { prisma } from '@multiwa/database';
import { ProfilesService } from './profiles.service';
import { mergeProfileSettings } from './profile-settings';

const db = prisma as any;
const merge = vi.mocked(mergeProfileSettings);
const svc = new (ProfilesService as any)({}, {}) as ProfilesService;

beforeEach(() => {
  db.profile.findUnique.mockReset().mockResolvedValue({ id: 'p1', settings: { autoRejectCalls: true }, workspace: {} });
  db.profile.update.mockReset().mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data }));
  merge.mockReset().mockResolvedValue({});
});

describe('ProfilesService.update — quiet-profile alarm', () => {
  it('merges both settings, and nothing else', async () => {
    await svc.update('p1', { quietAlarmHours: 2, quietAlarmNotify: ['628123456789'] } as any);
    expect(merge).toHaveBeenCalledWith('p1', { quietAlarmHours: 2, quietAlarmNotify: ['628123456789'] });
  });

  it('null hours turns the alarm off', async () => {
    await svc.update('p1', { quietAlarmHours: null } as any);
    expect(merge).toHaveBeenCalledWith('p1', { quietAlarmHours: null });
  });

  it('an update without them leaves settings alone', async () => {
    await svc.update('p1', { messageDelayMs: 1500 } as any);
    expect(merge).not.toHaveBeenCalled();
  });
});
