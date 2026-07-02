# H2 — Wing-Canvas-Engine produktisieren — Report

## Ergebnis

Gate: implementiert exakt gemaess Plan, 2 dokumentierte Abweichungen (siehe unten), 1501/1501 Tests gruen (1493 Baseline + 8 neu: 3 Sync/No-Network/Size + 3 Injektion + 2 Dark-Dedup).

## Umgesetzt

1. **`design-system/components/brand/wing-canvas-engine.js`** (neu, 25294 Bytes = ~24,7KB, unter dem 25KB-Budget mit ~306 Bytes Marge): Portierung des H0-Spikes (`h0-engine.js`, 20153 Bytes) zu einer Canvas2D-Dreiecksnetz-Engine. Ported 1:1: Geometrie/Gains-Konstanten, `smoothstep`/`buildWeights`/`deform`, `restState`/`REST_CHANNELS`, Easings (`powerEase`/`sineEase`/`elasticOut`/`parseEase`), Mini-Timeline-Runtime (`Timeline` + Prototyp, `timeline()`), Presets (`classicCycle`/`olympianCycle`), Status-Timelines (`buildIdle`/`buildConnecting`/`buildSuccess`/`buildError`), Triangle-Mapping (`pushOut`/`drawTriangle`). NICHT portiert (kein Aufrufer, G9): `renderOnce`, `onFps`, `setPreset`, `status`-Getter — Handle-API ist exakt `{setStatus, destroy}`.
   - Neue H2-Produktionskonstanten: `HERMES_GOLD`, `GOLD_ENABLED=false`, `GOLD_STRENGTH`, `GOLD_PULSE_GAIN`, `GOLD_RGB` (berechnet via `hexToRgb`, kein Literal), `FPS_CAP_DEFAULT=30`, `GRID_FINE={16,24}`, `GRID_COARSE={8,12}`, `COARSE_MAX_SIZE_PX=96`, `DPR_CAP=2`, `DEFAULT_SIZE_PX=112`, `DEFAULT_STATUS`, `DEFAULT_PRESET`, `WORKING_LOOP_PAUSE_SEC=0.12`, `TAB_SWITCH_DT_CAP_SEC=0.1`, `INTERSECTION_THRESHOLD=0.02`, `TERMINAL_WING_STATUSES`.
   - Neue Funktionen: `hexToRgb`, `defaultGrid(size)`, `buildDeformContext(img, grid)` (ausgelagert aus `mount()`, G30/G34), `goldTintAlpha(state)`.
   - `mount(host, opts)`: sofortige Canvas-Dimensionierung (kein Jank vor Bild-Load), Bild-Load-Wiring (`img.onload` baut `dctx`), Frame-Cap-Akkumulator (`frameBudgetSec`), Terminal-Stop bei success/error (`TERMINAL_WING_STATUSES`), Visibility-Gating (`IntersectionObserver` + `visibilitychange`), reduced-motion-Fallback (statische Ruhepose, KEINE rAF-Schleife), optionaler Gold-Post-Tint (`applyGoldTint`, `source-atop`-Compositing, ein `fillRect` nach den Dreiecken).
   - `opts.preset` (`"classic"`|`"olympian"`, Default `classic`) macht `olympianCycle` erreichbar, ohne dass H2 selbst einen Konsumenten braucht (Plan §0).
   - `opts.gold` (Instanz-Ebene) mit `effectiveGold = GOLD_ENABLED && !!opts.gold` — solange `GOLD_ENABLED=false` (Owner-Gate, Quell-Ebene), wirkungslos, also fail-closed/Default-AUS.
2. **`src/ui/wing-canvas-engine.js`** (neu): exakte Byte-Kopie (`cp`), Sync-Test verifiziert.
3. **`src/ui/wing-markup.js`**: 4 neue Exporte `WING_CSS_DARK_STATIC`/`WING_CSS_DARK_LIVE`/`WING_MARKUP_DARK_STATIC`/`WING_MARKUP_DARK_LIVE` additiv; `wingSpan` auf Options-Objekt (`{dark, live}`) refaktoriert, bestehende 4 Exporte byte-identisch (per Test verifiziert, `T-wing-dedup-output-*`/`T-wing-dedup-variants` weiterhin gruen).
4. **`src/ui/widget-catalog.js`**: `withWingEngine(html)` (exportiert) fuegt die Engine an ihrem Platzhalter (`<!--__WING_ENGINE__-->`) ein, defensiv NICHT angehaengt falls fehlend (heute alle 5 Widgets — H3/H4 fuehren den Platzhalter erst ein). `WIDGET_DEFS` unveraendert (kein neues Widget, keine geaenderten `wing`-Zuordnungen).
5. Tests: `test/mcp-ui-wing-canvas-sync.test.js` (neu, 3 Tests: Byte-Sync, No-Network, Groessenbudget), `test/mcp-ui-wing-canvas-injection.test.js` (neu, 3 Tests: Injektion via synthetisches Fixture, P13), `test/mcp-ui-wing-dedup.test.js` (additiv, +2 Tests fuer die dark-Varianten).

## Verifikation (Kommandos aus Plan §6)

- `node --check` auf allen 7 betroffenen/neuen Dateien: alle OK.
- `grep -nE "https?://"` + `grep -n "@import"` auf beiden Engine-Kopien: leer (kein Match) — self-contained bestaetigt.
- `diff design-system/.../wing-canvas-engine.js src/ui/wing-canvas-engine.js`: leer (byte-identisch).
- `wc -c design-system/.../wing-canvas-engine.js`: 25294 Bytes (<= 25600 Budget).
- `git diff master -- src/ui/widget-bind.js`: leer (bindByteIdentical bestaetigt).
- `npm test`: **1501/1501 gruen, 0 fail** (1493 Baseline + 8 neu).
- Verboten laut Auftrag geblieben unangetastet: `src/server.js`, `src/mcp-tools.js`, `src/claude.js`, `src/bridge.js`, `src/ui/widgets/*.html`, `apps/hermes-animation-lab/` — `git diff --stat master` auf diesen Pfaden ist leer.

## H0-Bezug (Perf, Report-Pflicht laut Chain)

H0-Messwerte (aus Spike-Benchmark, kein neues Live-Profiling in H2 noetig — H2 fuegt keinen gerenderten Aufrufer hinzu):
- 112px / Grid 16x24: median 0,40ms/Frame → `GRID_FINE = {x:16, y:24}`.
- 86px / Grid 8x12: median 0,10ms/Frame → `GRID_COARSE = {x:8, y:12}`.
- Schwelle 86px ≤ 96px → coarse, 112px > 96px → fine → `COARSE_MAX_SIZE_PX = 96`.
- 5 gleichzeitige Wings: ~0,8ms/Frame gesamt → `FPS_CAP_DEFAULT = 30` traegt bequem.
Die H2-Konstanten entsprechen den H0-Entscheidungsregeln 1:1 (keine Abweichung).

## Abweichungen vom woertlichen Plan-Text (dokumentiert)

1. **Kopf-Kommentar-Dichte gestrafft (§1.7-Budget):** Die im Plan §1.2 vorgeschlagenen H0-Herkunftskommentare je Konstante (z. B. `// H0: 112px/16×24 median 0.40ms`) wurden verdichtet (z. B. `// 112px median 0.40ms`, Verweis auf `tasks/h0-report.md` entfernt, Sektions-Divider von `----...----` auf ein festes kurzes `---- Titel ----` gekuerzt), um unter dem 25KB-Budget zu bleiben (25738 Bytes vor dem Straffen, 25294 danach). Der Plan selbst erwartet das ausdruecklich ("Falls über Budget: Kommentare straffen, nicht Logik kürzen") — keine Logik-Aenderung, nur Kommentar-Kuerzung.
2. **`test/mcp-ui-wing-dedup.test.js`, `T-wing-dedup-dark-variants` (S3, selbst gefunden vor Merge):** Der Plan-Text (§5.3) sieht `assert.doesNotMatch(WING_CSS_DARK_STATIC, /--color-navy-700/...)` vor. Das ist mit der Plan-eigenen Implementierung (§3: `WING_CSS_DARK_STATIC = WING_BASE_CSS + WING_DARK_OVERRIDE_CSS + ...`) strukturell unerfuellbar: `WING_BASE_CSS` bleibt (bewusst, wegen der geforderten Byte-Identitaet der 4 bestehenden Exporte) unveraendert und enthaelt die `--color-navy-700`-Deklaration weiterhin woertlich; `WING_DARK_OVERRIDE_CSS` haengt lediglich eine spaeter deklarierte, gleich-spezifische `.wing--dark{background:none}`-Regel an, die sie per CSS-Kaskade (Quellreihenfolge entscheidet bei gleicher Spezifitaet) zur Laufzeit ausser Kraft setzt, ohne die Zeichenkette zu entfernen. Der Test in der Plan-Fassung haette also IMMER fehlgeschlagen, unabhaengig von der Implementierung. Fix: Assertion auf das tatsaechlich pruefbare Verhalten umgestellt — Vorhandensein der Override-Regel `.wing--dark{background:none}` in beiden dark-Exporten, mit Kommentar, der den Kaskaden-Mechanismus erklaert. Visuelle Wirkung (keine navy Rundmarke auf der dunklen Karte) bleibt wie geplant erhalten, nur der String-Test wurde korrigiert.

## Betroffene/neue Dateien

- `design-system/components/brand/wing-canvas-engine.js` (neu)
- `src/ui/wing-canvas-engine.js` (neu, byte-Kopie)
- `src/ui/wing-markup.js` (additiv)
- `src/ui/widget-catalog.js` (additiv + eine Pipeline-Zeile geaendert)
- `test/mcp-ui-wing-canvas-sync.test.js` (neu)
- `test/mcp-ui-wing-canvas-injection.test.js` (neu)
- `test/mcp-ui-wing-dedup.test.js` (additiv, 1 Assertion-Fix gegenueber Plan-Text)

## Naechste Schritte

H3/H4 (Widget-Redesign): echte Widgets tragen den `<!--__WING_ENGINE__-->`-Platzhalter erst dort ein und werden zu Konsumenten von `mount()`/`opts.preset`/`opts.gold`. Groessenbudget-Marge (~306 Bytes) im Auge behalten, falls die Engine dort noch waechst.
