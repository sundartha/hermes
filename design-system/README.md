# Hermes Design System

Visual design system for **Hermes** — an autonomous phone line for AI agents,
built by **Sundartha**. Hermes attaches to an AI assistant over the **Model
Context Protocol (MCP)** and answers/places real phone calls on the user's
behalf, always disclosing up front that an assistant is speaking.

The brand voice: *"Give your AI wings."* A deep-navy, Mount-Olympus hero in
Norse display type (falls back to a generic serif until the self-hosted Norse
webfont loads) sells the marketing site; a calm, light Space Grotesk app runs
the tenant dashboard; brand navy `#1b4f86` is the single action color across
both.

## Products / surfaces

1. **Marketing website** — public, dark navy hero chrome (`site/`). Full-bleed
   Olympus photo + drifting-cloud video, Norse display, white pill
   CTAs. Pages: hero, *How it works* (3 steps), *Pricing* (Starter €4.99 /
   Business €9.99).
2. **Tenant web app / dashboard** — logged-in light UI (`app/`). Overview KPIs,
   call history, agent permissions (the one write path), billing. Space
   Grotesk, white cards, brand-navy actions.
3. **MCP result cards** — rich cards a Hermes tool renders inside a host
   chatbot (`mcp/`). The live widgets (`src/ui/widgets/*`) are wired via
   MCP-UI (see `src/mcp-tools.js`); these design-system copies are static
   mockups for browsing the visual language, not the served markup.

## Sources

- **Codebase:** `web/` (Astro SSG + islands frontend). Canonical tokens live in
  `web/src/styles/tokens/{primitives,semantic,hero}.css`; component styles in
  `web/src/styles/{app,site}.css`; the hero is `web/src/pages/index.astro`;
  marketing copy in `web/src/pages/*.astro` + `web/src/lib/plans.js`; app islands
  in `web/src/components/app/*.astro`. Fonts in `web/public/assets/fonts/`.
- All tokens, copy, pricing, and the hero composition in this system are lifted
  verbatim from that codebase. Where this system mirrors a codebase file, the
  source path is named in a comment at the top of the file.

## Token provenance (avoid drift)

The token tree under `tokens/` is the canonical copy of
`web/src/styles/tokens/`. Light/app roles live on `:root`
(`tokens/primitives.css` + `tokens/semantic.css`); the dark/hero roles live under
`.on-dark` (`tokens/dark.css`) so light and dark specimens coexist in one
stylesheet. `_shared/tokens.css` now just `@import`s the root `styles.css`, so
there is a single source of truth. If the codebase tokens change, update
`tokens/`.

---

## CONTENT FUNDAMENTALS

**Voice.** Confident, plain, a little mythic. The hero is a three-word
imperative — *"Give your AI wings."* — set against the sky; everything else is
direct and unembellished. Marketing leans on one poetic line, then immediately
gets concrete ("The phone line for your AI agents").

**Person.** Second person, addressing the tenant directly — *"You decide what
your agent may do"*, *"Pick a number and plan"*. The product speaks about itself
in the third person — *"Hermes answers incoming calls…"*, *"Hermes makes the
calls"*. The agent's spoken disclosure is a first-person promise the UI surfaces
as *"Disclosure spoken first."*

**Casing.** Sentence case for all body copy, leads, and step text. The wordmark
`HERMES` is all-caps with wide tracking (`.22em`–`.3em`); the descriptor `by
Sundartha` is uppercase, smaller, wider still. UI eyebrows/labels and status
badges are UPPERCASE with `.12em` tracking. Headings are sentence case.

**Honesty as a value.** The copy refuses to overstate. Pricing notes that
self-service checkout *"is not faked here"*; MCP cards are explicitly labelled
*"Design mockup."* Billing reassures: *"nothing is charged without your
consent."* When the agent can't do something it says so ("could not reach").

**Tone examples (verbatim).**
- Hero: "Give your AI *wings*." / "The phone line for your AI agents."
- Footer chip: "Works with Claude & Gemini · Model Context Protocol"
- Step: "Hermes answers incoming calls and places outgoing ones on your behalf —
  and clearly states up front that an assistant is speaking."
- Billing: "You start your monthly subscription after signing in. Your card is
  charged only for the plan you choose."

**Punctuation.** Spaced middot ` · ` separates metadata (`Inbound · message
taken`, `Thu · 14:30`). Em dashes for asides. No exclamation points. Numbers and
currency use a leading symbol and a dot decimal (`€4.99`). Phone numbers shown
with country code.

**Emoji.** None. The brand uses no emoji anywhere — not in marketing, app, or
MCP cards. Iconography is the winged-sandal logo, a few stroke arrow glyphs, and
tinted status badges.

---

## VISUAL FOUNDATIONS

**Two worlds, one accent.** The system is deliberately bimodal:
- **Dark (marketing / `.on-dark`)** — navy gradient `radial-gradient(120% 90% at
  50% 0%, #1b4f86, #0f2d52 55%, #0a2245)`, Norse display + Space Grotesk UI,
  white pill CTAs, full-bleed Olympus imagery.
- **Light (app)** — `#fafafa` page, white cards, Space Grotesk throughout,
  brand-navy actions, near-black `#25282b` text.
- **Brand navy `#1b4f86`** is the one accent color across both worlds; status
  stays monochrome (navy for positive/info, ink for critical, gray for
  neutral — no red or green).

**Color.** Raw primitives → semantic roles only (components never touch hex).
Status pairs are tinted-surface + ink-text, deliberately monochrome (no red or
green): positive `#1b4f86`/`#eef3fa`, critical `#25282b`/`#ececec`, info
`#1b4f86`/`#eef3fa`, neutral `#7e7e7e`/`#f2f2f2`. A live indicator navy
`#1b4f86` vs idle gray `#c4c4c4`.

**Type.** Two families. *Norse* (400 + 700) — the runic display face for
headings and the wordmark; falls back to a generic serif until the
self-hosted Norse webfont loads, with `font-style: italic` applied directly to
whichever face is active for emphasis. Hero headline at `clamp(50px, 7.4vw,
98px)`. *Space Grotesk* (400–700) — dark-site UI, nav, prices, and the entire
light app plus all body copy. Heading weight is heavy (800) in the app; tight
`-0.015em` tracking on headings, wide `.12em` on labels.

**Spacing.** 4px base scale (`--space-1`..`--space-20`) aliased to intent
(`--space-card: 24px`, `--space-section: 80px`, `--space-gap: 20px`). Page
measure caps at 1180px.

**Corners & cards.** Generous radii: cards 18px (`--radius-card`), controls/
inputs 12px, badges/pills 99px, CTAs fully round (999px). A card is a *white
surface + 1px `#ececec` hairline border + soft shadow `0 6px 18px rgba(0,0,0,
.07)` + 24px padding*. No heavy borders, no colored left-accent stripes.

**Shadows.** Light world: one soft ambient card shadow. Dark world: layered,
cooler, navy-tinted shadows for pills (`0 10px 26px -12px rgba(7,18,40,.7)`) and
a `drop-shadow` on the logo — depth comes from elevation over imagery, not lines.

**Backgrounds & imagery.** Marketing is image-forward: a real Mount-Olympus
photograph (`olymp_3.jpg`) with a slow drifting-cloud video (`hermes_olymp.mp4`)
layered over a navy gradient fallback. Cool, atmospheric, blue-hour palette.
Legibility comes from **scrims** — a top band and bottom scrim
(`linear-gradient` of `rgba(8,22,48,…)`) plus per-element text-shadows — never
from a flat overlay. The app uses no photography; it's flat `#fafafa`/white.

**Motion.** Restrained. One easing — `cubic-bezier(0.22, 1, 0.36, 1)` — and one
duration, `0.22s`. Buttons/pills lift 1–2px on hover with a deepening shadow;
the switch knob slides; nav pills cross-fade background+text. A live dot can
pulse (`1.8s`). No bounces, no springy or decorative looping animation on
content.

**Hover / press.** Hover = darker fill (navy `#1b4f86`→`#0f2d52`), lighter
ghost (gray-75→gray-100), or `opacity .7` on dark nav links; pill CTAs
translate up. Active nav pill inverts to a solid navy fill. Inputs turn their
border navy on focus. No shrink-on-press.

**Transparency & blur.** Reserved for the dark world: white text at 70–96%
opacity for hierarchy; nav/brand text-shadows; scrims in low-alpha navy. No
backdrop blur. The light app is fully opaque.

**Layout rules.** Marketing nav is absolutely positioned and transparent over
the hero (left brand lockup, center links, right log-in + pill). The app header
is sticky white with a hairline. Dashboards are a centered 1180px column; KPI
tiles in a 4-up grid; secondary panels in a 2-up grid that collapses to one
column under 720px.

---

## ICONOGRAPHY

Hermes is **icon-light by design** — there is no icon font and almost no icon set
in the codebase.

- **Wing mark (the constant element).** The single feathered wing of Hermes,
  after the winged messenger — the system's recurring brand element. Two forms:
  - **WingMark** (`components/brand/`, `assets/logos/hermes-wing.png`, embedded
    as a data URI for portability) — a lightweight, CSS-only wing for static
    logo spots (nav, lockup, avatars). Default IDLE state is a perpetual,
    low-amplitude hover. Also takes `status` for cheap CSS approximations.
  - **LiveWing** (`components/brand/`, driven by `wing-engine.js`) — the REAL
    lab animation: a deformable Pixi mesh (16×24) ported verbatim from
    `apps/hermes-animation-lab` (`deform.ts` / `HermesWing.ts` / `status.ts` /
    `presets.ts`). Articulates every feather — flap, bend, tip-lag, lift —
    through the MCP call lifecycle: `idle` · `connecting` (two cautious beats) ·
    `working` (carried flight) · `success` (elastic upward snap) · `error`
    (stutter, then droop). `wing-engine.js` lazy-loads pixi.js v8 + GSAP from a
    CDN. Use LiveWing where the motion is the point — the chat status beacon —
    not for tiny logos. Both honour `prefers-reduced-motion`.
  - **`wing-canvas-engine.js`** (`components/brand/`, mirrored byte-identically
    to `src/ui/wing-canvas-engine.js`) — the same feather physics/choreography
    as LiveWing, ported to a self-contained Canvas2D triangle mesh instead of
    Pixi. Built so it can be injected as ONE `<script>` into an MCP widget
    iframe with zero network access (no CDN, no `@import`, no second file) —
    the constraint that ruled out `wing-engine.js`/Pixi for widgets in the
    first place (widget iframes cannot reliably load a third-party CDN
    script). The two engines therefore intentionally duplicate the
    media-independent core (geometry/gain constants, `smoothstep`/
    `buildWeights`/`deform`, `restState`, the preset and status
    choreographies) rather than sharing a module — there is no ESM/build step
    either engine can lean on without breaking its single-script contract.
    `wing-engine.js` keeps serving the higher-fidelity Pixi previews in
    `design-system/mcp/*` and `live.card.html`; `wing-canvas-engine.js` is the
    CDN-free variant meant for real widget consumption once H3/H4 wires it
    into `src/ui/widgets/*.html`. **Whoever changes the shared physics/
    choreography in one file must mirror the change in the other** (no
    automated sync test covers this subset, only the byte-identity test
    between the two `wing-canvas-engine.js` copies).
- **Logo / brand mark.** The winged sandal of Hermes, a white PNG
  (`assets/logos/sandal_solid.png`) used on the dark hero with a soft
  drop-shadow. The Sundartha company mark is a small red rounded-square SVG
  (`assets/logos/favicon.svg`).
- **Arrows.** The only repeated UI icon is a stroked right-arrow
  (`M5 12h13 / M12 5l7 7-7 7`, 2.4–2.5px stroke, round caps) inside "Get
  started" CTAs and the chat composer send button. Inline SVG, `currentColor` or
  `#10305a` on white pills.
- **Call direction.** Unicode arrow glyphs — `↘` inbound (info-blue tint), `↗`
  outbound (critical/ink tint) — set in tinted round chips, mirroring the
  codebase's `render.js`.
- **Status.** Conveyed by tinted **StatusBadge** pills + a checkmark, not icons.
- **Emoji.** Never used.

**Substitution note:** no third-party icon library (Lucide/Heroicons/etc.) is
used in the source, so this system ships none. If a future surface needs a
broader icon set, add one and document it here — do not hand-roll one-off SVGs.

---

## INDEX / MANIFEST

Root:
- `styles.css` — global entry; `@import`s the token tree only. **Consumers link
  this.**
- `tokens/` — `fonts.css` (@font-face: Norse + Norse Bold, Space Grotesk, both
  self-hosted), `primitives.css` (`:root` raw), `semantic.css` (`:root` roles),
  `dark.css` (`.on-dark` hero roles).
- `assets/` — `logos/` (winged sandal PNG, Sundartha SVG), `imagery/`
  (Olympus photo + cloud video), `fonts/` (self-hosted woff2).
- `_shared/` — `preview.css` (specimen + mirrored component classes for the HTML
  cards); `hud-card.css` (the shared Olympus-HUD card chrome for the 4
  read-only MCP kit cards below, mirrors `src/ui/hud-card-css.js` — one
  source instead of 4x the same block); `tokens.css` (re-exports
  `styles.css`, kept for back-compat).
- `SKILL.md` — Agent-Skills front matter for download into Claude Code.

Components (`window.HermesDesignSystem_738510.*`):
- `components/brand/` — **WingMark** (CSS idle wing, the constant brand element),
  **LiveWing** (the real Pixi mesh-deform wing; needs `wing-engine.js`) and
  `wing-canvas-engine.js` (the CDN-free Canvas2D twin for widget iframes, see
  ICONOGRAPHY above).
- `components/core/` — **Button** (primary/ghost, sizes), **Card** (titled
  surface), **PillCTA** (white CTA, on dark).
- `components/feedback/` — **StatusBadge** (6 tones), **LiveDot**, **Stat** (KPI
  tile).
- `components/forms/` — **Field** (labelled input, navy focus), **Switch** (brand
  toggle).
  Each has `<Name>.jsx` + `<Name>.d.ts` + `<Name>.prompt.md`, with one
  bundle-mounting `@dsCard` per directory.

Brand cards (`components/brand/`): `brand.card.html` — the idle WingMark + the
HERMES by Sundartha lockup; `live.card.html` — the LiveWing through all five
call states, on demand.

Foundation cards (`foundation/`): `colors.html`, `typography.html`,
`spacing-radii-shadows.html`, `brand.html`.

UI kits:
- `site/index.html` — interactive marketing site (hero → how-it-works →
  pricing). Starting point.
- `app/index.html` — interactive tenant dashboard (login → overview / calls /
  settings / billing), composing the bundle components. Starting point.
- `mcp/` — `index.html` (result card in a chatbot), `wing-status.html`
  (concept showcase, Pixi/CDN — not the production path), `call.html` (unified
  call card across its 5 lifecycle states, mirrors `src/ui/widgets/call.html`),
  `agent-status.html`, `my-number.html`, `calls.html`, `calendar.html` (the 4
  read-only cards, mirror `src/ui/widgets/*`). **Design only.**

The Design System tab renders every `@dsCard`-tagged HTML, grouped by `group`.
