---
name: hermes-design
description: Use this skill to generate well-branded interfaces and assets for Hermes (by Sundartha) — an autonomous phone line for AI agents over MCP — for production or for throwaway prototypes/mocks. Contains brand guidelines, color/type/spacing tokens, self-hosted fonts, logo assets, reusable React components, and full UI kits (marketing site, tenant dashboard, MCP cards).
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick map

- `styles.css` — link this one file to get every token + webfont.
- `tokens/` — `primitives.css` (raw), `semantic.css` (`:root` light/app roles),
  `dark.css` (`.on-dark` navy hero roles), `fonts.css` (Instrument Serif + Space
  Grotesk self-hosted; Inter via Google Fonts).
- `assets/` — `logos/` (winged-sandal PNG, Sundartha SVG), `imagery/` (Mount
  Olympus photo + drifting-cloud video), `fonts/` (woff2).
- `components/{core,feedback,forms}/` — React primitives. Bundle global is
  `window.HermesDesignSystem_738510`. Use `<Name>.prompt.md` for usage.
- `site/`, `app/`, `mcp/` — full UI kits (marketing, dashboard, MCP cards).

## The 30-second brand

- Two worlds: **dark navy marketing** (Instrument Serif display, Space Grotesk,
  white pill CTAs, full-bleed Olympus imagery, scrims for legibility) and **light
  app** (Inter, white cards, `#fafafa` page). **Brand red `#e60000`** is the one
  action color in both.
- Cards: white, 1px `#ececec` hairline, 18px radius, soft `0 6px 18px
  rgba(0,0,0,.07)` shadow, 24px padding. Pills/badges fully rounded.
- Voice: confident, plain, honest; second person to the user, third person about
  "Hermes". Sentence case copy; UPPERCASE wide-tracked labels. **No emoji.**
- Motion: one easing `cubic-bezier(0.22,1,0.36,1)`, ~0.22s; hover lifts 1–2px /
  darkens fill. No bounce.

When building marketing surfaces, wrap them in `.on-dark` to pick up the navy
hero tokens. When building app surfaces, use the `:root` defaults. Compose the
existing components instead of re-implementing them.
