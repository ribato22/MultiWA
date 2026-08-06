---
sidebar_position: 1
title: "Docker Deployment"
---

# 16 - Docker Deployment

Production deployment with Docker and Docker Compose.

The repository ships with a working `docker-compose.yml` at the project root that defines five services — `postgres`, `redis`, `api`, `admin`, and an optional `minio` plus `nginx` for the full stack. Use that file as the source of truth for ports, environment variables, and healthchecks; the snippets in this guide are illustrations only.

---

## Quick Deploy

```bash
# 1. Clone the repository
git clone https://github.com/ribato22/MultiWA.git
cd MultiWA

# 2. Copy the Docker environment template and review it
cp .env.docker .env
# Edit .env: set strong values for JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY,
# DB_PASSWORD, NEXT_PUBLIC_API_URL, and CORS_ORIGINS.

# 3. Start the stack
docker compose up -d

# 4. (Optional) Bring up the full stack with S3 storage and Nginx reverse proxy
docker compose --profile full up -d
```

Default exposed endpoints once the stack is up:

| Service | URL |
|---------|-----|
| Admin Dashboard | http://localhost:3001 |
| API | http://localhost:3333/api/v1 |
| Swagger UI | http://localhost:3333/api/docs |
| PostgreSQL | localhost:5432 (mapped from `postgres:5432`) |
| Redis | localhost:6379 (mapped from `redis:6379`) |

The API container listens on `3333` because `docker-compose.yml` sets `API_PORT=3333`. The Admin container listens on `3001`.

---

## Service Definitions (excerpt from `docker-compose.yml`)

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: api
    container_name: multiwa-api
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://multiwa:${DB_PASSWORD:-multiwa123}@postgres:5432/${DB_NAME:-multiwa}?schema=public
      REDIS_URL: redis://redis:6379
      API_PORT: 3333
      API_HOST: 0.0.0.0
      JWT_SECRET: ${JWT_SECRET:-change-this-to-a-random-secret}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET:-change-this-refresh-secret}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY:-}
      CORS_ORIGINS: ${CORS_ORIGINS:-http://localhost:3001,http://localhost:3333}
      WHATSAPP_ENGINE: ${DEFAULT_ENGINE:-whatsapp-web-js}
      SESSIONS_DIR: /data/sessions
    ports:
      - "${API_PORT:-3333}:3333"
    volumes:
      - sessions_data:/data/sessions
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3333/api/docs"]

  admin:
    build:
      context: .
      dockerfile: Dockerfile
      target: admin
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:3333}
    container_name: multiwa-admin
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:3333}
    ports:
      - "${ADMIN_PORT:-3001}:3001"

  postgres:
    image: postgres:16-alpine
    container_name: multiwa-postgres

  redis:
    image: redis:7-alpine
    container_name: multiwa-redis
```

> `NEXT_PUBLIC_API_URL` is **baked into the admin client bundle at build time**. If you change its value, you must rebuild the admin image: `docker compose build --no-cache admin && docker compose up -d --no-deps --force-recreate admin`.

---

## Required Environment Variables

| Variable | Description | Notes |
|----------|-------------|-------|
| `DB_PASSWORD` | PostgreSQL password | Set a strong value before first `up -d`; it becomes the password baked into the volume. |
| `JWT_SECRET` | Secret for JWT access tokens | `openssl rand -base64 64` |
| `JWT_REFRESH_SECRET` | Secret for JWT refresh tokens | Independent of `JWT_SECRET` |
| `ENCRYPTION_KEY` | Encrypts sensitive fields at rest | `openssl rand -hex 32` |
| `NEXT_PUBLIC_API_URL` | Public URL the browser uses to reach the API | Must match the origin users hit (e.g., `https://api.example.com`); build-time |
| `CORS_ORIGINS` | Comma-separated allowed origins | Include the admin origin (e.g., `https://admin.example.com`) |
| `DEFAULT_ENGINE` | `whatsapp-web-js` or `baileys` | Defaults to `whatsapp-web-js` |

Optional S3-compatible media storage (MinIO or external):

| Variable | Description |
|----------|-------------|
| `S3_ENDPOINT` | e.g., `http://minio:9000` or `https://s3.amazonaws.com` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Storage credentials |
| `S3_BUCKET` | Defaults to `multiwa-media` |

The full reference is in [18-configuration-reference.md](<configuration-reference.md>).

---

## Reverse Proxy (Nginx)

Single public origin serving the Admin UI, with API calls reverse-proxied under `/api`:

```nginx
server {
    listen 443 ssl http2;
    server_name multiwa.example.com;

    ssl_certificate     /etc/letsencrypt/live/multiwa.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/multiwa.example.com/privkey.pem;

    # Admin (Next.js)
    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # API + Swagger
    location /api/ {
        proxy_pass         http://127.0.0.1:3333;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Socket.IO (WebSocket upgrade)
    location /socket.io/ {
        proxy_pass         http://127.0.0.1:3333;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
    }
}
```

If you put the Admin on a different subdomain than the API (e.g., `admin.example.com` and `api.example.com`), update `NEXT_PUBLIC_API_URL` and `CORS_ORIGINS` accordingly, then **rebuild the admin image** so the new API URL is baked into the client bundle.

---

## Health Checks

```bash
# API (matches the compose healthcheck)
curl -fsSI http://localhost:3333/api/docs

# PostgreSQL
docker exec multiwa-postgres pg_isready -U multiwa

# Redis
docker exec multiwa-redis redis-cli ping
# Expected: PONG

# Admin
curl -fsSI http://localhost:3001/

# Worker logs (last 40 lines)
docker logs --tail 40 multiwa-worker
```

The compose file ships container-level healthchecks for the API (`/api/docs`), PostgreSQL (`pg_isready`), and Redis. `docker ps` shows `(healthy)` once they pass.

---

## Backup and Restore

```bash
# Dump the database from inside the container
docker exec -t multiwa-postgres pg_dump -U multiwa multiwa > multiwa-backup-$(date -u +%Y%m%d).sql

# Restore (assumes an empty target database)
cat multiwa-backup-YYYYMMDD.sql | docker exec -i multiwa-postgres psql -U multiwa -d multiwa
```

WhatsApp session files live in the `sessions_data` named volume and should be backed up alongside the database. They contain device authentication material and must be protected like a secret.

---

## Production Checklist

Before exposing the deployment to real users, confirm:

- [ ] Strong, unique values for `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, and `DB_PASSWORD` (no defaults from `.env.docker`).
- [ ] `NODE_ENV=production` is set in the API container.
- [ ] `CORS_ORIGINS` only lists the real public origins; localhost removed.
- [ ] `NEXT_PUBLIC_API_URL` matches the URL the browser will use, and the admin image has been rebuilt after any change.
- [ ] TLS is terminated in front of the stack (Nginx, Traefik, Caddy, or a managed load balancer).
- [ ] Database and Redis are not exposed to the public internet.
- [ ] Daily database backups are scheduled and tested (restore at least once).
- [ ] `sessions_data` volume is backed up and access-controlled.
- [ ] Webhook delivery uses HTTPS endpoints and HMAC secrets where applicable.
- [ ] Logs and metrics are shipped somewhere persistent (Loki, ELK, CloudWatch, etc.).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Bind for 0.0.0.0:3333 failed: port is already allocated` | Another process or container holds the port | Stop the conflicting process, or override `API_PORT` / `ADMIN_PORT` in `.env`. |
| `multiwa-api` keeps restarting | `JWT_SECRET` missing or DB URL wrong | `docker logs multiwa-api` and fix the env, then `docker compose up -d`. |
| Admin loads but every API call is `Network Error` | `NEXT_PUBLIC_API_URL` mismatched, or CORS blocking | Verify `NEXT_PUBLIC_API_URL` in `.env`, rebuild admin (`docker compose build --no-cache admin`), and confirm the value appears in `CORS_ORIGINS`. |
| Admin shows `localhost:3333` from a browser on another machine | Build-time `NEXT_PUBLIC_API_URL` was left as the default | Set `NEXT_PUBLIC_API_URL` to a reachable URL, then rebuild the admin image. |
| WhatsApp keeps asking for the QR code on every restart | `sessions_data` volume not persistent or wrong mount | Confirm the volume is declared (`docker volume inspect multiwa_sessions_data`) and not pruned. |
| `pg_isready` fails | Postgres container unhealthy or wrong credentials | Check `docker logs multiwa-postgres`; common causes are `DB_PASSWORD` changed after the volume was initialized. |
| `redis-cli ping` returns no PONG | Redis not started or different password | `docker logs multiwa-redis`; if you set a Redis password ensure `REDIS_URL` uses it. |
| `curl http://localhost:3333/api/docs` returns 404 | Wrong port, or the API is still booting | Wait for `MultiWA Gateway API running` in the API logs; verify port mapping with `docker port multiwa-api`. |

You can also use these as a quick sanity probe:

```bash
docker exec multiwa-api sh -c 'echo NODE_ENV=$NODE_ENV'   # expect: production
docker exec multiwa-api sh -c 'echo PORT=$API_PORT'       # expect: 3333
```

---

[← n8n Integration](<../sdks/n8n-integration.md>) · [Documentation Index](<../intro.md>) · [Development Guide →](<development.md>)
