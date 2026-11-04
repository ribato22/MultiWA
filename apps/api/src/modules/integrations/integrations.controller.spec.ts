// The integrations' configuration comes from the server's environment, like SMTP and storage: it is the server owner's,
// checked by the auth guard (@Roles + @ServerOwnerOnly) for the whole controller.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MetadataScanner } from '@nestjs/core';

vi.mock('@multiwa/database', () => ({ prisma: {} }));

import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { SERVER_OWNER_KEY } from '../auth/decorators/server-owner.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IntegrationsController } from './integrations.controller';

describe('IntegrationsController', () => {
  it("is for the server's owner, signed in", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, IntegrationsController)).toEqual([JwtAuthGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, IntegrationsController)).toEqual(['owner']);
    expect(Reflect.getMetadata(SERVER_OWNER_KEY, IntegrationsController)).toBe(true);
  });

  it("names no role on a handler, where it would override the controller's", () => {
    const proto = IntegrationsController.prototype as unknown as Record<string, object>;
    expect(new MetadataScanner().getAllMethodNames(proto).filter((m) => Reflect.getMetadata(ROLES_KEY, proto[m]) !== undefined)).toEqual([]);
  });
});
