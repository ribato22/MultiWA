// ProfilesService.update and the call settings: auto-reject and the default call reply live in the profile's settings
// JSON, next to keys other routes write (the call settings, the announcement). An update merges only the keys it was
// given, in one statement (mergeProfileSettings), so it never writes back a key another request changed meanwhile.
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationPipe } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({ prisma: { profile: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() } } }));
vi.mock('./engine-manager.service', () => ({ EngineManagerService: class {} }));
vi.mock('./profile-settings', () => ({ mergeProfileSettings: vi.fn() }));

import { prisma } from '@multiwa/database';
import { UpdateProfileDto } from './dto';
import { ProfilesService } from './profiles.service';
import { mergeProfileSettings } from './profile-settings';

const db = prisma as any;
const merge = vi.mocked(mergeProfileSettings);
const update = (dto: UpdateProfileDto) => new ProfilesService({} as any, {} as any, {} as any).update('p1', dto);
const savedData = () => db.profile.update.mock.calls[0][0].data;

beforeEach(() => {
  db.profile.findUnique.mockReset().mockResolvedValue({ id: 'p1', displayName: 'Line 1', settings: { theme: 'dark' }, workspace: {} });
  db.profile.update.mockReset().mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data }));
  merge.mockReset().mockResolvedValue({ theme: 'dark' });
});

describe('ProfilesService.update call settings', () => {
  it('merges the default call reply alone, never the settings it read', async () => {
    await update({ callReplyMessage: 'We will call you back' });
    expect(merge).toHaveBeenCalledWith('p1', { callReplyMessage: 'We will call you back' });
    expect(savedData()).not.toHaveProperty('settings');
  });

  it('merges the three call settings independently of each other', async () => {
    await update({ autoRejectCalls: false });
    expect(merge).toHaveBeenLastCalledWith('p1', { autoRejectCalls: false });
    await update({ autoRejectCallMessage: 'Not now' });
    expect(merge).toHaveBeenLastCalledWith('p1', { autoRejectCallMessage: 'Not now' });
    await update({ autoRejectCalls: true, autoRejectCallMessage: 'Hi', callReplyMessage: 'Bye' });
    expect(merge).toHaveBeenLastCalledWith('p1', { autoRejectCalls: true, autoRejectCallMessage: 'Hi', callReplyMessage: 'Bye' });
  });

  // Blank means "no default reply": it is stored as given, not skipped (the reply route reads a blank as none).
  it('stores a blank reply, which switches the default off', async () => {
    await update({ callReplyMessage: '' });
    expect(merge).toHaveBeenCalledWith('p1', { callReplyMessage: '' });
  });

  it('writes no settings when no setting is given', async () => {
    await update({ name: 'Renamed' });
    expect(merge).not.toHaveBeenCalled();
    expect(savedData()).toMatchObject({ displayName: 'Renamed' });
  });

  it('a profile deleted between its read and the merge is 404, and nothing else is written', async () => {
    merge.mockResolvedValue(null);
    await expect(update({ callReplyMessage: 'Hi' })).rejects.toMatchObject({ status: 404 });
    expect(db.profile.update).not.toHaveBeenCalled();
  });
});

// The API-wide pipe strips every field a DTO does not declare with a validator: a setting that lost its decorators
// would be accepted (200) and silently dropped.
describe('UpdateProfileDto callReplyMessage', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const body = (value: unknown) => pipe.transform(value, { type: 'body', metatype: UpdateProfileDto, data: '' });

  it('survives the pipe, text only', async () => {
    expect(await body({ callReplyMessage: 'Call back soon', unknownField: 1 })).toEqual({ callReplyMessage: 'Call back soon' });
    const refused: any = await body({ callReplyMessage: 42 }).then(() => null, (e) => e);
    expect(JSON.stringify(refused?.getResponse())).toContain('callReplyMessage must be a string');
  });
});

// A profile's calls cascade with it, and so do their recordings' rows: their files (and the announcement) must go first,
// or nothing would point at them any more (the nightly sweep would remove them within a day).
describe('ProfilesService.delete', () => {
  const make = (purgeProfile: ReturnType<typeof vi.fn>) => {
    const service = new ProfilesService({} as any, {} as any, { purgeProfile } as any);
    vi.spyOn(service, 'findOne').mockResolvedValue({} as any);
    vi.spyOn(service, 'disconnect').mockResolvedValue({ status: 'disconnected' } as any);
    return service;
  };

  it("deletes the profile's recording files and announcement first, then the profile", async () => {
    const purgeProfile = vi.fn().mockResolvedValue(undefined);
    db.profile.delete.mockReset().mockResolvedValue({});
    expect(await make(purgeProfile).delete('p1')).toEqual({ success: true });
    expect(purgeProfile).toHaveBeenCalledWith('p1');
    expect(purgeProfile.mock.invocationCallOrder[0]).toBeLessThan(db.profile.delete.mock.invocationCallOrder[0]);
  });

  it('a purge that fails on the database leaves the profile in place', async () => {
    db.profile.delete.mockReset();
    await expect(make(vi.fn().mockRejectedValue(new Error('db down'))).delete('p1')).rejects.toThrow('db down');
    expect(db.profile.delete).not.toHaveBeenCalled();
  });
});
