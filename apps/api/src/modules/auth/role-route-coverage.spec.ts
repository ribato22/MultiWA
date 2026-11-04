// Role route-coverage meta-test: who may call each route, read from the real Nest metadata as the auth guards read
// it, and held to scripts/api-roles.snapshot.json. It fails when
//   1. a signed-in route that changes something (any method but the reads of READ_METHODS) names no role class with @Roles, or
//   2. a route's class differs from the snapshot, or a route is missing from it or extra in it.
// A change to who may call a route is then a change to the snapshot, and shows in the pull request's diff. After
// reviewing such a change: UPDATE_ROLE_SNAPSHOT=1 pnpm --filter api test:meta
import 'reflect-metadata';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { CONTROLLER_WATERMARK, GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from './decorators/roles.decorator';
import { SERVER_OWNER_KEY } from './decorators/server-owner.decorator';
import { JwtAuthGuard, JwtOrApiKeyGuard } from './guards/jwt-auth.guard';
import { READ_METHODS } from './guards/role-check';
import { ADMIN_ROLES, AGENT_ROLES, ANY_ROLES } from './roles';

const SRC = path.resolve(__dirname, '../..');
const SNAPSHOT = path.resolve(SRC, '../../../scripts/api-roles.snapshot.json');
const NOTE =
  "Who may call each route: Public (no sign-in), Any, Agent (owner, admin, member), Admin (owner, admin) or Server owner. role-route-coverage.spec.ts compares it with the controllers' @Roles; change it together with them. Regenerate: UPDATE_ROLE_SNAPSHOT=1 pnpm --filter api test:meta";
const CLASSES: Array<[string, readonly string[]]> = [['Any', ANY_ROLES], ['Agent', AGENT_ROLES], ['Admin', ADMIN_ROLES]];

type Controller = { prototype: Record<string, unknown> };

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(p);
    return entry.name.endsWith('.controller.ts') ? [p] : [];
  });
}

const segment = (p: unknown) => String((Array.isArray(p) ? p[0] : p) ?? '').replace(/^\/+|\/+$/g, '');
const sameRoles = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();
// Path, then method, in code-point order: the order the snapshot file is written in.
const byPath = (a: string, b: string) => {
  const [ka, kb] = [a.slice(a.indexOf(' ') + 1) + ' ' + a, b.slice(b.indexOf(' ') + 1) + ' ' + b];
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

function classOf(controller: Controller, handler: object, method: string): string {
  const guards = [...(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []), ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])];
  if (!guards.some((g) => g === JwtAuthGuard || g === JwtOrApiKeyGuard)) return 'Public';
  if (Reflect.getMetadata(SERVER_OWNER_KEY, handler) ?? Reflect.getMetadata(SERVER_OWNER_KEY, controller)) return 'Server owner';
  const roles: readonly string[] | undefined = Reflect.getMetadata(ROLES_KEY, handler) ?? Reflect.getMetadata(ROLES_KEY, controller);
  if (!roles?.length) return READ_METHODS.has(method) ? 'Any' : 'UNSET';
  return CLASSES.find(([, r]) => sameRoles(r, roles))?.[0] ?? [...roles].sort().join(',');
}

async function routesByClass(): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const file of controllerFiles(SRC)) {
    for (const exported of Object.values(await import(/* @vite-ignore */ file))) {
      if (typeof exported !== 'function' || !Reflect.getMetadata(CONTROLLER_WATERMARK, exported)) continue;
      const controller = exported as unknown as Controller;
      const base = segment(Reflect.getMetadata(PATH_METADATA, controller));
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[name];
        if (name === 'constructor' || typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
        const route = `${method} /${[base, segment(Reflect.getMetadata(PATH_METADATA, handler))].filter(Boolean).join('/')}`;
        found[route] = classOf(controller, handler, method);
      }
    }
  }
  return found;
}

describe('role route coverage', () => {
  let routes: Record<string, string>;

  beforeAll(async () => {
    routes = await routesByClass();
    if (process.env.UPDATE_ROLE_SNAPSHOT === '1') {
      const sorted = Object.fromEntries(Object.keys(routes).sort(byPath).map((r) => [r, routes[r]]));
      writeFileSync(SNAPSHOT, JSON.stringify({ note: NOTE, routeCount: Object.keys(sorted).length, routes: sorted }, null, 2) + '\n');
    }
  }, 120_000);

  it('every signed-in route that changes something names who may call it (@Roles)', () => {
    expect(Object.keys(routes).filter((r) => routes[r] === 'UNSET').sort(byPath)).toEqual([]);
  });

  it('who may call each route is what scripts/api-roles.snapshot.json says', () => {
    expect(routes).toEqual(JSON.parse(readFileSync(SNAPSHOT, 'utf8')).routes);
  });
});
