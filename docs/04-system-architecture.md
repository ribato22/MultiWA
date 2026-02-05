# 04 - System Architecture

## Overview

MultiWA follows a modular, layered architecture designed for scalability and maintainability.

```
┌─────────────────────────────────────────────────────────────┐
│                     Admin Dashboard                         │
│                    (Next.js + Shadcn UI)                    │
└─────────────────────┬───────────────────────┬───────────────┘
                      │ REST API              │ WebSocket
┌─────────────────────▼───────────────────────▼───────────────┐
│                      API Gateway                            │
│                  (NestJS + Fastify)                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Auth      │  │  Messaging  │  │   Groups    │         │
│  │   Module    │  │   Module    │  │   Module    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Contacts   │  │  Broadcast  │  │   Webhooks  │         │
│  │   Module    │  │   Module    │  │   Module    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
├─────────────────────────────────────────────────────────────┤
│                    Engine Manager                           │
│              (Baileys / WhatsApp-Web.js)                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  PostgreSQL │  │    Redis    │  │   MinIO/S3  │         │
│  │  (Prisma)   │  │  (BullMQ)   │  │  (Storage)  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Modules

| Module | Responsibility |
|--------|----------------|
| **AuthModule** | JWT authentication, API keys |
| **ProfilesModule** | WhatsApp sessions management |
| **MessagesModule** | Send/receive messages |
| **GroupsModule** | Group CRUD, participants |
| **BulkModule** | Bulk messaging with variables |
| **ContactsModule** | Contact management, tags |
| **BroadcastModule** | Campaign management |
| **WebhooksModule** | Event delivery |
| **AutomationModule** | Visual flow builder |
| **AutoreplyModule** | AI-powered auto-replies |

---

## Data Flow

```
1. User Request → API Gateway
2. Authentication → JWT/API Key validation
3. Business Logic → Module service
4. Engine Manager → WhatsApp operation
5. WhatsApp Response → Transform
6. Database → Persist
7. Webhook/WebSocket → Notify subscribers
8. Response → User
```

---

## Multi-Tenant Architecture

```
Organization (Tenant)
├── Workspaces
│   ├── Profiles (WhatsApp sessions)
│   │   ├── Contacts
│   │   ├── Conversations
│   │   └── Messages
│   └── Settings
└── Users (RBAC)
```

---

[← Quick Start](./03-quick-start.md) · [Documentation Index](./README.md) · [Database Design →](./05-database-design.md)
