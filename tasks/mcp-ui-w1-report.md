# Phase W1 — Gemeinsames Client-Daten-Binding fuer alle Widgets

- **Gate:** PASS
- **finalBranch:** `phase/mcp-ui-w1-binding`
- **headCommit:** `e8d6a75dc0589b29b6523bb7a23a94cfdb28b32c`
- **Tests:** 1132 pass / 0 fail (davon 9 neue W1-Tests)
- **Fix-Runden:** 0

---

## Plan (gekuerzt)

**Ziel:** Ein gemeinsames Client-Daten-Binding, das die `data-mcp="<key>"`-Slots aller 3 Widgets (`call-status.html`, `call-result.html`, `transcript.html`) aus dem host-gepushten `structuredContent` fuellt — XSS-sicher, self-contained, fail-safe, mit genau EINER Quelle (DRY).

**Grounding-Befund (am `master`-Arbeitsbaum verifiziert):**
- Slot-Inventar deckt sich exakt mit dem `structuredContent`-Kontrakt aus `src/mcp-tools.js` (`pickCallStatus` → `call_id`/`status`/`duration_s`/`last_transcript_lines`; `pickTranscript` → `call_id`/`result_summary`/`objective_achieved`). Keine neuen Felder noetig/erlaubt.
- `last_transcript_lines` ist bereits ein Array fertig formatierter Strings (`"Agent: …"`/`"Gegenseite: …"`) — kein `{role,text}`-Parsing noetig.
- `src/ui/widget-catalog.js` liest die Widget-HTML EINMAL beim Modul-Load in `WIDGET_HTML`; `widgetHtml(id)` ist die einzige Lesequelle beider Adapter (`mcp-native.js`, `chatgpt.js`). → EIN Inject-Punkt deckt alle Hosts + alle Widgets ab.
- Token-Gate (`scripts/check-token-sync.js`) hasht Widget-HTML NICHT; Serve-Zeit-Injektion ohne Byte-Aenderung an `.html` haelt `check:tokens` automatisch gruen — kein `tokens.lock`-Update.
- Bestandstest-Constraints (`test/mcp-ui.test.js` AC4/AC6): Resource-HTML darf kein `href=`, kein `<link`, kein `@import`, keine Leak-Strings enthalten und muss mit `<!-- @dsCard` (Zeile 1) beginnen.

**Design-Entscheidung (DRY-Spannung):** EINE Quelle als generiertes Script + Serve-Zeit-Injektion an EINEM Punkt.
- Neues Modul `src/ui/widget-bind.js` enthaelt die Binding-Logik als echte, exportierte, DOM-abstrakte JS-Funktionen (von `node:test` ohne DOM pruefbar) und generiert daraus per `Function.prototype.toString()` den Iframe-Script-Text `BIND_SCRIPT`. Die Logik existiert damit genau einmal; der Script-Text ist eine Projektion derselben Funktionen.
- `widget-catalog.js` fuegt `BIND_SCRIPT` einmalig vor `</body>` in jede Widget-HTML ein (beim Modul-Load, kein per-Request-IO). Beide Adapter erben das automatisch.
- Nicht gewaehlt: Script-Text in jede `.html` kopieren (verletzt DRY/S2, 3 Kopien); externes `<script src>` (Iframe-Sandbox self-contained, kein externer Import → AC6/P5).

**Exportierte Funktionen** (jeweils DOM/Host als Parameter = DIP, testbar; nur `querySelectorAll`/`createElement`/`textContent`/`appendChild`/`removeChild`/`firstChild`, NIE `innerHTML`):
- `isObject(value)` — geteilte Nicht-null-Objekt-Pruefung.
- `readHostData(root)` — Feature-Detection synchroner Host-Bruecke: (a) `root.openai.toolOutput` (ChatGPT/skybridge), (b) `root.mcpToolOutput` (MCP-nativ/Claude, Kandidat); keine Bruecke → `null`.
- `readMessageData(message)` — `postMessage`-Handshake: `event.data.toolOutput` | `event.data.structuredContent`.
- `renderLines(doc, container, lines)` — Array → je Zeile ein `<div class="turn">` via `textContent`; Container vorher per `firstChild`/`removeChild` leeren.
- `applyField(doc, key, value)` — fuellt alle `[data-mcp="<key>"]`-Slots; Array → `renderLines`, sonst `textContent = String(value)`.
- `bind(doc, data)` — iteriert Host-Objekt-Keys; `null`/`undefined` uebersprungen.
- `run(root)` — Bootstrap im Iframe: synchrone Bruecke lesen + binden + `message`-Listener; alles in try/catch (fail-safe no-op).

`BIND_SCRIPT` = `buildBindScript()`-Projektion aller Funktionen + `LINE_CLASS`-Konstante, abgeschlossen mit `run(window);`. Funktionsdeklarationen im IIFE gehoistet → Querverweise im Scope; kein `href=`/`<link>`/`@import` (AC6 erfuellt).

**Blast-Radius (geplant):** Neu `src/ui/widget-bind.js`, `test/mcp-ui-w1-bind.test.js`; geaendert `src/ui/widget-catalog.js` (Import + Inject-Punkt) + 3 Kommentar-Zeilen in den Widget-HTML (C2, risikolos). Unberuehrt: `mcp-tools.js`, `ports.js`, `registry.js`, `contract.js`, beide Adapter, `config.js`, `check-token-sync.js`, `tokens.lock`.

---

## Impl-Zusammenfassung

Phase W1 wie geplant umgesetzt:

- **Neu `src/ui/widget-bind.js`:** gemeinsame Binding-Logik als pure, testbare Funktionen (`isObject`/`readHostData`/`readMessageData`/`renderLines`/`applyField`/`bind`/`run`); `BIND_SCRIPT` als `toString`-Projektion derselben Funktionen (eine Quelle). Benannte Konstanten `BODY_CLOSE`/`LINE_CLASS` (keine Magic Numbers).
- **`src/ui/widget-catalog.js`:** `withBindScript(html)` injiziert `BIND_SCRIPT` EINMAL je Serve vor `</body>` in jede Widget-HTML (defensives Anhaengen, falls `</body>` fehlt). Beide Adapter (`mcp-native`, `chatgpt`) und alle 3 Widgets erben es automatisch ueber `widgetHtml(id)`.
- **Feature-Detection** deckt `window.openai.toolOutput`, `window.mcpToolOutput` und den `postMessage`-Handshake defensiv ab; XSS-sicher (nur `textContent`, nie `innerHTML`), self-contained (kein `@import`/`href`/`<link>`), fail-safe ohne Bruecke.
- **3 Widget-HTML-Kommentare (C2)** praezisiert (Bytes nur in Kommentaren geaendert).
- **Neu `test/mcp-ui-w1-bind.test.js`:** 9 W1-Tests mit lokalem Fake-DOM (kein Dep, kein DOM, kein Spawn): DRY-Quelle (`split(BIND_SCRIPT).length === 2` je Widget), XSS statisch (`!BIND_SCRIPT.includes("innerHTML")`) + verhaltensbasiert, Array-Rendering (2 `.turn`-Knoten, Re-Bind ohne Doppeln), fehlende/`null`-Felder uebersprungen, Feature-Detection (alle Kanaele + Muell→`null`), fail-safe `run`, Slot-Kontrakt-Abdeckung beider Whitelists, `applyField`/`renderLines` direkt.

**Verifikation:**
- `node --check` beider JS-Dateien gruen.
- `npm test`: 1132 pass / 0 fail (davon 9 neue W1-Tests); AC4/AC6 der Bestandssuite unberuehrt gruen.
- `check:tokens`: direkt ausgefuehrt Exit 0 (`OK - Tokens synchron`). Hinweis: der `npm`-Wrapper meldet Exit 194 — ein Sandbox-Artefakt des `node_modules`-Symlinks, kein echter Fehler.
- node-Smoke: `widgetHtml(id)` traegt fuer alle 3 Widgets das injizierte Binding (`run(window);` vor `</body>`, `data-mcp`-Slots vorhanden).

Committet auf `phase/mcp-ui-w1-binding` (`e8d6a75`).

### Deviations
Keine. Plan 1:1 umgesetzt (inkl. der als optional markierten 3 C2-Kommentar-Edits).

### Fuer den W2-Live-Smoke zu bestaetigen
- Welcher Host-Kanal real traegt: (a) ChatGPT/skybridge `window.openai.toolOutput` synchron; (b) MCP-nativ/Claude — ob injiziertes Global (`window.mcpToolOutput`, Kandidat) ODER der `postMessage`/`message`-Event (`event.data.toolOutput`/`structuredContent`) der reale Mechanismus ist. W1 deckt alle drei defensiv ab; W2 bestaetigt den tatsaechlichen und entfernt ggf. ungenutzte Kandidaten.
- Timing: ob das Tool-Output beim Iframe-Load schon am Global haengt oder erst per Event nachgereicht wird (deshalb Listener + synchroner Read).

---

## Safety-Urteil

**APPROVED.** W1 sauber gescoped: nur `src/ui/widget-bind.js` (neu) + `widget-catalog.js` (`BIND_SCRIPT` einmal vor `</body>` zur Modul-Ladezeit injiziert) + 3 reine Kommentar-Aenderungen in den Widget-HTMLs + neuer Test. Kein neuer npm-Dep, keine config/auth/safety/disclosure-Aenderung.

- Safety-Gates intakt; `numberGateError` unberuehrt; `cancel_call` laeuft weiter als normaler authentisierter Host-MCP-Tool-Call durch alle Gates (Regel 1 unberuehrt).
- Disclosure intakt; `claude.js`/`bridge.js` nicht im Diff.
- Auth fail-closed intakt; keine neuen Endpunkte/Auth-Aenderungen.
- Keine Secrets geleakt.
- XSS-sicher (nur `textContent`, nie `innerHTML`, kein `@import`/`href`/`<link>`); host-Daten landen nur in passende `data-mcp`-Slots, server-seitige DSGVO-Whitelist bleibt der Gate.
- Flag-aus byte-identisch: `widgetHtml` nur via UI-Adapter geliefert, gegated durch `config.mcpUiEnabled` (Default aus).
- Eigene Tests unabhaengig gruen (1132/0).

**Concern (kein Blocker):** Unter `STORE_BACKEND=pg` gegen echte Postgres scheitern 2 Tests (`store-purge`, `tenant-erasure`) — auf `master` IDENTISCH, reine Umgebungslimitierung (fehlende non-superuser `NOBYPASSRLS DATABASE_URL`), nicht durch W1 verursacht (W1 beruehrt nur `src/ui/`).

---

## Clean-Code-Audit (S1–S4)

**Verdict: PASS** — keine S1/S2-Verstoesse. Reife, bewusst single-sourced Scheibe (`BIND_SCRIPT` via `Function.prototype.toString` = eine Quelle, kein Copy-Paste je `.html`). XSS-Disziplin durchgehend (nur `textContent`, nie `innerHTML`) und durch Tests verriegelt.

**S1 (Blocker):** keine.

**S2 (Blocker):** keine. DRY vorbildlich: Binding-Logik existiert genau einmal, Test `T-W1-AC1` verriegelt "genau eine Quelle je Widget".

**S3 (sollte):**
- **W1-S3-1** · `src/ui/widget-bind.js` (`applyField`): CSS-Selektor per String-Konkatenation aus dem host-gepushten Schluessel (`'[data-mcp="'+key+'"]'`); ein Schluessel mit `"` oder `]` wuerfe in `querySelectorAll` einen `SyntaxError`. Heute unkritisch (Schluessel = server-gewhitelistetes `structuredContent` UND `run()` ist fail-safe gekapselt), aber der direkte `bind()`/`applyField()`-Pfad (Tests, kuenftige Aufrufer) ist ungeschuetzt. Fix: Schluessel gegen Slot-Whitelist pruefen oder `CSS.escape`/Attribut-Iteration.
- **W1-S3-2** · `src/ui/widget-bind.js` (`LINE_CLASS`-Kommentar) + `src/ui/widgets/call-result.html`: `LINE_CLASS="turn"` ist nur in `call-status.html` als `.turn`-Stil definiert; `call-result.html` hat ebenfalls einen `last_transcript_lines`-Slot und bekommt damit `<div class="turn">` ohne passende `.turn`-Regel (ungestylt). Der Kommentar "matcht `.turn` in den Widget-Styles" verallgemeinert ueber (C2/G11). Dashboard-Optik = Smoke, kein Korrektheitsfehler. Fix: `.turn`-Stil in `call-result.html` ergaenzen oder Kommentar auf `call-status` einschraenken.

**S4 (nice-to-have):**
- **W1-S4-1** · `src/ui/widget-bind.js`: 7 exportierte Klein-Funktionen, mehrere primaer als Test-Seam. Vertretbar (DOM-freie `node:test`-Pruefbarkeit), niedrigste Prioritaet, kein Handlungsbedarf — reiner Hinweis.

**Pass-Notes:** P11/T1 — neues Verhalten vollstaendig getestet (9 Tests, kein Netz/Spawn/Dependency, DOM via Fake), Grenzfaelle abgedeckt (`null`/`undefined`-Skip, unbekannte Keys, Re-Bind ohne Doppeln, fehlende Bruecke). Feature-Detection statt hart verdrahteter Konvention (fail-safe → `null`). `run()` faengt bewusst alles ab (leerer catch mit begruendetem Kommentar = dokumentierter fail-safe no-op). Server-Sicherheit unabhaengig: `cancel_call` laeuft weiter durch alle Gates, DSGVO-Whitelist im transcript-Widget respektiert. `node --check` beider JS-Dateien sauber.

---

## Fix-Runden

**0 Fix-Runden.** Dualer Review (Safety APPROVED + Clean-Code PASS) im ersten Durchlauf bestanden; keine S1/S2-Blocker. Die 2 S3-Nits + 1 S4-Hinweis sind nicht blockierend und bleiben als optionale Folge-Tickets offen.
