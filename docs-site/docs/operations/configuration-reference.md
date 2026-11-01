---
sidebar_position: 3
title: "Configuration Reference"
---

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
| `TRUST_PROXY` | ❌ | - (`172.16.0.0/12` in `docker-compose.production.yml`) | Address of the reverse proxy in front of the API, so rate limits and logins see the client's address |
| `NEXT_PUBLIC_API_URL` | ❌ | `http://localhost:3333` (Docker) | URL the browser uses to reach the API. **Build-time** in the admin image. |
| `DEFAULT_ENGINE` | ❌ | `whatsapp-web-js` | WhatsApp engine (`whatsapp-web-js` or `baileys`) |
| `ENGINE_HOST` | ❌ | `api` | Where the engine runs: `api` or `worker` |
| `DURABLE_SEND` | ❌ | `false` | Enqueue outbound sends in Redis (BullMQ) with retry |
| `OUTBOUND_SEND_CONCURRENCY` | ❌ | `10` | Max concurrent durable send deliveries |
| `WEBHOOK_TIMEOUT_MS` | ❌ | `30000` | Webhook delivery timeout |
| `WEBHOOK_ALLOW_PRIVATE_TARGETS` | ❌ | `false` | Allow webhook/AI targets on private networks (SSRF guard) |
| `QUIET_ALARM_ACTIVE_HOURS` | ❌ | `07:00-22:00` | Daily window in which a connected profile's silence counts toward its quiet-profile alarm |
| `QUIET_ALARM_TIMEZONE` | ❌ | `Asia/Jakarta` | Time zone of that window |
| `CALL_RING_TIMEOUT_MS` | ❌ | `90000` | A call still ringing after this long is closed as `unknown` |
| `CALL_LOG_GRACE_MS` | ❌ | `60000` | How long a call that stopped ringing as `unknown` waits for WhatsApp's call log before the team is told about an unanswered call |
| `CALLS_MEDIA_ENABLED` | ❌ | `false` | Answering calls in the dashboard: the media server's switch |
| `CALLS_MEDIA_ANNOUNCED_ADDRESS` | with `CALLS_MEDIA_ENABLED` | - | The address agents' browsers reach the media port on |
| `CALLS_MAX_TALK_MINUTES` | ❌ | `120` | A call answered in the dashboard is hung up after this long |
| `CALL_RECORDINGS_STORAGE` | ❌ | `STORAGE_TYPE`, else `local` | Where call recordings go: `local` or `s3` |
| `CALL_RECORDINGS_PATH` | for local recordings | - (Docker: `/data/call-recordings`) | The directory of local call recordings |
| `CALL_RECORDINGS_TMP` | for recording | - (Docker: `/data/call-recordings-tmp`) | The directory of recordings in progress |

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

### `TRUST_PROXY`
**Optional** | String (comma-separated IP addresses or CIDRs) | Default: unset (`172.16.0.0/12` in `docker-compose.production.yml`)

The address of the reverse proxy in front of the API. Without it, behind nginx every request comes from nginx's address: every client shares one rate limit, and logins record nginx's address. With it, the API takes the client address that proxy appended to `X-Forwarded-For`.

Only the hop that connects to the API is trusted, and only from a listed address, so a client cannot choose its address by sending its own `X-Forwarded-For`. Keep client networks out of the list: a client that connects to the API port directly from a listed address is taken for the proxy. A value that is not an address list, such as `1` or `true`, stops the API at boot.

```env
# nginx on a Docker network of the stock compose files
TRUST_PROXY=172.16.0.0/12
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

The API allows **120 requests per minute per route and client address** (the global
`ThrottlerGuard`; some routes, such as `POST /auth/register`, allow fewer). The limit
is not set by an environment variable. Behind a reverse proxy, set
[`TRUST_PROXY`](#trust_proxy) so the client address is the caller's, not the proxy's.

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

The API and the worker must see the same value. The stock Compose files with a
worker give both services the one in `.env`.

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

## Quiet-Profile Alarm

A profile can stay `connected` while WhatsApp has stopped delivering messages to
it, and nothing reports a disconnect. The quiet-profile alarm catches this: when
a connected profile receives no incoming message for a set number of hours, it
raises **one** alarm (an admin bell notification, plus a WhatsApp message to your
ops numbers through another connected profile of the same organization) and
**one** notice when messages resume. Profiles are checked every 5 minutes. A
disconnected profile never raises the alarm: the disconnect alert covers that.

The alarm is set per profile, on the profile page or with
`PUT /api/v1/profiles/:id`:

- `quietAlarmHours` — whole hours, 1 to 72, of silence before the alarm. `null`
  (or blank on the profile page) turns it off, which is the default.
- `quietAlarmNotify` — up to 5 WhatsApp numbers that get the message. The
  profile's own number is skipped, and `@broadcast` and `@newsletter` addresses
  are refused.

Set it on profiles that normally receive messages throughout the active hours: a
profile that is quiet for long stretches will raise and recover regularly.

Silence is counted only inside a daily active window, so a quiet night does not
raise an alarm. Two variables set that window. The stock compose files do not
forward them: add them under `environment:` of the API service to override the
defaults.

### `QUIET_ALARM_ACTIVE_HOURS`
**Optional** | `HH:MM-HH:MM` | Default: `07:00-22:00`

Daily window in which a connected profile's silence counts, in the time zone
below. The start is included, the end is not, the window cannot cross midnight
and it must last at least an hour. An invalid value falls back to the default.

### `QUIET_ALARM_TIMEZONE`
**Optional** | IANA time zone | Default: `Asia/Jakarta`

Time zone of that window, also used for the times written in the alarm message.
An unknown zone falls back to the default.

```env
# Count silence from 08:00 to 20:00 Jakarta time
QUIET_ALARM_ACTIVE_HOURS=08:00-20:00
QUIET_ALARM_TIMEZONE=Asia/Jakarta
```

---

## Calls

Timers for incoming WhatsApp calls. They are read by the process that hosts the engine: the API by default, the worker with `ENGINE_HOST=worker`. The stock Compose files do not pass them through, so add them to the `environment:` of that service. A value that is not a positive number falls back to the default.

### `CALL_RING_TIMEOUT_MS`
**Optional** | Number (milliseconds) | Default: `90000`

How long a call may stay `ringing` before MultiWA gives up on it and closes it as `unknown`, and tells your team about an unanswered call. It is the safety net for a call whose end the engine never reported. WhatsApp's call log can still settle the call afterwards (a `call.updated` webhook).

### `CALL_LOG_GRACE_MS`
**Optional** | Number (milliseconds) | Default: `60000`

A call that stopped ringing as `unknown` usually gets its real outcome (missed, rejected, answered on another device) from WhatsApp's call-log message within moments. If none has arrived after this long, MultiWA tells your team about an unanswered call. The call stays `unknown` until a call log settles it.

```env
CALL_RING_TIMEOUT_MS=90000
CALL_LOG_GRACE_MS=60000
```

The timers live in memory. When the engine host starts, every call still `ringing` is closed as `unknown` at once, whatever its age, and no `call.ended` webhook is sent for it. It stays `unknown`, since an engine passes on only the call log of a call it saw ringing since it last connected.

---

## Calls answered in the dashboard

Agents can answer a profile's incoming calls in the dashboard (`PUT /profiles/:id/calls-settings`) through a media server in the API. It runs only where the API hosts the engines (`ENGINE_HOST=api`). The stock Compose files pass these settings to the API, except the last two (add those to the `environment:` of the API service); publish the media port by adding `docker-compose.calls-media.yml`.

### `CALLS_MEDIA_ENABLED`
**Optional** | `true` / `false` | Default: `false`

The server switch. Off, the media server never starts and no profile can turn dashboard answering on. Changing it needs an API restart.

### `CALLS_MEDIA_PORT`
**Optional** | Port | Default: `40000`

The one UDP+TCP port of all call audio. Agents' PCs must reach it (UDP preferred, TCP as the fallback).

### `CALLS_MEDIA_ANNOUNCED_ADDRESS`
**Required when `CALLS_MEDIA_ENABLED=true`** | IP address or host name

The address agents' browsers reach the media port on, e.g. the server's LAN address. The API does not start without it.

### `CALLS_MEDIA_LISTEN_IP`
**Optional** | IPv4 address | Default: the first external interface

The local address the media server listens on. Set it when the host has several interfaces or the API uses host networking.

### `CALLS_MEDIA_ICE_SERVERS`
**Optional** | JSON

ICE servers for agents' browsers, e.g. a TURN server for agents outside the LAN: `[{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]`.

### `CALLS_MAX_TALK_MINUTES`
**Optional** | Number (minutes) | Default: `120`

A call answered in the dashboard is hung up after this long (`endReason: time_limit`).

### `CALLS_CONNECT_TIMEOUT_MS`
**Optional** | Number (milliseconds) | Default: `10000`

From an agent's Answer to its audio connected. Past it the answer is undone and the call rings again for every agent, unless WhatsApp was already answering it: it is hung up then.

### `CALLS_AGENT_GRACE_MS`
**Optional** | Number (milliseconds) | Default: `15000`

An agent whose browser has no connection to the API, or whose audio link is down, for this long is hung up (`endReason: agent_lost`). A reloaded agent page rejoins its call within it. The WhatsApp Web page's own audio link down for as long ends the call too (`endReason: media_failed`).

```env
CALLS_MEDIA_ENABLED=true
CALLS_MEDIA_ANNOUNCED_ADDRESS=192.0.2.10
CALLS_MAX_TALK_MINUTES=120
```

---

## Call recordings

Calls answered in the dashboard can be recorded (`PUT /profiles/:id/calls-settings` with `recording: true`), always with an announcement the caller hears first (`POST /profiles/:id/calls-announcement`). Recordings and announcements are private:

- nothing serves them without the login of an owner or admin of their organization;
- every play and download is audited;
- recording cannot be turned on unless the storage refuses reads without credentials. The API checks this then, and again every night at 02:30 server time (`TZ`). When a check finds the storage public (the nightly one, or the one run to turn recording on), recording is turned off on every profile, and every organization with recording on or recordings stored is alerted: its owners and admins get a bell notification, and the [quiet-profile alarm](#quiet-profile-alarm) numbers of its profiles (`quietAlarmNotify`) a WhatsApp message. A nightly check that proves nothing alerts the organizations whose profiles record the same way, and leaves recording on.

A recorded call is recorded in stereo, from before the announcement: left the caller, right what the caller heard (the announcement, then the agent). The agent is connected once the announcement has played. When the recorder does not start, or the announcement does not play, the call goes on unrecorded with the agent connected, and the owners and admins are told the same way (each at most once an hour per profile).

When recording is on for a profile but this server's recordings storage, or `CALL_RECORDINGS_TMP`, is not set up, its calls are not recorded, and every night its organization's owners and admins are reminded.

A recording is written to `CALL_RECORDINGS_TMP` while its call lasts, and stored when the call ends, with four tries over about 40 seconds. When they all fail, it stays on the server, the owners and admins are told, and it is tried again at the next start and every night. It is never stored to a storage last found public, and it is deleted unstored once older than its profile's retention period. A recording cut short by a restart is stored at the next start, marked `partial`.

The same nightly job deletes the recordings older than each profile's retention period (`retentionDays`, 90 by default). It also deletes the files nothing points at any more (for one, those of a deleted workspace or organization; a deleted profile's files are deleted with it). The stock Compose files pass all six settings below to the API.

> ⚠️ **One recordings location per MultiWA database**: never point two installations, or a restored copy, at the same bucket and prefix or the same directory — each night each would delete the other's files.

### `CALL_RECORDINGS_STORAGE`
**Optional** | `local` / `s3` | Default: `STORAGE_TYPE`, else `local`

Where recordings go. Media can stay local while recordings go to a bucket, or the other way round. Changing it leaves the recordings already stored behind: this server can neither play nor delete them until it uses that storage again (retention skips them, and the log says how many).

### `CALL_RECORDINGS_PATH`
**Required for local recordings** | Path | Docker Compose: `/data/call-recordings` (volume `call_recordings`)

A directory of their own, on a persistent volume.

- It must not be inside or around `STORAGE_PATH` (served without a login) or `SESSIONS_DIR` (its backups would carry every recording), nor around the API's working directory (the nightly sweep would walk the whole application).
- It must belong to the API's user alone. It is made 0700; one of another user, a shared (sticky) directory such as `/tmp`, or a symlink is refused. The API image runs as root, so a named Docker volume is made 0700; a bind mount must belong to the container's user.
- Unset or refused, recording cannot be turned on. `GET /calls/media/status` says why, in `server.recordings.problem`.

### `CALL_RECORDINGS_BUCKET`
**Optional** | Bucket name | Default: `S3_BUCKET`

- S3 recordings need `S3_ENDPOINT`, `S3_ACCESS_KEY` and `S3_SECRET_KEY`, and use `S3_REGION` (default `us-east-1`).
- A private bucket of their own is strongly advised. Objects are written without an ACL, so they are as private as the bucket.
- The check fetches a probe without credentials at `S3_ENDPOINT`, and at `S3_PUBLIC_URL` when it is set (a loopback `S3_PUBLIC_URL`, such as the dev compose's `http://localhost:9000`, is the same server and is not fetched twice). A refusal (`400`, `401`, `403` or `404`) or a page that is not the probe (a login page) passes, the probe's own bytes are `storage_not_private`, and any other answer, or none within 5 seconds, is `storage_check_failed`.
- The check sees only those addresses. Turn off every other public way to the recordings bucket: a public bucket URL (Cloudflare R2's `r2.dev`, a custom domain) or a CDN that reads the bucket on its own credentials.
- Keep versioning off on the recordings bucket, or expire noncurrent versions with a lifecycle rule: with versioning on, a deleted recording stays as a noncurrent version.
- Compatible stores: AWS S3, MinIO, Wasabi, Backblaze B2, Cloudflare R2, DigitalOcean Spaces, and Google Cloud Storage (XML API).

### `CALL_RECORDINGS_PREFIX`
**Optional** | Key prefix | Default: `call-recordings/`

Letters, digits, `.`, `_`, `-` and `/` only, without a `.` or `..` segment; another value leaves recording unavailable (`server.recordings.problem` says why).

Changing it, the bucket or `CALL_RECORDINGS_PATH` leaves the recordings already stored behind: each recording remembers its location (`s3:<bucket>/<prefix>` or `local:<path>`), and this server neither plays nor deletes one stored elsewhere (retention skips them, and the log says how many). To move them, copy the objects to the new location first, then point their rows at it: `UPDATE call_recordings SET "storageLocation" = '<new>' WHERE "storageLocation" = '<old>';`. Another provider with the same bucket and prefix keeps the same location (the endpoint is not part of it): copy the objects before switching, or deletes and retention would mark rows deleted while their files stay at the old provider.

### `CALL_RECORDINGS_SSE`
**Optional** | `AES256` / `aws:kms`

Server-side encryption of every object, for stores that support it. Another value leaves recording unavailable.

```env
CALL_RECORDINGS_STORAGE=s3
CALL_RECORDINGS_BUCKET=multiwa-call-recordings
CALL_RECORDINGS_SSE=AES256
```

### `CALL_RECORDINGS_TMP`
**Required for recording** | Path | Docker Compose: `/data/call-recordings-tmp` (volume `call_recordings_tmp`)

Where a recording is written while its call lasts, whatever `CALL_RECORDINGS_STORAGE` is. It holds about 0.5 MB a minute per recorded call, and as much again for a moment while that call's recording is stored.

- On a persistent volume, a recording cut short by a restart is stored at the next start (`partial`). Elsewhere, it is lost with the container.
- The same rules as `CALL_RECORDINGS_PATH` apply: not inside or around `STORAGE_PATH`, `SESSIONS_DIR` or `CALL_RECORDINGS_PATH`, nor around the API's working directory.
- It must belong to the API's user alone. It is made 0700; one of another user, a shared (sticky) directory such as `/tmp`, or a symlink is refused. The API image runs as root, so a named Docker volume is made 0700; a bind mount must belong to the container's user.
- Unset or refused, recording cannot be turned on, and `GET /calls/media/status` says why, in `server.recordings.problem`. Recordings already stored stay playable, deletable and under retention.
- One per API process: two processes sharing one would take each other's recordings in progress for leftovers. (The engines run in one API process; that is the supported setup.)

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
