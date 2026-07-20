# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-07-20

### Added

- **Send Policy Engine** — window-aware multi-lane outbound governor (SERVICE replies flow free; UTILITY/AUTH/MARKETING cold lanes capped + warmed) with a delivery-health circuit breaker and delivery-confirmed OTP failover.
- **Durable broadcast** — BullMQ-backed broadcast execution with crash-window recovery and scheduled-broadcast triggers.
- **HTTP RED metrics** — `http_requests_total` + `http_request_duration_seconds` (labelled by method / route pattern / status) at `/metrics`, plus a sample `prometheus.yml` and a Grafana dashboard under `docs/monitoring/`.
- **API-key scope enforcement** — `@RequireScope` guard reads each key's stored permissions (unscoped / `*` keys remain full-access).
- **Distribution** — keyless (OIDC) publish workflows for the TypeScript / Python / n8n SDKs, container-image supply chain (SBOM + cosign signature + SLSA provenance), a Render one-click blueprint, and `docs/21-releasing-and-distribution.md`.
- **CI security scanning** — CodeQL, Dependabot, gitleaks, and an advisory `pnpm audit`.
- **End-to-end test harness** — auth, tenant/IDOR isolation, API-key auth, session revocation, and webhook cross-org isolation against live Postgres + Redis.
- **Unit test coverage** — 90+ validated unit tests across API services (organizations, api-keys, contacts, conversations, autoreply, rbac) and worker processors (webhook, automation, message, webhook-dispatcher); vitest stood up for `apps/worker`; coverage gates ratcheted (api 5→14 %, worker 0→21 %).
- **Deadlock-resilient acks** — `withDeadlockRetry` retries transient Postgres write conflicts / deadlocks (Prisma `P2034`; Postgres `40P01` / `40001` / `55P03`) with backoff and logs each retry (`[db-retry]`) so the previously-silent prod conflicts become countable.

### Changed

- **Prisma 7** — database layer migrated to Prisma 7.8 with the node-postgres driver adapter (`@prisma/adapter-pg`) and `prisma.config.ts`.
- **NestJS 11 + Fastify 5** — upgraded the backend framework and the aligned `@nestjs/*` / `@fastify/*` majors.
- Dropped the `uuid` dependency in favour of `node:crypto` `randomUUID`; 30 production dependencies bumped (bullmq, ioredis, axios, aws-sdk, radix, tanstack-query, …).
- Registration and password-change minimum length raised to 12 characters (login accepts existing shorter passwords).
- Refresh tokens are signed and verified with `JWT_REFRESH_SECRET`, distinct from the access-token secret.
- Documentation reconciled with the actual code (AI provider, engine status, webhook event names, SDK base URLs, HMAC example).
- Admin build enforces TypeScript; backend lint ratcheted to error.

### Fixed

- Production Redis backing BullMQ set to `--maxmemory-policy noeviction` with AOF, so queued jobs are never silently evicted; container log rotation added.
- Graceful shutdown (`enableShutdownHooks`) drains in-flight work on `SIGTERM`.
- Inbound WhatsApp group (`@lid`) messages are no longer dropped (message-id serialization).
- **Group picker no longer silently empties** — `GroupsService.getAll` falls back to persisted group conversations when the live `getGroups` engine call fails (e.g. a WhatsApp Web build whose group Store isn't hooked while send still works).
- API-key send scope aligned to the admin-UI convention (`messages:write` / `messages:read`) so keys issued from the dashboard can actually send.
- Refresh-token unique-hash collision (a 500 on rapid re-login) resolved with a per-token `jti`; the ack handler no longer degrades to a table-wide `WHERE 1=1` status rewrite when the message id is missing.

### Security

- Resolved the real CodeQL critical/high findings — SSRF in the automation rule-engine, stored XSS in the admin chat media URL, request-body type confusion in contact tags, insecure randomness in the org temp password, and ReDoS in the SDK URL join — and cleared the code-scanning tab to **0 open** (verified false positives dismissed with justifications).
- Hardened the lockfile so Dependabot regenerations can't swap the runtime git dependency `libsignal` to an unreachable SSH URL (`pnpm.overrides` HTTPS pins + a CI guard), and pinned the WhatsApp Web engine version served air-gap-safe from local nginx.
- Session revocation on logout; SSRF-guarded webhook delivery; org-scoped roles.

### Removed

- Deleted a dead, unauthenticated duplicate WebSocket gateway (`RealtimeGateway` / `WsApiKeyGuard`); realtime is served only by the authenticated `EventsGateway`.

## [1.0.0] - 2026-05-24

### Aligned

- Workspace version pinned to `1.0.0` across all `package.json` files (`multiwa`, `@multiwa/api`, `@multiwa/admin`, `@multiwa/worker`, `@multiwa/core`, `@multiwa/database`, `@multiwa/engines`, `@multiwa/sdk`, `@multiwa/chatwoot-bridge`, `n8n-nodes-multiwa`). README version badge updated to match.

### Documentation

- Aligned all public docs (`docs/03-quick-start.md`, `docs/07-api-specification.md`, `docs/09-webhook-events.md`, `docs/10-messaging.md`, `docs/12-automation.md`, `docs/16-deployment-docker.md`, `docs/18-configuration-reference.md`, `docs/README.md`) with the actual API: Docker base URL `http://localhost:3333/api/v1`, Swagger UI at `/api/docs`, Admin at `http://localhost:3001`, header `x-api-key`.
- Replaced incorrect endpoint paths with controller-verified ones. The WhatsApp QR is now correctly documented as `GET /accounts/:accountId/profiles/:profileId/qr` (previous docs incorrectly listed `GET /profiles/:id/qr`). The Auto-reply API uses `/autoreply` rules base (previous docs used the non-existent `/autoreply/rules`). The Automation Flow API uses `/automation` (previous docs used the non-existent `/automation/flows`).
- Added a Production Checklist and a Troubleshooting matrix to the Docker deployment guide.
- Called out the build-time semantics of `NEXT_PUBLIC_API_URL` in the configuration reference and in the deployment guide.

### SDK Package Readiness

- TypeScript SDK (`packages/sdk`): `package.json` `exports["."]` reordered so the `types` condition fits inside each `import`/`require` branch using the correct `.d.mts`/`.d.ts` files. The tsup build warning about an ineffective `types` condition is gone. Added `homepage`, `bugs`, `engines.node`, `sideEffects: false`, `publishConfig.access`, `repository.directory`, and `./package.json` to `exports`. Build now produces CJS, ESM, and dual DTS artifacts; `npm pack --dry-run` packages 7 files (LICENSE, README.md, dist/index.{d.mts,d.ts,js,mjs}, package.json) at 9.3 kB.
- Python SDK (`packages/sdk-python`): `pyproject.toml` URLs updated from the placeholder `github.com/multiwa/multiwa-python` to the real `github.com/ribato22/MultiWA`. `Development Status` relaxed from `5 - Production/Stable` to `4 - Beta` until the package is verified on PyPI. Added `Issues` and `Changelog` URLs plus Python 3.13 to the classifier list. Author email placeholder removed.
- PHP SDK (`packages/sdk-php`): `composer.json` gains a `homepage`, a `support.issues` and `support.source` block, an author `homepage` field, and `minimum-stability: stable`. The placeholder author email was removed.
- LICENSE (MIT) was copied into each of the three SDK package directories so the published tarball includes it.
- Public registry publishing for `@multiwa/sdk` (NPM), `multiwa` (PyPI), and `multiwa/multiwa-php` (Packagist) is **still not yet verified** and remains a follow-up. The READMEs continue to instruct in-repo install paths.

### Notes

- In-repo SDKs (`packages/sdk`, `packages/sdk-python`, `packages/sdk-php`) are part of this release. Public registry publishing for `@multiwa/sdk` (NPM), `multiwa-sdk` (PyPI), and `multiwa/sdk` (Packagist) is **not yet verified and is tracked as a follow-up**. Install from this repository or via the local package path until those registries are confirmed.
- The only verified public image is `ribato/multiwa-api` on Docker Hub. Other image names that appeared in earlier docs (`multiwa/api`, `multiwa/admin`, `multiwa/multiwa`) were not resolvable and have been removed from public docs.

## [0.0.1] - 2026-02-16

### Added
- **Multi-engine architecture** — Pluggable WhatsApp engine adapters (whatsapp-web.js, Baileys)
- **Admin Dashboard** — Full-featured Next.js dashboard with real-time session monitoring
- **Visual Automation Builder** — Drag & drop flow builder for message automation
- **Knowledge Base** — AI-powered auto-reply using document context (OpenAI-compatible API)
- **Broadcast System** — Bulk messaging with template support and delivery tracking
- **Contact Management** — Import/export contacts, tagging, and segmentation
- **Template System** — Reusable message templates with variable substitution
- **Webhook System** — Real-time event notifications to external services
- **API Key Management** — Multiple API keys with scoping and expiration
- **Push Notifications** — Browser push notifications via Web Push API
- **SMTP Email** — Configurable email notifications for critical events
- **Audit Logging** — Comprehensive audit trail for all operations
- **Plugin System** — Extensible plugin architecture for custom functionality
- **SDKs** — Official TypeScript, Python, and PHP SDKs
- **GDPR Compliance** — Data export and deletion endpoints
- **Docker Support** — Production-ready Docker Compose with Nginx reverse proxy
- **GitHub CI/CD** — Automated lint, build, test, and Docker build pipeline
- **Worker Service** — BullMQ-based background job processor (messages, automation, webhooks, scheduled tasks)
- **Demo Mode** — Read-only sandbox mode (`DEMO_MODE=true`) with API guard blocking mutations and frontend banner
- **Dashboard Screenshots** — 11 screenshots of admin UI in `docs/screenshots/`
- **Demo Mode Documentation** — New docs page explaining demo mode setup and architecture

### Changed
- **Configuration Reference** — Translated from Indonesian to English

### Security
- Helmet security headers (API)
- CSP headers (Admin UI)
- JWT authentication with refresh tokens
- API key encryption at rest
- Rate limiting and input validation
