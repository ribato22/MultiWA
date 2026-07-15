# Landing Page — Astryx Multi-Theme Showcase

> Overrides [MASTER.md](../multiwa-admin/MASTER.md) for the marketing landing at `/`.

## Layout

- Hero-centric flow with theme gallery, feature bento, component playground, pricing, FAQ, and CTA banner.
- Max content width: 72rem (`landing-section`), 80rem for header/footer.
- Mobile-first; theme picker collapses to `<select>` below 1024px.

## Theming

- Official `@astryxdesign/core` with all 7 theme packages (neutral, butter, chocolate, matcha, stone, gothic, y2k).
- Live switch via `Theme` provider; persisted to `localStorage` and `?theme=` URL param.
- Dashboard retains local `ui/` components and Tailwind dark mode.

## Accessibility

- Theme swatches: min 44×44px touch targets, `aria-pressed`, descriptive labels.
- Heading hierarchy h1 → h2 → h3; FAQ uses `CollapsibleGroup`.
- `prefers-reduced-motion`: instant transitions on `.landing-root`.

## Motion

- Theme border/shadow transitions: 200ms ease.
- No decorative-only animation; one pulse removed in favor of static badge.
