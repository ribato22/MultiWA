# Page Override: `/dashboard/profiles/[id]`

Inherits all rules from `../MASTER.md`. Below are deltas + page-specific behaviors.

## Purpose
Single profile detail + WhatsApp engine connect/disconnect + QR scan flow. The page where ops users link a new WhatsApp number, monitor session status, and recover after disconnects.

## Critical UX Issues Found (2026-05-25)
1. **Loading spinner not animating** — Tailwind `animate-spin` purged from production CSS. Fixed via inline `@keyframes mw-spin` fallback (deployed in source, awaits rebuild).
2. **No phone number guard** — engine `onReady` silently overwrote `profile.phoneNumber` with whatever WA account scanned. Fixed via server-side compare + disconnect + emit `connection:status` error. Frontend now needs visual treatment for this error toast.
3. **No mismatch UI** — when server emits `error` reason "Scanned number does not match...", the existing toast shows generic. Needs a dedicated `<Alert variant="destructive">` panel above the QR with explicit guidance.

## Page Layout
```
+--------------------------------------------------------------+
| Breadcrumb: Profiles / RIBATO                                |
+--------------------------------------------------------------+
| Hero Card                                                    |
|   Avatar (40px) | Display name + phone (Fira Code) | Badge   |
|   actions: [Refresh QR] [Disconnect] [Delete profile]        |
+--------------------------------------------------------------+
| Status Strip (only visible when not Connected)               |
|   3-step indicator: 1. Authenticate → 2. Scan QR → 3. Online |
+--------------------------------------------------------------+
| QR Area (only when Connecting & no QR yet)                   |
|   Centered: spinner (Lucide Loader2) + "Generating QR..."    |
|   Helper text: "Open WhatsApp → Linked Devices → Link"       |
|                                                              |
|   When qrCode received: render 256x256 QR + 2-minute timer   |
+--------------------------------------------------------------+
| Tabs: Details | Sessions | Webhooks | Activity Log           |
+--------------------------------------------------------------+
```

## Status Badge Variants
| Profile.status | Badge color | Badge text | Pulse |
|---|---|---|---|
| `connected` | `#22C55E/15` text `#22C55E` | Connected | No |
| `DISCONNECTED` / `disconnected` | `#64748B/20` text `#64748B` | Disconnected | No |
| `connecting` | `#F59E0B/15` text `#F59E0B` | Connecting... | Yes (2s ease-in-out infinite) |
| `error` | `#EF4444/15` text `#EF4444` | Error | No |

## QR Scan Flow States
1. **Idle (not connecting)** → CTA button "Connect WhatsApp" prominent (green-500). Show device card if previously linked: "Last connected: Yesterday 12:46 PM".
2. **Connecting (engine spinning up)** → Step indicator step 1 active. Skeleton-style QR placeholder with spinner.
3. **QR ready** → Render QR 256x256 + countdown "Expires in 1:42" (decrements). "Refresh" button below.
4. **Scanned (engine onReady)** → If phone matches → Step 3 active, badge `Connected`, fetch profile refresh. If phone mismatch → switch to **Error State** below.
5. **Error State (phone mismatch)** → red Alert above QR with text:
   > **Wrong WhatsApp account scanned.**
   > Profile expected `+62 822 8301 1108`, but scanned `+62 8111 0171 95`.
   > Disconnect this device on your phone (Settings → Linked Devices) and rescan with the correct number.
   - Single CTA: `Try again` (triggers reconnect cycle).

## Phone Number Display
- Use Fira Code (monospaced) for `+62 822 8301 1108` style with thin spaces between groups.
- Mask middle digits if user has `setting.showFullNumber=false` (future feature).

## Loading Spinner Implementation (CRITICAL)
**DO:** Inline `<style jsx>{` @keyframes mw-spin {...} `}</style>` next to the spinner element.
**DON'T:** Rely solely on Tailwind's `animate-spin` — it may be purged from production build.

```tsx
<svg
  className="w-12 h-12 mx-auto text-muted-foreground"
  style={{ animation: 'mw-spin 1s linear infinite', transformOrigin: 'center' }}
  fill="none" viewBox="0 0 24 24"
>
  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0..." />
</svg>
<style jsx>{`@keyframes mw-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`}</style>
```

## Real-Time Events Subscribed
- `qr:update { profileId, qrCode }` → render QR
- `connection:status { profileId, status, phone?, reason? }` → update badge + page state
- `message:ack { profileId, messageId, status }` → not used on detail page (chat page handles)

Note: backend room name is `profile:${profileId}`; frontend must `socket.emit('join', { profileId })` after connect.

## Edge Cases to Handle
- **Engine init failure** → emit `connection:status` with `status: 'error'`, `reason: '...'`. Show inline Alert + Retry button.
- **QR timeout** → engine emits new QR after ~2 min. UI shows countdown; on expire, auto-refresh placeholder.
- **Profile deleted while page open** → 404 from `GET /api/v1/accounts/.../profiles/{id}` → redirect to `/dashboard/profiles` with toast.
- **Slow QR generation** (engine cold start can take 15-30 s with Chromium boot) → keep spinner spinning, do not show "stuck" message before 30 s.
- **WebSocket disconnect mid-session** → small pill at top "Reconnecting…" with auto-retry; queue QR updates.

## Acceptance Criteria for Redesign
- [ ] Loading spinner visibly rotates 360° per second on production build (no Tailwind dependency).
- [ ] Phone mismatch shows red Alert with explicit numbers and recovery steps.
- [ ] Status badge color + pulse matches MASTER tokens exactly.
- [ ] QR area max-width 320px on mobile, centered, no horizontal scroll at 375px.
- [ ] Keyboard: Tab order = badge → connect/refresh → QR refresh → delete (with confirm dialog).
- [ ] `aria-busy="true"` on QR area while connecting; `aria-live="polite"` for status changes.
- [ ] Lighthouse contrast: all text ≥ 4.5:1 against background.
