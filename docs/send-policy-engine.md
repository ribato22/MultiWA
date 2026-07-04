# Send Policy Engine — Design

Status: **Draft for approval** · Owner: MultiWA · Last updated: 2026-07-04

A window-aware, multi-lane outbound governor that lets a WhatsApp gateway keep
customer **replies flowing freely** while **pacing and protecting cold /
business-initiated traffic** (OTP, notifications, marketing) — the traffic that
actually trips WhatsApp's anti-abuse **reach-out lock** (ack error `463`,
`NackCallerReachoutTimelocked`).

This builds directly on the per-profile send gate
(`packages/engine-runtime/src/send-gate.service.ts`) and the anti-ban pacing v2
(warm-up ramp + delay jitter) already shipped.

---

## 1. Background & motivation

WhatsApp itself distinguishes two kinds of outbound message via the **24-hour
customer service window**:

- **In-window replies** — the recipient messaged the business within the last
  24 h; the business replies. **Not** subject to the reach-out lock. Safe.
- **Cold / business-initiated** — first contact, or outside the window (OTP,
  notifications, marketing). **Subject** to the reach-out lock. This is what gets
  a number rate-locked when abused.

A single flat "daily message limit" cannot tell these apart, so it either
throttles safe replies (hurting a support bot) or fails to protect against the
cold-outreach that causes bans. Real deployments run **both** kinds on one
number (e.g. a support bot that also sends login OTP), which is exactly the
situation that locks a number.

**Goal:** classify each outbound message by *service window* + *category*, then
apply independent pacing/caps per lane, with delivery confirmation and failover
for the risky lanes.

### Empirical basis
On a production number that was reach-out-locked: replies delivered normally
(hundreds delivered/read in a day) while a cold send to a never-inbound number
stuck at ack `unknown`, and a healthy sibling number reached `sent` to the same
recipient. Replies flow; cold outreach is restricted. The design mirrors that
reality instead of fighting it.

---

## 2. Goals / non-goals

**Goals**
- Never throttle in-window replies because of cold-traffic limits.
- Govern cold traffic (cap, pace, warm-up) per category, independently.
- Make OTP delivery robust: confirm delivery, fail over when the number is locked.
- Be generic and configurable — useful to any WhatsApp gateway operator (OSS).

**Non-goals**
- Bypassing WhatsApp's reach-out lock (impossible and against platform policy).
- Replacing the official WhatsApp Cloud API — instead, integrate it as a
  first-class fallback channel for the traffic that needs it.

---

## 3. Categories & window classification

**Message category** (mirrors WhatsApp's own template taxonomy so it is familiar
to any operator):

| Category | Meaning | Default lane |
|---|---|---|
| `service` | Reply / conversational | Reply lane (safe) |
| `utility` | Transactional notification | Cold lane |
| `authentication` | OTP / login codes | Cold lane (OTP sub-policy) |
| `marketing` | Promotional | Cold lane (strictest) |

- The **caller declares** the category on send (e.g. the OTP app sends
  `category: "authentication"`). Default when omitted: `utility`.
- **Window classifier** `isWithinServiceWindow(profileId, recipient)` = there
  exists an **inbound** message from `recipient` to `profileId` within
  `serviceWindowHours` (default 24). If true, the effective lane is **always
  `service`** regardless of declared category — an in-window message is a reply.

Effective lane resolution:

```
effectiveLane(profile, recipient, category):
  if isWithinServiceWindow(profile, recipient): return SERVICE
  return category            # utility | authentication | marketing
```

---

## 4. Lane governance

Each lane has an independent policy. Only cold lanes are capped/warmed:

| Lane | Daily cap | Pacing | Warm-up | Notes |
|---|---|---|---|---|
| **SERVICE** | high safety backstop only | base delay + jitter | no | Replies always flow |
| **UTILITY** | `coldDailyLimit` | base delay + jitter | yes | Transactional |
| **AUTHENTICATION** | dedicated OTP budget | priority, tighter timeout | optional | Delivery-confirmed (Phase 2) |
| **MARKETING** | strictest sub-cap of cold | heaviest | yes | Most ban-prone |

**Counters** are per-lane and reset on the same WIB midnight boundary as today's
`dailyMessageCount`:
- `dailyMessageCount` (existing) = total safety backstop.
- `coldMessageCount` (new) = cold-lane traffic; the warm-up ramp + `coldDailyLimit`
  are enforced against **this**, not the total. This corrects the current
  behaviour where warm-up caps *all* sends including replies.

---

## 5. Phase 1 — Window-aware multi-lane governor (this PR)

### 5.1 Data model (`Profile`, all nullable/defaulted for `prisma db push`)
- `serviceWindowHours Int @default(24)` — window that makes a send a reply.
- `coldDailyLimit Int?` — cap for cold-lane sends. Resolution: `coldDailyLimit`
  → else `dailyMessageLimit` → else **a conservative default of 250/day**
  (`COLD_DEFAULT_DAILY_LIMIT`, mirrors WhatsApp Cloud API's entry tier) so cold
  traffic is safe-by-default on an unconfigured number. Set explicitly (incl. a
  high value) to widen it.
- `coldMessageCount Int @default(0)` — cold-lane counter (reset with `dailyResetAt`).
- Warm-up columns (already exist) are **re-scoped to the cold lane**.

`Message` gains:
- `category String?` — the declared/derived category, for audit + Phase 2 health.

### 5.2 Send-gate changes (`send-gate.service.ts`)
`executeWithGate(profileId, sendFn, meta?)` gains an optional `meta`:
`{ recipient, category }`.

`gatedRun`:
1. Resolve `effectiveLane` (window classifier query + declared category).
2. Apply base delay + jitter (unchanged, all lanes).
3. **Reply lane:** check only the high `dailyMessageLimit` backstop; increment
   `dailyMessageCount`.
4. **Cold lane:** compute the effective cold cap = `effectiveDailyCap` over
   `coldDailyLimit` (warm-up ramps toward it); 429 when `coldMessageCount >= cap`;
   on success increment **both** `coldMessageCount` and `dailyMessageCount`.

The window classifier is a single indexed query (latest inbound from the
recipient's conversation). Result cached briefly per (profile, recipient) to
avoid a DB hit on bursts.

### 5.3 API
- `BaseMessageDto` gains optional `category` (enum: service | utility |
  authentication | marketing). No route changes → API contract unchanged.
- The pre-enqueue 429 path mirrors the lane logic for a synchronous 429.

### 5.4 Admin UI
Profile "Sending guardrails" card gains a **cold-traffic** sub-section: cold
daily limit, service-window hours, and the warm-up controls move under it
(clarifying that warm-up governs cold traffic, not replies). A read-out shows
today's `service` vs `cold` counts.

### 5.5 Backward compatibility
- No `category` + within window → SERVICE (replies unaffected).
- No `category` + cold → `utility` with `coldDailyLimit` (or `dailyMessageLimit`
  fallback). Existing single-limit behaviour is preserved when cold columns are
  unset.

---

## 6. Phase 2 — Delivery confirmation, health, cold circuit breaker (implemented)
Each outbound send persists its `lane` (service|cold) on the message. When a COLD
message reaches a terminal ack, the breaker is re-evaluated from the last
`COLD_CIRCUIT_WINDOW` (10) terminal cold outcomes: `delivered`/`read`/`played` =
success, `unknown`/`failed` = failure.

- **Open:** when the cold delivery-success rate drops below
  `COLD_CIRCUIT_MIN_SUCCESS` (0.4) over at least `COLD_CIRCUIT_MIN_SAMPLES` (5)
  samples, `Profile.coldCircuitState` → `open`. While open, cold sends are
  rejected `429 COLD_CIRCUIT_OPEN`; **replies (service) keep flowing**. An org
  `SYSTEM` alert fires on the transition.
- **Half-open + recover:** after `COLD_CIRCUIT_COOLDOWN_MS` (30 min) the next cold
  send is allowed as a probe; a delivered ack closes the breaker (recovered
  alert), a failed one re-arms the cooldown.
- The health signal counts only **transmitted** cold sends (real WhatsApp id) with
  an ack-derived terminal state — policy 429s / send errors keep a placeholder id
  and are excluded, so the breaker never counts its own blocks. State transitions
  are atomic (compare-and-set) and evaluated once per message (first terminal ack).
- **Known limitation:** the breaker relies on undelivered cold sends producing a
  terminal `unknown` ack (whatsapp-web.js does; a reach-out-locked send yields
  ack=-1). An engine that leaves silently-dropped sends at non-terminal `sent`
  (e.g. Baileys) would need a stuck-`sent` reconciliation sweep to feed the signal
  — a small follow-up, not required for the whatsapp-web.js path.
- All thresholds are env-overridable. Per-send OTP confirmation + failover is
  Phase 3.

## 7. Phase 3 — OTP delivery-confirmed failover (implemented)
`POST /messages/otp` sends an OTP with automatic failover to a generic secondary
template channel:

- **Cold circuit open** → straight to the secondary channel (the number is
  reach-out-locked; don't waste an attempt).
- **Otherwise** → send over the primary (unofficial) number, wait up to
  `OTP_ACK_TIMEOUT_MS` (8 s) for a delivered/read ack; if it isn't confirmed, or
  the send is rejected (cold cap / circuit), fail over to the secondary channel.
- The response reports which channel delivered it (`whatsapp` | `fallback`).

The secondary channel is a **generic** template-send HTTP adapter configured
entirely through env: `OTP_FALLBACK_URL`, `OTP_FALLBACK_COMPANY_UUID`,
`OTP_FALLBACK_TEMPLATE_UUID`, `OTP_FALLBACK_CHATBOT_UUID`, `OTP_FALLBACK_VAR_KEY`,
`OTP_FALLBACK_TIMEOUT_MS`, and an **optional** auth header
(`OTP_FALLBACK_AUTH_HEADER` + `OTP_FALLBACK_TOKEN`) for providers that require one.
Leaving `OTP_FALLBACK_URL` empty disables failover. No provider name, endpoint, or
credential lives in this repository — concrete wiring is deployment-specific
(server `.env` only).

Hardening applied: immediate failover on a synchronously-known non-delivery (no
wasted ack wait); a final status recheck + best-effort `deleteForEveryone` recall
before failover to reduce duplicate OTPs; an abort timeout on the fallback HTTP
call; recipient JIDs without a phone form (`@lid`/`@g.us`) are rejected for the
template channel; and total delivery failure returns HTTP 502 (not a 200 with
`success:false`).

**Known limitations / follow-ups:** (1) reliable per-OTP confirmation assumes
**synchronous send mode** (`ENGINE_HOST=api`, `DURABLE_SEND` off) — in durable
mode the primary is only enqueued, so it fails over immediately. (2) The fallback
channel does **not** count against the per-profile cold cap / circuit, so OTP
volume is bounded only by the endpoint's auth + the provider's own limits; a
dedicated per-profile fallback quota is a possible follow-up. (3) A late-delivered
primary can still race the recall (at-least-once OTP delivery).

---

## 8. Testing & verification
- Unit: window classifier (in/out of window, no history), lane resolution,
  per-lane cap + warm-up math (extends the existing `effectiveDailyCap` cases).
- Integration: a cold send over cap → 429 while an in-window reply to the same
  profile still succeeds (the core guarantee).
- Live (reversible): confirm a reply and a cold send land on different counters.

## 9. Open questions
- OTP sub-policy defaults (dedicated budget size, ack timeout).
- Whether marketing should be off by default on recovering numbers.
