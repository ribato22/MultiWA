// Server-wide settings (SMTP, storage) are the server owner's: the owner of the oldest organization, checked by the
// auth guard (@Roles + @ServerOwnerOnly), not by each handler.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';

vi.mock('@multiwa/database', () => ({ prisma: {} }));
vi.mock('@multiwa/engine-runtime', () => ({ EmailService: class {} }));

import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { SERVER_OWNER_KEY } from '../auth/decorators/server-owner.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SettingsController } from './settings.controller';

describe('SettingsController', () => {
  it("is for the server's owner, signed in", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SettingsController)).toEqual([JwtAuthGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, SettingsController)).toEqual(['owner']);
    expect(Reflect.getMetadata(SERVER_OWNER_KEY, SettingsController)).toBe(true);
  });
});
