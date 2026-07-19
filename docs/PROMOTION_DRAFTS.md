# MultiWA — Community Promotion Drafts

## 📢 Reddit Post — r/selfhosted

**Title:** `I built MultiWA — a self-hosted WhatsApp API gateway with visual automation, AI replies, and multi-engine support`

**Body:**

```
Hey r/selfhosted! 👋

I've been working on **MultiWA**, a fully self-hosted, open-source WhatsApp Business API gateway. Think of it as your own Twilio for WhatsApp — but free, open-source, and completely under your control.

### 🐳 One-command setup:
```bash
git clone https://github.com/ribato22/MultiWA.git
cd MultiWA && cp .env.docker .env
docker compose up -d
```

### Key features:
- 📱 **Multi-Session** — Connect unlimited WhatsApp numbers via single API
- 🔌 **Pluggable engines** — pick whatsapp-web.js (production) or Baileys (experimental) per profile
- 🤖 **AI Auto-Reply** — Knowledge base powered by OpenAI (or any OpenAI-compatible API)
- ⚡ **Visual Flow Builder** — Drag & drop automation (no code needed)
- 📢 **Broadcast** — Bulk messaging with templates, variables, tracking
- 🖥️ **Admin Dashboard** — Full-featured Next.js dashboard with dark mode
- 📦 **SDKs** — Official TypeScript, Python, PHP clients
- 🔗 **Webhooks + API Keys** — Enterprise-grade integration
- 🐳 **Docker Ready** — One-command setup, production containers with healthchecks

### Screenshots:
[Contacts](https://raw.githubusercontent.com/ribato22/MultiWA/main/docs/screenshots/contacts.png) | [Automation](https://raw.githubusercontent.com/ribato22/MultiWA/main/docs/screenshots/automation.png) | [Profiles](https://raw.githubusercontent.com/ribato22/MultiWA/main/docs/screenshots/profiles.png) | [Settings](https://raw.githubusercontent.com/ribato22/MultiWA/main/docs/screenshots/settings.png)

### Tech stack:
NestJS + Fastify (API) · Next.js 14 (Dashboard) · PostgreSQL + Redis · BullMQ Workers · Socket.IO

**GitHub:** https://github.com/ribato22/MultiWA
**Website:** https://ribato22.github.io/MultiWA/
**License:** MIT

Would love to hear your feedback! What features would you want to see next?
```

---

## 📢 Reddit Post — r/opensource

**Title:** `MultiWA — Open Source WhatsApp API Gateway with Visual Automation Builder (MIT License)`

**Body:**

```
I'm sharing my open-source project **MultiWA** — a self-hosted WhatsApp Business API gateway.

**What makes it different from other WhatsApp tools:**
- Pluggable engines: whatsapp-web.js (production) or Baileys (experimental), selectable per profile
- Visual automation builder: drag & drop, no coding required
- AI-powered knowledge base: plug in OpenAI (or any OpenAI-compatible API) for smart auto-replies
- Full admin dashboard with real-time chat, analytics, broadcast
- Official SDKs for TypeScript, Python, and PHP

One-command Docker setup, MIT licensed, actively maintained.

🔗 https://github.com/ribato22/MultiWA

Contributions welcome! We have several "good first issue" tickets for newcomers.
```

---

## 📋 awesome-selfhosted Submission

**PR Title:** `Add MultiWA to Communication - Custom`

**Entry to add** (in alphabetical order under `Communication - Custom`):

```markdown
- [MultiWA](https://github.com/ribato22/MultiWA) - Self-hosted WhatsApp Business API gateway with multi-engine support, visual automation builder, AI-powered replies, and admin dashboard. `MIT` `Docker/Nodejs`
```

**PR Description:**

```
Adds MultiWA to the Communication - Custom section.

MultiWA is a self-hosted WhatsApp Business API gateway featuring:
- Multi-engine support (whatsapp-web.js + Baileys)
- Visual drag-and-drop automation builder
- AI-powered auto-reply (OpenAI-compatible API)
- Full admin dashboard (Next.js 14)
- Official SDKs (TypeScript, Python, PHP)
- One-command Docker setup

License: MIT
Demo: https://ribato22.github.io/MultiWA/
Source: https://github.com/ribato22/MultiWA
```

---

## 📝 Hacker News — Show HN

**Title:** `Show HN: MultiWA – Open-source WhatsApp API gateway with visual automation and AI replies`

**Body:**

```
I built MultiWA, a self-hosted WhatsApp Business API gateway.

It supports multiple WhatsApp engines (whatsapp-web.js production, Baileys experimental), has a visual drag-and-drop automation builder, AI-powered knowledge base (OpenAI-compatible), and a full admin dashboard.

Docker one-click setup:
  git clone ... && docker compose up -d

Tech: NestJS, Next.js 14, PostgreSQL, Redis, BullMQ, Socket.IO

https://github.com/ribato22/MultiWA
```

**Best posting time:** Tuesday-Thursday, 8-10 AM PT (22:00-00:00 WIB)

---

## 📝 Dev.to Article

**Title:** `Building a Self-Hosted WhatsApp API Gateway with Visual Automation — MultiWA`

**Tags:** `opensource`, `docker`, `whatsapp`, `nestjs`

_(Write a 1000-word article covering the problem, solution, architecture, and how to get started)_
