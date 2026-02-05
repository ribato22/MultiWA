# MultiWA ↔ Chatwoot Bridge

Bridges WhatsApp messages between **MultiWA Gateway** and **Chatwoot**.

## Features

- 📥 **Incoming**: WhatsApp messages → Chatwoot conversations
- 📤 **Outgoing**: Agent replies in Chatwoot → WhatsApp via MultiWA
- 👤 Auto-creates contacts and conversations in Chatwoot
- 🔒 API key authentication

## Setup

### 1. Environment Variables

```bash
# MultiWA
MULTIWA_URL=http://localhost:3001
MULTIWA_API_KEY=your-api-key
MULTIWA_PROFILE_ID=your-profile-id

# Chatwoot
CHATWOOT_URL=http://localhost:3000
CHATWOOT_ACCESS_TOKEN=your-chatwoot-token
CHATWOOT_ACCOUNT_ID=1
CHATWOOT_INBOX_ID=1

# Bridge
BRIDGE_PORT=3100
```

### 2. Configure Webhooks

**MultiWA** → Add webhook URL: `http://bridge-host:3100/webhook/multiwa`  
**Chatwoot** → Add webhook URL: `http://bridge-host:3100/webhook/chatwoot`

### 3. Run

```bash
pnpm install
pnpm dev
```

## Architecture

```
WhatsApp User → MultiWA API → Bridge → Chatwoot (Agent sees message)
WhatsApp User ← MultiWA API ← Bridge ← Chatwoot (Agent replies)
```
