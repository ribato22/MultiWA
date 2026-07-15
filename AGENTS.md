# Repository Guidelines

## Project Overview

MultiWA is a self-hosted WhatsApp Business API gateway. It provides a NestJS/Fastify API, Next.js admin, BullMQ worker, Prisma/PostgreSQL persistence, selectable WhatsApp engines, realtime updates, webhooks, automation, and SDK/integration packages.

## Architecture & Data Flow

- `apps/api` is the public API: `/api/v1`, Swagger at `/api/docs`, Socket.IO realtime, validation, auth, tenancy, scheduling, and feature modules.
- `apps/worker` owns BullMQ consumers and, when `ENGINE_HOST=worker`, WhatsApp engine/session runtime.
- `packages/database` owns Prisma and PostgreSQL schema; `packages/core` owns canonical app events/realtime contracts; `packages/engines` owns adapter contracts/factory; `packages/engine-runtime` owns shared send pacing.
- Default `ENGINE_HOST=api`: API owns adapters, sessions, automation callbacks, and Socket.IO emission. `ENGINE_HOST=worker`: API queues engine commands/outbound work through Redis; worker owns engines and publishes realtime payloads back through Redis for API Socket.IO relay. Choose one owner only.
- Typical send path: API validates/normalizes recipient → persists conversation/message → direct send or durable `outbound-send` BullMQ job → send gate/adapter → delivery state and canonical event → realtime/webhook delivery.
- Canonical EventEmitter/webhook event names are dot-delimited (`message.sent`); Socket.IO events are colon-delimited (`message:ack`, `qr:update`). Do not interchange them.
- A queued, pending, or scheduled-row `sent` result is not proof of remote WhatsApp delivery. Follow the persisted message state/ack/webhook event.

## Key Directories

| Path | Purpose |
| --- | --- |
| `apps/api/src/main.ts` | API bootstrap, global prefix/security/validation/realtime setup. |
| `apps/api/src/app.module.ts` | API composition root. |
| `apps/api/src/modules/**` | Feature modules: profiles, messages, contacts, automations, webhooks, auth, events. |
| `apps/worker/src/main.ts` | Worker bootstrap, queue registration, graceful shutdown. |
| `apps/worker/src/engine/**` | Worker-mode engine, message, automation, realtime runtime. |
| `apps/admin/src/app/**` | Next.js App Router admin and auth screens. |
| `apps/admin/src/components/**` | Admin UI, contact controls, shared components. |
| `apps/admin/src/lib/**` | API client, i18n, state/helpers. |
| `packages/database/prisma/schema.prisma` | Canonical PostgreSQL data model. |
| `packages/core/src/{app-events,realtime}.ts` | Canonical event names and Redis realtime contract. |
| `packages/engines/src/**` | Engine adapters and factory (`whatsapp-web-js`, `baileys`, `mock`). |
| `packages/engine-runtime/src/send-gate.service.ts` | Per-profile pacing, lanes, and circuit controls. |
| `scripts/**` | Release/public-boundary/API-contract checks and local webhook helpers. |
| `docs/**` | Primary product/deployment/API documentation. |
| `docs-site/` | Separate Docusaurus project, not part of pnpm workspace. |

## Development Commands

Use Node 20+ and pnpm 9.15 at repository root.

```bash
pnpm install
pnpm build                 # turbo build
pnpm test                  # turbo test; interactive because API's test script runs Vitest watch mode
pnpm typecheck             # turbo typecheck
pnpm check:release         # whitespace + public-boundary + API-contract checks

```

For CI-style completion, use focused one-shot Vitest commands in `Testing & QA`; do not rely on root `pnpm test` to terminate.

Build compiled shared packages after a fresh checkout or package-source edit:

```bash
pnpm --filter database build && pnpm --filter core build \
  && pnpm --filter engines build && pnpm --filter engine-runtime build
```

Local core services use API `3000`, admin `3001`, PostgreSQL `5432`, Redis `6379`. Root Docker Compose defaults differ: API `3333`, database host `5433`, Redis host `6380`.

```bash
# VM-local data services; use packaged Redis config, not repo root
sudo pg_ctlcluster 16 main start
sudo redis-server /etc/redis/redis.conf --daemonize yes

# Schema: no prisma/migrations directory; use db push from repository root
pnpm --filter database exec prisma db push

# Admin
pnpm --filter @multiwa/admin dev

# API workaround; see Known Operational Caveats
cd apps/api
pnpm exec tsc -p tsconfig.json --noEmitOnError false --incremental false
node dist/main.js
```

For the separate documentation app, use its own npm lockfile:

```bash
cd docs-site
npm ci
npm run start
```

## Code Conventions & Common Patterns

- TypeScript is strict at root; follow local `tsconfig` exceptions rather than spreading `any`. Prefer interfaces for object contracts and discriminated unions for variants/results.
- Formatting: `pnpm format` runs Prettier over `**/*.{ts,tsx,md,json}`. Follow Nest `*.controller.ts`, `*.service.ts`, `*.module.ts` naming, use `use-*` for custom hooks, and match the containing directory's existing component filename style. No established shared global-store convention was identified by scouts; preserve local state/provider patterns rather than inventing one.
- Nest features follow controller/module/service composition with constructor DI. Use Nest HTTP exceptions (`NotFoundException`, `BadRequestException`, `ForbiddenException`, etc.) for request failures.
- Preserve `@RequireTenant` with resource-scoped API handlers: `TenantGuard` is opt-in and routes without tenant metadata pass through.
- Async services await Prisma operations. Queue consumers persist terminal state, emit canonical events, and rethrow transient failures so BullMQ can retry. Best-effort realtime/webhook callbacks log failures without breaking engine callbacks.
- Keep API and worker counterparts aligned when changing engine, message, automation, or AI runtime behavior. Most are duplicated across `apps/api/src/modules/**` and `apps/worker/src/engine/**`; only `SendGateService` is shared.
- UI: New or rebuilt UI MAY use any suitable component library or local components, chosen per task for compatibility, maintenance, accessibility, bundle/UX fit, and consistency with surrounding screens. GentleDuck MUST NOT be used. Preserve i18n/RTL behavior, logical CSS (`start`/`end`, `ms`/`me`), accessible labels/roles, keyboard operation, and visible focus states. Do not mandate any repo-wide UI library without an explicit user decision.
- Tests use Vitest. API specs colocate as `*.spec.ts`; admin tests live under `apps/admin/src/__tests__`. Use `renderWithI18n` for provider-dependent admin components.

## Important Files

- `package.json`, `pnpm-workspace.yaml`, `turbo.json`: root workspace/task contract.
- `.env.example`, `.env.production.example`, `.env.docker`: environment templates; never commit populated secrets.
- `apps/api/src/common/engine-host.ts`: engine ownership mode decision.
- `apps/api/src/modules/messages/messages.service.ts`: public outbound-message state and enqueue logic.
- `apps/api/src/modules/events/events.gateway.ts`: authenticated Socket.IO boundary.
- `apps/api/src/common/tenant/tenant.guard.ts`: organization ownership guard.
- `apps/admin/next.config.js`: standalone build, API rewrite precedence, build-time public URL behavior.
- `docker-compose.yml`, `docker-compose.production.yml`, `docker-compose.dokploy.yml`: distinct runtime topologies; do not mix their ports, network aliases, or env defaults.
- `scripts/check-api-contract.mjs`: source/snapshot/docs API-contract gate. Controller edits require `docs/07-api-specification.md` and `scripts/api-routes.snapshot.json` updates; `pnpm check:api-contract:update` intentionally rewrites the snapshot.
- `scripts/check-public-boundary.sh`: scans tracked files for public-release hazards.

## Runtime/Tooling Preferences

- Root runtime: Node `>=20`, pnpm `9.15.0`, Turborepo. Do not introduce Bun as root package manager or replace `pnpm-lock.yaml` without an explicit migration decision.
- `.env` at root is used by root tools. `apps/api/.env` is required when filtered API/database processes load Prisma from the API CWD. `apps/admin/.env.local` must set `NEXT_PUBLIC_API_URL` and `INTERNAL_API_URL` to `http://localhost:3000` for local development; the Next fallback is Docker-oriented `:3333`.
- `NEXT_PUBLIC_API_URL` is embedded at admin build time. Rebuild the admin image after changing it.
- Postgres, Redis, WhatsApp session data, and optional object storage need persistent volumes in deployed topologies. API/worker Chromium/Puppeteer images need their system Chromium configuration intact.
- `baileys` is experimental; capability-check adapters instead of assuming parity with `whatsapp-web-js`.
- Docs conflict in places. Prefer root `README.md`, `docs/03-quick-start.md`, `docs/16-deployment-docker.md`, and `docs/18-configuration-reference.md`; validate legacy `docs-site/**`, `docs/02-requirements.md`, `docs/17-development.md`, and `docs/database-options.md` before copying commands.

## Testing & QA

```bash
# Admin: jsdom + React Testing Library + fast-check
pnpm --filter @multiwa/admin test
pnpm --filter @multiwa/admin exec vitest run src/__tests__/bug-conditions.test.tsx
pnpm --filter @multiwa/admin test:watch

# API: use one-shot Vitest, not bare `api test` watch script
pnpm --filter @multiwa/api exec vitest run
pnpm --filter @multiwa/api exec vitest run src/modules/auth/auth.service.spec.ts
```

API test runs may need PostgreSQL, Redis, and explicit test secrets. Use repository-local test configuration; do not place credentials in source. Representative API specs mock Prisma, queues, engines, web push, and Redis-adjacent lifecycle; do not assume a mocked unit suite proves live-service integration.

Admin test setup mocks Next, Socket.IO, and API calls, seeds local storage, and resets `html[lang]`/`dir`. Add user-visible component tests with accessible queries; use `data-testid` only where semantic queries are impractical. Existing i18n/RTL and contact tests use fast-check property assertions.

There is no audited browser E2E suite or configured coverage threshold. Treat production-flow changes as requiring focused behavior tests plus an appropriate manual/browser smoke test.

Before release-oriented changes, run `pnpm check:release`. Its public-boundary scan hard-fails PEM private keys, merge markers, and non-doc RFC1918 literals; it flags credential-like and `.env`-style assignments. Never commit real credentials, internal audit artifacts, or private operational data. Webhook verification must use raw request bytes and the dot-delimited public event contract; do not rely on `scripts/test-webhook.sh` selection flags beyond `-k`.

## Known Operational Caveats

- Root operational notes record no Prisma migrations directory: use `pnpm --filter database exec prisma db push`, not `prisma migrate deploy`.
- Root operational notes record that `pnpm --filter api dev` currently does not launch after pre-existing TypeScript errors, while `nest start --watch --builder swc` hits `Cannot access 'EngineManagerService' before initialization`. Use the emitted CommonJS API command above unless this is re-verified/fixed.
- Root operational notes record API typecheck/lint limitations: API has pre-existing type errors, API ESLint is not configured, admin `next lint` prompts interactively, and database lint targets a missing path. Do not represent those as green quality gates.
- Dockerfiles intentionally tolerate some TypeScript build failures but assert emitted runtime artifacts. Treat an image build as an artifact check, not proof that typecheck passed.
