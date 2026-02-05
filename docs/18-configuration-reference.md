# Referensi Konfigurasi

Dokumentasi lengkap environment variables untuk MultiWA Gateway.

## Quick Reference

| Variable | Required | Default | Deskripsi |
|----------|----------|---------|-----------|
| `DATABASE_URL` | ✅ | - | PostgreSQL connection string |
| `REDIS_URL` | ✅ | - | Redis connection string |
| `JWT_SECRET` | ✅ | - | Secret key untuk JWT |
| `SESSIONS_PATH` | ❌ | `/data/sessions` | Path penyimpanan session WhatsApp |
| `API_PORT` | ❌ | `3000` | Port API server |
| `NODE_ENV` | ❌ | `development` | Environment mode |

---

## Database

### `DATABASE_URL`
**Required** | String

PostgreSQL connection string dengan format:
```
postgresql://[user]:[password]@[host]:[port]/[database]?sslmode=[mode]
```

**Contoh:**
```env
# Development
DATABASE_URL=postgresql://multiwa:multiwa_password@localhost:5432/multiwa_gateway

# Production (dengan SSL)
DATABASE_URL=postgresql://user:password@db.host.com:5432/multiwa?sslmode=require
```

---

## Redis

### `REDIS_URL`
**Required** | String

Redis connection string untuk queue dan caching.

```env
# Development
REDIS_URL=redis://localhost:6379

# Production (dengan password)
REDIS_URL=redis://:password@redis.host.com:6379
```

---

## Authentication

### `JWT_SECRET`
**Required** | String (min 32 karakter)

Secret key untuk signing JWT tokens. **WAJIB diganti di production!**

```bash
# Generate secure secret
openssl rand -base64 32
```

### `JWT_EXPIRES_IN`
**Optional** | String | Default: `7d`

Durasi validitas JWT token. Format: `Xd` (hari), `Xh` (jam), `Xm` (menit).

```env
JWT_EXPIRES_IN=7d   # 7 hari
JWT_EXPIRES_IN=24h  # 24 jam
```

### `ENCRYPTION_KEY`
**Optional** | String (32 karakter)

Key untuk enkripsi data sensitif (API keys, credentials).

```bash
# Generate 32-character key
openssl rand -hex 16
```

---

## API Server

### `API_PORT`
**Optional** | Number | Default: `3000`

Port untuk NestJS API server.

### `API_HOST`
**Optional** | String | Default: `0.0.0.0`

Host binding untuk API server.

### `CORS_ORIGINS`
**Optional** | String (comma-separated)

Allowed origins untuk CORS. Pisahkan multiple origins dengan koma.

```env
# Development
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# Production
CORS_ORIGINS=https://admin.yourdomain.com,https://app.yourdomain.com
```

---

## WhatsApp Sessions

### `SESSIONS_PATH`
**Optional** | String | Default: `/data/sessions`

Directory untuk menyimpan session data WhatsApp (Baileys auth files).

```env
# Development
SESSIONS_PATH=./sessions

# Production (Docker volume)
SESSIONS_PATH=/data/sessions
```

> ⚠️ **Penting**: Path ini harus persisten (Docker volume) agar session tidak hilang saat container restart.

---

## Rate Limiting

### `RATE_LIMIT_TTL`
**Optional** | Number | Default: `60`

Time window dalam detik untuk rate limiting.

### `RATE_LIMIT_MAX`
**Optional** | Number | Default: `100`

Maksimum request per time window.

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

Jumlah concurrent jobs yang diproses worker.

```env
# Low-resource server
WORKER_CONCURRENCY=5

# High-performance server
WORKER_CONCURRENCY=20
```

---

## Webhook

### `WEBHOOK_TIMEOUT`
**Optional** | Number | Default: `30000`

Timeout dalam milidetik untuk webhook delivery.

### `WEBHOOK_RETRY_ATTEMPTS`
**Optional** | Number | Default: `3`

Jumlah retry attempts jika webhook gagal.

---

## Logging

### `LOG_LEVEL`
**Optional** | String | Default: `info`

Level logging: `debug`, `info`, `warn`, `error`.

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
**Required untuk Admin** | String

URL API backend untuk Admin UI.

```env
# Development
NEXT_PUBLIC_API_URL=http://localhost:3000

# Production
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
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
JWT_EXPIRES_IN=7d
API_PORT=3000
CORS_ORIGINS=https://admin.yourdomain.com
SESSIONS_PATH=/data/sessions
LOG_LEVEL=warn
NODE_ENV=production
RATE_LIMIT_MAX=100
RATE_LIMIT_TTL=60
```

---

## Security Checklist

- [ ] `JWT_SECRET` menggunakan random string 32+ karakter
- [ ] `DATABASE_URL` menggunakan SSL di production
- [ ] `CORS_ORIGINS` hanya whitelist domain yang diperlukan
- [ ] `LOG_LEVEL` set ke `warn` atau `error` di production
- [ ] `SESSIONS_PATH` menggunakan persistent volume
