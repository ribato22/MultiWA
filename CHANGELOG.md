# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
