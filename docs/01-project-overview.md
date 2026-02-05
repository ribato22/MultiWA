# 01 - Project Overview

## 1.1 Executive Summary

**MultiWA** (formerly MultiWA Gateway) is a free, open-source, self-hosted WhatsApp API Gateway designed for developers and businesses who need full control over their messaging infrastructure—without vendor lock-in or hidden paywalls.

### Core Values

- **🆓 Free Forever** - No premium tiers, no feature gates
- **🔓 Open Source** - MIT licensed, community-driven
- **🏠 Self-Hosted** - Your data stays on your servers
- **🔌 Extensible** - Plugin architecture for customization
- **📦 Multi-Language SDKs** - Python, PHP, JavaScript (coming soon)

---

## 1.2 Vision & Mission

### Vision
To become the go-to open-source WhatsApp integration platform for developers worldwide.

### Mission
Provide a robust, scalable, and developer-friendly WhatsApp API that rivals commercial solutions—completely free.

---

## 1.3 Problem Statement

### Pain Points Addressed

| Pain Point | Commercial Solutions | MultiWA Solution |
|------------|---------------------|------------------|
| **Cost** | $50-500/month | FREE |
| **Vendor Lock-in** | Proprietary APIs | Open standard REST API |
| **Data Privacy** | Data on third-party servers | Self-hosted, you own data |
| **Customization** | Limited or paid | Full source code access |
| **Multi-Session** | Often extra charge | Unlimited sessions |
| **AI Integration** | Rarely included | Built-in OpenAI/GPT |

---

## 1.4 Project Goals

### Primary Goals

1. **100% WhatsApp Feature Parity** - Support all message types, groups, status
2. **Enterprise-Ready** - Multi-tenant, RBAC, audit logging
3. **Developer Experience** - SDKs, Swagger docs, WebSocket real-time
4. **Automation** - Visual flow builder, auto-reply, n8n integration
5. **Scalability** - Redis queues, horizontal scaling ready

### Success Metrics

| Metric | Target |
|--------|--------|
| GitHub Stars | 1,000+ in 6 months |
| Docker Pulls | 10,000+ in 6 months |
| Active Deployments | 500+ worldwide |
| SDK Downloads | 5,000+ PyPI/Packagist |

---

## 1.5 Technology Stack

| Layer | Technology |
|-------|------------|
| **Backend** | NestJS + Fastify |
| **Database** | PostgreSQL + Prisma ORM |
| **Cache** | Redis |
| **Queue** | BullMQ |
| **Frontend** | Next.js 14 + Shadcn UI |
| **WhatsApp** | Baileys + WhatsApp-Web.js |
| **Real-time** | Socket.IO |
| **Containerization** | Docker + Docker Compose |

---

## 1.6 Competitive Positioning

| Feature | MultiWA | OpenWA | WAHA | Fonnte |
|---------|---------|--------|------|--------|
| **Price** | FREE | Free | $50+/mo | $30+/mo |
| **Open Source** | ✅ | ✅ | ❌ | ❌ |
| **SDKs** | Python, PHP | Coming Soon | ❌ | ❌ |
| **n8n Integration** | ✅ | ❌ | ❌ | ❌ |
| **AI Auto-Reply** | ✅ GPT-4 | ❌ | ❌ | ❌ |
| **Visual Flow Builder** | ✅ | ❌ | ❌ | ❌ |
| **Groups API** | ✅ | ✅ | ✅ | ❌ |
| **WebSocket** | ✅ | ✅ | ❌ | ❌ |
| **Multi-Tenant** | ✅ | ❌ | ❌ | ❌ |

---

## 1.7 Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Feb 2026 | MultiWA Team | Initial release |

---

[← Documentation Index](./README.md) · [Next: Requirements →](./02-requirements.md)
