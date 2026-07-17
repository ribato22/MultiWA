---
sidebar_position: 3
title: "Quick Start"
---

# 03 - Quick Start

Get MultiWA running in under 5 minutes.

---

## Prerequisites

- Docker & Docker Compose installed
- OR Node.js 20+ and PostgreSQL

---

## Option A: Docker (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/ribato22/multiwa.git
cd multiwa

# 2. Copy environment file
cp .env.example .env

# 3. Start with Docker Compose
docker compose up -d

# 4. Access the services
# Dashboard: http://localhost:3000
# API:       http://localhost:3001/api
# Swagger:   http://localhost:3001/api/docs
```

---

## Option B: Local Development

```bash
# 1. Clone the repository
git clone https://github.com/ribato22/multiwa.git
cd multiwa

# 2. Install dependencies
pnpm install

# 3. Setup environment
cp .env.example .env
# Edit .env with your PostgreSQL connection

# 4. Sync the database schema (no migrations dir → db push)
pnpm prisma db push

# 5. Start development servers
pnpm dev

# Dashboard: http://localhost:3000
# API:       http://localhost:3001/api
```

---

## First Steps

### 1. Create a Profile

```bash
curl -X POST http://localhost:3001/api/profiles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name": "My WhatsApp"}'
```

### 2. Get QR Code

```bash
curl http://localhost:3001/api/profiles/{profileId}/qr \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. Scan QR with WhatsApp

Open WhatsApp on your phone → Linked Devices → Scan the QR code

### 4. Send a Message

```bash
curl -X POST http://localhost:3001/api/messages/text \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "profileId": "your-profile-id",
    "to": "628123456789",
    "text": "Hello from MultiWA!"
  }'
```

---

## Next Steps

- [API Specification](/api/api-specification) - Full API reference
- [Python SDK](/sdks/python-sdk) - Python integration
- [Docker Deployment](/operations/deployment-docker) - Production setup

---

[← Requirements](/getting-started/requirements) · [Documentation Index](/getting-started/project-overview) · [System Architecture →](/architecture/system-architecture)
