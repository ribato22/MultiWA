// Role route-coverage meta-test: who may call each route, read from the real Nest metadata as the auth guards read
// it, and held to scripts/api-roles.snapshot.json. It fails when
//   1. a signed-in route that changes something (any method but the reads of READ_METHODS) names no role class with @Roles,
//      or a route names a role (@Roles, @ServerOwnerOnly) with no auth guard to check it,
//   2. a route's class differs from the snapshot, a route is missing from it or extra in it, or the file is not what
//      UPDATE_ROLE_SNAPSHOT=1 writes, or
//   3. a controller sits outside a *.controller.ts file, where this walk does not look, or two handlers make one route.
// A change to who may call a route is then a change to the snapshot, and shows in the pull request's diff. After
// reviewing such a change: UPDATE_ROLE_SNAPSHOT=1 pnpm --filter api test:meta
import 'reflect-metadata';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { CONTROLLER_WATERMARK, GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner } from '@nestjs/core';
import { ROLES_KEY } from './decorators/roles.decorator';
import { SERVER_OWNER_KEY } from './decorators/server-owner.decorator';
import { JwtAuthGuard, JwtOrApiKeyGuard } from './guards/jwt-auth.guard';
import { READ_METHODS } from './guards/role-check';

const SRC = path.resolve(__dirname, '../..');
const SNAPSHOT = path.resolve(SRC, '../../../scripts/api-roles.snapshot.json');
const NOTE =
  "Who may call each route: Public (no sign-in), Any, Agent (owner, admin, member), Admin (owner, admin) or Server owner. role-route-coverage.spec.ts compares it with the controllers' @Roles; change it together with them. Regenerate: UPDATE_ROLE_SNAPSHOT=1 pnpm --filter api test:meta";
// Spelled out, not taken from roles.ts: a role added to a list there must change the class of every route using it.
const CLASSES: Array<[string, readonly string[]]> = [
  ['Any', ['owner', 'admin', 'member', 'viewer']],
  ['Agent', ['owner', 'admin', 'member']],
  ['Admin', ['owner', 'admin']],
];
const AUTH_GUARDS = [JwtAuthGuard, JwtOrApiKeyGuard];

type Controller = { name: string; prototype: Record<string, object> };

// Every .ts file but the specs and the declarations.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(p);
    return entry.name.endsWith('.ts') && !/\.(spec|d)\.ts$/.test(entry.name) ? [p] : [];
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
  const read = (key: string) => Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
  const roles: readonly string[] | undefined = read(ROLES_KEY);
  const serverOwner = Boolean(read(SERVER_OWNER_KEY));
  const guards = [...(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []), ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])];
  // A subclass of an auth guard inherits its role check. A role with no auth guard is a forgotten guard, not Public.
  if (!guards.some((g) => AUTH_GUARDS.some((A) => g === A || g?.prototype instanceof A))) {
    return roles || serverOwner ? 'UNGUARDED' : 'Public';
  }
  if (serverOwner) return 'Server owner';
  if (!roles?.length) return READ_METHODS.has(method) ? 'Any' : 'UNSET';
  return CLASSES.find(([, r]) => sameRoles(r, roles))?.[0] ?? [...roles].sort().join(',');
}

async function walk() {
  const routes: Record<string, string> = {};
  const handlers: Record<string, string[]> = {};
  const controllers = new Set<Controller>();
  const scanner = new MetadataScanner();
  for (const file of sourceFiles(SRC).filter((f) => f.endsWith('.controller.ts'))) {
    for (const exported of Object.values(await import(/* @vite-ignore */ file))) {
      if (typeof exported !== 'function' || !Reflect.getMetadata(CONTROLLER_WATERMARK, exported) || controllers.has(exported)) continue;
      const controller = exported as unknown as Controller;
      controllers.add(controller);
      const base = segment(Reflect.getMetadata(PATH_METADATA, controller));
      // Inherited handlers too: Nest finds a controller's routes with this same scanner.
      for (const name of scanner.getAllMethodNames(controller.prototype)) {
        const handler = controller.prototype[name];
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
        const route = `${method} /${[base, segment(Reflect.getMetadata(PATH_METADATA, handler))].filter(Boolean).join('/')}`;
        routes[route] = classOf(controller, handler, method);
        (handlers[route] ??= []).push(`${controller.name}.${name}`);
      }
    }
  }
  return { routes, handlers, controllers: controllers.size };
}

function snapshotText(routes: Record<string, string>): string {
  const sorted = Object.fromEntries(Object.keys(routes).sort(byPath).map((r) => [r, routes[r]]));
  return JSON.stringify({ note: NOTE, routeCount: Object.keys(sorted).length, routes: sorted }, null, 2) + '\n';
}

describe('role route coverage', () => {
  let routes: Record<string, string>;
  let handlers: Record<string, string[]>;
  let controllers: number;

  beforeAll(async () => {
    ({ routes, handlers, controllers } = await walk());
    if (process.env.UPDATE_ROLE_SNAPSHOT === '1') {
      // CI holds the routes to the committed file; rewriting it there would pass any change.
      if (process.env.CI) {
        throw new Error('UPDATE_ROLE_SNAPSHOT=1 rewrites scripts/api-roles.snapshot.json, so it is refused in CI: run it locally and commit the file');
      }
      writeFileSync(SNAPSHOT, snapshotText(routes));
    }
  }, 120_000);

  it('every signed-in route that changes something names who may call it (@Roles), and no route names a role without an auth guard', () => {
    expect(Object.fromEntries(Object.entries(routes).filter(([, c]) => c === 'UNSET' || c === 'UNGUARDED'))).toEqual({});
  });

  it('who may call each route is what scripts/api-roles.snapshot.json says', () => {
    expect(routes).toEqual(JSON.parse(readFileSync(SNAPSHOT, 'utf8')).routes);
  });

  it('scripts/api-roles.snapshot.json is exactly what UPDATE_ROLE_SNAPSHOT=1 writes (note, routeCount, order)', () => {
    expect(readFileSync(SNAPSHOT, 'utf8')).toBe(snapshotText(routes));
  });

  it('every controller is in a *.controller.ts file, where this walk finds it', () => {
    // Decorators at the start of a line, so a mention in a comment (`// @Controller(`, ` * @Controller(`) is not counted.
    const decorators = sourceFiles(SRC).reduce((n, f) => n + (readFileSync(f, 'utf8').match(/^[ \t]*@Controller\(/gm)?.length ?? 0), 0);
    expect(decorators, '@Controller( decorators under src, against the controllers found in *.controller.ts files').toBe(controllers);
  });

  it('no two handlers make the same route', () => {
    expect(Object.fromEntries(Object.entries(handlers).filter(([, h]) => h.length > 1))).toEqual({});
  });
});
