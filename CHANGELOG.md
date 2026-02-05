# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-02-16

### Added
- **Multi-engine architecture** — Pluggable WhatsApp engine adapters (whatsapp-web.js, Baileys)
- **Admin Dashboard** — Full-featured Next.js dashboard with real-time session monitoring
- **Visual Automation Builder** — Drag & drop flow builder for message automation
- **Knowledge Base** — AI-powered auto-reply using document context (OpenAI, Google AI)
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

### Security
- Helmet security headers (API)
- CSP headers (Admin UI)
- JWT authentication with refresh tokens
- API key encryption at rest
- Rate limiting and input validation
