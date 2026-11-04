// The auth guards sign the caller in, then check who may call the route (assertRole).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

vi.mock('@multiwa/database', () => ({ prisma: {} }));

import { JwtAuthGuard, JwtOrApiKeyGuard } from './jwt-auth.guard';

const post = (role: string) =>
  ({
    getHandler: () => function route() {},
    getClass: () => class Routes {},
    switchToHttp: () => ({ getRequest: () => ({ method: 'POST', user: { role } }) }),
  }) as unknown as ExecutionContext;

describe.each([['JwtAuthGuard', JwtAuthGuard], ['JwtOrApiKeyGuard', JwtOrApiKeyGuard]] as const)('%s', (_name, Guard) => {
  // The sign-in itself is Passport's: stubbed here, so the test is about what follows it.
  const signedIn = () => vi.spyOn(Object.getPrototypeOf(Guard.prototype), 'canActivate').mockResolvedValue(true);
  afterEach(() => vi.restoreAllMocks());

  it('refuses a viewer on a route that changes something, after signing them in', async () => {
    const signIn = signedIn();
    const viewer = post('viewer');
    await expect(new Guard(new Reflector()).canActivate(viewer)).rejects.toThrow(ForbiddenException);
    expect(signIn).toHaveBeenCalledWith(viewer);
  });

  it('lets a member through the same route', async () => {
    signedIn();
    await expect(new Guard(new Reflector()).canActivate(post('member'))).resolves.toBe(true);
  });
});
