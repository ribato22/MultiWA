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
  status      String        @default("disconnected")
  engine      String        @default("whatsapp-web-js") // whatsapp-web-js | baileys | mock
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

// Engine is stored as a plain String on Profile (not a DB enum). Valid values are
// validated at the application layer: whatsapp-web-js (default) | baileys | mock.

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

[← System Architecture](<system-architecture.md>) · [Documentation Index](<../intro.md>) · [Engine Abstraction →](<engine-abstraction.md>)
