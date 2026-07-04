# 07 - API Specification

> This document is source-verified against the controllers in `apps/api/src/**/*.controller.ts` as of MultiWA `1.0.0` (2026-05-24). For interactive exploration, use Swagger UI at `<API base host>:<API port>/api/docs`.

## 7.1 Overview

| Property | Value |
|----------|-------|
| Base URL (Docker) | `http://localhost:3333/api/v1` |
| Base URL (local dev) | `http://localhost:3000/api/v1` |
| Swagger UI | `<API host>:<port>/api/docs` |
| Global prefix | `api/v1` (from `app.setGlobalPrefix('api/v1')` in `apps/api/src/main.ts`) |
| Format | JSON |
| Auth | Bearer Token or `x-api-key` header |

All endpoint paths in this document are relative to the base URL. For example, `POST /messages/text` resolves to `POST http://localhost:3333/api/v1/messages/text` under the Docker default.

---

## 7.2 Authentication

### Bearer Token

```
Authorization: Bearer YOUR_JWT_TOKEN
```

Issued by `POST /auth/register` and `POST /auth/login`. Refresh with `POST /auth/refresh`.

### API Key

```
x-api-key: YOUR_API_KEY
```

The Swagger UI registers the API key under the `api-key` security scheme; the header name is lowercase `x-api-key`. Create keys with `POST /api-keys`.

---

## 7.3 Response Format

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "meta": { "timestamp": "2026-02-05T10:00:00Z" }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Phone number is required"
  }
}
```

---

## 7.4 Endpoints

The tables below mirror the `@Controller(...)` decorators in `apps/api/src/`. Use them as the authoritative endpoint list; if Swagger and this document diverge, Swagger wins.

### Auth (`/auth`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/register` | Register an account and receive tokens |
| `POST` | `/auth/login` | Log in and receive tokens |
| `POST` | `/auth/2fa/verify` | Verify a 2FA challenge during login |
| `POST` | `/auth/refresh` | Exchange refresh token for a new access token |
| `POST` | `/auth/logout` | Invalidate the current session |
| `GET` | `/auth/me` | Get the current user |
| `GET` | `/auth/preferences` | Get user preferences |
| `PATCH` | `/auth/preferences` | Update user preferences |
| `POST` | `/auth/change-password` | Change the current user's password |
| `DELETE` | `/auth/account` | Delete the current user account |
| `POST` | `/auth/2fa/setup` | Begin 2FA enrollment |
| `POST` | `/auth/2fa/enable` | Confirm and enable 2FA |
| `POST` | `/auth/2fa/disable` | Disable 2FA |
| `POST` | `/auth/2fa/backup-codes` | Generate 2FA backup codes |
| `GET` | `/auth/sessions` | List active sessions |
| `DELETE` | `/auth/sessions/:id` | Revoke a specific session |
| `DELETE` | `/auth/sessions` | Revoke all sessions except current |

### Health (`/health`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe |

### Accounts (`/accounts`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/accounts` | List accounts |
| `POST` | `/accounts` | Create account |
| `GET` | `/accounts/:id` | Get account |
| `PUT` | `/accounts/:id` | Update account |
| `DELETE` | `/accounts/:id` | Delete account |
| `GET` | `/accounts/:accountId/profiles` | List profiles inside an account |
| `POST` | `/accounts/:accountId/profiles` | Create a profile in an account |
| `GET` | `/accounts/:accountId/profiles/:profileId` | Get profile (account-scoped) |
| `DELETE` | `/accounts/:accountId/profiles/:profileId` | Delete profile (account-scoped) |
| `POST` | `/accounts/:accountId/profiles/:profileId/connect` | Start WhatsApp connection |
| `POST` | `/accounts/:accountId/profiles/:profileId/disconnect` | Disconnect |
| `GET` | `/accounts/:accountId/profiles/:profileId/qr` | Retrieve current QR code |

### Profiles (`/profiles`) — flat alternative to the account-scoped routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/profiles` | List profiles |
| `POST` | `/profiles` | Create profile |
| `GET` | `/profiles/:id` | Get profile |
| `PUT` | `/profiles/:id` | Update profile |
| `DELETE` | `/profiles/:id` | Delete profile |
| `POST` | `/profiles/:id/connect` | Start WhatsApp connection |
| `POST` | `/profiles/:id/disconnect` | Disconnect |
| `GET` | `/profiles/:id/status` | Get connection status |

> The QR endpoint lives under the account-scoped `/accounts/.../qr` route, not on the flat `/profiles` resource.

### Messages (`/messages`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/messages/text` | Send text message |
| `POST` | `/messages/image` | Send image |
| `POST` | `/messages/video` | Send video |
| `POST` | `/messages/audio` | Send audio/voice |
| `POST` | `/messages/document` | Send document |
| `POST` | `/messages/location` | Send location |
| `POST` | `/messages/contact` | Send contact card |
| `POST` | `/messages/reaction` | Send a reaction |
| `POST` | `/messages/reply` | Send a quoted reply |
| `POST` | `/messages/poll` | Send poll |
| `POST` | `/messages/typing` | Set typing presence |
| `POST` | `/messages/mark-read` | Mark messages read |
| `POST` | `/messages/delete-for-everyone` | Delete message for everyone |
| `POST` | `/messages/schedule` | Schedule a message |
| `GET` | `/messages/schedule/:profileId` | List scheduled messages for a profile |
| `DELETE` | `/messages/schedule/:id` | Cancel a scheduled message |
| `GET` | `/messages/profile/:profileId` | List messages for a profile |
| `GET` | `/messages/conversation/:conversationId` | List messages in a conversation |
| `GET` | `/messages/conversation/:conversationId/load-older` | Fetch older messages from WhatsApp and persist them |
| `GET` | `/messages/:id` | Get a single message |
| `DELETE` | `/messages/:id` | Delete a message locally |

### Bulk Messaging (`/bulk`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/bulk/send` | Send bulk messages with variables |
| `GET` | `/bulk/batches` | List batches |
| `GET` | `/bulk/batch/:batchId` | Get batch status |
| `POST` | `/bulk/batch/:batchId/cancel` | Cancel batch |

### Broadcast (`/broadcast`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/broadcast` | Create a broadcast campaign |
| `GET` | `/broadcast` | List broadcasts |
| `GET` | `/broadcast/:id` | Get broadcast |
| `PUT` | `/broadcast/:id` | Update broadcast |
| `DELETE` | `/broadcast/:id` | Delete broadcast |
| `POST` | `/broadcast/:id/schedule` | Schedule broadcast |
| `POST` | `/broadcast/:id/start` | Start broadcast immediately |
| `POST` | `/broadcast/:id/pause` | Pause broadcast |
| `POST` | `/broadcast/:id/resume` | Resume broadcast |
| `POST` | `/broadcast/:id/cancel` | Cancel broadcast |
| `GET` | `/broadcast/:id/stats` | Broadcast delivery stats |
| `GET` | `/broadcast/:id/recipients` | Broadcast recipient list |

### Groups (`/groups`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/groups/profile/:profileId` | List groups for a profile |
| `GET` | `/groups/:groupId` | Get group info |
| `POST` | `/groups` | Create group |
| `PATCH` | `/groups/:groupId` | Update group |
| `POST` | `/groups/:groupId/participants/add` | Add participants |
| `POST` | `/groups/:groupId/participants/remove` | Remove participants |
| `POST` | `/groups/:groupId/participants/promote` | Promote to admin |
| `POST` | `/groups/:groupId/participants/demote` | Demote from admin |
| `POST` | `/groups/:groupId/leave` | Leave group |
| `GET` | `/groups/:groupId/invite-link` | Get invite link |
| `POST` | `/groups/:groupId/invite-link/revoke` | Revoke invite link |

### Conversations (`/conversations`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/conversations` | List conversations |
| `GET` | `/conversations/unread-count` | Total unread message count across the org |
| `GET` | `/conversations/:id` | Get conversation |
| `GET` | `/conversations/:id/messages` | List messages in conversation |
| `PUT` | `/conversations/:id/read` | Mark conversation read |
| `PUT` | `/conversations/:id/archive` | Archive |
| `PUT` | `/conversations/:id/unarchive` | Unarchive |
| `PUT` | `/conversations/:id/mute` | Mute |
| `PUT` | `/conversations/:id/pin` | Pin |
| `DELETE` | `/conversations/:id` | Delete conversation |
| `DELETE` | `/conversations/:id/messages` | Clear messages in conversation |

### Contacts (`/contacts`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/contacts` | List contacts |
| `POST` | `/contacts` | Create contact |
| `GET` | `/contacts/:id` | Get contact |
| `PUT` | `/contacts/:id` | Update contact |
| `DELETE` | `/contacts/:id` | Delete contact |
| `POST` | `/contacts/import` | Import contacts |
| `POST` | `/contacts/import/csv` | Import contacts from CSV |
| `GET` | `/contacts/export/csv` | Export contacts as CSV |
| `POST` | `/contacts/:id/tags` | Add tags |
| `DELETE` | `/contacts/:id/tags` | Remove tags |
| `GET` | `/contacts/profile/:profileId/validate/:phone` | Validate a single phone number on WhatsApp |
| `POST` | `/contacts/profile/:profileId/validate` | Validate a batch of phone numbers |
| `POST` | `/contacts/sync/whatsapp` | Sync contacts from WhatsApp |
| `POST` | `/contacts/profile/:profileId/save-to-whatsapp` | Save a contact into the WhatsApp account addressbook (whatsapp-web-js only) |
| `DELETE` | `/contacts/profile/:profileId/whatsapp/:phone` | Delete a contact from the WhatsApp account addressbook (whatsapp-web-js only) |

### Templates (`/templates`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/templates` | Create template |
| `GET` | `/templates` | List templates |
| `GET` | `/templates/:id` | Get template |
| `PUT` | `/templates/:id` | Update template |
| `DELETE` | `/templates/:id` | Delete template |
| `POST` | `/templates/:id/preview` | Render preview with variables |
| `POST` | `/templates/:id/duplicate` | Duplicate template |

### Webhooks (`/webhooks`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/webhooks` | Create webhook |
| `GET` | `/webhooks` | List webhooks |
| `GET` | `/webhooks/:id` | Get webhook |
| `PUT` | `/webhooks/:id` | Update webhook |
| `DELETE` | `/webhooks/:id` | Delete webhook |
| `POST` | `/webhooks/:id/test` | Send a test event |

> **Removed:** the legacy global `/hooks` registry has been retired. Use the
> organization-scoped `/webhooks` endpoints above — they sign every delivery with
> an HMAC `X-MultiWA-Signature` header and are isolated per tenant.

### Automation (`/automation`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/automation` | Create automation flow |
| `GET` | `/automation` | List automation flows |
| `GET` | `/automation/:id` | Get flow |
| `PUT` | `/automation/:id` | Update flow |
| `DELETE` | `/automation/:id` | Delete flow |
| `PUT` | `/automation/:id/toggle` | Toggle active flag |
| `POST` | `/automation/:id/test` | Test a flow with sample input |
| `GET` | `/automation/:id/stats` | Flow execution stats |
| `POST` | `/automation/reorder` | Reorder flows |

### Auto-reply (`/autoreply`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/autoreply/quick-replies` | Create a quick reply |
| `GET` | `/autoreply/quick-replies` | List quick replies |
| `DELETE` | `/autoreply/quick-replies/:id` | Delete a quick reply |
| `POST` | `/autoreply` | Create an auto-reply rule |
| `GET` | `/autoreply` | List auto-reply rules |
| `GET` | `/autoreply/:id` | Get rule |
| `PUT` | `/autoreply/:id` | Update rule |
| `DELETE` | `/autoreply/:id` | Delete rule |
| `PUT` | `/autoreply/:id/toggle` | Toggle active flag |
| `POST` | `/autoreply/webhook-reply` | Configure webhook-driven reply |
| `GET` | `/autoreply/webhook-reply/:profileId` | Get webhook-reply config |
| `POST` | `/autoreply/ai-hook` | Configure AI-driven reply |
| `GET` | `/autoreply/ai-hook/:profileId` | Get AI-hook config |

### AI (`/ai` and `/ai/knowledge`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/ai/status` | AI provider status |
| `POST` | `/ai/complete` | Generic completion |
| `POST` | `/ai/auto-reply` | Generate an auto-reply suggestion |
| `POST` | `/ai/sentiment` | Sentiment scoring |
| `POST` | `/ai/translate` | Translate text |
| `POST` | `/ai/knowledge/:profileId/text` | Ingest text into the knowledge base |
| `GET` | `/ai/knowledge/:profileId` | List knowledge documents |
| `DELETE` | `/ai/knowledge/:id` | Delete a knowledge document |
| `POST` | `/ai/knowledge/:profileId/search` | Search the knowledge base |

### API Keys (`/api-keys`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api-keys` | List API keys |
| `POST` | `/api-keys` | Create API key |
| `DELETE` | `/api-keys/:id` | Revoke API key |

### Settings (`/settings`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/settings/storage` | Get storage settings |
| `PUT` | `/settings/storage` | Update storage settings |
| `POST` | `/settings/storage/test` | Test storage configuration |
| `GET` | `/settings/smtp` | Get SMTP settings |
| `PUT` | `/settings/smtp` | Update SMTP settings |
| `POST` | `/settings/smtp/test` | Test SMTP configuration |

### Uploads (`/uploads`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/uploads/media` | Upload media for use in messages |

### Integrations (`/integrations`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/integrations/config` | Get integration config |
| `PUT` | `/integrations/config` | Update integration config |
| `POST` | `/integrations/test` | Test integration connectivity |

### Statistics (`/statistics`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/statistics/dashboard` | Dashboard summary |
| `GET` | `/statistics/messages` | Message totals |
| `GET` | `/statistics/messages/trend` | Message volume trend |
| `GET` | `/statistics/contacts` | Contact stats |
| `GET` | `/statistics/broadcasts` | Broadcast stats |
| `GET` | `/statistics/automations` | Automation stats |
| `GET` | `/statistics/response-time` | Response-time stats |

### Audit (`/audit`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/audit/logs` | List audit log entries |
| `GET` | `/audit/summary` | Audit summary |
| `GET` | `/audit/actions` | Audit action catalog |

### Notifications (`/notifications`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/notifications` | List notifications |
| `GET` | `/notifications/unread-count` | Unread count |
| `PATCH` | `/notifications/:id/read` | Mark a notification read |
| `PATCH` | `/notifications/read-all` | Mark all read |
| `DELETE` | `/notifications/:id` | Delete one |
| `DELETE` | `/notifications` | Delete all |
| `GET` | `/notifications/push/vapid-key` | Web Push VAPID public key |
| `GET` | `/notifications/push/subscriptions` | List push subscriptions |
| `POST` | `/notifications/push/subscribe` | Register a push subscription |
| `POST` | `/notifications/push/unsubscribe` | Remove a push subscription |
| `POST` | `/notifications/push/test` | Send a test push notification |

### Organizations (`/organizations`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/organizations/current` | Get current organization |
| `PUT` | `/organizations/current` | Update current organization |
| `GET` | `/organizations/members` | List members |
| `POST` | `/organizations/members` | Invite a member |
| `PUT` | `/organizations/members/:id/role` | Change member role |
| `DELETE` | `/organizations/members/:id` | Remove member |

### Workspaces (`/workspaces`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workspaces` | List workspaces |
| `POST` | `/workspaces` | Create workspace |
| `GET` | `/workspaces/:id` | Get workspace |
| `PUT` | `/workspaces/:id` | Update workspace |
| `DELETE` | `/workspaces/:id` | Delete workspace |

### RBAC (`/rbac`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/rbac/permissions` | List permissions |
| `POST` | `/rbac/roles` | Create role |
| `GET` | `/rbac/roles` | List roles |
| `GET` | `/rbac/roles/:id` | Get role |
| `PUT` | `/rbac/roles/:id` | Update role |
| `DELETE` | `/rbac/roles/:id` | Delete role |
| `POST` | `/rbac/assign` | Assign role to user |
| `DELETE` | `/rbac/users/:userId/organizations/:orgId` | Unassign user from organization |
| `GET` | `/rbac/users/:userId/roles` | List user roles |
| `GET` | `/rbac/users/:userId/permissions` | List user permissions |
| `POST` | `/rbac/organizations/:id/seed` | Seed default roles for an organization |

### GDPR (`/account`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/account/export` | Export personal data |
| `DELETE` | `/account/delete` | Delete account and personal data |

---

## 7.5 Example: Send Bulk with Variables

```bash
curl -X POST http://localhost:3333/api/v1/bulk/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "profileId": "profile-123",
    "messages": [
      {
        "chatId": "628123456789@c.us",
        "type": "text",
        "content": { "text": "Hello {name}!" },
        "variables": { "name": "John" }
      },
      {
        "chatId": "628987654321@c.us",
        "type": "text",
        "content": { "text": "Hello {name}!" },
        "variables": { "name": "Jane" }
      }
    ],
    "options": {
      "delayBetweenMessages": 5000,
      "randomizeDelay": true
    }
  }'
```

---

[← Engine Abstraction](./06-engine-abstraction.md) · [Documentation Index](./README.md) · [WebSocket API →](./08-websocket-api.md)
