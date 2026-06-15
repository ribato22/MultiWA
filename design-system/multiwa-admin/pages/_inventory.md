# MultiWA Admin — Page Inventory & Redesign Roadmap

> Source-verified from `apps/admin/src/app/dashboard/**/page.tsx` (18 pages).
> Per-page design overrides live next to this file. Each page file is a delta on top of `../MASTER.md`.

## Priority Tiers

### Tier A — Anchor pages (redesign first, validate design system on real data)
1. **`/dashboard` (Overview)** — entry point, must impress on first 5 seconds.
2. **`/dashboard/profiles/[id]` (Profile Detail / QR Connect)** — most critical broken UX right now.
3. **`/dashboard/chat`** — daily-driver page, highest traffic.

### Tier B — Operational pages (frequent ops use)
4. **`/dashboard/profiles`** (list)
5. **`/dashboard/profiles/new`** (create)
6. **`/dashboard/messages`** (history + search)
7. **`/dashboard/broadcast`**
8. **`/dashboard/contacts`**
9. **`/dashboard/templates`**

### Tier C — Automation & integration (configuration-heavy)
10. **`/dashboard/automation`** (flow list)
11. **`/dashboard/automation/builder`** (drag-and-drop canvas — highest visual stakes)
12. **`/dashboard/webhooks`**
13. **`/dashboard/integrations`**
14. **`/dashboard/knowledge`**

### Tier D — Settings & admin (less-frequent, can be utilitarian)
15. **`/dashboard/analytics`**
16. **`/dashboard/api-keys`**
17. **`/dashboard/audit`**
18. **`/dashboard/settings`**

## Cross-Cutting Concerns

Apply uniformly across all pages:

- **App shell:** sidebar (collapsible) + header (org switcher, profile dropdown, notification bell) + content area `max-w-7xl` mx-auto.
- **Empty states:** centered Lucide icon 48px + heading + 1-sentence description + primary CTA. NO emojis.
- **Loading states:** Skeleton screens for list/grid layouts (prefer over spinners). Spinners only for transient actions with inline keyframes fallback per Master.
- **Error states:** Inline alert with `bg-#EF4444/15 border-#EF4444/30 text-#EF4444`, icon, message, recovery action.
- **Toast notifications:** top-right, max 3 stacked, dismiss on click + auto 5s.
- **Keyboard shortcuts:** `Cmd/Ctrl+K` for command palette (multi-session goal, not session 1).
- **Real-time updates:** WebSocket subscription per page where applicable; visible "connected"/"reconnecting" pill.

## Multi-Session Roadmap

| Session | Scope | Estimated effort |
|---|---|---|
| **S1** (this) | Design system + tokens (Stitch + skill) + page inventory + Profile Detail anchor + quick bug fixes deploy | 1.5 h done, 30 min waiting on network |
| **S2** | Tier A complete: Overview, Profile Detail polish, Chat redesign | 3 h |
| **S3** | Tier B: profiles list, profile new, messages, broadcast, contacts, templates | 3-4 h |
| **S4** | Tier C: automation list, builder canvas, webhooks, integrations, knowledge | 3-4 h |
| **S5** | Tier D: analytics, api-keys, audit, settings + polish pass + accessibility audit | 2-3 h |
| **S6** | App shell finalize: sidebar component, header, command palette, dark/light toggle | 2 h |

Total estimate: **15-18 hours** across 6 sessions for full overhaul.

## Deployment Strategy (per user decision)

- Edit local → `scp via jump host` → server `/opt/multiwa/apps/admin/src/...` → `docker compose build admin` → `docker compose up -d --no-deps --force-recreate admin`
- Skip git commit (live experimentation). Operator decides later when changes are stable enough to backport to public main.
- Per-page deploys are independent; safe to ship 1-2 pages per session.
- Rollback: `multiwa-admin:pre-rebuild-20260524T112007Z` still tagged on server (safety net for entire admin app).
