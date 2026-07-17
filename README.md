<p align="center">
  <img src="apps/admin/public/logo.png" alt="MultiWA Logo" width="80" />
</p>

<h1 align="center">MultiWA</h1>

<p align="center">
  <strong>Open Source WhatsApp Business API Gateway</strong><br />
  Multi-engine • Self-hosted • Enterprise-ready
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.0.0-green.svg" alt="Version" /></a>
  <a href="https://ribato22.github.io/MultiWA/"><img src="https://img.shields.io/badge/🌐_Website-Live-brightgreen.svg" alt="Website" /></a>
  <a href="docker-compose.yml"><img src="https://img.shields.io/badge/docker-one--click-2496ED.svg" alt="Docker" /></a>
  <a href="https://hub.docker.com/r/ribato/multiwa-api"><img src="https://img.shields.io/docker/pulls/ribato/multiwa-api.svg" alt="Docker Pulls" /></a>
  <a href="https://github.com/ribato22/MultiWA/actions/workflows/ci.yml"><img src="https://github.com/ribato22/MultiWA/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/ribato22/MultiWA/actions/workflows/release-gate.yml"><img src="https://github.com/ribato22/MultiWA/actions/workflows/release-gate.yml/badge.svg" alt="Release Gate" /></a>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
  <a href="https://buymeacoffee.com/ribato"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕-orange.svg" alt="Buy Me a Coffee" /></a>
  <a href="https://github.com/sponsors/ribato22"><img src="https://img.shields.io/badge/Sponsor-❤️-ea4aaa.svg" alt="GitHub Sponsors" /></a>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#-screenshots">Screenshots</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-api-documentation">API Docs</a> •
  <a href="#-sdks">SDKs</a> •
  <a href="#-production-deployment">Deployment</a> •
  <a href="#-release-checks">Release Checks</a> •
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## 🎯 What is MultiWA?

**MultiWA** is a fully self-hosted, open-source WhatsApp API gateway that lets you connect multiple WhatsApp numbers through a single unified REST + WebSocket API. It runs as a `docker compose up` stack on your own server, ships an admin dashboard for QR onboarding and live chat, and exposes official SDKs for TypeScript, Python, and PHP.

If you want to send and receive WhatsApp messages from your own backend without per-message pricing, vendor lock-in, or sending customer data through a third party, MultiWA is built for you.

### ✨ Why MultiWA?

| Feature | MultiWA | WhatsApp Cloud API | Evolution API |
|---------|---------|-------------------|---------------|
| **Self-hosted** | ✅ Full control | ❌ Meta-hosted | ✅ |
| **Multi-engine** | ✅ whatsapp-web.js (Baileys adapter experimental) | ❌ Single | ❌ Fixed |
| **Admin Dashboard** | ✅ Full-featured | ❌ None | ⚠️ Basic |
| **Visual Automation** | ✅ Drag & drop builder | ❌ | ❌ |
| **Knowledge Base AI** | ✅ OpenAI / Google AI | ❌ | ❌ |
| **Plugin System** | ✅ Extensible | ❌ | ❌ |
| **Free** | ✅ MIT License | ⚠️ Per-message pricing | ✅ |
| **Official SDKs** | ✅ TS, Python, PHP | ✅ Multiple | ⚠️ Community |

<p align="center">
  <br />
  ⭐ <strong>If you find MultiWA useful, please consider giving it a star!</strong><br />
  It helps us grow and motivates continued development.
  <br /><br />
  <a href="https://github.com/ribato22/MultiWA"><img src="https://img.shields.io/github/stars/ribato22/MultiWA?style=social" alt="GitHub Stars" /></a>
</p>

---

## 🚀 Quick Start

### Option 1: Docker — One Command Setup ⚡

```bash
git clone https://github.com/ribato22/MultiWA.git
cd MultiWA
cp .env.docker .env
docker compose up -d
```

That's it! Access:
- 🖥️ **Admin Dashboard**: http://localhost:3001
- 📖 **API Swagger Docs**: http://localhost:3333/api/docs
- 🔌 **API Endpoint**: http://localhost:3333/api/v1

> **Full stack** (with S3 storage + Nginx proxy): `docker compose --profile full up -d`

### Option 2: Local Development

**Prerequisites:** Node.js ≥ 20 · PostgreSQL ≥ 16 · Redis ≥ 7 · pnpm ≥ 9

```bash
git clone https://github.com/ribato22/MultiWA.git
cd MultiWA
pnpm install

cp .env.example .env

# Setup database (no migrations dir — db push syncs the schema)
pnpm --filter database exec prisma generate
pnpm --filter database exec prisma db push

# Build workspace packages
pnpm --filter database build
pnpm --filter engines build

# Start development
pnpm --filter api dev     # API on http://localhost:3000
pnpm --filter admin dev   # Admin on http://localhost:3001
```

---

## ⚡ Features

### Core
- 📱 **Multi-Session Management** — Connect unlimited WhatsApp accounts
- 🔌 **Pluggable Engine Adapters** — Clean engine interface with per-profile engine selection: whatsapp-web.js (default, production) or a Baileys adapter (experimental)
- 📨 **Unified Messaging API** — Send text, media, documents, contacts, locations
- 📡 **Real-time WebSocket** — Live session status, QR codes, and events via Socket.IO
- 🔐 **JWT Authentication** — Secure API access with refresh tokens

### Admin Dashboard
- 🖥️ **Modern UI** — Next.js 14 with dark mode, responsive design
- 💬 **Live Chat** — Real-time chat interface with message history
- 📊 **Analytics** — Message volume, delivery rates, session metrics
- 🔍 **Audit Trail** — Complete logging of all operations

### Automation & AI
- 🤖 **Visual Flow Builder** — Drag & drop automation design
- 🧠 **Knowledge Base** — AI-powered replies using OpenAI or Google AI
- 📅 **Scheduled Messages** — Queue messages for future delivery
- 📢 **Broadcast** — Bulk messaging with templates and tracking

### Integrations
- 🔗 **Webhooks** — Real-time event notifications to your services
- 🔑 **API Keys** — Multiple keys with scoping and expiration
- 📦 **SDKs** — TypeScript, Python, PHP
- 🔔 **Push Notifications** — Browser push via Web Push API
- 📧 **SMTP Email** — Email alerts for critical events

### Enterprise
- 🛡️ **Security** — Helmet, CSP, rate limiting, encryption at rest
- 🐳 **Docker** — Production-ready containers with health checks
- ⚙️ **Background Worker** — BullMQ worker scaffolding (a durable async send queue is on the roadmap; today message sending and scheduling run in the API process)
- 🔒 **GDPR** — Data export and deletion endpoints
- 🔌 **Plugin System** — Extend with custom plugins

---

## 📸 Screenshots

<p align="center">
  <img src="docs/screenshots/contacts.png" alt="Contacts" width="48%" />
  <img src="docs/screenshots/automation.png" alt="Automation" width="48%" />
</p>
<p align="center">
  <img src="docs/screenshots/profiles.png" alt="Profiles" width="48%" />
  <img src="docs/screenshots/settings.png" alt="Settings" width="48%" />
</p>

<p align="center">
  <a href="docs/screenshots/">View all screenshots →</a>
</p>

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Nginx (SSL / Proxy)                   │
├──────────────────────┬───────────────────────────────────┤
│  Admin (Next.js)     │  API (NestJS / Fastify)           │
│  Port 3001           │  Port 3333 (Docker)               │
│                      │  Port 3000 (local dev)            │
│                      │  ├─ /api/v1  REST + Swagger UI    │
│                      │  └─ /socket.io  realtime events   │
│                      ├───────────────────────────────────┤
│                      │  WhatsApp Engine Adapters         │
│                      │  ├─ whatsapp-web.js               │
│                      │  └─ Baileys                       │
├──────────────────────┴───────────────────────────────────┤
│  Worker (BullMQ)  │  PostgreSQL 16  │  Redis 7           │
└──────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **API** | NestJS 10 + Fastify |
| **Admin** | Next.js 14 + Tailwind CSS |
| **Database** | PostgreSQL 16 + Prisma ORM |
| **Cache/Queue** | Redis 7 + BullMQ |
| **WhatsApp** | whatsapp-web.js / Baileys |
| **Auth** | JWT (access + refresh tokens) |
| **Realtime** | Socket.IO |
| **Container** | Docker + Docker Compose |
| **CI/CD** | GitHub Actions |

---

## 📖 API Documentation

Full interactive API documentation is available at `/api/docs` (Swagger UI).

### Example: Send a Text Message

```bash
curl -X POST http://localhost:3333/api/v1/messages/text \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profileId": "profile-uuid",
    "to": "6281234567890",
    "text": "Hello from MultiWA! 👋"
  }'
```

### Example: Connect a WhatsApp Session

```bash
curl -X POST http://localhost:3333/api/v1/accounts/YOUR_ACCOUNT_ID/profiles/YOUR_PROFILE_ID/connect \
  -H "Authorization: Bearer YOUR_TOKEN"
```

> 📚 See the [full documentation site](https://ribato22.github.io/MultiWA/docs/) for detailed guides, API reference, webhook events, and more. Source docs are in the [`docs/`](docs/) directory.

---

## 📦 SDKs

Official SDKs are included in the repository today. Registry publishing
(NPM, PyPI, Packagist) is tracked as a release follow-up — until those
registries are verified, install from this repo or via the local
workspace path.

| Language | Source | Status |
|----------|--------|--------|
| TypeScript/Node.js | [`packages/sdk`](packages/sdk) | Included in repository · registry publishing pending |
| Python | [`packages/sdk-python`](packages/sdk-python) | Included in repository · registry publishing pending |
| PHP | [`packages/sdk-php`](packages/sdk-php) | Included in repository · registry publishing pending |

### TypeScript SDK Example

```typescript
import { MultiWAClient } from '@multiwa/sdk';

const client = new MultiWAClient({
  // Docker default: 'http://localhost:3333/api/v1'
  // Local dev default if you omit baseUrl: 'http://localhost:3000/api/v1'
  baseUrl: 'http://localhost:3333/api/v1',
  apiKey: 'your-api-key',
});

// Send a text message
await client.messages.sendText({
  profileId: 'profile-uuid',
  to: '6281234567890',
  text: 'Hello! 👋',
});
```

---

## 🗂️ Project Structure

```
MultiWA/
├── apps/
│   ├── api/             # NestJS backend API
│   ├── admin/           # Next.js admin dashboard
│   └── worker/          # BullMQ background worker
├── packages/
│   ├── core/            # Shared types and utilities
│   ├── database/        # Prisma schema and migrations
│   ├── engines/         # WhatsApp engine adapters
│   ├── sdk/             # TypeScript SDK (`@multiwa/sdk`)
│   ├── sdk-python/      # Python SDK (`multiwa`)
│   └── sdk-php/         # PHP SDK (`multiwa/multiwa-php`)
├── plugins/             # Plugin directory
├── docker/              # Dockerfiles (api, admin, worker)
├── docs/                # Public documentation
├── scripts/             # Release-gate scripts and utilities
└── .github/workflows/   # CI, release-gate, docker-publish, docs-deploy
```

---

## 🐳 Production Deployment

Detailed deployment guide: [`docs/16-deployment-docker.md`](docs/16-deployment-docker.md)

```bash
# 1. Clone and configure
git clone https://github.com/ribato22/MultiWA.git
cd MultiWA
cp .env.production.example .env
# Edit .env with your settings (JWT_SECRET, DB_PASSWORD, etc.)

# 2. Build and start (with all optional services)
docker compose --profile full up -d --build

# 3. Sync the database schema (the API container also does this automatically
#    on startup; run manually only if you need to force it)
docker exec multiwa-api npx prisma db push --schema=packages/database/prisma/schema.prisma

# 4. Access
# API:    http://your-server:3333/api/docs
# Admin:  http://your-server:3001
```

> 💡 For advanced production setups (custom Nginx, external PostgreSQL, SSL), see the
> [`docker-compose.production.yml`](docker-compose.production.yml) which is optimized
> for enterprise deployments with pre-configured Nginx reverse proxy.

---

## ✅ Release Checks

Every push to `main` and every pull request runs the **Release Gate**
workflow at [`.github/workflows/release-gate.yml`](.github/workflows/release-gate.yml).
It performs three checks:

- **Public boundary scan** — `pnpm check:public-boundary`. Hard-fails on
  PEM private key blocks, merge conflict markers, and RFC1918 private IP
  literals in non-doc tracked files.
- **API contract drift** — `pnpm check:api-contract`. Diffs the source
  controllers in `apps/api/src` against
  [`scripts/api-routes.snapshot.json`](scripts/api-routes.snapshot.json)
  and against the table rows in
  [`docs/07-api-specification.md`](docs/07-api-specification.md). If any
  side drifts, the gate fails with a precise list of routes that are
  added, removed, or missing from the docs.
- **No internal-only files tracked** — fails if any internal-only
  working file or note slips into the public tree.

Run the gate locally before opening a PR:

```bash
pnpm check:release
```

When you change a controller, also refresh the snapshot so the docs-drift
check stays in sync:

```bash
pnpm check:api-contract:update
```

See [`docs/release-checklist.md`](docs/release-checklist.md) for the full
maintainer release flow.

---

## 🤝 Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
full guide.

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/amazing-feature`).
3. Make your changes, then run `pnpm check:release` to confirm the release
   gate still passes.
4. Commit (`git commit -m 'feat: add amazing feature'`).
5. Push to the branch (`git push origin feature/amazing-feature`).
6. Open a Pull Request.

The [Release Checks](#-release-checks) section above explains what the
gate enforces. For controller changes, also see
[CONTRIBUTING.md → Release Checks](CONTRIBUTING.md#release-checks).

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 🔗 Links

- 📖 [Documentation](https://ribato22.github.io/MultiWA/docs/) · [Source](docs/)
- 🐛 [Report a Bug](https://github.com/ribato22/MultiWA/issues/new?template=bug_report.md)
- 💡 [Request a Feature](https://github.com/ribato22/MultiWA/issues/new?template=feature_request.md)
- 🔒 [Security Policy](SECURITY.md)
- 📝 [Changelog](CHANGELOG.md)
- 🕵️ [Privacy Policy](PRIVACY.md)

---

<p align="center">
  Made with ❤️ by the <a href="https://github.com/ribato22">MultiWA</a> team
</p>
