---
sidebar_position: 2
title: "Development"
---

# 17 - Development Guide

## Setup Development Environment

```bash
# Clone repository
git clone https://github.com/ribato22/multiwa.git
cd multiwa

# Install dependencies
pnpm install

# Setup environment
cp .env.example .env
# The database commands run in packages/database and read DATABASE_URL from the .env there
cp .env packages/database/.env

# Start PostgreSQL and Redis
docker compose up -d postgres redis

# Generate the Prisma client, then sync the database schema (no migrations dir → db push)
pnpm --filter database db:generate
pnpm --filter database db:push

# Start development servers
pnpm dev
```

---

## Project Structure

```
multiwa/
├── apps/
│   ├── api/                # NestJS Backend
│   │   ├── src/
│   │   │   ├── modules/    # Feature modules
│   │   │   ├── common/     # Shared utilities
│   │   │   └── main.ts
│   │   └── Dockerfile
│   └── admin/              # Next.js Dashboard
│       ├── app/
│       ├── components/
│       └── Dockerfile
├── packages/
│   ├── prisma/             # Database schema
│   ├── sdk-python/         # Python SDK
│   └── sdk-php/            # PHP SDK
├── docs/                   # Documentation
└── docker-compose.yml
```

---

## Adding a New Module

1. Create module directory:
```bash
mkdir -p apps/api/src/modules/myfeature
```

2. Create files:
```
myfeature/
├── dto/
│   └── index.ts
├── myfeature.controller.ts
├── myfeature.service.ts
└── myfeature.module.ts
```

3. Register in `app.module.ts`:
```typescript
import { MyFeatureModule } from './modules/myfeature/myfeature.module';

@Module({
  imports: [..., MyFeatureModule],
})
```

---

## Testing

The tests need the Prisma client generated, and the workspace packages the API and the worker use built, as CI does:

```bash
pnpm --filter database exec prisma generate
pnpm --filter "api^..." build
```

`pnpm test` runs the unit tests of every package, through Turbo. Each package has its own checks too:

```bash
# API: the unit tests with the coverage gate CI enforces, and the tenant and role route-coverage checks
pnpm --filter api run test:cov
pnpm --filter api run test:meta

# Worker
pnpm --filter @multiwa/worker run test:cov

# TypeScript SDK
pnpm --filter @multiwa/sdk test
pnpm --filter @multiwa/sdk typecheck
```

The API's integration (e2e) suite boots the real app against PostgreSQL and Redis, and writes to the database: give it a database of its own.

```bash
export DATABASE_URL=postgresql://test:test@localhost:5432/multiwa_test REDIS_URL=redis://localhost:6379
pnpm --filter database exec prisma db push --accept-data-loss
JWT_SECRET=test JWT_REFRESH_SECRET=test ENCRYPTION_KEY=$(openssl rand -hex 32) NODE_ENV=test ENGINE_HOST=worker \
  pnpm --filter api test:e2e
```

The Python and PHP SDKs are tested with their own tools, each from its own directory:

```bash
# packages/sdk-python (Python 3.9 or newer)
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/ruff check . && .venv/bin/mypy multiwa tests && .venv/bin/pytest -q -W error

# packages/sdk-php (PHP 8.1 or newer, Composer)
composer update
vendor/bin/phpstan analyse && vendor/bin/phpunit
```

### Admin end-to-end tests

The admin's tests run its real pages in your installed Google Chrome (Playwright's `chrome` channel, so nothing is downloaded) against a fake backend: REST is answered inside the browser, and realtime comes from a socket.io server the tests start. No API, database or WhatsApp runs.

```bash
pnpm --filter admin typecheck   # the app, and the tests in e2e/
pnpm --filter admin test:e2e    # every test; Playwright starts `next dev` on port 3901, and stops it after
pnpm --filter admin exec playwright test e2e/in-call.spec.ts -g "Mute silences"   # one file, one test
pnpm --filter admin exec playwright test e2e/unit                                 # the unit tests
```

- The fake API listens on `E2E_API_PORT`: 3900 by default on your machine, 3000 in CI, where the admin is built for `http://localhost:3000`. A port already in use fails the tests at once, naming the port: pick another, e.g. `E2E_API_PORT=3910 pnpm --filter admin test:e2e`.
- Pure modules (most of them in `apps/admin/src/lib/`) are tested in `apps/admin/e2e/unit/`, by the same runner, without a browser.
- `DOCS_SCREENSHOTS=1 pnpm --filter admin test:e2e e2e/docs-screenshots.spec.ts` takes the pictures of the [calls guide](<../features/calls.md>) again, into `docs/screenshots/calls/`. Look at each one, then run `pnpm sync:docsite`.

---

## Code Style

- **ESLint** + **Prettier** for formatting
- **Conventional Commits** for commit messages

```bash
# Lint
pnpm lint

# Format
pnpm format
```

---

## Pull Request Checklist

- [ ] Tests pass (`pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Docs updated if needed
- [ ] Conventional commit message

---

## Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev servers |
| `pnpm build` | Build production |
| `pnpm --filter database db:studio` | Open Prisma Studio |
| `pnpm --filter database db:push` | Sync database schema |
| `pnpm test` | Run tests |

The `database` commands read `DATABASE_URL` from `packages/database/.env` (see the setup above), or from the environment.

---

[← Docker Deployment](<deployment-docker.md>) · [Documentation Index](<../intro.md>)
