# Phase H2 — Wing-Canvas-Engine produktisieren

**Ziel:** self-contained Mesh-Wing-Engine (Canvas2D) fuer MCP-UI-Widgets produktionsreif machen, ohne bestehende Widgets/Server-Verhalten anzufassen.

- **Gate:** BLOCKED
- **finalBranch:** `phase/h2-wing-canvas-engine-fix2`
- **headCommit:** `3bca4067ab457035093256da6ecf3c609b4de604`

## Plan (gekuerzt)

Portierung des H0-Spikes (Geometrie/Gains, Mini-Timeline-Runtime, Presets `classic`/`olympian`, Status-Timelines) aus dem Hermes Animation Lab in eine self-contained Canvas2D-Engine, die direkt in MCP-UI-Widgets eingebettet werden kann (kein externes Laden, kein Netzwerkzugriff, kein Framework-Dep). Zwei byte-identische Kopien:

- `design-system/components/brand/wing-canvas-engine.js` (Authoring-Quelle)
- `src/ui/wing-canvas-engine.js` (Laufzeit-Kopie, von den Widgets tatsaechlich geladen)

Produktionsverhalten obendrauf gegenueber dem Spike: Frame-Cap (`FPS_CAP_DEFAULT=30`), Visibility-Gating (IntersectionObserver + `visibilitychange`), Terminal-Stop bei `success`/`error`, `prefers-reduced-motion`-Fallback (keine rAF-Schleife, ein statisches Render), optionaler Gold-Post-Tint hinter einem Owner-Gate (`GOLD_ENABLED=false`, fail-closed). Groessenbudget der Engine-Datei: 25 KB (im Review als `25*1024`-Bytes interpretiert). Additiv in `src/ui/wing-markup.js`: vier neue dunkle Wing-Varianten fuer eine kommende Olympus-HUD-Karte, ohne die vier bestehenden hellen Exporte zu veraendern. Additiv in `src/ui/widget-catalog.js`: eine neue `withWingEngine()`-Injektionsfunktion nach dem etablierten Platzhalter-Muster (`withBindScript`/`withWingAssets`), die H2 selbst noch in keinem der 5 echten Widgets verdrahtet (das ist H3/H4). Vorgabe bei Ueberschreiten des Groessenbudgets: Kommentare straffen, nicht Logik kuerzen. Harte Nebenbedingung: `src/ui/widget-bind.js` bleibt byte-identisch zu `master`, keine Aenderung an bestehenden Widgets/Server/Claude-Logik/Bridge/Animation-Lab.

## Impl + Abweichungen

- **Tests:** 1501/1501 gruen (1493 Baseline + 8 neu) zum Zeitpunkt des Erst-Commits; `node --check` auf allen 7 betroffenen Dateien ok.
- **Engine-Groesse:** 25294 Bytes (unter dem 25 KB-Budget), im spaeteren Fix-r2 auf 25529 Bytes gewachsen (siehe Fix-Runden).
- **Bind-Byte-Identitaet:** `src/ui/widget-bind.js` byte-identisch zu `master` bestaetigt.
- **Neue Dateien:**
  - `design-system/components/brand/wing-canvas-engine.js`
  - `src/ui/wing-canvas-engine.js`
  - `test/mcp-ui-wing-canvas-sync.test.js`
  - `test/mcp-ui-wing-canvas-injection.test.js`
  - `tasks/h2-report.md` (im Worktree; dieser Bericht hier ist die Version fuer das Haupt-Repo)
- **Editierte Dateien:**
  - `src/ui/wing-markup.js` (additiv: 4 neue dunkle Wing-Varianten)
  - `src/ui/widget-catalog.js` (additiv: `withWingEngine()`)
  - `test/mcp-ui-wing-dedup.test.js` (additive Ergaenzung, 8 neue Tests insgesamt in dieser Datei)

**Dokumentierte Abweichungen vom Plan:**

1. **Kommentar-Straffung wegen 25 KB-Budget:** Engine war initial 25738 Bytes (ueber Budget), auf 25294 Bytes gekuerzt durch Verdichten der Sektions-Divider und Herkunftskommentare (keine Logik-Aenderung) — vom Plan selbst als Vorgehen fuer diesen Fall vorgesehen.
2. **Test-Assertion-Korrektur in `T-wing-dedup-dark-variants`:** Die im Plan woertlich vorgegebene Assertion (`assert.doesNotMatch(WING_CSS_DARK_STATIC, /--color-navy-700/...)`) war mit der ebenfalls plan-vorgegebenen Implementierung strukturell unerfuellbar — `WING_BASE_CSS` bleibt fuer Byte-Identitaet unveraendert, `WING_DARK_OVERRIDE_CSS` haengt nur eine spaeter deklarierte, gleich-spezifische CSS-Regel an. Die Zeichenkette `--color-navy-700` bleibt in `WING_BASE_CSS` also immer vorhanden; nur die CSS-Kaskade neutralisiert sie visuell zur Laufzeit. Assertion wurde auf das tatsaechlich pruefbare Verhalten umgestellt (Vorhandensein der Override-Regel `.wing--dark{background:none}`), mit erklaerendem Kommentar. Visuelle Wirkung entspricht weiterhin dem Plan.

## Safety-Urteil

**approved: true** — APPROVE nach Pruefung von `review-h2-r2` (Branch `phase/h2-wing-canvas-engine-fix2`, frischer Worktree).

- `npm test` lokal gruen: **1530/1530**, 0 fail.
- **Scope respektiert:** `git diff master..branch` zeigt keine Aenderung an `src/ui/widgets/*.html`, `src/server.js`, `src/mcp-tools.js`, `src/claude.js`, `src/bridge.js`, `apps/hermes-animation-lab/`.
- `src/ui/widget-bind.js` byte-identisch zu master (Diff leer).
- Beide Engine-Kopien via `cmp` byte-identisch bestaetigt (je 25529 Bytes), zusaetzlich per Sync-Test (`T-wing-canvas-sync`) als Drift-Gate abgesichert.
- **Self-contained bestaetigt:** Grep auf `http(s)://`, `@import`, `fetch`, `XMLHttpRequest`, `localStorage`/`sessionStorage`/`indexedDB`/`WebSocket` sowie `eval`/`new Function` liefert in beiden Engine-Dateien 0 Treffer.
- **Perf-Konstanten** decken sich exakt mit H0-Ergebnis/Auftragsvorgabe: `FPS_CAP_DEFAULT=30`, `GRID_COARSE`/`COARSE_MAX_SIZE_PX=96`, `DPR_CAP=2`, `GOLD_ENABLED=false` (Owner-Gate).
- **reduced-motion-Pfad** klar nachvollziehbar (kein rAF, kein IntersectionObserver-Setup, ein statisches `render()`), end-to-end verifiziert durch `T-wing-mount-reduced-motion` (Fake-DOM/rAF-Harness, `raf.pendingCount()===0` vor/nach `setStatus`).
- **Terminal-Stop** implementiert (`isTerminalDone()` prueft `TERMINAL_WING_STATUSES` success/error + Timeline-Ende, `frame()` stoppt danach ohne erneuten `requestAnimationFrame`-Aufruf), getestet via `T-wing-mount-terminal`.
- **Visibility-Gating** vollstaendig (IntersectionObserver + `visibilitychange`-Listener), je eigener Test in beide Richtungen (Start/Stop).
- **Canvas-Dimensionierung** synchron in `mount()` vor dem Bild-Load (kein reportSize-Jank), verifiziert per `T-wing-mount-canvas`.
- `withWingEngine()`-Injektion defensiv No-Op fuer alle 5 heutigen Widgets (kein Platzhalter vorhanden -> HTML byte-unveraendert, per grep bestaetigt); `wing-markup.js` fuegt die neuen Dark-Varianten rein additiv hinzu (per Dedup-Test verifiziert).
- Keine neuen npm-Dependencies (`package.json`/`package-lock.json` unveraendert). Kein `console.*`, kein toter/auskommentierter Code.

**Concerns (kein Blocker):**

1. 25 KB-Budget wird als `25*1024=25600` Bytes interpretiert (nicht dezimal 25000); aktuelle Engine-Groesse 25529 Bytes (~71 Bytes Marge zu 25600, aber ueber dem dezimalen 25000-Wert). Konsistent dokumentiert und im Test (`T-wing-canvas-size: bytes <= 25*1024`) hart verankert — im Auge behalten bei weiterem Wachstum (H3/H4).
2. `tasks/h2-report.md` (Worktree-Version) war nach Fix-Runde 1+2 nicht nachgezogen (nannte noch 25294 Bytes / 1501 Tests statt aktuell 25529 Bytes / 1530 Tests); korrekte Werte standen in den `fix(h2)`-Commit-Messages. Reine Doku-Staleness, kein funktionaler Mangel.

## Clean-Code-Audit

**blocker: true — Gate BLOCKED**

### S1 (1 Fund, Blocker)

**T1 — `src/ui/wing-canvas-engine.js:513`** (identisch `design-system/components/brand/wing-canvas-engine.js:513`): Der Preset-Switch in `applyStatus()` — `tl = (preset === "olympian" ? olympianCycle : classicCycle)(state, WORKING_LOOP_PAUSE_SEC)` — ist eine neue, produktionsreife Verzweigung (`opts.preset` wird in `mount()` Zeile 399 aus der Public API entgegengenommen; `window.HermesWingCanvas.mount(host, {preset:'olympian', status:'working'})` ist bereits heute aufrufbar). Kein Test in `test/mcp-ui-wing-canvas-mount.test.js` ruft `mount()` jemals mit `preset: 'olympian'` auf; `test/mcp-ui-wing-canvas-physics.test.js` prueft `classicCycle`/`olympianCycle` nur als isolierte reine Funktionen, nicht die Verdrahtung ueber `opts.preset`. Ein vertauschtes `===`, ein Tippfehler im String `'olympian'` oder ein umgedrehter Ternary wuerde von keinem Test bemerkt. Verwandte, kleinere Luecken im selben Muster (nicht separat gezaehlt, gleiche Fix-Runde): `status='error'` wird im Terminal-Stop-Pfad von `mount()` nie getestet (nur `'success'`); `opts.grid`/`opts.size`/`opts.fpsCap` werden in keinem Mount-Test mit Nicht-Default-Werten belegt.

Fix-Empfehlung: mindestens einen Mount-Test ergaenzen, der `preset:'olympian', status:'working'` setzt und ueber einen Beobachtungspunkt (z. B. `state.beat !== 0` nach einem Tween-Schritt, oder denselben `__internal`-vm-Patch-Trick wie in `mcp-ui-wing-canvas-physics.test.js`) verifiziert, dass tatsaechlich `olympianCycle` statt `classicCycle` lief; optional denselben Terminal-Stop-Test wie fuer `'success'` auch fuer `'error'` duplizieren.

### S2

Keine Funde.

### S3 (2, nicht blockierend)

1. **G25 (Buendel)** — `design-system/components/brand/wing-canvas-engine.js:27,30,32-34` (identisch `src/ui/wing-canvas-engine.js`): Die physikalischen Gain-/Divisor-Konstanten (`/0.92` in `WING_FIT`, `AMBIENT_ROT`-Faktoren 0.9/1.7/1.3/0.6 in `computeScreen()`, `BEAT_GAIN`/`FLAP_GAIN`/`BEND_GAIN`/...) tragen nur einen Gruppen-Kommentar (`---- Geometrie / Gains (aus HermesWing.ts + deform.ts) ----`), keinen Kommentar pro Konstante. Kein neuer Verstoss der Phase — identisches Muster existiert bereits unveraendert in `design-system/components/brand/wing-engine.js` (master, unangetastet); Duplizierung ist bewusst und dokumentiert (Sync-Test). Optionaler Fix: falls je angefasst, Herkunfts-Kommentar pro Konstante ergaenzen.
2. **P15/YAGNI (Beobachtung)** — `src/ui/wing-markup.js:101-124`: `WING_CSS_DARK_STATIC`/`WING_CSS_DARK_LIVE`/`WING_MARKUP_DARK_STATIC`/`WING_MARKUP_DARK_LIVE` sowie `opts.preset`/`opts.gold` in `wing-canvas-engine.js` sind exportierte, aber noch von keinem echten Widget konsumierte Seams (H3/H4 sollen sie verdrahten). Entspricht dem im Projekt etablierten Muster vorbereitender Seams vor dem ersten Konsumenten (vgl. I0-Phase); nur der Vollstaendigkeit halber notiert, kein Verstoss.

### S4

Keine Funde.

### Gesamturteil Clean-Code

BLOCKED wegen des 1 S1-Fundes (fehlende Testabdeckung fuer den `preset`-Ternary in `applyStatus()`/`mount()`). Alles Uebrige sauber: 48 neue Tests, 1530/1530 Gesamtsuite gruen, `node --check` ok auf allen betroffenen Dateien, Magic Numbers in den H2-eigenen Produktionskonstanten (`GOLD_*`, `FPS_CAP_DEFAULT`, `GRID_FINE`/`COARSE`, `COARSE_MAX_SIZE_PX`, `DPR_CAP`, `WORKING_LOOP_PAUSE_SEC`, `TAB_SWITCH_DT_CAP_SEC`, `INTERSECTION_THRESHOLD`) durchgehend benannt und mit Herkunfts-/Begruendungskommentar versehen. Duplizierung Engine vs. `wing-engine.js` (Canvas vs. Pixi, unterschiedliche Medien) explizit dokumentiert und durch Byte-Sync-Test abgesichert. Status-Namen/Mappings pro Datei genau einmal definiert (kein G23-Verstoss), keine toten Funktionen/kein auskommentierter Code/keine abgeschalteten Sicherungen. Testqualitaet insgesamt hoch (Build-Operate-Check, Grenzfalltests, vm-Sandbox-Technik statt Reimplementierung der Engine-Logik) — die eine Luecke betrifft gezielt den neu eingefuehrten `preset`-Branch, der trotz vollstaendiger Test-Suite fuer status/gold/visibility/frame-cap/terminal-stop nirgends end-to-end durchlaufen wird. Empfehlung: Mount-Test fuer `preset='olympian'` ergaenzen, danach PASS.

## Fix-Runden

**r1** — Branch `phase/h2-wing-canvas-engine-fix1` (von `phase/h2-wing-canvas-engine`), Commit `d9c448e`. Fixed H2 review blockers. H2-S1: 27 neue `node:test`-Behavior-Tests ergaenzt (`test/mcp-ui-wing-canvas-physics.test.js`: 20 Tests auf reinen Funktionen via test-lokalem `__internal`-Source-Patch, keine Aenderung an der ausgelieferten Engine).

**r2** — H2 Review-Blocker Runde 2 behoben. `applyGoldTint()` (Canvas2D `source-atop`-Gold-Tint in `src/ui/wing-canvas-engine.js:459-471` bzw. `design-system/components/brand/wing-canvas-engine.js`) war ueber `mount()` ungetestet, weil `GOLD_ENABLED` hart auf `false` steht. Fix ausschliesslich in `test/mcp-ui-wing-canvas-m...` (Quelltext an dieser Stelle abgeschnitten übergeben).

Nach r1+r2 stand die Suite bei 1530/1530 (laut Safety-Review), finalBranch `phase/h2-wing-canvas-engine-fix2`. Trotz zweier Fix-Runden bleibt das Gate laut vorliegendem Clean-Code-Audit **BLOCKED** — der dort benannte S1-Fund (Testabdeckung fuer `preset='olympian'` in `mount()`/`applyStatus()`) ist gemaess dieser Quelle nicht Teil der in r1/r2 behobenen Punkte und muss vor Merge noch geschlossen werden.
