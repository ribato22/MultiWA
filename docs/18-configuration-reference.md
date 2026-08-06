# Configuration Reference

Complete documentation of environment variables for MultiWA Gateway.

## Quick Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | - | PostgreSQL connection string |
| `REDIS_URL` | ✅ | - | Redis connection string |
| `JWT_SECRET` | ✅ | - | Secret key for JWT access tokens |
| `JWT_REFRESH_SECRET` | ✅ | - | Secret key for JWT refresh tokens |
| `SESSIONS_DIR` | ❌ | `/data/sessions` (Docker) | WhatsApp session storage path (env name in compose is `SESSIONS_DIR`) |
| `API_PORT` | ❌ | `3000` (code) / `3333` (Docker compose) | API server port |
| `API_HOST` | ❌ | `0.0.0.0` | API bind address |
| `NODE_ENV` | ❌ | `development` | Environment mode |
| `CORS_ORIGINS` | ❌ | `http://localhost:3001,http://localhost:3333` (Docker) | Comma-separated allowed origins |
| `NEXT_PUBLIC_API_URL` | ❌ | `http://localhost:3333` (Docker) | URL the browser uses to reach the API. **Build-time** in the admin image. |
| `DEFAULT_ENGINE` | ❌ | `whatsapp-web-js` | WhatsApp engine (`whatsapp-web-js` or `baileys`) |
| `ENGINE_HOST` | ❌ | `api` | Where the engine runs: `api` or `worker` |
| `DURABLE_SEND` | ❌ | `false` | Enqueue outbound sends in Redis (BullMQ) with retry |
| `OUTBOUND_SEND_CONCURRENCY` | ❌ | `10` | Max concurrent durable send deliveries |
| `WEBHOOK_TIMEOUT_MS` | ❌ | `30000` | Webhook delivery timeout |
| `WEBHOOK_ALLOW_PRIVATE_TARGETS` | ❌ | `false` | Allow webhook/AI targets on private networks (SSRF guard) |

---

## Database

### `DATABASE_URL`
**Required** | String

PostgreSQL connection string in the following format:
```
postgresql://[user]:[password]@[host]:[port]/[database]?sslmode=[mode]
```

**Example:**
```env
# Development
DATABASE_URL=postgresql://multiwa:multiwa_password@localhost:5432/multiwa_gateway

# Production (with SSL)
DATABASE_URL=postgresql://user:password@db.host.com:5432/multiwa?sslmode=require
```

---

## Redis

### `REDIS_URL`
**Required** | String

Redis connection string for queue and caching.

```env
# Development
REDIS_URL=redis://localhost:6379

# Production (with password)
REDIS_URL=redis://:password@redis.host.com:6379
```

---

## Authentication

### `JWT_SECRET`
**Required** | String (min 32 characters)

Secret key for signing JWT tokens. **MUST be changed in production!**

```bash
# Generate secure secret
openssl rand -base64 32
```

### `JWT_EXPIRES_IN`
**Optional** | String | Default: `7d`

JWT token validity duration. Format: `Xd` (days), `Xh` (hours), `Xm` (minutes).

```env
JWT_EXPIRES_IN=7d   # 7 days
JWT_EXPIRES_IN=24h  # 24 hours
```

### `ENCRYPTION_KEY`
**Optional** | String (32 characters)

Key for encrypting sensitive data (API keys, credentials).

```bash
# Generate 32-character key
openssl rand -hex 16
```

---

## API Server

### `API_PORT`
**Optional** | Number | Default: `3000` (when running locally with `pnpm --filter api dev`) or `3333` (Docker compose default)

Port for the NestJS API server. The Docker Compose file overrides this to `3333` so the in-container port and the host port mapping line up (`"${API_PORT:-3333}:3333"`). Public docs and examples use `3333` because that is the Docker default.

### `API_HOST`
**Optional** | String | Default: `0.0.0.0`

Host binding for the API server.

### `CORS_ORIGINS`
**Optional** | String (comma-separated)

Allowed origins for CORS. Separate multiple origins with commas.

```env
# Development
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# Production
CORS_ORIGINS=https://admin.yourdomain.com,https://app.yourdomain.com
```

---

## WhatsApp Sessions

### `SESSIONS_DIR`
**Optional** | String | Default: `/data/sessions` (Docker)

Directory for storing WhatsApp session data (whatsapp-web.js auth files and Baileys keystore). The Docker compose file maps this to the `sessions_data` named volume.

```env
# Local development
SESSIONS_DIR=./sessions

# Docker (matches compose default)
SESSIONS_DIR=/data/sessions
```

> ⚠️ **Important**: This path must be persistent (a named Docker volume or a host bind mount) so sessions are not lost when the container restarts. Treat session files like a credential: anyone with the files can impersonate the connected WhatsApp number.

---

## Rate Limiting

### `RATE_LIMIT_TTL`
**Optional** | Number | Default: `60`

Time window in seconds for rate limiting.

### `RATE_LIMIT_MAX`
**Optional** | Number | Default: `100`

Maximum requests per time window.

### Advanced Rate Limiting (Production)

```env
RATE_LIMIT_SHORT=10/1s    # 10 requests per second
RATE_LIMIT_MEDIUM=100/1m  # 100 requests per minute
RATE_LIMIT_LONG=1000/1h   # 1000 requests per hour
```

---

## Worker

### `WORKER_CONCURRENCY`
**Optional** | Number | Default: `10`

Number of concurrent jobs processed by the worker.

```env
# Low-resource server
WORKER_CONCURRENCY=5

# High-performance server
WORKER_CONCURRENCY=20
```

---

## Engine Hosting

Where the WhatsApp engine runs — `api` (default) or `worker`.

### `ENGINE_HOST`
**Optional** | `api` | `worker` | Default: `api`

Selects the process that owns the WhatsApp engine sessions:
- `api` (default) — the engine lives in the API process (current behaviour).
- `worker` — the engine runs in `apps/worker`; the API delegates engine
  operations over BullMQ. The worker must be running and share the API's
  sessions volume.

```env
ENGINE_HOST=api
```

---

## Durable Sending

Outbound sends are synchronous by default. When `DURABLE_SEND=true` they are
enqueued in Redis (BullMQ) and delivered by an in-process consumer with retry —
the API returns `202 { status: "queued" }` immediately and delivery is reported
via `message.status` and `message.sent`/`message.failed` webhooks.

### `DURABLE_SEND`
**Optional** | Boolean | Default: `false`

```env
DURABLE_SEND=true
```

### `OUTBOUND_SEND_CONCURRENCY`
**Optional** | Number | Default: `10`

Maximum concurrent deliveries from the durable send queue.

```env
OUTBOUND_SEND_CONCURRENCY=10
```

---

## Webhook

> Delivery knobs: the retry policy (attempts/backoff) and per-attempt timeout
> are read from these env vars by the worker's webhook dispatcher/processor.

### `WEBHOOK_TIMEOUT_MS`
**Optional** | Number | Default: `30000`

Timeout in milliseconds for webhook delivery.

### `WEBHOOK_RETRY_ATTEMPTS`
**Optional** | Number | Default: `5`

Number of delivery attempts (BullMQ job attempts) if a webhook delivery fails.
Defaults to the historical fixed policy of 5 attempts.

### `WEBHOOK_RETRY_DELAY_MS`
**Optional** | Number | Default: `30000`

Base delay (ms) between retries (exponential backoff). Defaults to the
historical fixed policy of 30s.

### `WEBHOOK_ALLOW_PRIVATE_TARGETS`
**Optional** | Boolean | Default: `false`

SSRF guard for tenant-controlled URLs (webhook targets, custom-AI endpoints).
By default targets that resolve to loopback, private, link-local or reserved
addresses are **blocked** (cloud metadata `169.254.169.254` is always blocked,
even when this is `true`). Self-hosted deployments that deliver to internal
services on the same network (Chatwoot, Typebot, n8n, localhost) set this to
`true` to allow private targets. Leave `false` for public / multi-tenant
deployments.

```env
# Allow webhooks to reach internal services on the same network
WEBHOOK_ALLOW_PRIVATE_TARGETS=true
```

---

## Logging

### `LOG_LEVEL`
**Optional** | String | Default: `info`

Logging level: `debug`, `info`, `warn`, `error`.

```env
# Development (verbose)
LOG_LEVEL=debug

# Production (minimal)
LOG_LEVEL=warn
```

### `NODE_ENV`
**Optional** | String | Default: `development`

Environment mode: `development`, `production`, `test`.

---

## Admin UI (Next.js)

### `NEXT_PUBLIC_API_URL`
**Required for Admin** | String

API backend URL for the Admin UI. **This value is baked into the Next.js client bundle at build time.** Changing it in `.env` alone is not enough — you must rebuild the admin image, for example:

```bash
docker compose build --no-cache admin
docker compose up -d --no-deps --force-recreate admin
```

```env
# Docker default (matches docker-compose.yml)
NEXT_PUBLIC_API_URL=http://localhost:3333

# Production behind a reverse proxy on the same origin
NEXT_PUBLIC_API_URL=https://multiwa.example.com

# Production with a dedicated API subdomain
NEXT_PUBLIC_API_URL=https://api.example.com
```

---

## Optional Services

### Sentry (Error Tracking)

```env
SENTRY_DSN=https://key@sentry.io/project
```

### MinIO (S3-compatible Storage)

```env
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=multiwa-media
MINIO_USE_SSL=false
```

---

## Example Configurations

### Development (.env)

```env
DATABASE_URL=postgresql://multiwa:multiwa_password@localhost:5432/multiwa_gateway
REDIS_URL=redis://localhost:6379
JWT_SECRET=development-secret-key-change-in-production
JWT_EXPIRES_IN=7d
API_PORT=3000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
SESSIONS_PATH=./sessions
LOG_LEVEL=debug
NODE_ENV=development
```

### Production (.env.production)

```env
DATABASE_URL=postgresql://user:password@db.host.com:5432/multiwa?sslmode=require
REDIS_URL=redis://:password@redis.host.com:6379
JWT_SECRET=your-secure-generated-secret-key-here
JWT_REFRESH_SECRET=another-independent-secret-here
ENCRYPTION_KEY=32-hex-chars-from-openssl-rand-hex-32
JWT_EXPIRES_IN=7d
API_PORT=3333
CORS_ORIGINS=https://admin.yourdomain.com
NEXT_PUBLIC_API_URL=https://multiwa.yourdomain.com
SESSIONS_DIR=/data/sessions
LOG_LEVEL=warn
NODE_ENV=production
RATE_LIMIT_MAX=100
RATE_LIMIT_TTL=60
```

---

## Security Checklist

- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` are independent random strings of 32+ characters (generated with `openssl rand -base64 64`).
- [ ] `ENCRYPTION_KEY` is set (`openssl rand -hex 32`) so credential fields are encrypted at rest.
- [ ] `DATABASE_URL` uses SSL in production.
- [ ] `CORS_ORIGINS` only whitelists required domains (no `localhost` in production).
- [ ] `LOG_LEVEL` set to `warn` or `error` in production.
- [ ] `SESSIONS_DIR` uses a persistent volume and is backed up like credentials.
- [ ] `NEXT_PUBLIC_API_URL` matches the public URL the browser will hit, and the admin image was rebuilt after setting it.
- [ ] `NODE_ENV=production` is set.
