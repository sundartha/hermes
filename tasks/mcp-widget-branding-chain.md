# Lean-Phasen-Kette — Hermes-Branding fuer MCP-Widgets + Server-Icon

Ausfuehrbarer Ketten-Treiber. Strategie/Kontext: `PLAN-MCP-WIDGET-BRANDING.md` (zuerst
lesen). Umsetzung ueber gepinnte Kopien von `.claude/workflows/phase-impl-lean.js`
(args-Passthrough ist in diesem Repo empirisch unzuverlaessig gewesen, siehe
[[phase-impl-workflow-args]] — deshalb pro Phase eine eigene, hart gepinnte Skript-Kopie,
KEIN `args`-Objekt).

## Driver-Protokoll

1. Lead bleibt duenn: liest KEINEN vollen Diff, startet pro Phase einen
   `phase-impl-lean`-Lauf (gepinntes Skript), merged das Ergebnis (lokal, `master`), geht
   zur naechsten Phase.
2. Alle Subagenten (Plan/Impl/Review/Fix/Report) auf `model:"sonnet"` (siehe
   [[lean-phase-orchestration]]).
3. Gate pro Phase: dualer Review (Safety/Verhalten + Clean-Code). S1/S2 = harte Blocker,
   Self-Fix-Loop bis PASS oder `maxFixRounds` erschoepft.
4. Verifikation vor "done": `npm test` gruen, `node --check` der geaenderten Dateien, die
   je Phase genannten grep/Sicht-Checks.
5. Reihenfolge T1 -> T2 -> T3 (T2 branched von T1s Merge-Commit, damit es die
   normalisierten Tokens aus T1 vorfindet; T3 ist dateimaessig unabhaengig, laeuft aber
   ebenfalls sequenziell nach T2 aus Einfachheit).

## Globale Invarianten (jede Phase)

- `src/ui/widget-bind.js` byte-identisch (`git diff` leer).
- `src/mcp-tools.js` wird in T1/T2 NICHT editiert (nur Widget-HTML-Dateien).
- Kein `innerHTML`, kein `@import`/`<link>`/CDN-`<script>` in Widget-HTML.
- Kein neuer npm-Dependency.
- Safety-Gates/Disclosure/Auth ohnehin nicht im Diff-Pfad dieser Kette — Reviewer
  bestaetigt das trotzdem explizit (0-Diff-Nachweis auf `src/server.js`, `src/claude.js`,
  `src/bridge.js`, `src/mcp-tools.js`).

---

## T1 — Design-Token-Alignment (alle 5 Widgets, autonom)

**Ziel:** Die ad-hoc `:root`-Tokens in `src/ui/widgets/{call,agent-status,my-number,calls,
calendar}.html` durch die echten, aktuellen Werte aus `apps/web/src/styles/tokens/
{primitives,semantic}.css` ersetzen. Kein Rot/Gruen mehr (Vor-Rebrand-Palette), Navy als
einzige Akzentfarbe, Karten-Radius von der Control-Radius unterschieden, Schatten
ergaenzt, Font-Fallback-Stack korrigiert.

**Betroffene Dateien:** die 5 Widget-HTML-Dateien unter `src/ui/widgets/`. Keine
JS-/Server-Datei.

**Konkrete Zielwerte (aus `apps/web/src/styles/tokens/primitives.css` +
`semantic.css`, PLAN Abschnitt 2 — als Ausgangspunkt, der Plan-Schritt der Phase liest
die echten Dateien nochmal nach, falls sie sich seither geaendert haben):**

```
--color-ink-900:#25282b;      /* Text, unveraendert */
--color-gray-500:#7e7e7e;     /* gedaempfter Text, unveraendert */
--color-gray-150:#ececec;     /* Karten-Rahmen, unveraendert */
--color-gray-300:#c4c4c4;     /* inaktiv/off-Indikator (ersetzt gruen fuer "idle/aus") */
--color-white:#fff;
--color-navy-700:#1b4f86;     /* die EINE Aktionsfarbe (ersetzt rot) */
--color-navy-50:#eef3fa;      /* zarte Navy-Tint-Flaeche (Status-Badge-Hintergrund) */
--radius-card:18px;           /* Karten-Aussenradius (war 12px = Control-Radius) */
--radius-control:12px;        /* Buttons/Inputs (unveraendert im Wert, jetzt korrekt benannt) */
--radius-pill:99px;           /* Badges/Pills */
--shadow-card:0 6px 18px rgba(0,0,0,.07);  /* NEU - fehlte komplett */
--font-sans:"Space Grotesk","Helvetica Neue",Arial,sans-serif;  /* war system-ui */
```

Status-Darstellung: KEIN `--color-red-600`/`--color-green-500` mehr. Positiv/completed =
Navy-auf-Navy-50 (`--color-navy-700` Text auf `--color-navy-50` Flaeche). Kritisch/failed
= Ink-auf-Gray-150 (`--color-ink-900` auf `--color-gray-150`). Der Cancel-Button (in
`call.html`) verliert seine rote Fuellung — sekundaerer/"ghost"-Stil (Ink-Text, weisser
Grund, `--color-gray-150`-Rahmen), konsistent mit dem einzigen Aktionsakzent Navy fuer
Primaerhandlungen; die Phase grundet den exakten Button-Stil gegen
`design-system/components/core/Button.jsx` (Ghost-Variante) statt den Wert zu erfinden.

**Deterministisches AC:**
1. `grep -rn "color-red-600\|color-green-500" src/ui/widgets/` -> kein Treffer.
2. Jede der 5 Dateien enthaelt `--color-navy-700:#1b4f86` und `--shadow-card:0 6px 18px
   rgba(0,0,0,.07)` (oder eine functionally-identische Formulierung, per Test auf den
   berechneten Wert statt String-Match, falls die Phase Space-Formatierung aendert).
3. `.card`-Regel (oder aequivalente Wrapper-Klasse) in jeder Datei nutzt einen 18px-Radius
   fuer die Karte selbst (nicht 12px).
4. `node --check` entfaellt (reine HTML/CSS-Dateien) — dafuer: bestehende
   `test/mcp-ui-w1-bind.test.js`/`test/mcp-ui-w1-call-widget.test.js`/`test/mcp-ui.test.js`
   bleiben gruen (reiner Style-Diff darf keine Slot-Namen/`data-mcp`-Attribute/Skript-
   Logik veraendern - nur `<style>`-Block + Farb-/Radius-/Schatten-Klassenwerte).
5. `npm test` -> 0 Fehler, keine neuen Tests notwendig (reiner Style-Refactor ohne neues
   Verhalten - Clean-Code P11 verlangt hier KEINEN neuen Test, siehe `clean-code.md`
   "reiner Refactor laesst die Bestandssuite ohne Test-Aenderung gruen").
6. Sicht-Check (Teil des Impl-Reports, kein automatisierter Test): ein Screenshot/Diff
   der `.card`-Darstellung gegen `design-system/mcp/call-status.html` (Mockup) zeigt
   sichtbar denselben Radius-/Schatten-/Farb-Charakter (keine pixelgenaue Uebereinstimmung
   verlangt, nur "erkennbar dieselbe Sprache").

**Verifikation:** die grep-Checks + `npm test` (Bestandssuite gruen) + der Sicht-Check im
Report.

**Abhaengigkeit:** keine (erste Phase).

**Safety-Notiz:** reiner CSS-/Markup-Diff in Widget-HTML, kein `src/`-JS beruehrt. Kein
Sicherheits-relevanter Pfad im Diff.

---

## T2 — Wing-Integration (autonom, baut auf T1 auf)

**Ziel:** `WingMark`-Prinzip (reine CSS-Keyframes + ein `<img>`, siehe
`design-system/components/brand/WingMark.jsx` + `wing-image.js`) nach `call.html`
portieren: ein kleiner (ca. 28-32px) Wing neben dem Titel ("Anruf"/"Hermes ruft fuer dich
an"), dessen Animation an die BEREITS VORHANDENE Status-Zustandsmaschine gekoppelt ist
(dieselbe Funktion, die heute `data-mcp="status"` befuellt, `updateForStatus` in
`call.html`). Zusaetzlich: eine STATISCHE idle-Wing-Marke (kein Status-Wechsel noetig, da
diese 4 Tools keinen Anruf-Lebenszyklus haben) im Header der 4 anderen Widgets
(`agent-status`, `my-number`, `calls`, `calendar`) fuer durchgaengige Markenpraesenz.

**Betroffene Dateien:** `src/ui/widgets/call.html` (Wing + State-Mapping),
`src/ui/widgets/{agent-status,my-number,calls,calendar}.html` (nur statische Wing-Marke im
Header, kein Skript-Diff).

**State-Mapping (WingMark-States sind exakt 5, siehe PLAN Abschnitt 6 fuer die
`cancelled`-Ausnahme):**

```
JS-Status "dialing"    -> Wing-Status "connecting"
JS-Status "in_progress" -> Wing-Status "working"
JS-Status "completed"   -> Wing-Status "success"
JS-Status "failed"      -> Wing-Status "error"
JS-Status "cancelled"   -> Wing-Status "error"   (kein 6. State erfunden, PLAN Abschnitt 6)
(kein Status/initial)   -> Wing-Status "idle"
```

**Portierung (kein React/JSX, kein Build-Step):**
- Die 6 `@keyframes` aus `WingMark.jsx` (`hermesWingDrift`, `hermesWingBob`,
  `hermesWingConnect`, `hermesWingFlap`, `hermesWingSuccess`, `hermesWingError`) 1:1 als
  Vanilla-`<style>`-Block in `call.html` (bereits ein self-contained Inline-`<style>`-
  Widget, kein neues Muster).
- Das Wing-PNG aus `design-system/components/brand/wing-image.js` (`WING_PNG`-Konstante,
  bereits ein `data:image/png;base64,...`-String) als `<img src="...">` einbetten — KEIN
  neuer externer Link, reine Kopie eines Bytestrings.
- Statuswechsel setzt/wechselt eine CSS-Klasse auf dem Wing-Wrapper (z.B.
  `wing--connecting`), NICHT `innerHTML` — die bestehende `updateForStatus`-Funktion
  bekommt einen zusaetzlichen, klar benannten Aufruf (kein neuer globaler Seiteneffekt,
  ein Argument mehr ist nicht noetig, da der Status bereits als Parameter vorliegt).
- `prefers-reduced-motion: reduce` deaktiviert alle Wing-Keyframes (1:1 aus `WingMark.jsx`
  uebernehmen, nicht neu erfinden).
- Statische Widgets (T2, zweiter Teil): idle-Wing OHNE Skript-Aenderung, nur Markup + der
  `hermesWingDrift`/`hermesWingBob`-Keyframe-Block (idle-Loop reicht, kein
  Connecting/Working/Success/Error-Code in diesen 4 Dateien noetig — kleinerer
  Blast-Radius, YAGNI).

**Deterministisches AC:**
1. `call.html` enthaelt alle 6 Keyframe-Namen (`hermesWingDrift`, `hermesWingBob`,
   `hermesWingConnect`, `hermesWingFlap`, `hermesWingSuccess`, `hermesWingError`).
2. `call.html` enthaelt `prefers-reduced-motion`.
3. Ein Test (neu, `test/mcp-ui-w1-call-widget.test.js` erweitert oder neue Datei) simuliert
   je einen Statuswechsel (`dialing`/`in_progress`/`completed`/`failed`/`cancelled`) und
   prueft, dass der Wing-Wrapper die erwartete Zustandsklasse traegt (JSDOM-Sim wie im
   Bestand, `node:vm`).
4. Kein `innerHTML` fuer den Wing (statisches `<img>`-Tag im HTML, Klassenwechsel nur ueber
   `className`/`classList`, NIE ueber geparstes Markup).
5. Die 4 anderen Widgets enthalten den idle-Wing (`hermesWingBob`/`hermesWingDrift`), aber
   KEINE der uebrigen 4 State-Keyframes (kein toter Code fuer States, die dort nie
   auftreten) — per grep verifizierbar.
6. `npm test` -> 0 Fehler (neue Tests + Bestand gruen).
7. `git diff` auf `src/mcp-tools.js`, `src/ui/widget-bind.js`, `src/ui/widget-catalog.js`
   -> leer (reiner Widget-Inhalts-Diff, keine Katalog-/Bind-Aenderung noetig, da kein
   neues Widget entsteht).

**Verifikation:** die grep/Test-Checks + `npm test` + Sicht-Check (Wing animiert sichtbar
beim manuellen Oeffnen der Datei im Browser mit den vier Status-Werten simuliert, Teil des
Reports).

**Abhaengigkeit:** T1 (branch von T1s Merge-Commit, damit die Wing-Marke die bereits
korrigierten Navy-Tokens nutzt statt die alten Rot/Gruen-Werte erneut zu referenzieren).

**Safety-Notiz:** reiner Widget-Inhalts-Diff, keine Tool-Handler/Server-Datei beruehrt.

---

## T3 — MCP-Server-Icon (autonom, unabhaengig von T1/T2)

**Ziel:** `serverInfo.icons` setzen (PLAN Abschnitt 4), damit Claude/ChatGPT ein
Hermes-Icon statt des generischen Platzhalters zeigen KOENNEN (Live-Wirksamkeit erst nach
Deploy pruefbar, siehe Abschnitt "Nicht autonom" unten).

**Betroffene Dateien:** `src/mcp-server.js` (serverInfo), neue Datei
`public/brand/hermes-icon.png` (kopiert aus einer bestehenden Wing-Asset-Quelle — die
Phase waehlt zwischen `apps/hermes-studio/public/hermes-logo.png` [1024x1024, Navy-Flaeche
+ weisser Wing, sofort einsatzbereit] und einem aus `design-system/assets/logos/` kopierten
Asset; Kriterium: Format muss auf jedem Host-Hintergrund lesbar sein, also KEIN
transparentes Freisteller-PNG als alleiniges Icon), optional `public/favicon.ico`
(defensiv, PLAN Abschnitt 4).

**Konkrete Aenderung in `src/mcp-server.js`:**
```js
const server = new McpServer(
  {
    name: "hermes",
    version: "0.2.0",
    icons: [{ src: `${config.publicUrl}/brand/hermes-icon.png`, mimeType: "image/png", sizes: ["1024x1024"] }],
  },
  serverOptions,
);
```
`config.publicUrl` existiert bereits (siehe `src/config.js`, wird schon fuer
Webhook-/TeXML-URLs verwendet) — kein neuer Konfig-Wert.

**Deterministisches AC:**
1. `public/brand/hermes-icon.png` existiert, ist ein valides PNG (`file`-Check).
2. `src/mcp-server.js`: `serverInfo`/`new McpServer(...)`-Aufruf traegt ein `icons`-Array
   mit mindestens einem Eintrag, `src` beginnt mit `${config.publicUrl}` (kein
   hartkodierter Hostname, PLAN-Konsistenz mit dem Rest der Config-Zentralisierung).
3. Ein Test (neu oder erweitert) faehrt einen echten `initialize`-Request gegen den
   MCP-Endpunkt (Muster wie bestehende MCP-Smoke-Tests) und prueft
   `result.serverInfo.icons[0].src` enthaelt `/brand/hermes-icon.png`.
4. `node --check src/mcp-server.js` fehlerfrei.
5. `npm test` -> 0 Fehler.
6. Statische Auslieferung: ein `curl`/Supertest-Check, dass `GET
   ${config.publicUrl-relativ}/brand/hermes-icon.png` (bzw. der lokale Server-Pfad) 200 +
   `content-type: image/png` liefert (Express liefert `public/` bereits statisch aus —
   die Phase verifiziert das gegen die bestehende Static-Middleware, fuegt KEINE neue
   Route hinzu, wenn `public/` schon global gemountet ist).

**Verifikation:** die Checks oben + `npm test` + lokaler Smoke (`SKIP_TWILIO_SIGNATURE_
CHECK=true`, `/mcp` `initialize` per curl, `icons`-Feld in der Antwort).

**Abhaengigkeit:** keine harte Abhaengigkeit zu T1/T2 (andere Dateien) — laeuft in dieser
Kette trotzdem sequenziell NACH T2 (Merge-Reihenfolge-Einfachheit, kein technischer Grund).

**Safety-Notiz:** Server-Identitaets-Metadaten + ein neues statisches Asset, kein
Tool-Handler/Gate/Auth-Pfad im Diff. `config.publicUrl` ist bereits vertrauenswuerdige,
zentrale Config - kein neuer Angriffsvektor.

---

## V — Visuelle Verifikation (NICHT autonom, Lead + Owner)

- Lokal: Server starten, die 5 Widget-Dateien direkt im Browser (Chrome-Extension)
  gegenueber den passenden `design-system/mcp/*.html`-Mockups screenshotten und
  vergleichen (Farbe/Radius/Schatten/Wing-Praesenz). `initialize`-Response-Icon-Feld
  gegen den Test aus T3-AC3 nochmal manuell per curl bestaetigen.
- NICHT autonom / Owner-Gate: `git push upstream master` (macht live) + ein erneuter
  Claude-Connector-Check (Icon), da das Icon nur nach einem echten Re-Sync des Hosts
  pruefbar ist. Diskriminator: das Hermes-Icon (nicht der graue Wuerfel) erscheint in
  `claude.ai/customize/connectors`.
- Feedback-Loop mit dem Owner VOR dem Push: Screenshots zeigen, auf Rueckmeldung zum
  visuellen Ergebnis warten (Owner hat explizit einen Feedback-Loop verlangt, nicht nur
  ein "fertig"-Report).

## Merge-/Abschluss-Notizen fuer den Lead

- Nach jeder Phase: `tasks/<phase>-report.md` pruefen (PASS?), dann lokal mergen.
- Nach T3: gesamte autonome Kette in lokalem `master`; Push `upstream` erst nach
  Owner-Freigabe (V-Abschnitt).
- Design-Entscheidungen der Kette als Memory festhalten (Muster wie
  [[mcp-ui-live-widget-chain]]): welche Token-Werte final verwendet wurden, ob der
  Live-Icon-Check nach Deploy gruen war.
