# 16 - Docker Deployment

Production deployment with Docker and Docker Compose.

---

## Quick Deploy

```bash
# Clone repository
git clone https://github.com/ribato22/multiwa.git
cd multiwa

# Configure environment
cp .env.example .env
# Edit .env with production values

# Start services
docker compose -f docker-compose.prod.yml up -d
```

---

## docker-compose.prod.yml

```yaml
version: '3.8'

services:
  api:
    image: multiwa/api:latest
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/multiwa
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - db
      - redis
    restart: unless-stopped

  admin:
    image: multiwa/admin:latest
    build:
      context: .
      dockerfile: apps/admin/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://api:3001
    depends_on:
      - api
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=multiwa
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `JWT_SECRET` | Secret for JWT tokens | Random 32+ char string |
| `API_KEY_SECRET` | Secret for API keys | Random 32+ char string |
| `OPENAI_API_KEY` | OpenAI API key (for AI features) | `sk-...` |

---

## Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name api.multiwa.io;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name admin.multiwa.io;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

---

## SSL with Traefik

```yaml
# Add to docker-compose.prod.yml
traefik:
  image: traefik:v2.10
  command:
    - --providers.docker=true
    - --entrypoints.web.address=:80
    - --entrypoints.websecure.address=:443
    - --certificatesresolvers.letsencrypt.acme.email=admin@example.com
    - --certificatesresolvers.letsencrypt.acme.storage=/acme.json
    - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
  ports:
    - "80:80"
    - "443:443"
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
    - ./acme.json:/acme.json

api:
  labels:
    - traefik.http.routers.api.rule=Host(`api.multiwa.io`)
    - traefik.http.routers.api.tls.certresolver=letsencrypt
```

---

## Health Checks

```bash
# API Health
curl http://localhost:3001/api/health

# Database
docker compose exec db pg_isready

# Redis
docker compose exec redis redis-cli ping
```

---

## Backup

```bash
# Database backup
docker compose exec db pg_dump -U postgres multiwa > backup.sql

# Restore
docker compose exec -T db psql -U postgres multiwa < backup.sql
```

---

[← n8n Integration](./15-n8n-integration.md) · [Documentation Index](./README.md) · [Development Guide →](./17-development.md)
