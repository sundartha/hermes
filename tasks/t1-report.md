# Phase T1 — Design-Token-Alignment (5 Widgets)

- **Gate:** PASS (dualer Review: Safety APPROVED + Clean-Code keine S1/S2)
- **finalBranch:** `phase/widget-branding-t1`
- **headCommit:** `87a601935a05a289c460f369dab0961eef4c9b07`
- **Tests:** 1471 pass / 0 fail
- **Fix-Runden:** 0 (kein Review-Blocker)

---

## Plan (gekuerzt)

Gegroundet gegen die echten Dateien (nicht gegen `design-system/README.md`): Werte 1:1 aus
`apps/web/src/styles/tokens/primitives.css` + `semantic.css` sowie aus
`design-system/components/core/Button.jsx` (Ghost-Variante) und
`design-system/_shared/preview.css` (`.btn`/`.btn--ghost`) abgeleitet.

**Zwei bewusst aufgeloeste Abweichungen von der Chain-Doc-Prosa** (vor Impl benannt, nicht
nachtraeglich entschieden):

1. **Ghost-Button hat KEINEN Rahmen.** Chain-Doc-Prosa sagt "weisser Grund,
   `--color-gray-150`-Rahmen"; der echte Code (`Button.jsx` ghost, gespiegelt in
   `.btn--ghost`) hat **keinen** Rahmen (`border:0`), sondern eine getoente Flaeche
   (`--color-gray-75` idle, `--color-gray-100` Hover, Text `--color-ink-900`). Echter,
   gegroundeter Wert uebernommen statt Prosa-Vermutung.
2. **Buttons nutzen `--radius-card` (18px), nicht `--radius-control` (12px).** `Button.jsx`
   und `Card.jsx` setzen ueberall `--radius-card`; `--radius-control` wird repo-weit nur fuer
   Inputs/kleine Kacheln genutzt (per `grep` verifiziert) und hat in keinem der 5 Widgets
   einen Konsumenten -> bewusst weggelassen (G12, kein totes Custom-Property).

**Gemeinsames Muster (alle 5 Dateien):**

- Falscher Kommentar ("Subset aus `design-system/_shared/tokens.css`, Werte identisch") wird
  korrigiert auf die tatsaechliche kanonische Quelle (`apps/web/src/styles/tokens/{primitives,
  semantic}.css`) — ohne die verbotenen Substrings `@import`/`<link`/`href=` (AC6/Testgate).
- `.card`: `--radius-md`(12px) -> `--radius-card`(18px) + neu `box-shadow:var(--shadow-card)`.
- `.dot` (agent-status/my-number/calls/calendar): `--color-green-500` -> `--color-navy-700`
  (gegroundet gegen `LiveDot.jsx`: "Navy when live"); `50%`-Radius bleibt unveraendert
  (selbsterklaerender geometrischer Wert, analog G25-Ausnahme).

**call.html (einziges File mit Button + dynamischen Status-Zeilen):**

- `:root` voller Ersatz: `--color-red-600`/`--color-green-500` raus; neu `--color-navy-700`
  (`#1b4f86`), `--color-navy-50` (`#eef3fa`), `--color-gray-75`/`-100` (Ghost-Button-Flaechen),
  `--radius-card`(18px), `--radius-pill`(99px), `--shadow-card`, Font-Stack auf
  `"Space Grotesk",...` (kanonischer `--font-sans`).
- `.badge`: statisches Gruen -> Navy-Pill (`background:navy-50`, `color:navy-700`,
  `border-radius:pill`, `font-weight:600` gegen `StatusBadge.jsx` gegroundet).
- NEU, additiv per Attribut-Selektor auf bestehende `data-mcp`-Werte (keine Markup-/Skript-
  Aenderung): `.line[data-row="summary"|"objective"]` -> Navy-Pill (positiv),
  `.line[data-row="failure"]` -> Gray-Pill (kritisch). Bewusst ohne
  `text-transform:uppercase` (freie Saetze statt kurzer Keywords, Lesbarkeit vor Regel-Treue).
- `.cancel` (Ghost-Button) 1:1 gegen `Button.jsx` gegroundet: `background:gray-75`,
  `:hover{background:gray-100}`, `color:ink-900`, `border:0`, `border-radius:card`,
  `font-weight:600`, `:disabled{opacity:.6}`. Padding/font-size (`8px/12px`, `13px`) bewusst
  NICHT auf `Button.jsx`-Groessen-Presets umgestellt (Footer-Kontext, minimaler Diff,
  visuell nicht unterscheidbar) — dokumentierte Annaeherung, keine 1:1-Groessen-Kopie.

**agent-status.html, my-number.html, calendar.html:** identischer `:root`-Ersatz (Navy statt
Rot/Gruen, `radius-card`, `shadow-card`, Space-Grotesk-Font), nur `.card`/`.dot` betroffen.
Kein `--radius-pill`/`--color-navy-50`/`--color-gray-75` eingefuegt (keiner haette einen
Konsumenten, G12).

**calls.html:** gleicher `:root`-Block wie oben, plus `.cell[data-field="status"]`:
`--color-green-500` -> `--color-navy-700`. Kein Pill/Tint (kein struktureller Gut/Schlecht-Hook
je Zeile, freier Statustext) — einfacher Navy-Swap statt erfundener Praezision.

**AC (deterministisch):** kein `color-red-600`/`color-green-500`-Treffer mehr in
`src/ui/widgets/`; `--color-navy-700`+`--shadow-card` in allen 5 `:root`-Bloecken; `.card`
nutzt 18px; bestehende Tests (`mcp-ui-w1-bind`, `mcp-ui-w1-call-widget`, `mcp-ui`, P5-Token-
Sync) bleiben gruen ohne Aenderung (reiner Style-Refactor, kein neuer Test noetig,
Clean-Code P11 als Ausnahme); Sicht-Check gegen `design-system/mcp/call-status.html`.

Kein `node --check` notwendig (reine HTML/CSS-Dateien).

---

## Impl-Zusammenfassung

Alle 5 Widget-HTMLs in `src/ui/widgets/` (`call.html`, `agent-status.html`, `my-number.html`,
`calls.html`, `calendar.html`) exakt gemaess Plan auf die echten kanonischen Tokens aus
`apps/web/src/styles/tokens/{primitives,semantic}.css` umgestellt:

- `--radius-md`(12px) -> `--radius-card`(18px), neuer `--shadow-card` auf `.card`.
- `--color-red-600`/`--color-green-500` komplett entfernt, ersetzt durch `--color-navy-700`
  (+ `--color-navy-50` fuer Tint-Flaechen in `call.html`).
- Ghost-Cancel-Button in `call.html` 1:1 gegen `Button.jsx`/`.btn--ghost` gegroundet: kein
  Rahmen, `gray-75`-Flaeche/`gray-100`-Hover statt der urspruenglichen Rot-Fuellung,
  `radius-card` statt `radius-md`, `font-weight:600`, `opacity:.6` bei disabled.
- `call.html` zusaetzlich zwei rein additive Attribut-Selektor-Regeln fuer die bestehenden
  `data-row="summary"/"objective"/"failure"`-Zeilen (Navy-Pill bei positiv, Gray-Pill bei
  Fehler) + Pill-Badge-Stil fuer `.badge`.
- `calls.html`: `.cell[data-field="status"]` auf Navy umgestellt.
- Irrefuehrender "Subset aus `design-system/_shared/tokens.css`"-Kommentar in allen 5 Dateien
  auf die tatsaechliche Quelle korrigiert (ohne verbotene Substrings).

Reiner Style-Diff: `data-mcp`-Slots, `data-row`/`data-cancel`-Selektoren und der komplette
`<script>`-Block in `call.html` sind byte-identisch zu `master` (per diff verifiziert —
Extraktion ab `</style>` bis Dateiende ergab 0 Zeilen Unterschied fuer alle 5 Dateien).

Verifikation:

- `nodeCheckPass`: true (nicht erforderlich, aber n.a. — reine HTML/CSS)
- `testsPass`: true — 1471 pass / 0 fail (json-Backend + pglite in derselben Suite)
- `smokePass`: true (Datei-Inhalt aller 5 Widgets nach Edit gelesen, diff gegen master nur im
  `<style>`-Bereich, Markup/Script byte-identisch)
- `committed`: true (`87a6019`, Branch `phase/widget-branding-t1`)

Dateien editiert:

- `src/ui/widgets/call.html`
- `src/ui/widgets/agent-status.html`
- `src/ui/widgets/my-number.html`
- `src/ui/widgets/calls.html`
- `src/ui/widgets/calendar.html`

Dateien neu: keine. Tests hinzugefuegt/geaendert: keine.

**Deviations:**

- Keine Test-Datei geaendert/hinzugefuegt: reiner CSS/Token-Refactor ohne `data-mcp`/
  `data-row`/Skript-Aenderung -> Bestandssuite bleibt gruen ohne Test-Anpassung
  (Plan-Abschnitt 6 Punkt 5, Clean-Code P11 ausdruecklich als Ausnahme benannt).
- Keine neue npm-Dependency, kein neuer `node_modules`-Eintrag ausser dem lokalen Symlink
  (nicht committet, gitignored).

Visual-Check-Note: kein Browser-Rendering in dieser Umgebung verfuegbar; Sicht-Check erfolgte
textuell gegen `design-system/mcp/call-status.html` (Mockup) + `preview.css`
(`.mcp-card`/`.status-badge`) + `Button.jsx` (Ghost-Variante): Farbwerte
(`--color-navy-700:#1b4f86`), Radius (18px) und Schatten (`0 6px 18px rgba(0,0,0,.07)`)
stimmen exakt mit den neu gesetzten Widget-Werten ueberein.

---

## Safety-Urteil

**APPROVED.**

- `testsPassIndependently`: true — frischer Worktree (node_modules-Symlink, Branch
  `review-t1` von `phase/widget-branding-t1`): 1471 pass, 0 fail, 0 skipped, ~58s. Beide
  Store-Backends (json + pg via pglite) in derselben Suite abgedeckt.
- `safetyGatesIntact` / `disclosureIntact` / `authFailClosedIntact` / `noSecretsLeaked` /
  `scopeRespected` / `behaviorAsIntended`: alle true.
- `concerns`: keine. `blockers`: keine.

Begruendung: Branch `phase/widget-branding-t1` ist genau 1 Commit (`87a6019`) vor `master`,
merge-base = `master` HEAD (sauberer FF-Zweig). `git diff --stat` zeigt ausschliesslich 5
Dateien: `src/ui/widgets/{agent-status,calendar,call,calls,my-number}.html` (68
Insertions/35 Deletions), 0 Test-Dateien, kein `package.json`/`package-lock`-Diff, keine
neuen npm-Dependencies. Verboten-Liste bestaetigt nicht beruehrt: `src/mcp-tools.js`,
`src/server.js`, `src/claude.js`, `src/bridge.js` kommen im Diff nicht vor (grep leer). Fuer
jede der 5 Dateien per diff verifiziert: Aenderung ausschliesslich im `<style>`-Block; alles
ab `</style>` (Markup inkl. aller `data-mcp`-Slots, `data-row`-Attribute, Inline-`<script>`)
Byte-fuer-Byte identisch zu `master` (awk-Extraktion + diff, exit=0 fuer alle 5 Dateien). Die
neuen CSS-Selektoren in `call.html` referenzieren existierende Markup-Attribute, keine toten
Selektoren. Neue Token-Werte 1:1 aus `apps/web/src/styles/tokens/{primitives,semantic}.css`
uebernommen (navy-700=`#1b4f86`, navy-50=`#eef3fa`, radius-lg/radius-card=18px,
shadow-soft/shadow-card=`rgba(0,0,0,.07)`, radius-pill=99px, font-sans=Space Grotesk) —
Kommentar-Behauptung "kanonische Quelle" stimmt nachweislich. Keine Secrets im Diff. Safety-
Gates, Disclosure, Auth-Fail-Closed unberuehrt, da die betroffenen Dateien reine, ungeloggte,
keine Calls/SMS/Auth ausloesende Widget-HTML sind. Scope exakt wie in T1 gefordert: reines
Widget-Branding (Navy statt Rot/Gruen), keine Extras.

---

## Clean-Code-Audit

**Verdict: PASS** — keine S1/S2-Blocker.

- **S1:** keine
- **S2:** keine
- **S3:**
  - G16/G25 (Magic Numbers, PASS mit Begruendung) — Hex-/px-/rgba-Werte im `:root`-Block sind
    bewusst Inline-Kopien (Iframe-Sandbox-Zwang, kein `@import` moeglich); 1:1 gegen
    `primitives.css`+`semantic.css` verifiziert (navy-700 `#1b4f86`, navy-50 `#eef3fa`,
    radius-card=radius-lg=18px, shadow-card=shadow-soft, Space-Grotesk-Stack, gray-75/-100) —
    kein erfundener Wert, nur zur Doku festgehalten, keine Flag.
  - `call.html` `.cancel`: Padding (`--space-2 --space-3`=8px/12px) und `font-size:13px`
    wurden von T1 nicht angefasst und decken sich nicht exakt mit `Button.jsx`-Ghost-Groessen
    (sm 8px/14px bzw. md 20px/16px); reine Sizing-Differenz, Farbe/Radius/Weight/Hover/
    Disabled-Opacity stimmen exakt; vorbestehend/unveraendert, kein Fix-Zwang in dieser Phase.
- **S4:**
  - Derselbe 4-zeilige Token-Subset-Block ist wortgleich in allen 5 Widget-Dateien
    dupliziert — vorbestehendes, code-begruendetes Muster (self-contained Iframe, kein
    Build-Step, kein `@import`); T1 hat es nur konsistent nachgezogen, nicht neu eingefuehrt.
    Kein Blocker, strukturelle Beobachtung fuer Folgephasen.
  - `scripts/check-token-sync.js` prueft Hash-Drift nur zwischen `primitives`/`semantic`/
    `hero.css` und ihrer `design-system/tokens`-Kopie sowie `@import`-/`@dsCard`-Invarianten,
    NICHT die in `src/ui/widgets/*.html` eingebetteten Werte selbst gegen die kanonische
    Quelle. Kuenftiger Value-Change in `primitives.css` koennte in den Widgets lautlos
    driften, ohne dass das Gate es meldet. Kein T1-Fehler, lohnender Folge-Scope.

Pass-Notes: alle 5 geaenderten Werte-Sets stimmen byte-genau mit der kanonischen Quelle
ueberein; Status-Rollen semantisch korrekt (`data-row="summary"/"objective"` = navy-50/-700
entspricht `--color-status-positive`/`-info`, `data-row="failure"` = gray-150/ink-900
entspricht `--color-status-critical`) — sauber aus `semantic.css` uebernommen, nicht erfunden.
Cancel-Button exakt gegen `Button.jsx`-Ghost gegroundet. Kein `@import`, kein leftover
Rot/Gruen (grep-verifiziert), `@dsCard`-Marker/Slot-Struktur unangetastet. Testlauf auf dem
echten Phase-Branch (`87a6019`): `npm test` 1471/1471 gruen, `node scripts/check-token-sync.js`
OK.

Top-Todos (kein Handlungsbedarf fuer Merge, 0 S1/S2):

- Optional/Follow-up: `check-token-sync.js` erweitern, damit es auch die in
  `src/ui/widgets/*.html` eingebetteten Token-Werte gegen die kanonische Quelle hasht
  (verhindert stillen Drift bei kuenftigen Rebrand-Aenderungen).
- Optional/kosmetisch: `.cancel`-Padding/`font-size` (8px/12px, 13px, unveraendert von T1) an
  `Button.jsx`-Ghost-Groessen (sm 8px/14px) angleichen, falls volle 1:1-Deckung gewuenscht ist.

---

## Fix-Runden

0 (keine Selbst-Behebung, kein Review-Blocker). Dualer Review direkt Gate=PASS, nur 2
kosmetische S3/S4-Nits, keiner blockierend.
