---
sidebar_position: 1
title: "API Specification"
---

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
| `DELETE` | `/accounts/:accountId/profiles/:profileId` | Delete profile (account-scoped; owner or admin) |
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
| `PUT` | `/profiles/:id/calls-settings` | The profile's call settings (owner or admin): `answerInDashboard`, `recording`, `retentionDays` (1-3650); 409 with `reasons` when one cannot be turned on |
| `POST` | `/profiles/:id/calls-announcement` | Upload the announcement callers hear before a recorded call (owner or admin; multipart `file`: mp3, wav, ogg, webm or m4a, at most 2 MB and 30 seconds; half a second more is allowed for encoders' padding) |
| `GET` | `/profiles/:id/calls-announcement` | The profile's announcement, to listen to (owner or admin) |
| `DELETE` | `/profiles/:id/calls-announcement` | Remove the announcement (owner or admin; 409 while recording is on; its file goes at a nightly sweep once it is an hour old) |
| `DELETE` | `/profiles/:id` | Delete profile (owner or admin) |
| `POST` | `/profiles/:id/connect` | Start WhatsApp connection |
| `POST` | `/profiles/:id/disconnect` | Disconnect |
| `GET` | `/profiles/:id/status` | Get connection status |

> The QR endpoint lives under the account-scoped `/accounts/.../qr` route, not on the flat `/profiles` resource.

### Messages (`/messages`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/messages/text` | Send text message |
| `POST` | `/messages/otp` | Send an OTP with delivery-confirmed failover to a secondary channel |
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

> **Disconnected profile.** The endpoints that deliver a message (`text`, `image`, `video`, `audio`, `document`, `location`, `contact`, `reaction`, `reply`, `poll`) answer **`409 Conflict`** when the profile has no live WhatsApp connection, instead of reporting success:
>
> ```json
> { "statusCode": 409, "error": "PROFILE_DISCONNECTED", "message": "Profile is not connected; the message was not sent" }
> ```
>
> The message is stored with `status: "failed"` and a `message.failed` event is emitted. Nothing is retried automatically, so reconnect the profile and send again. `POST /messages/otp` does not return the 409: it fails over to its secondary channel, or answers `502 OTP_DELIVERY_FAILED` when no channel delivers. Bulk batches, broadcasts and scheduled messages record the message as `failed` instead of returning an error. With `DURABLE_SEND=true` a send is enqueued instead and retried a bounded number of times before it ends `failed` (see [Durable Sending](<../features/messaging.md#durable-sending-optional>)).

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

### Calls (`/calls`)

Incoming WhatsApp calls, stored per profile and published as the `call.received`, `call.answered`, `call.rejected`, `call.ended` and `call.updated` [webhook events](<webhook-events.md>); deleting a call's recording sends `call.recording.deleted`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/calls` | List calls of a profile, newest first (`profileId` required; filters `outcome`, `followUp`, `from` (caller JID or phone number, e.g. `628111000111`), `since` (ISO 8601 date); paging `limit` 1-100, `cursor`) |
| `GET` | `/calls/open-count` | Open call follow-ups across the org |
| `GET` | `/calls/media/status` | Readiness of answering calls in the dashboard and of recording them: the media server, the recordings storage and every profile of the organization (owner or admin) |
| `GET` | `/calls/:id` | Get a call |
| `PATCH` | `/calls/:id` | Update the follow-up status (`open`, `in_progress`, `done`) or the assignee |
| `POST` | `/calls/:id/reject` | Reject a call that is still ringing |
| `POST` | `/calls/:id/reply` | Send a text to the caller (default: the profile's `callReplyMessage`) |
| `POST` | `/calls/:id/call-link` | Create a WhatsApp call link (`voice` / `video`) and send it to the caller |
| `GET` | `/calls/:id/recording` | The call's recording, `audio/webm` (owner or admin; HTTP Range; `?download=1` as an attachment; audited) |
| `DELETE` | `/calls/:id/recording` | Delete the call's recording (owner or admin) |

`reply` and `call-link` send a WhatsApp message to the caller, so they behave like a send from `/messages`:

- **API-key scope.** An API key with an explicit scope list needs `messages:write` (*Send Messages*) for them, and gets `403` without it. Keys with no scopes or with `*`, and JWT logins, skip this check. The reads, `PATCH` and `reject` ask for no scope.
- **Send gate.** The text goes through the profile's send gate (see [Messaging](<../features/messaging.md>)): it waits out the pacing delay and can be refused with `429` and a code in the body. `DAILY_LIMIT_REACHED` and `REPEAT_SUPPRESSED` (the same text to the same caller within a minute, by default) can happen at any time; `COLD_DAILY_LIMIT_REACHED` and `COLD_CIRCUIT_OPEN` only once the service window has closed. An incoming call opens the service window (`serviceWindowHours`, 24 hours by default) the way an incoming message does, so answering a recent call is a reply, not cold outreach. With `DURABLE_SEND=true` or `ENGINE_HOST=worker` the text is queued instead (the `message` in the response has `status: "queued"`), and a delivery failure arrives as a `message.failed` webhook.

Other errors of the call actions:

| Status | When |
|--------|------|
| `409` | `reject`: the call is not ringing any more. Any action: the profile is not connected. `call-link`: the engine cannot create call links (Baileys) |
| `422` | `reply` or `call-link` for a group call |
| `502` | The text to the caller was not sent, or WhatsApp returned no call link |
| `504` | `reject` or the creation of the call link: WhatsApp did not answer in time (about 30 seconds) |

**Auto-reject.** A profile with `autoRejectCalls` on (set with `PUT /profiles/:id`) rejects a ringing call at once (`rejectedBy` is `auto`). A non-blank `autoRejectCallMessage` is then sent to the caller, also when the reject failed because the caller had already hung up. That reply goes through the same send gate and is sent at most once per caller per 24 hours; it is never sent for a group call or for a call known only from its call log. A reply the gate refuses or the engine fails to send is not retried and does not use up the 24 hours, so the caller's next call can try again.

**Recordings.** A call answered in the dashboard on a profile with `recording` on is recorded from before the profile's announcement, in stereo: left the caller, right what the caller heard. When the recorder does not start or the announcement does not play, the call goes on unrecorded. A recording is stored when its call ends ([`call.recording.ready`](<webhook-events.md#call-recording-events>)). Each call in `GET /calls` and `GET /calls/:id` has `recording`: `null`, or the recording's facts:

- `id`, `durationSec`, `bytes`, `announcementPlayed`, `createdAt`;
- `partial`: it may end before its call did (cut short by a restart, a recorder that did not stop cleanly, or a write that failed);
- once its file is deleted, `deletedAt` and `deleteReason` (`admin` or `retention`). The row stays as evidence.

The audio itself:

- **Owner or admin only**, on a call of their organization. An API key with an explicit scope list needs `recordings:read` to play or download and `recordings:delete` to delete. Such a key also needs `profiles:write` for `PUT /profiles/:id/calls-settings`, the announcement routes and deleting a profile (`DELETE /profiles/:id`, `DELETE /accounts/:accountId/profiles/:profileId`, which delete its recordings too), and `recordings:delete` as well to change `retentionDays` (a shorter period deletes recordings). Keys with no scopes or with `*` skip these checks.
- **`GET /calls/:id/recording`** answers `200`, or `206` for a `Range: bytes=…` request, with `Accept-Ranges: bytes` and `Cache-Control: private, no-store`.
  - Only one range is served: a list is answered whole. A range past the end is `416`.
  - `?download=1` adds `Content-Disposition: attachment`.
  - Every read is audited (`call.recording.play`, `call.recording.download`, with the IP and user agent) before its first byte: once every 10 minutes per user, address, user agent, recording and action, whatever range it asks for, so a player's seeks do not flood the audit log and no range escapes it. A request that cannot be audited is refused with `503`.
  - A `HEAD` answers the same headers without the audio, and is audited as a read.
  - `404` when the call has no recording, it was deleted, its file is missing, or it is stored in another location than this server uses now (see [Call recordings](<../operations/configuration-reference.md#call-recordings>)). `503` while the recordings storage is not configured, or when it does not answer (try again).
- **`DELETE /calls/:id/recording`** deletes the file and answers `{ callId, recordingId, deletedAt }`. It is audited as `call.recording.delete` and sends the `call.recording.deleted` webhook. A recording already deleted is `404`, and one stored in another location `409`; while the recordings storage is not configured, the answer is `503`.
- **A browser player** cannot point an `<audio>` element at this route: the route needs the `Authorization` (or `x-api-key`) header. Fetch the file with the header, then play what was fetched.

Turning `recording` on answers `409` with `reasons` when it cannot be on:

- `no_announcement`;
- `recordings_storage_unset` (see [Call recordings](<../operations/configuration-reference.md#call-recordings>));
- `storage_not_private`: the storage serves its files without credentials, and recording is turned off on every profile;
- `storage_check_failed`: the check proved nothing; try again.

A `true` sent for a setting that is already on (`recording` or `answerInDashboard`) is left as it is, without a check, so a form may send every field.

The announcement upload answers `413` past 2 MB, `415` for another format or a file that cannot be read, `422` past 30 seconds (counted from the audio itself: an mp3's frames, a wav's samples; half a second more is allowed for encoders' padding) or for a file that does not say how long it is (a browser recording, for one), and `503` while two other announcements are being read or the recordings storage does not answer (as `GET /profiles/:id/calls-announcement` does then). It answers `400` without a file, and `409` (`recordings_storage_unset`) while the recordings storage is not configured. A new announcement replaces the profile's previous one, whose file, like a removed one's, goes at a nightly sweep once it is an hour old.

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
| `DELETE` | `/workspaces/:id` | Delete workspace (owner or admin) |

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

[← Engine Abstraction](<../architecture/engine-abstraction.md>) · [Documentation Index](<../intro.md>) · [WebSocket API →](<websocket-api.md>)
