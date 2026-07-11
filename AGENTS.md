# AGENTS.md

## Cursor Cloud specific instructions

MultiWA is a pnpm + Turborepo monorepo (Node ≥20, pnpm 9.15). The core product is a
self-hosted WhatsApp API gateway. For day-to-day development you run two services plus
two datastores:

| Service | Dir | Dev port | Depends on |
|---------|-----|----------|-----------|
| API (NestJS + Fastify) | `apps/api` | 3000 (`/api/v1`, Swagger at `/api/docs`, Socket.IO on `/socket.io/`) | PostgreSQL, Redis |
| Admin (Next.js 14) | `apps/admin` | 3001 | API |
| PostgreSQL 16 | — | 5432 | — |
| Redis 7 | — | 6379 | — |

`apps/worker` and MinIO/S3 are optional and not needed for the core flow (worker only for
scheduled/background jobs; S3 only when `STORAGE_TYPE=s3`, default is local disk).

### Datastores (installed in the VM image, NOT auto-started)
Start them at the beginning of a session:
```bash
sudo pg_ctlcluster 16 main start      # PostgreSQL
sudo redis-server --daemonize yes --appendonly yes   # Redis
```
Dev DB credentials: user `multiwa` / password `multiwa123` / db `multiwa_gateway`
(matches `DATABASE_URL` in `.env`). The schema is already applied.

### Env files (present in the VM image; all gitignored)
- `.env` (repo root) — used when tools run from the root (Prisma CLI, tests).
- `apps/api/.env` — **required**: the API and `packages/database` load `.env` from the
  process CWD, which is `apps/api` under `pnpm --filter api ...`. Without it, Prisma
  throws "Invalid value undefined for datasource db".
- `apps/admin/.env.local` — sets `NEXT_PUBLIC_API_URL`/`INTERNAL_API_URL` to
  `http://localhost:3000` (the admin's built-in default is `:3333` for Docker, wrong for
  local dev on `:3000`).

### Database schema
There is **no `prisma/migrations` directory**, so `prisma migrate deploy` does nothing.
Apply the schema with push instead (run from repo root so it uses root `.env`):
```bash
pnpm --filter database exec prisma db push
```
There is no seed script; the first user self-registers via `POST /api/v1/auth/register`
(requires `email`, `password`, `name`, `organizationName`) and becomes org `owner`.

### Building shared packages before running
`apps/api` and `apps/admin` import the compiled output of the workspace libs. After a
fresh checkout or when a package's source changes, rebuild them:
```bash
pnpm --filter database build && pnpm --filter core build \
  && pnpm --filter engines build && pnpm --filter engine-runtime build
```

### Running the API (important caveat)
The documented `pnpm --filter api dev` (`nest start --watch`, tsc) **does not launch the
app**: `tsc` reports 28 pre-existing type errors (test stubs in `auth.service.spec.ts`
missing schema fields, and Prisma JSON typing in `contacts.service.ts`) and its watch
runner only starts the app after a clean compile. `nest start --watch --builder swc`
compiles but crashes at runtime with a circular-dependency TDZ
(`Cannot access 'EngineManagerService' before initialization`) — SWC hoists classes
differently than tsc. These are pre-existing repo issues, not env problems.

`tsc`'s CommonJS emit avoids the circular-dep issue and emits despite type errors, so run
the API from its compiled output:
```bash
cd apps/api
pnpm exec tsc -p tsconfig.json --noEmitOnError false --incremental false   # emit dist/
node dist/main.js
```
For hot reload, run the tsc line with `--watch` in one terminal and `node --watch
dist/main.js` in another. Startup logs end with `MultiWA Gateway API running on
http://0.0.0.0:3000`. The whatsapp-web.js engine launches Puppeteer/Chromium and can take
~15s to emit a QR code after a profile connects.

### Running the Admin
```bash
cd apps/admin && pnpm exec next dev --port 3001
```

### Lint / typecheck / test
- **Lint is not wired up**: `apps/api` has no ESLint config, `apps/admin`'s `next lint`
  prompts interactively (avoid it in automation), and `packages/database` lint targets a
  non-existent `src/`. CI's "Lint" job only builds; it does not actually lint.
- **`pnpm typecheck` has pre-existing failures** in `apps/api` (same 28 errors above);
  `apps/admin` typecheck passes.
- **Tests** (Vitest, needs Postgres + Redis running):
  ```bash
  DATABASE_URL=postgresql://multiwa:multiwa123@localhost:5432/multiwa_gateway?schema=public \
  REDIS_URL=redis://localhost:6379 JWT_SECRET=test-jwt-secret \
  JWT_REFRESH_SECRET=test-jwt-refresh-secret \
  ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  pnpm --filter api test -- --run
  ```
- Release gate (no server needed): `pnpm check:release`.
