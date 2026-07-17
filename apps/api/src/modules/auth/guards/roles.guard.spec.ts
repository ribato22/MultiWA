// RolesGuard Unit Tests
// Verifies fail-closed role enforcement for @Roles(...)-decorated routes.

import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

// Build a minimal ExecutionContext whose request carries `user`.
function makeContext(user: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function makeGuard(required: string[] | undefined) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(required) } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows routes with no @Roles metadata', () => {
    expect(makeGuard(undefined).canActivate(makeContext(undefined))).toBe(true);
  });

  it('allows routes with an empty required-roles list', () => {
    expect(makeGuard([]).canActivate(makeContext({ role: 'member' }))).toBe(true);
  });

  it('allows a caller whose role is in the required set', () => {
    expect(makeGuard(['owner', 'admin']).canActivate(makeContext({ role: 'admin' }))).toBe(true);
  });

  it('denies a caller whose role is not in the required set', () => {
    expect(() =>
      makeGuard(['owner', 'admin']).canActivate(makeContext({ role: 'member' })),
    ).toThrow(ForbiddenException);
  });

  it('denies when the role is missing (fail closed)', () => {
    expect(() =>
      makeGuard(['owner', 'admin']).canActivate(makeContext({})),
    ).toThrow(ForbiddenException);
  });

  it('denies when there is no authenticated user (fail closed)', () => {
    expect(() =>
      makeGuard(['owner', 'admin']).canActivate(makeContext(undefined)),
    ).toThrow(ForbiddenException);
  });
});
