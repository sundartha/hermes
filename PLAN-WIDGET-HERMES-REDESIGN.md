# PLAN — Hermes-Widget-Redesign: Olympus HUD + Canvas-Mesh-Wing

Strategie-Doc (Analyse-only, KEIN Code). Erstellt 2026-07-02 aus Ist-Analyse, einem
dynamischen Strategie-Workflow (Canvas-Spike auf Opus + 2 Design-Drafts + Legacy-Audit,
alle Sonnet/Opus) und visueller Verifikation in Chrome (Screenshots aller Drafts,
Spike-Interaktion, Gold-Preview). Adversariale Opus-Kritik eingearbeitet (Abschnitt 10).
Umgesetzt wird sequenziell ueber die Lean-Phasen-Kette in
`tasks/widget-hermes-redesign-chain.md` (Muster wie [[mcp-ui-live-widget-chain]] /
[[conversation-quality-chain]]).

Verwandt: `PLAN-MCP-WIDGET-BRANDING.md` (Runde 1: echte Tokens + 28px-CSS-Wing — von
dieser Kette abgeloest), `PLAN-MCP-UI-LIVE-WIDGET.md` (das vereinte Call-Widget, dessen
Logik hier UNVERAENDERT bleibt), [[deploy-repo-split]] (Live = Push upstream, Owner-Gate).

---

## 1. Auftrag (Owner, 2026-07-02)

1. **Vodafone-Legacy-Designregeln raus.** Die Marke ist laengst Navy/Norse, aber die
   Regel-Prosa (design-system/README.md, SKILL.md, Komponenten-Doku) schreibt weiter
   Vodafone-Rot `#e60000` als DIE Aktionsfarbe vor. Vollstaendiger klassifizierter
   Audit liegt vor (Abschnitt 4).
2. **Widgets futuristisch, groesser, im Hermes-Branding.** Aktueller Stand (Runde 1):
   weisse Karten, 28px-Wing-Rundmarke — "zu klein, nicht unser Branding".
3. **Der ECHTE animierte Fluegel pro Szenario** (idle/connecting/working/success/error
   aus dem Animation Lab) muss in die Widgets — nicht die CSS-Approximation.
4. Visuelle Feedback-Schleife ueber Chrome; fertig erst bei erreichter Definition of Done.

## 2. Spike-Ergebnis (bewiesen, nicht angenommen)

**Der Lab-Fluegel laeuft self-contained in Canvas2D — ohne Pixi, GSAP oder CDN.**
Spike: `scratchpad/spike-canvas-wing.html` (Session-Scratchpad), visuell in Chrome
verifiziert (Mesh-Deformation, Tip-Lag, alle 5 Status, keine sichtbaren Seams).

- Mathe 1:1 aus `design-system/components/brand/wing-engine.js` portiert
  (smoothstep/buildWeights/deform, alle Gains, WING_BBOX, Ambient-Drift, Lift).
- Pixi-MeshPlane ersetzt durch Triangle-Texture-Mapping: Gitter 16x24 (oder 8x12),
  2 Dreiecke/Zelle, affines Mapping via `clip()`+`setTransform()`+`drawImage()`,
  SEAM_PAD 0.75 gegen Naht-Artefakte. DPR-Cap 2.
- GSAP ersetzt durch Mini-Timeline-Runtime (~130 Zeilen): `.set/.to`, duration/ease/
  repeat/yoyo/repeatDelay, Positions-Offsets (`<`, `-=x`), timeScale, Lazy-Capture
  (weiche Uebergaenge aus der vorigen Pose). Easings power1-4/sine/elastic.
- Engine-Groesse: ~20KB unminifiziert (inkl. deutscher Kommentare). Widget-Budget:
  heute ~180-196KB je Widget (PNG-Data-URI dominiert, live bewiesen); +20KB Engine
  ist unkritisch.
- OFFENER PUNKT fuer H2: FPS-Pill zeigte konstant 36fps unabhaengig von Groesse/Gitter
  — Ursache profilieren (Mess-Artefakt unter CDP vs. echter Bottleneck). Ziel:
  fluessig bei Widget-Groesse mit Frame-Cap (Abschnitt 6.3).

## 3. Design-Entscheidung (Lead, visuell in Chrome verglichen; Owner kann ueberstimmen)

Zwei komplette Drafts wurden gebaut und durchgesehen (`draft-a-beacon.html`,
`draft-b-olympus.html`, beide alle 5 Call-Zustaende + Read-only-Widgets, hell + dunkel):

- **A "Navy Beacon"**: Navy-Buehne oben, heller Ergebnis-Body — elegant, konservativ
  (Weiterentwicklung des bestehenden `design-system/mcp/wing-status.html`-Mockups).
- **B "Olympus HUD"** (GEWAEHLT): volldunkle Navy-Karte (#12335e -> #0f2d52 -> #081a37,
  radialer Akzent-Glow), Fluegel ~112px zentral vor duennem SVG-Status-Ring (rotierender
  Teilbogen bei dialing/in_progress, ruhiger Vollring bei completed, unterbrochener
  gedaempfter Ring bei failed/cancelled), HUD-Datenzeilen (UPPERCASE-Labels weit
  getrackt, tabular-nums), Status-Pills mit Live-Dot, feines Scanline-Overlay (~2.5%),
  EINE Akzent-Lichtfarbe `#5ea1e0` (aus navy-700 abgeleitet). Call-Karte 540px,
  Read-only 480px mit 86px-Wing. Funktioniert auf hellem UND dunklem Chat-Hintergrund
  (beides im Draft verifiziert).

Begruendung: trifft "futuristisch + Fluegel als Held + Goetterbote" am staerksten;
Read-only-Widgets tragen dieselbe Sprache ueberzeugend; diszipliniert (eine
Akzentfarbe, eine Easing-Kurve, kein Neon-Regenbogen).

**Gold-Wing (Faehigkeit ja, Default AUS — Owner-Gate, Kritik-Punkt 4):** Die
unkommittierte Lab-WIP (`aura.ts`) definiert HERMES_GOLD `#e6be5c` ("warm-patiniert",
Lichtpuls im Kraftschlag). Gold-auf-Navy wurde visuell geprueft: markant, edel. ABER:
die committete Marke ist weiss-auf-dunkel (wing-markup.js, Commit 0dca7ce) — Gold ist
eine NEUE Markenfarbe und damit Brand-Governance, keine Lead-Entscheidung. Umsetzung:
Post-Tint als EIN `source-atop`-fillRect pro Frame NACH den Dreiecken (~kostenlos
gegen 768 drawImage; Lichtpuls = Tint-Alpha aus state.flap/lift moduliert), hinter
einer benannten Konstante `GOLD_ENABLED = false`. H6 liefert den Gold/Weiss-
Screenshot-Vergleich; der Owner flippt mit einem Einzeiler. KEIN vorgetintetes
zweites PNG (wuerde 170KB duplizieren). Die Konstanten (Farbe/Staerke) leben in der
Engine-Quelle selbst — keine Abhaengigkeit von der unkommitteten aura.ts.

**Akzentfarbe (EINE, dokumentiert):** Der Draft nutzt `#5ea1e0` als Licht-Akzent.
Das Brand-Aktionsblau `#1b4f86` (navy-700) ist auf der dunklen Karte zu dunkel fuer
Ring/Glow/Pills — dunkle Oberflaechen brauchen eine aufgehellte Stufe DERSELBEN
Hue. `#5ea1e0` wird als benannter Inline-Token `--color-accent-light` mit
Herleitungs-Kommentar ("aufgehellte Stufe von navy-700 fuer dunkle Karten") gefuehrt
und im H6-Report dem Owner zur Bestaetigung vorgelegt (drei Kandidaten dokumentiert:
navy-700 / #5ea1e0 / Gold — Kritik-Punkt "drei konkurrierende Akzent-Wahrheiten").

## 4. Legacy-Audit (klassifiziert, vollstaendig)

**MUST_FIX (H1)** — noch "gueltig wirkende" Regeln/Doku, die Designer fehlleiten:

| Fundstelle | Problem |
| --- | --- |
| `design-system/README.md` 10/96/98/102/137/139 | "brand red #e60000 = single action color", Rot-Hover `#ac1811`, rote Status-/Fokus-/Nav-Regeln — komplett stale (Tokens sind Navy/Norse/Space Grotesk, semantic.css: "no red/green") |
| `design-system/SKILL.md` 29 | "30-second brand" nennt Rot als DIE Aktionsfarbe (Einstiegspunkt jeder Design-Session!) |
| `design-system/components/core/Button.prompt.md` 8 | Primary-Variante als "brand red #e60000, hover #ac1811" beschrieben (Komponente selbst laeuft laengst ueber Navy-Tokens) |
| `design-system/components/forms/Switch.jsx` 4, `Switch.d.ts` 12, `Field.jsx` 4, `Field.d.ts` 16, `Field.prompt.md` 8 | "brand-red"-Doku-Kommentare auf navy-getokenten Komponenten |
| `design-system/_ds_bundle.js` 1092/1152 | kompilierte Kopien derselben Kommentare (Bundle-Regeneration oder gezielter Kommentar-Fix) |
| `apps/hermes-animation-lab/src/lab/lab.css` 7 + `index.html` 92 | `--brand: #e60000` + Default-aktiver Stage-Hintergrund-Button "Marke" auf Vodafone-Rot |
| `README.md` 138/172, `ONBOARDING.md` 46 | verweisen auf entferntes `public/index.html` als "Vodafone-Design" / "Vodafone Verified"-Badge |

**KEEP (nicht anfassen):** historische Strategie-/Plan-Docs (PLAN-MCP-WIDGET-BRANDING,
sundartha-website-rewrite, rebrand-track-a, AUTONOM/STATUS-Logs), Tests die die
ABWESENHEIT von Rot asserten (`test/p1-dashboard-brand.test.js`,
`apps/web/test/pages.test.js`), Erklaer-Kommentare in `apps/web/src/styles/*` gegen
Rot-Wiedereinschleppung, Debug-`MARKER_COLOR` in `HermesWing.ts` (zufaelliger Hex,
keine Regel), Infra-Namen `vodafone-agent` (Track B), Auth-Test-Fixtures.

## 5. Harte Invarianten (die Kette darf sie NIE verletzen)

- `src/ui/widget-bind.js` bleibt **byte-identisch** (`git diff` leer).
- Kein `innerHTML` fuer Tool-Daten (nur `textContent`), kein `@import`/`<link>`/
  CDN-`<script>`/externe Requests in Widgets — alles self-contained.
- Funktionale Logik von `call.html` (Self-Poll, Host-Bruecke 3 Wire-Formate,
  Terminal-Erkennung, get_transcript-once, Cancel, 15s-Fallback, Diagnose) bleibt
  semantisch UNVERAENDERT — H3 ist ein Restyle + Wing-Mount, kein Logik-Umbau.
- Safety-Gates (`src/server.js` /api/calls), Disclosure, Tenant-Isolation: nicht im
  Diff-Pfad (kein Edit an server.js/mcp-tools.js/claude.js/bridge.js in dieser Kette).
- `MCP_UI_ENABLED=false` => byte-identisches Serververhalten (Kette aendert nur Inhalte
  bereits existierender Widget-/DS-Dateien + neue injizierte Assets hinter demselben Gate).
- Keine neuen npm-Dependencies. ESM, kein Build-Step. Kommentare deutsch ohne Umlaute.
- `prefers-reduced-motion: reduce` => statische Ruhepose, keine rAF-Schleife.
- Fail-safe: scheitert Canvas-Init (kein 2D-Context, was auch immer), bleibt die
  bewaehrte CSS-WingMark sichtbar — NIE ein leeres Loch statt Marke.

## 6. Ziel-Architektur

### 6.1 Wing-Canvas-Engine (H2)

- **Authoring-Quelle im Design-System** (Owner-Prinzip "das Design lebt im
  Design-System"): `design-system/components/brand/wing-canvas-engine.js` — IIFE,
  browser-global `window.HermesWingCanvas`, keine Imports, self-contained.
- **Laufzeit-Kopie** `src/ui/wing-canvas-engine.js` (src/ importiert NICHT aus
  design-system/ — etabliertes Muster wie wing-image.js/wing-image-data.js) +
  **Sync-Test** (Muster `test/mcp-ui-p5-token-sync.test.js` bzw. wing-dedup), der
  Byte-Gleichheit der Engine-Quelle asserted.
- **Injektion zur Serve-Zeit** in `widget-catalog.js` per Platzhalter (Muster
  BIND_SCRIPT/withWingAssets): `<!--__WING_ENGINE__-->` -> `<script>…Engine…</script>`.
  Widgets tragen einen Mount-Punkt `[data-wing-canvas]` + kleines Inline-Init.
- **API:** `mount(host, {size, status, gold, fpsCap, grid})` -> Handle mit
  `setStatus(next)` / `destroy()`. Status-Timelines + Presets 1:1 aus dem Spike.
- **Gold-Tint:** einmaliger Offscreen-Pre-Tint (HERMES_GOLD, benannte Konstanten
  fuer Farbe + Staerke), Textur wird EINMAL erzeugt und wiederverwendet.
- **Perf-Disziplin:** Frame-Cap (Ziel 30fps, benannte Konstante), Gitter nach Groesse
  (<=96px -> 8x12, sonst 16x24), Pause bei `document.visibilitychange` + off-screen
  (IntersectionObserver), DPR-Cap 2. AC enthaelt Profiling der 36fps-Beobachtung.
- **Fallback (dark-tauglich, Kritik-Punkt 1.2/R4):** Init in try/catch; bei
  Fehlschlag bleibt die CSS-WingMark sichtbar — aber in einer NEUEN Dark-Variante:
  auf der volldunklen Karte braucht der weisse Wing KEINE navy Rundmarke (die war
  das Sichtbarkeits-Mittel fuer WEISSE Karten und waere navy-auf-navy unsichtbar —
  exakt der Bug aus Commit 0dca7ce). wing-markup.js bekommt dazu WING_CSS_DARK_*/
  WING_MARKUP_DARK_*-Auspraegungen (weisser Wing ohne Rundel, dieselben Keyframes);
  Engine ersetzt den CSS-Wing erst NACH erfolgreichem Mount (progressive
  enhancement). Betroffene Tests werden in derselben Phase benannt angepasst.

### 6.2 call.html Redesign (H3)

Olympus-HUD-Layout gemaess Draft B; ALLE `data-mcp`-Slots, `data-row`-Keys,
`TERMINAL_STATUSES`, Poll-/Bruecken-/Cancel-Logik unveraendert. Neu:

- Fluegel-Held (112px) + Status-Ring; `updateWingForStatus` ruft kuenftig das
  Engine-Handle (`setStatus`) UND haelt den CSS-Klassen-Pfad als Fallback am Leben.
- Deutsche Status-Pills (VERBINDUNG/LIVE/ABGESCHLOSSEN/FEHLGESCHLAGEN/ABGEBROCHEN)
  als reine Anzeige-Uebersetzung im Widget-Skript; der rohe Status bleibt fuer die
  Logik und in einem (visuell dezenten) Slot erhalten — keine Aenderung am
  structuredContent-Vertrag.
- Karte ~540px breit; Hoehe kompakt halten (<= ~560px), `reportSize` uebernimmt die
  Iframe-Hoehe (bestehender Bind-Mechanismus, unveraendert).

### 6.3 Read-only-Widgets (H4)

agent-status / my-number / calls / calendar im selben Look, kompakter (max-width
`min(480px,100%)`, Wing 86px, Status fest `idle`). Listen (`data-mcp-row`) behalten
ihre generischen Row-Felder; nur CSS/Markup-Rahmen aendern sich.

**Wing-Mechanik nach H0-Entscheidungsregel (Kritik-Empfehlung 2):** Read-only-Widgets
sind der groesste CPU-Posten (potenziell 4+ Dauer-rAF-Loops fuer reine Deko). Default:
CSS-idle-Wing (Dark-Variante, GPU-komponierte Transforms, praktisch gratis). NUR wenn
das H0-Perf-Gate zeigt, dass ein Canvas-idle bei 86px/8x12 unter 2.5ms Haupt-Thread
pro Frame kostet UND Visibility-Gating greift, DARF H4 stattdessen die Engine mit
`fpsCap<=24` montieren. Die Entscheidung wird nach H0 in der Kette festgehalten.
Kein `<button>`/`href`/`<link>`/`callTool` in Read-only-Markup (T-W3-AC6-Asserts).

### 6.4 Design-System-Sync (H5)

`design-system/mcp/` spiegelt wieder die REALITAET: neue Karten fuer die 5 echten
Widgets (Call in allen 5 Zustaenden), stale Mockups (`call-result.html`,
`call-status.html`, `transcript.html`) entfernen bzw. ersetzen; `wing-status.html`
bleibt als Konzept-Showcase erlaubt, wird aber als solcher gekennzeichnet.

## 7. Pre-Mortem (Risiken vorab benannt)

- **Perf-Kollaps bei mehreren Widgets im Chat** (5 Karten x Canvas-rAF): entschaerft
  durch Frame-Cap, Visibility-/Offscreen-Pause, kleines Gitter, idle-Timeline mit
  Mini-Amplitude; Read-only-Widgets sind idle-only. AC: 5 Widgets gleichzeitig im
  Harness ohne fuehlbares Ruckeln des Haupt-Threads.
- **Host schneidet hohe Karten ab / Hoehe bricht:** Karte kompakt halten, reportSize
  ist bewiesen; QA prueft die Hoehen im Harness hell/dunkel.
- **Canvas im Sandbox-Iframe verboten:** Restrisiko klein (Inline-JS laeuft live
  bewiesen; Canvas2D ist Standard-API ohne Netz/Storage). Fallback 6.1 garantiert
  Marke statt Loch. Live-Bestaetigung ist Teil des Owner-Gates (H6/W-Live).
- **Tests brechen "still":** die Wing-/Katalog-Tests pinnen heutige Struktur
  (WING_CSS einmal je Widget, Klassenwechsel-Invariante AC6). Jede Phase benennt
  die Tests, die sie BEWUSST anpasst; alles andere bleibt gruen.
- **WIP-Kollision beim Merge:** `apps/hermes-animation-lab/*` traegt unkommittierte
  Owner-WIP (Gold/Aura). H1 beruehrt lab.css:7 + index.html:92 (andere Hunks) —
  Merge im Lead mit Stash; Konflikte werden im Lead aufgeloest, WIP wird NICHT
  committet (etabliertes Muster P8a).
- **Gold polarisiert:** eine Konstante, Screenshots beider Varianten (weiss/gold) im
  QA-Report — Owner kann mit einem Einzeiler zurueck.

## 8. Phasen-Ueberblick (Details + ACs in `tasks/widget-hermes-redesign-chain.md`)

| Phase  | Autonom? | Kurz |
| ------ | -------- | ---- |
| **H1** | ja | Design-System-Entstaubung: alle MUST_FIX aus Abschnitt 4 (Doku/Prosa/Kommentare, lab.css `--brand`, README/ONBOARDING-Reste); Grep-Gate |
| **H0** | **Lead** | Perf-Gate (Kritik-Empfehlung 1): Spike erweitern — 5 Canvas-Wings + HUD-Ring/Glow-CSS simultan, Haupt-Thread-Kosten pro render() via performance.now (NICHT CDP-fps), Visibility-Gating-Wirkung; klaert die 36fps-Frage; Entscheidungsregeln fuer H2-Konstanten + H4-Wing-Mechanik |
| **H2** | ja | Wing-Canvas-Engine produktisieren: DS-Quelle + src/ui-Kopie + Sync-Test, Katalog-Injektion, Dark-Fallback (wing-markup-Erweiterung), Frame-Cap/Visibility-Gating/Terminal-Stop/reduced-motion, Gold-Post-Tint hinter GOLD_ENABLED=false, Tests (inkl. benannter Anpassungen an wing-dedup) |
| **H3** | ja | call.html -> Olympus HUD (Fluegel-Held + Status-Ring + HUD-Zeilen + deutsche Pills, fluid `min(540px,100%)`, Hoehe reserviert), Logik unveraendert; benannte Test-Anpassungen (w1-call-widget AC-wing/AC-wing-static, wing-dedup LIVE) |
| **H4** | ja | 4 Read-only-Widgets im selben Look (kompakt, idle; Mechanik nach H0-Regel); benannte Test-Anpassungen (wing-static alle 4); AC6-Verbote (kein button/href/callTool) bleiben gruen |
| **H5** | ja | design-system/mcp/-Kit: vereinte Call-Mockup ADDIEREN (DS-Inversion korrigieren, Kritik 1.9), stale Karten raus, `@dsCard` Zeile 1, token-sync `--write` |
| **H6** | **Lead** | Visuelle QA-Schleife in Chrome (Harness: alle Widgets x Status x hell/dunkel, schmale Spalte, Fallback erzwungen, 5 parallel, Gold/Weiss- + Akzent-Vergleich fuer Owner), npm test, Abschluss-Report |
| **W-Live** | **nein (Owner)** | Push `upstream` + Live-Check in Claude: Widgets rendern, Canvas laeuft im ECHTEN sandboxed Host-Iframe (Restrisiko R3 wird erst hier final entkraeftet), Akzent/Gold-Entscheidung |

Reihenfolge H1 -> H0 -> H2 -> H3 -> H4 -> H5 -> H6 (H1 laeuft bereits, unabhaengig).
Jede autonome Phase = EIN gepinnter `phase-impl-lean`-Lauf (Subagenten SONNET), dualer
Review als Gate (S1/S2 = Blocker), Merge im Lead. Nach H3 und H4 zusaetzlich visueller
Zwischen-Check im Chrome-Harness durch den Lead (Feedback-Schleife, Owner-Auftrag 4).

## 9. Verifikation / Definition of Done

- `npm test` gruen (Baseline 1493/1493 vor der Kette, selbst verifiziert).
- Grep-Gates: (a) `grep -rn "e60000\|ac1811\|brand red" design-system/ --include="*.md"
  --include="*.jsx" --include="*.d.ts"` liefert KEINE gueltig-wirkende Regel mehr;
  (b) `grep -n "vodafone" README.md ONBOARDING.md` liefert keine Design-Beschreibungen
  mehr (Infra-/Track-B-Namen erlaubt); (c) kein `unpkg\|cdn\|https://` in
  `src/ui/widgets/*.html` + injizierten Assets.
- Visuell (Chrome-Harness, postMessage-Simulation): alle 5 Widgets, Call-Widget in
  allen 5 Zustaenden, hell + dunkel, Wing animiert je Szenario, Fallback-Pfad einmal
  erzwungen (Engine kuenstlich deaktiviert -> CSS-Wing sichtbar). Screenshots im Report.
- Perf: 5 Widgets parallel im Harness fluessig; FPS-Frage aus Abschnitt 2 beantwortet.
- Reports je Phase in `tasks/h<N>-report.md`; Abschluss in `tasks/todo.md` dokumentiert.
- Live-Deploy (`git push upstream master`) + Live-Widget-Check = **Owner-Gate**, nicht
  Teil der autonomen Kette.

## 10. Adversariale Kritik (Opus) — Einarbeitung

Der Kritik-Lauf las alle Pflicht-Dateien, Tests, Spike und Mock. Kern-Urteil:
Richtung tragfaehig, aber (a) Multi-Canvas-Perf unterschaetzt, (b) Test-Blast-Radius
unbenannt, (c) Dark-Fallback-Widerspruch. UEBERNOMMEN:

1. **H0-Perf-Gate vor H2** (Lead, Spike-Erweiterung: 5 Wings + HUD-CSS simultan,
   performance.now-Kosten pro render statt CDP-fps; die konstanten 36fps sind ein
   Alarmsignal — Konstanz ueber Gittergroessen deutet auf externen Cap/Artefakt).
   Echtes Host-Iframe-Profiling bleibt W-Live (nicht autonom moeglich).
2. **Brechende Asserts je Phase NAMENTLICH in der Spec** (mcp-ui-wing-static,
   mcp-ui-wing-dedup, mcp-ui-w1-call-widget AC-wing*, mcp-ui.test T-W3-AC6/T-P3-AC5)
   — Test-Update gehoert in die Phase der Code-Aenderung (B1/B2-Lehre), Reviewer
   prueft Verhaltens- statt Implementierungs-Bindung.
3. **Dark-Fallback**: CSS-WingMark bekommt Dark-Variante ohne navy Rundel (sonst
   navy-auf-navy unsichtbar = Regression von 0dca7ce). WingMark bleibt als Asset.
4. **Gold Default AUS** hinter GOLD_ENABLED; Post-Tint via source-atop (1 fillRect/
   Frame); Owner entscheidet am H6-Screenshot-Vergleich; Konstanten in der Engine
   (keine Abhaengigkeit von unkommitteter aura.ts). Akzentfarbe als benannter Token
   mit drei dokumentierten Kandidaten fuer den Owner.
5. **Read-only-Widgets default STATISCH/CSS-idle**; Canvas-idle nur nach
   H0-Entscheidungsregel (<2.5ms/Frame bei 86px/8x12 + Gating wirksam, fpsCap<=24).
6. **Terminal-Stop** (nach completed/failed/cancelled: One-Shot-Timeline, dann rAF
   stoppen), Visibility-Gating aus der Pixi-Referenz portieren, Frame-Cap 30.
7. **Fluid statt fix**: max-width min(540px,100%); Canvas-Hoehe vorab reservieren
   (reportSize-Jank); schmale Spalte in H6 testen.
8. **H5 korrigiert die DS-Inversion** (vereinte Call-Mockup ADDIEREN) + @dsCard-
   Zeile-1-Pflicht + token-sync --write in die Verifikation.
9. **HUD+Wing-Integration wird in H0 mitgespikt** (Canvas im SVG-Ring, Ring-spin +
   Wing-rAF simultan; SVG ohne href/xlink:href).

BEWUSST ABGEWICHEN (mit Begruendung):
- **H2 nicht dreigeteilt** (H2a/b/c): Perf-Haertung (Cap/Gating/Terminal-Stop) sind
  mit dem Spike als Vorlage ~30 Zeilen und werden durch H0-Messwerte als harte ACs
  gedeckt; Gold ist hinter Default-AUS-Flag trivial. Der Selbst-Fix-Loop + dualer
  Review des Lean-Laufs traegt diese Phasengroesse; drei separate Laeufe kosten mehr
  Koordination als sie Risiko senken. Faellt H2 im Gate durch, wird nachgeteilt.
- **H3 nicht in Mechanik/Layout gesplittet**: der Mechanik-Teil ist bewusst minimal
  (updateWingForStatus ruft zusaetzlich Engine-setStatus; Klassenwechsel bleibt als
  Fallback-Pfad bestehen) — die Zustandsmaschine selbst wird nicht angefasst; die
  AC-wing-Tests pruefen kuenftig beide Pfade.
