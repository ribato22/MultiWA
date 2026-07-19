// Unit tests for ApiKeyScopeGuard — proves the backward-compat decision matrix
// without HTTP. Mirrors roles.guard.spec.ts (Reflector-stubbed).

import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ApiKeyScopeGuard } from './api-key-scope.guard';

function ctx(user: any) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function guardWith(required: string[] | undefined) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(required) } as any;
  return new ApiKeyScopeGuard(reflector);
}

describe('ApiKeyScopeGuard', () => {
  it('passes when the route declares no scope', () => {
    expect(guardWith(undefined).canActivate(ctx({ apiKeyScopes: ['message:read'] }))).toBe(true);
    expect(guardWith([]).canActivate(ctx({ apiKeyScopes: ['message:read'] }))).toBe(true);
  });

  it('legacy unscoped key ([]) stays full-access', () => {
    expect(guardWith(['message:send']).canActivate(ctx({ apiKeyScopes: [] }))).toBe(true);
  });

  it('wildcard key (*) is full-access', () => {
    expect(guardWith(['message:send']).canActivate(ctx({ apiKeyScopes: ['*'] }))).toBe(true);
  });

  it('passes when the key carries the required scope', () => {
    expect(guardWith(['message:send']).canActivate(ctx({ apiKeyScopes: ['message:send'] }))).toBe(true);
  });

  it('passes on ANY-of when the key has one of several required scopes', () => {
    expect(guardWith(['message:send', 'message:read']).canActivate(ctx({ apiKeyScopes: ['message:read'] }))).toBe(true);
  });

  it('throws Forbidden when the key lacks the required scope', () => {
    expect(() =>
      guardWith(['message:send']).canActivate(ctx({ apiKeyScopes: ['message:read'] })),
    ).toThrow(ForbiddenException);
  });

  it('JWT principal (no apiKeyScopes) is never blocked by the scope guard', () => {
    expect(guardWith(['message:send']).canActivate(ctx({ role: 'owner' }))).toBe(true);
  });
});
