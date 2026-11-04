// The auth guards sign the caller in, then check who may call the route (assertRole).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

vi.mock('@multiwa/database', () => ({ prisma: {} }));

import { JwtAuthGuard, JwtOrApiKeyGuard } from './jwt-auth.guard';

// One request for the whole call, with no user until sign-in sets one: the role check sees only the user Passport set.
const post = () => {
  const request = { method: 'POST' };
  return {
    getHandler: () => function route() {},
    getClass: () => class Routes {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe.each([['JwtAuthGuard', JwtAuthGuard], ['JwtOrApiKeyGuard', JwtOrApiKeyGuard]] as const)('%s', (_name, Guard) => {
  // The sign-in itself is Passport's: stubbed here to set the user on the request as Passport does, so the test is
  // about what follows it.
  const signedInAs = (role: string) =>
    vi.spyOn(Object.getPrototypeOf(Guard.prototype), 'canActivate').mockImplementation(async (ctx: ExecutionContext) => {
      ctx.switchToHttp().getRequest().user = { role };
      return true;
    });
  afterEach(() => vi.restoreAllMocks());

  it('refuses a viewer on a route that changes something, after signing them in', async () => {
    const signIn = signedInAs('viewer');
    const context = post();
    await expect(new Guard(new Reflector()).canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(signIn).toHaveBeenCalledWith(context);
  });

  it('lets a member through the same route', async () => {
    signedInAs('member');
    await expect(new Guard(new Reflector()).canActivate(post())).resolves.toBe(true);
  });
});
