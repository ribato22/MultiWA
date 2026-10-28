// ProfilesService.update and the call settings: auto-reject and the default call reply live in the profile's
// settings JSON, next to whatever else is kept there, so an update merges into what is stored and never replaces it.
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationPipe } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({ prisma: { profile: { findUnique: vi.fn(), update: vi.fn() } } }));
vi.mock('./engine-manager.service', () => ({ EngineManagerService: class {} }));

import { prisma } from '@multiwa/database';
import { UpdateProfileDto } from './dto';
import { ProfilesService } from './profiles.service';

const db = prisma as any;
const stored = (settings: unknown) => ({ id: 'p1', displayName: 'Line 1', settings, workspace: {} });
const update = (dto: UpdateProfileDto) => new ProfilesService({} as any, {} as any).update('p1', dto);
const savedData = () => db.profile.update.mock.calls[0][0].data;

beforeEach(() => {
  db.profile.findUnique.mockReset();
  db.profile.update.mockReset().mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data }));
});

describe('ProfilesService.update call settings', () => {
  it('stores the default call reply in settings, keeping every other key', async () => {
    db.profile.findUnique.mockResolvedValue(stored({ autoRejectCalls: true, autoRejectCallMessage: 'Busy', theme: 'dark' }));
    await update({ callReplyMessage: 'We will call you back' });
    expect(db.profile.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({
        settings: { autoRejectCalls: true, autoRejectCallMessage: 'Busy', theme: 'dark', callReplyMessage: 'We will call you back' },
      }),
    });
  });

  it('changes the three call settings independently of each other', async () => {
    const before = { autoRejectCalls: true, autoRejectCallMessage: 'Busy', callReplyMessage: 'Call back soon', theme: 'dark' };
    db.profile.findUnique.mockResolvedValue(stored(before));
    await update({ autoRejectCalls: false });
    expect(savedData().settings).toEqual({ ...before, autoRejectCalls: false });
    db.profile.update.mockClear();
    await update({ autoRejectCallMessage: 'Not now' });
    expect(savedData().settings).toEqual({ ...before, autoRejectCallMessage: 'Not now' });
    db.profile.update.mockClear();
    await update({ autoRejectCalls: true, autoRejectCallMessage: 'Hi', callReplyMessage: 'Bye' });
    expect(savedData().settings).toEqual({ ...before, autoRejectCalls: true, autoRejectCallMessage: 'Hi', callReplyMessage: 'Bye' });
  });

  // Blank means "no default reply": it is stored as given, not skipped (the reply route reads a blank as none).
  it('stores a blank reply, which switches the default off', async () => {
    db.profile.findUnique.mockResolvedValue(stored({ callReplyMessage: 'Call back soon' }));
    await update({ callReplyMessage: '' });
    expect(savedData().settings).toEqual({ callReplyMessage: '' });
  });

  it('starts from nothing for a profile without settings', async () => {
    db.profile.findUnique.mockResolvedValue(stored(null));
    await update({ callReplyMessage: 'Hi' });
    expect(savedData().settings).toEqual({ callReplyMessage: 'Hi' });
  });

  it('leaves settings out of the update when no call setting is given', async () => {
    db.profile.findUnique.mockResolvedValue(stored({ callReplyMessage: 'Call back soon' }));
    await update({ name: 'Renamed' });
    expect(savedData()).not.toHaveProperty('settings');
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
