# MultiWA Testing Guide

Testing checklist and status for all features.
**Last Updated**: Feb 14, 2026

---

## 1. Authentication & Login

| Test | Status | Notes |
|------|--------|-------|
| Login with email/password | ✅ Pass | Tested at /auth/login |
| Invalid credentials error message | ✅ Pass | Shows error toast |
| 2FA login (TOTP) | ✅ Fixed | Was: UI didn't react after code entry. Fix: improved token extraction (`accessToken` + `access_token` formats) + `window.location.href` redirect |
| 2FA backup code | ⚠️ Untested | Backend supports it, UI has toggle |
| Token refresh | ⚠️ Untested | Auto-refresh via interceptor |
| Session persistence | ✅ Pass | Tokens stored in localStorage |

---

## 2. Dashboard / Overview

| Test | Status | Notes |
|------|--------|-------|
| Dashboard loads after login | ✅ Pass | Shows stats cards |
| Profile count display | ✅ Pass | |
| Message count display | ✅ Pass | |
| Quick actions | ✅ Pass | |
| Active session badge | ✅ Fixed | Was: showed 1 when 7 sessions active. Fix: corrected count logic |

---

## 3. Profiles & Connection

| Test | Status | Notes |
|------|--------|-------|
| List profiles | ✅ Pass | Shows all created profiles |
| Create new profile | ✅ Pass | |
| Delete profile | ✅ Pass | |
| QR code generation | ✅ Fixed | Was: QR not appearing in Docker. Fix: Chromium installed & configured correctly in Dockerfile |
| QR code scanning → connect | ✅ Pass | |
| Device info (phone number) | ✅ Fixed | Was: showed "No phone". Fix: profile field mapping `phoneNumber` → `phone` |
| Session data display | ✅ Fixed | Was: raw JSON string. Fix: parsed `sessionData` to object |
| **Reconnection (auto-retry)** | ✅ Improved | Auto-retry with exponential backoff (3 retries: 5s → 15s → 45s). Also fixed: Chromium SingletonLock cleanup, removed `--single-process` flag, staggered startup |
| Disconnect/Reconnect button | ✅ Pass | |

> **Note**: Reconnection on macOS development is inherently slower than Docker/Linux due to Puppeteer (Chromium) startup overhead. The 60s browser timeout and 240s protocol timeout in `whatsapp-webjs.adapter.ts` are normal for the library.

---

## 4. Chat

| Test | Status | Notes |
|------|--------|-------|
| Load conversations list | ✅ Pass | |
| Send text message | ✅ Pass | |
| Receive message (real-time) | ✅ Pass | Via WebSocket |
| Send image/media | ✅ Pass | |
| Message status (sent/delivered/read) | ✅ Pass | ACK updates via WebSocket |
| Schedule message | ✅ Fixed | Was: scheduled messages didn't appear in chat. Fix: placeholder message added immediately after scheduling |
| Schedule message datetime picker | ✅ Pass | |

---

## 5. Messages Page

| Test | Status | Notes |
|------|--------|-------|
| Send text message | ✅ Pass | |
| Send image/video/audio/document | ✅ Pass | File upload supported |
| Send location | ✅ Pass | |
| Send poll | ✅ Pass | |
| Send contact card | ✅ Pass | |
| Template picker | ✅ Pass | |
| Typing indicator | ✅ Pass | |
| **Schedule message** | ✅ Added | Was: missing entirely. Fix: added ⏰ schedule button + datetime picker (TEXT messages) |
| Recent sent messages list | ✅ Pass | |

---

## 6. Contacts

| Test | Status | Notes |
|------|--------|-------|
| List contacts | ✅ Pass | |
| Search contacts | ✅ Pass | |
| Contact details | ✅ Pass | |
| Sync from WhatsApp | ✅ Fixed | Was: list appeared empty after sync. Fix: frontend parsed `{ contacts: [], total }` object correctly |
| **LID duplicate filtering** | ✅ Fixed | Was: 494/991 contacts had `@lid` JID suffix. Fix: adapter filters out `@lid`, `@g.us`, `@broadcast` JIDs. Legacy records required manual SQL cleanup |
| Delete contact | ✅ Fixed | Was: 400 Bad Request. Fix: Fastify rejects empty body with `Content-Type: application/json` — `ApiClient` now conditionally sets header |
| Import contacts | ⚠️ Untested | |

---

## 7. Templates

| Test | Status | Notes |
|------|--------|-------|
| List templates | ✅ Pass | |
| Create template | ✅ Pass | |
| Edit template | ✅ Pass | |
| Delete template | ✅ Pass | |
| Template variables | ✅ Pass | |

---

## 8. Broadcast

| Test | Status | Notes |
|------|--------|-------|
| Create broadcast | ✅ Pass | |
| Send broadcast | ✅ Pass | |
| Broadcast history | ✅ Pass | |

---

## 9. Automation

| Test | Status | Notes |
|------|--------|-------|
| Create automation rule | ✅ Pass | |
| Trigger on keyword | ✅ Fixed | Was: trigger type enum mismatch between Flow Builder and Rule Engine. Fix: normalized `message.received` → `all`, `message.keyword` → `keyword`, `contact.created` → `new_contact` |
| Visual flow builder | ✅ Fixed | Multiple fixes: (1) trigger type saves correctly, (2) condition extraction reads `field`/`operator`/`value`, (3) action reads `config.text`, (4) `send_text` → `reply` mapping |
| **Bot reply loop prevention** | ✅ Fixed | Was: bot replying to own messages. Fix: added `fromMe` check in `onMessage` |
| **Message count & rate limiting** | ✅ Added | Increments `dailyMessageCount` on outgoing auto-reply, checks `dailyMessageLimit` before sending |
| **Typing simulation** | ✅ Added | `chat.sendStateTyping()` before auto-reply with configurable delay (`messageDelayMs`, default 1500ms) |
| AI auto-reply | ⚠️ Requires config | Needs `OPENAI_API_KEY` in `.env` |

---

## 10. AI Knowledge Base

| Test | Status | Notes |
|------|--------|-------|
| Profile dropdown | ✅ Fixed | Was: empty. Fix: profile field mapping |
| Upload document | ✅ Pass | Documents chunked and stored in DB |
| List documents | ✅ Pass | |
| Delete document | ✅ Pass | |
| Search knowledge base | ✅ Pass | TF-IDF keyword search |
| **AI auto-reply with RAG context** | ⚠️ Requires `OPENAI_API_KEY` | The knowledge base provides context for AI-powered auto-replies |

> **Architecture Note**: The AI in Knowledge Base works in two layers:
> 1. **Knowledge Base Service** — stores documents as chunks, searches using TF-IDF (no API key needed)
> 2. **AI Service** — uses OpenAI API (`gpt-4o-mini`) for generating replies with RAG context from knowledge base (**requires `OPENAI_API_KEY`**)
>
> To enable AI features, add to `.env`:
> ```
> OPENAI_API_KEY=sk-your-key-here
> OPENAI_BASE_URL=https://api.openai.com/v1  # optional, defaults to OpenAI
> ```

---

## 11. Group Messaging

| Test | Status | Notes |
|------|--------|-------|
| List groups | ✅ Fixed | Was: single corrupted group crashed entire list. Fix: sequential processing with per-group `try/catch` |
| **High-volume groups (270+)** | ✅ Fixed | Optimized participant count extraction from raw metadata, 30s timeout wrapper to prevent hangs |
| **Send group message** | ✅ Fixed | Was: "Ghost Success" — message appeared sent but never delivered. Root cause: double normalization stripped `@g.us` suffix + stale Docker `dist/` files. Fix: removed duplicate normalization in adapter, rebuilt with `npx tsc` |

---

## 12. Analytics

| Test | Status | Notes |
|------|--------|-------|
| Message analytics charts | ✅ Pass | |
| Contact growth chart | ✅ Pass | |

---

## 13. Webhooks

| Test | Status | Notes |
|------|--------|-------|
| Create webhook | ✅ Pass | |
| Webhook delivery | ✅ Pass | |
| Webhook logs | ✅ Pass | |

---

## 14. Integrations

| Test | Status | Notes |
|------|--------|-------|
| n8n integration | ✅ Pass | |
| API key management | ✅ Pass | |

---

## 15. Settings

| Test | Status | Notes |
|------|--------|-------|
| Account settings | ✅ Pass | |
| 2FA setup | ✅ Pass | |
| Storage configuration | ✅ Pass | |

---

## 16. Audit Log

| Test | Status | Notes |
|------|--------|-------|
| View audit logs | ✅ Pass | |
| Filter by action | ✅ Pass | |

---

## Known Issues & Limitations

1. **Reconnection speed**: On macOS dev, Chromium startup takes ~15-30s. In Docker (Linux), it's faster (~5-10s). The auto-retry feature (3 attempts with backoff) mitigates most failures.

2. **AI features require OpenAI API key**: The `OPENAI_API_KEY` env var must be configured for AI auto-reply, sentiment analysis, and translation to work. Without it, AI features gracefully return `{ success: false, error: 'OpenAI API key not configured' }`.

3. **Scheduled messages**: The cron job runs every minute to process pending scheduled messages. There may be up to 60s delay between the scheduled time and actual delivery.

4. **Docker dist staleness**: When editing TypeScript source files, always rebuild the Docker image (`docker compose build api --no-cache`) or manually run `npx tsc` in the relevant package before restarting. Stale compiled `.js` files in `dist/` will silently ignore your changes.

5. **Chromium SingletonLock**: Container restarts may leave stale lock files preventing Puppeteer from launching. The `EngineManagerService` now auto-cleans these, but if issues persist, manually remove `SingletonLock`/`SingletonSocket`/`SingletonCookie` files from `.wwebjs_auth/`.

6. **LID contacts**: New WhatsApp versions create duplicate contacts with `@lid` JID suffix. The adapter filters these on sync, but legacy records may need manual SQL cleanup: `DELETE FROM contacts WHERE phone LIKE '%@lid%';`

7. **Fastify empty body**: POST/DELETE requests without a body must **not** include `Content-Type: application/json` header, or Fastify will return 400 Bad Request.

---

## Environment

| Service | Port | Notes |
|---------|------|-------|
| Backend API (NestJS) | 3000 | Main API server |
| Admin Dashboard (Next.js) | 3001 | Admin frontend |
| PostgreSQL | 5432 | Database |
| Redis | 6379 | Cache & queue |

---

## Docker Deployment Notes

- Always use `docker compose build api --no-cache` after TypeScript changes
- Set `shm_size: '1gb'` in `docker-compose.dev.yml` for Chromium stability
- Do not use `--single-process` flag in Puppeteer launch arguments (causes QR regeneration loops)
- Staggered auto-reconnect is enabled on startup to prevent CPU/memory spikes
