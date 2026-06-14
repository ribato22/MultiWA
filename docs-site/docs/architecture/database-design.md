---
sidebar_position: 2
title: "Database Design"
---

# 05 - Database Design

## Overview

MultiWA uses PostgreSQL with Prisma ORM for type-safe database access.

---

## Entity Relationship Diagram

```
┌────────────────┐       ┌────────────────┐
│  Organization  │───────│   Workspace    │
└────────────────┘       └───────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
             ┌──────▼───┐  ┌─────▼────┐ ┌─────▼────┐
             │ Profile  │  │  Account │ │  User    │
             └────┬─────┘  └──────────┘ └──────────┘
                  │
     ┌────────────┼────────────┬─────────────┐
     │            │            │             │
┌────▼───┐  ┌─────▼────┐ ┌─────▼────┐ ┌──────▼─────┐
│Contact │  │ Message  │ │Broadcast │ │ Automation │
└────────┘  └──────────┘ └──────────┘ └────────────┘
```

---

## Core Models

### Profile (WhatsApp Session)
```prisma
model Profile {
  id          String    @id @default(cuid())
  name        String
  phone       String?
  status      SessionStatus @default(DISCONNECTED)
  engine      EngineType    @default(BAILEYS)
  webhookUrl  String?
  createdAt   DateTime  @default(now())
  
  contacts    Contact[]
  messages    Message[]
  broadcasts  Broadcast[]
}
```

### Contact
```prisma
model Contact {
  id        String   @id @default(cuid())
  phone     String
  name      String?
  email     String?
  tags      String[] @default([])
  metadata  Json?
  
  profileId String
  profile   Profile  @relation(...)
}
```

### Message
```prisma
model Message {
  id          String      @id @default(cuid())
  waMessageId String?     @unique
  fromMe      Boolean
  type        MessageType
  content     String
  status      MessageStatus
  timestamp   DateTime    @default(now())
  
  profileId   String
  contactId   String?
}
```

---

## Enums

```prisma
enum SessionStatus {
  DISCONNECTED
  CONNECTING
  QR_READY
  CONNECTED
}

enum EngineType {
  BAILEYS
  WHATSAPP_WEB_JS
}

enum MessageType {
  TEXT
  IMAGE
  VIDEO
  AUDIO
  DOCUMENT
  LOCATION
  CONTACT
  POLL
}
```

---

## Indexes

```prisma
@@index([profileId])
@@index([phone])
@@index([createdAt])
@@index([status])
```

---

[← System Architecture](/architecture/system-architecture) · [Documentation Index](/getting-started/project-overview) · [Engine Abstraction →](/architecture/engine-abstraction)
