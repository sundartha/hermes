# T2 — Wing-Integration (call.html + 4 andere Widgets): Detailbericht

- **Gate:** BLOCKED
- **finalBranch:** `phase/widget-branding-t2-fix2`
- **Basis:** `76bfa6b` (T1 bereits gemergt)
- **headCommit (Impl-Runde):** `c1f1825b5b85966761b54f651e2777d5160929a6`

## 1. Plan (gekuerzt)

Grundlage: `tasks/mcp-widget-branding-chain.md` (Abschnitt T2), `PLAN-MCP-WIDGET-BRANDING.md` (Abschnitt 3, 6), `.claude/refs/clean-code.md`, die 5 Widget-Dateien (T1 bereits gemergt, Navy-Tokens/Radius/Schatten vorhanden), `design-system/components/brand/WingMark.jsx` + `wing-image.js`, bestehende Tests (`mcp-ui-w1-call-widget.test.js`, `mcp-ui-w1-bind.test.js`, `mcp-ui.test.js`), `src/ui/widget-catalog.js`, `src/ui/widget-bind.js`, `scripts/check-token-sync.js`.

### Design-Entscheidungen des Plans

1. `.dot` in den 4 statischen Widgets wird durch die Wing-Marke **ersetzt**, nicht ergaenzt (kein Doppel-Icon, G12); `.dot`-CSS-Regel entfaellt (kein toter Code, G9).
2. `data-wing` nur in `call.html` — die 4 statischen Widgets bekommen `class="wing wing--idle"` + `aria-hidden="true"`, aber kein `data-wing` (kein Hook ohne Skript, G2/G12).
3. Kein Drop-Shadow/Brightness-Filter aus `WingMark.jsx` portiert (nicht Teil der AC, Scope-Grenze).
4. `--wing-size:28px` als neue benannte CSS-Custom-Property in allen 5 `:root`-Blöcken (kein Magic Number, G25), identisch überall.
5. `alt=""` + `aria-hidden="true"` auf dem Wing (rein dekorativ).
6. `WING_PNG` wird **nicht von Hand abgeschrieben** (171 KB Base64) — Empfehlung: programmatisch aus `wing-image.js` einlesen und via Platzhalter (`__WING_PNG__`) in die 5 Zieldateien einsetzen; Byte-Identitäts-Test als Sicherheitsnetz.
7. Kein Eingriff in `scripts/check-token-sync.js`/`tokens.lock` (prüft nur `@import`, Diff bleibt grün ohne das Gate anzufassen).
8. Test importiert `WING_PNG` direkt via ESM aus `design-system/components/brand/wing-image.js` (reiner Test-/Dev-Zeit-Bezug, keine Laufzeit-Kopplung von `src/` zu `design-system/`).

### Diff-Umfang laut Plan

- `src/ui/widgets/call.html`: Token `--wing-size`, neuer CSS-Block (6 Keyframes: `hermesWingDrift/Bob/Connect/Flap/Success/Error` + `prefers-reduced-motion`), verschachteltes Markup `.wing > .wing-inner > img` mit `data-wing`, JS-Konstanten (`WING_STATUS_IDLE`, `WING_STATUS_BY_CALL_STATUS` — Mapping `dialing→connecting, in_progress→working, completed→success, failed→error, cancelled→error`), zwei reine Funktionen (`wingStatusFor`, `updateWingForStatus`, ausschliesslich `className`-Mutation, nie `innerHTML`), ein Aufruf in `updateForStatus`.
- 4 statische Widgets (`agent-status.html`, `my-number.html`, `calls.html`, `calendar.html`): Token + nur die idle-Keyframes (Drift+Bob, keine der 4 State-Keyframes, YAGNI/G9), `.dot`-Span durch die statische idle-Wing-Marke ersetzt (kein `data-wing`).
- Neue/erweiterte Tests: `test/mcp-ui-w1-call-widget.test.js` (2 neue Tests: Keyframes/Reduced-Motion/Byte-Identität, 5 Statuswechsel inkl. `cancelled→error`), neue Datei `test/mcp-ui-wing-static.test.js` (parametrisiert über die 4 statischen Widgets: idle-Wing, Byte-Identität, kein `.dot` mehr, keine ungenutzten State-Keyframes, kein `innerHTML`).
- Invariante (0 Diff verlangt): `src/mcp-tools.js`, `src/ui/widget-bind.js`, `src/ui/widget-catalog.js`, `src/server.js`, `src/claude.js`, `src/bridge.js`.

### Risiken/Pre-Mortem (Plan)

- Base64-Transkriptionsfehler beim Einbetten (171 KB × 5 Dateien) unsichtbar im Diff-Review → gemildert durch Byte-Identitäts-Assertion in beiden Tests.
- Payload-Zuwachs ~5 × 171 KB ≈ 850 KB über die 5 Widget-Dateien, einmalig beim Modul-Load — als bewusste Kette-Vorgabe akzeptiert, nur Sichtbarkeits-Notiz.
- Kein Resize-Feedback-Schleifen-Risiko (Keyframes animieren nur `transform`, `ResizeObserver` in `widget-bind.js` beobachtet `doc.body`).
- `.dot`-Entfernung ist eine ueber die reine Anweisung hinausgehende Aufräumaktion — explizit begründet, leicht revertierbar.

## 2. Impl-Zusammenfassung

T2 wurde exakt nach Plan umgesetzt:

- `call.html` erhielt den vollen Wing-Marken-Diff: Token `--wing-size`, 6 Keyframes + `prefers-reduced-motion`, verschachteltes `.wing`/`.wing-inner`/`<img>`-Markup mit `data-wing`, `WING_STATUS_BY_CALL_STATUS`-Mapping + `wingStatusFor()`/`updateWingForStatus()` + Aufruf in `updateForStatus`.
- `agent-status.html`, `my-number.html`, `calls.html`, `calendar.html` erhielten Token + nur den idle-Keyframe-Block (Drift+Bob, keine State-Keyframes) und ersetzten ihren jeweils einzigen `.dot`-Span durch die statische idle-Wing-Marke.
- `WING_PNG` wurde programmatisch (Node-Einmal-Skript im Scratchpad, danach gelöscht) byte-identisch aus `design-system/components/brand/wing-image.js` in alle 5 Dateien via `__WING_PNG__`-Platzhalter eingesetzt — kein Hand-Abschreiben, per Test verifiziert (`html.includes(WING_PNG)`).
- `test/mcp-ui-w1-call-widget.test.js` erweitert (`className` am Fake-Element, `[data-wing]`-Selektor + `wing()`-Accessor, 2 neue Tests).
- Neue Datei `test/mcp-ui-wing-static.test.js`: prüft alle 4 statischen Widgets parametrisiert (idle-Wing vorhanden, kein `.dot` mehr, keine ungenutzten State-Keyframes, kein `innerHTML`, Byte-Identität).
- `scripts/check-token-sync.js` bleibt grün (kein `@import` eingeführt).
- `mcp-tools.js`/`server.js`/`widget-bind.js`/`widget-catalog.js`/`claude.js`/`bridge.js` unangetastet (per `git diff master...HEAD --name-only` verifiziert).
- Voller `npm test` (json + pglite im selben Lauf): **1477/1477 grün**, 0 Fehler.
- Commit `c1f1825` auf Branch `phase/widget-branding-t2` (Basis `76bfa6b`), `node_modules`-Symlink nicht getrackt.

### Deviations

1. **WING_PNG-Präfix.** Die Plan-Diff-Notation lautete `src="data:image/png;base64,<WING_PNG 1:1 aus wing-image.js>"`; `WING_PNG` in `wing-image.js` enthält aber bereits den vollen Data-URI-Präfix (bestätigt per `wc -c`/Read). Ein wörtliches Kopieren des Snippets hätte den Präfix verdoppelt (kaputtes, unsichtbar defektes Bild). Umgesetzt gemäss der eigenen Plan-Vorgabe Abschnitt 0.6 (Platzhalter + programmatische Substitution): `src="__WING_PNG__"` wird 1:1 durch den `WING_PNG`-String ersetzt, kein doppelter Präfix — inhaltlich das vom Plan gemeinte Ergebnis.
2. **Kommentar-Wortwahl wegen Testkonflikt.** Zwei neue Kommentare (CSS-Block-Kommentar + JS-Funktionskommentar in `call.html`) enthielten wörtlich den String `innerHTML`, was den bestehenden fail-closed Test `T-W1-call-AC6` (globale Substring-Prüfung gegen `innerHTML` im gesamten Widget-HTML, auch Kommentare) brach. Umformuliert zu "kein HTML-Ersetzen" bei identischer Aussage — kein Verhalten geändert, nur Wortwahl.

## 3. Safety-Urteil

**APPROVED** (final, Runde fix2).

- `testsPassIndependently`: true — eigener Lauf im frischen Worktree (`review-t2-r2`, `node_modules` per Symlink): 1477/1477 pass, 0 fail, ~91s. Deckt beide Backends ab (Default json + mehrere dedizierte pg/pglite-Tests). Die 2 T2-spezifischen Testdateien separat verifiziert: 17/17 pass, inkl. der bestehenden unveränderten AC6-Guard (kein `innerHTML`/`@import`/`<link/href=`).
- Safety-Gates intakt, Disclosure intakt, Auth-Fail-Closed intakt, keine Secrets geleakt, Scope respektiert, Verhalten wie beabsichtigt.
- **Verdict-Begründung:** 0 Diff auf `src/mcp-tools.js`, `src/server.js`, `src/ui/widget-bind.js`, `src/ui/widget-catalog.js`, `src/claude.js`, `src/bridge.js` (per Merge-Base-Diff verifiziert). Kein CDN-`<script src=http>`, kein `@import`/`<link>` irgendwo im Diff. Kein `innerHTML`; Statuswechsel läuft ausschliesslich über `wing.className = "wing wing--" + wingStatusFor(status)` mit fest verdrahteter Allowlist-Map + hartem `idle`-Fallback (keine Injection-Fläche selbst bei attacker-beeinflusstem MCP-Status). `call.html`: 88 Insertions / 0 Deletions, bestehende Poll-/Brücken-/Cancel-Logik byte-identisch ausserhalb der einen additiven Aufrufzeile. Eingebetteter Base64-Payload ist ein echtes 500×500-PNG, byte-identisch zur Repo-Quelle. Keine API-Key/Token/Secret/Bearer-Muster im Diff.

### Concerns (nicht blockierend)

1. **Diff-Form-Abweichung:** `git diff master...HEAD` (Merge-Base) betrifft 5 Widget-HTML-Dateien + **zwei** Testdateien statt der vorgegebenen "höchstens eine Testdatei". Beide Testdateien testen ausschliesslich das T2-Feature selbst, keine der verbotenen Dateien ist berührt (0 Diff auf allen sechs) — als kleine, ungefährliche Scope-Nuance gewertet.
2. **Branch-Staleness (kein T2-Fehler):** `git diff master HEAD` (Zwei-Punkt, ohne Merge-Base) zeigt zusätzlich Änderungen an `public/brand/hermes-icon.png`, `src/mcp-server-info.js`, `src/mcp-server.js`, `src/server.js` und einer Testdatei. Ursache: master hat nach dem T2-Branchpoint einen separaten T3-Merge bekommen (`2fd7b87`), den T2 (Basis `76bfa6b`) noch nicht hat. Per Merge-Base-Diff (korrekt für Feature-Branch-Review) sind exakt die 5 Widget-HTMLs + 2 Testdateien betroffen.
3. **5x-Duplizierung des Base64-Blobs:** Alle 5 Widget-HTML-Dateien tragen denselben ~168 KB Base64-PNG-Blob (`WING_PNG`) literal eingebettet (5× Duplikat, ~840 KB Diff-Grösse). Bewusste, im Commit `cabca61` explizit dokumentierte Entscheidung (Runde-1-Dedup-Versuch über `widget-catalog.js` wurde als unautorisierte Scope-Ausweitung erkannt und zurückgerollt) — kein Blocker aus Safety-Sicht, aber Performance/Payload-Note für eine spätere bewusste Dedup-Phase mit Owner-Freigabe.

## 4. Clean-Code-Audit (S1-S4)

**Verdict: BLOCKED (1× S2).**

### S1 (Blocker-Kategorie: kritisch)

Keine Funde.

### S2 (Blocker)

1. **G5 · `src/ui/widgets/agent-status.html`, `calendar.html`, `calls.html`, `my-number.html`, `call.html`.** Das `WING_PNG`-Data-URI (ca. 171 KB Base64, identischer md5 in allen 5 Dateien) UND der komplette Wing-CSS/Keyframe-Block sind wörtlich 5× dupliziert (~855 KB Gesamt-Duplizierung im Diff). Verifiziert per `diff` zwischen den idle-CSS-Blöcken aller 4 statischen Widgets (0 Zeilen Unterschied) und per md5-Vergleich der Base64-Payload. Fix: Injektion an EINER Stelle (Serve-Zeit über `src/ui/widget-catalog.js`, wie in Runde 1 bereits gebaut und funktionsfähig demonstriert) statt Copy-Paste in 5 `.html`-Dateien.

   Einordnung des Auditors: Das Team hat das selbst erkannt, in Runde 1 behoben und in Runde 2 bewusst zurückgesetzt (Commit `cabca61`: "unautorisierte Scope-Ausweitung ... dieser Auftrag schliesst `widget-catalog.js` explizit aus") — die Duplizierung ist damit ein **dokumentiertes akzeptiertes Risiko**, keine übersehene Schlamperei. Der Auditor flaggt sie trotzdem strikt nach Katalog (G5 ist S2, die Duplizierung ist real, messbar und ein Fix wäre nachweislich möglich ohne den Code unklarer zu machen — die Ausnahme in Audit-Regel 3 greift damit nicht), damit der Owner die Risiko-Akzeptanz explizit auch aus Clean-Code-Sicht bestätigt oder die Scope-Erweiterung auf `widget-catalog.js` in einer eigenen, autorisierten Phase nachzieht.

### S3 (nicht blockierend, aber zu beheben)

1. **C2/C4 · `agent-status.html:19`, `calendar.html:19`, `calls.html:19`, `my-number.html:19`, `call.html:29`.** Kommentar verweist auf "PLAN-MCP-WIDGET-BRANDING.md Abschnitt 3" (`call.html` zusätzlich "Abschnitt 6") — diese Datei existiert nirgends im Git-Verlauf des Repos (weder auf master noch auf irgendeinem widget-branding-Branch), sondern liegt nur ungetrackt im Haupt-Arbeitsverzeichnis des Lead. Nach einem Merge ohne das Plan-Doc ist die Referenz nicht auflösbar. Fix: Plan-Doc mitcommitten oder die Begründung (insb. die `cancelled→error`-Entscheidung) direkt im Code-Kommentar ausformulieren statt auf ein externes, nicht versioniertes Dokument zu verweisen.
2. **G22 · `src/ui/widgets/call.html` (`TERMINAL_STATUSES` vs. `WING_STATUS_BY_CALL_STATUS`).** Zwei getrennte lokale Aufzählungen kodieren überlappendes Wissen über den Call-Status-Enum (welche Werte terminal sind bzw. welchem Wing-Zustand sie entsprechen). Kommt serverseitig ein 6. Status hinzu, müssen beide Stellen synchron gepflegt werden, sonst fällt der neue Status stillschweigend auf "idle" zurück (kosmetisch, keine Funktionsstörung). Nicht neu durch T2 eingeführt (`TERMINAL_STATUSES` existierte schon vor T2), aber durch die neue Map verstärkt. Kein Blocker, nur Hinweis für eine spätere Konsolidierung.

### S4 (Stil/Nits)

Keine Funde.

### passNotes (was bereits erfüllt ist)

- Keyframes wortwörtlich identisch zu `design-system/components/brand/WingMark.jsx` (Drift/Bob/Connect/Flap/Success/Error, alle diff-frei geprüft) — kein Neuerfinden von Werten.
- `cancelled→error` ist im Code kommentiert begründet, `WING_STATUS_BY_CALL_STATUS` mappt ausschliesslich auf die 5 vorgegebenen WingMark-Zustände.
- `prefers-reduced-motion` (`.wing, .wing * { animation: none !important; }`) ist in allen 5 Dateien vorhanden.
- `WING_PNG` nachweislich byte-identisch aus `wing-image.js` eingebettet (aktiv per Test geprüft).
- `updateWingForStatus` hat einen Null-Guard, `wingStatusFor` ist eine reine Funktion mit explizitem P5-Kommentar (Command-Query-Trennung).
- Statische Widgets haben nachweislich keine toten State-Keyframes (per Test aktiv verhindert).
- Dekoratives `<img>` korrekt mit `alt=""` + `aria-hidden` auf dem Wrapper.
- Runde 2 hat den Round-1-Fix (`wing-markup.js` + Test) restlos entfernt, `widget-catalog.js` ist wieder byte-identisch zum Vor-T2-Stand (0 Diff) — kein Scope-Leck, keine Karteileichen.
- Alle 1477 Tests grün, keine Sicherheits-/Auth-/Safety-Gate-Berührung.

### topTodos (aus dem Audit)

1. Owner-Entscheidung einholen: 5×-Duplizierung (`WING_PNG` + Keyframe-CSS, ~855 KB) explizit als akzeptiertes Risiko abzeichnen ODER separate autorisierte Phase für Dedup über `widget-catalog.js` (Round-1-Ansatz wiederverwenden).
2. Kommentar-Referenz auf `PLAN-MCP-WIDGET-BRANDING.md` (Abschnitt 3/6) reparieren: Plan-Doc mitcommitten oder Begründung direkt inline ausformulieren, sonst dangling reference nach Merge.
3. Optional/später: `TERMINAL_STATUSES` und `WING_STATUS_BY_CALL_STATUS` auf eine gemeinsame Quelle ziehen, um stillschweigenden Drift bei einem zukünftigen 6. Call-Status zu vermeiden (kosmetisches Risiko, kein Blocker).

## 5. Fix-Runden

- **r1:** T2-Review-Blocker (G5/S2, Wing-Marke-Duplizierung) behoben: `WING_PNG` + Wing-CSS/Keyframes liegen einmal in der neuen `src/ui/wing-markup.js` (baut auf `design-system/components/brand/wing-image.js` auf) statt wörtlich in 5 Widget-Dateien. `widget-catalog.js` injiziert sie per Platzhalter-Replace beim Serve.
- **r2:** Branch `phase/widget-branding-t2-fix2` (von `phase/widget-branding-t2-fix1`) behebt den einen SCOPE-Blocker aus r1: Commit `215575c` (Runde 1) hatte die Wing-CSS/Markup-Duplizierung über eine Server-seitige Platzhalter-Injektion in `src/ui/widget-catalog.js` + eine neue Datei `src/ui/wing-markup.js` gelöst — das war eine **unautorisierte Scope-Ausweitung** (der Auftrag schliesst `widget-catalog.js` explizit aus, siehe Betroffene-Dateien-Invariante im Plan). Fix2 rollt das zurück auf den ursprünglichen Plan-Ansatz (wörtliche 5×-Duplizierung in den Widget-Dateien selbst), womit `widget-catalog.js`/`wing-markup.js` wieder unangetastet sind — die G5/S2-Duplizierung aus r1 kehrt dadurch zurück und ist der finale Blocker im letzten Audit (siehe Abschnitt 4). Ergebnis: **Gate bleibt BLOCKED**, Entscheidung liegt beim Owner (Duplizierung akzeptieren oder eine eigene autorisierte Dedup-Phase mit `widget-catalog.js`-Scope beauftragen).

## 6. Offene Owner-Entscheidung (Zusammenfassung)

Der finale Zustand (`phase/widget-branding-t2-fix2`) ist funktional korrekt und safety-approved, aber clean-code-BLOCKED wegen der bewussten Rückkehr zur 5×-Duplizierung von `WING_PNG` + Keyframe-CSS (~855 KB), nachdem der Dedup-Fix aus r1 als Scope-Verstoss zurückgerollt wurde. Der Owner muss wählen:

- (a) Duplizierung explizit als akzeptiertes Risiko abzeichnen und T2 in diesem Zustand mergen, oder
- (b) eine eigene, autorisierte Phase für die Dedup über `src/ui/widget-catalog.js` beauftragen (Round-1-Ansatz wiederverwenden).

Zusätzlich zu klären: die dangling Kommentar-Referenz auf `PLAN-MCP-WIDGET-BRANDING.md` (Plan-Doc mitcommitten oder Begründung inline ausformulieren).
