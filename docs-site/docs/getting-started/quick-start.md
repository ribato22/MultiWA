---
sidebar_position: 3
title: "Quick Start"
---

# 03 - Quick Start

Get MultiWA running in under 5 minutes.

---

## Prerequisites

- Docker & Docker Compose installed (recommended)
- OR Node.js 20+, pnpm 9+, PostgreSQL 16+, and Redis 7+ for local development

---

## Option A: Docker (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/ribato22/MultiWA.git
cd MultiWA

# 2. Copy the Docker environment template
cp .env.docker .env

# 3. Start the stack
docker compose up -d

# 4. Watch logs until the API is ready (Ctrl+C to detach)
docker compose logs -f api
```

Once the API logs print `MultiWA Gateway API running on http://0.0.0.0:3333`, the stack is ready.

| Service | URL |
|---------|-----|
| Admin Dashboard | http://localhost:3001 |
| API base | http://localhost:3333/api/v1 |
| Swagger UI | http://localhost:3333/api/docs |

> The full stack profile (S3-compatible storage + Nginx) is `docker compose --profile full up -d`.

---

## Option B: Local Development

```bash
# 1. Clone the repository
git clone https://github.com/ribato22/MultiWA.git
cd MultiWA

# 2. Install workspace dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env: at minimum set DATABASE_URL, REDIS_URL, and JWT_SECRET

# 4. Generate the Prisma client and sync the schema (no migrations dir → db push)
pnpm --filter database exec prisma generate
pnpm --filter database exec prisma db push

# 5. Build workspace packages used by the API
pnpm --filter database build
pnpm --filter engines build

# 6. Start the dev servers in two terminals
pnpm --filter api dev     # API on http://localhost:3000  (local dev default)
pnpm --filter admin dev   # Admin on http://localhost:3001
```

> Note: in local-dev mode the API defaults to port `3000`. The Docker stack uses port `3333` because that is what `docker-compose.yml` sets via `API_PORT`. The Swagger UI is always at `<API base host>:<API port>/api/docs`.

---

## First Steps

Replace `http://localhost:3333` with your API base if you are not using the default Docker port. The global API prefix is always `/api/v1`.

### 1. Register an account

```bash
curl -X POST http://localhost:3333/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "ChangeMe1!",
    "name": "Admin"
  }'
```

The response includes an `accessToken`. Use it as `Authorization: Bearer ...` for the next calls.

### 2. Create a Profile

```bash
curl -X POST http://localhost:3333/api/v1/profiles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name": "My WhatsApp"}'
```

### 3. Connect and Fetch the QR

The recommended path is the Admin Dashboard at http://localhost:3001 — it polls the API and renders the QR for you. If you prefer raw API calls, use the account-scoped endpoints:

```bash
# Start the engine for the profile (account-scoped path)
curl -X POST http://localhost:3333/api/v1/accounts/{accountId}/profiles/{profileId}/connect \
  -H "Authorization: Bearer YOUR_TOKEN"

# Retrieve the QR (account-scoped)
curl http://localhost:3333/api/v1/accounts/{accountId}/profiles/{profileId}/qr \
  -H "Authorization: Bearer YOUR_TOKEN"
```

> The QR endpoint is exposed under `/accounts/:accountId/profiles/:profileId/qr` because profiles live inside an account in MultiWA's multi-tenant model. The Admin UI handles the account resolution for you. To list your accounts: `GET /api/v1/accounts`.

Open WhatsApp on your phone → **Linked devices** → **Link a device** → scan the QR.

### 4. Send a Text Message

```bash
curl -X POST http://localhost:3333/api/v1/messages/text \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "profileId": "your-profile-id",
    "to": "628123456789",
    "text": "Hello from MultiWA!"
  }'
```

The Admin Dashboard at http://localhost:3001 also has a guided onboarding for the same flow if you prefer a UI.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `docker compose up -d` exits, no containers | Ports `3001` / `3333` / `5432` / `6379` already in use | Stop the conflicting service or override ports in `.env` (`API_PORT`, `ADMIN_PORT`) |
| Swagger at `/api/docs` returns 404 | API still booting | Wait for the `MultiWA Gateway API running` log line, then retry |
| `401 Unauthorized` | Missing or expired token | Re-run step 1 to get a fresh `accessToken` and re-send with `Authorization: Bearer ...` |
| QR endpoint returns 404 | Profile not started yet | Call `POST /api/v1/profiles/{id}/connect` first |

---

## Next Steps

- [API Specification](<../api/api-specification.md>) — full endpoint reference
- [Webhook Events](<../api/webhook-events.md>) — receive real-time events
- [Python SDK](<../sdks/python-sdk.md>) — integrate from Python
- [Docker Deployment](<../operations/deployment-docker.md>) — production setup

---

[← Requirements](<requirements.md>) · [Documentation Index](<../intro.md>) · [System Architecture →](<../architecture/system-architecture.md>)
