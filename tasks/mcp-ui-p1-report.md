# P1 — MCP Rich-UI duenne Scheibe (Detailbericht)

**Phase:** P1 MCP Rich-UI duenne Scheibe (`get_call_status`, UiRenderer-Seam + Stufe-0/Stufe-1-Fallback)
**Gate:** **PASS**
**finalBranch:** `phase/mcp-ui-p1-slice`
**Commit:** `6c251f57d8d715821bc1c17ae129094b28e64171`
**Tests:** 1029/1029 gruen (0 Fehler), inkl. 7 neuer AC1-AC6/Seam-Tests
**Fix-Runden:** 0

---

## 1. Plan (gekuerzt)

Ziel: `get_call_status` von reinem `{type:"text"}` auf einen **Zwei-Stufen-Vertrag** heben und dafuer einen host-abstrakten `UiRenderer`-Seam unter `src/ui/` etablieren — Spiegel zu `src/telephony/`.

- **Stufe 0 (universell):** `structuredContent` + `outputSchema`-Validierung; Textblock byte-kompatibel zur heutigen 3-Feld-Sicht.
- **Stufe 1 (nur faehige Hosts):** statische `ui://hermes/call-status`-Resource via `registerResource` + `_meta.ui.resourceUri` am Tool. Daten fliessen NICHT in die Resource (PII at rest vermeiden), nur ueber `structuredContent`.

Tragende Befunde aus dem echten Code:
- SDK 1.29.0 `server.registerTool(name, config, cb)` unterstuetzt `outputSchema` UND `_meta` (der positionsbasierte `server.tool(...)` nicht) → `registerTool` Pflicht fuer AC1/AC2.
- `validateToolOutput` erzwingt `structuredContent` + `safeParseAsync`; Zod **strippt nicht** → Whitelisting muss explizit im Handler passieren.
- **Stateless-Transport-Realitaet:** `/mcp` baut pro POST einen frischen `McpServer` (`sessionIdGenerator: undefined`). `initialize` und `tools/list`/`tools/call` sind getrennte POSTs → eine per-Request-Instanz sieht die `initialize`-Capabilities nicht. Bekannte Grenze, kein P1-Bug.

Neue Dateien (Seam analog `telephony/`):
- `src/ui/contract.js` — SEP-1865-Vertrag schlank nachgebildet (Owner-Option A: kein `@modelcontextprotocol/ext-apps`-Dep). Einzige Quelle der Protokoll-Strings (`UI_MIME`, `UI_CAPABILITY_KEY`, `UI_META_KEY`, URI-Prefix) + `capabilityDeclaresUi` (fail-closed).
- `src/ui/ports.js` — reine JSDoc-Typdefs (`UiRenderer`).
- `src/ui/registry.js` — `uiRendererFor(hostHint)`, fail-closed null bei `!enabled`/fehlender Capability.
- `src/ui/adapters/mcp-native.js` — der EINE Adapter; Widget-HTML einmal beim Modul-Load (kein per-Request-IO).
- `src/ui/widgets/call-status.html` — self-contained Widget (Inline-Tokens, `@dsCard`-Marker, read-only).

Edits: `mcp-tools.js` (`pickCallStatus`-Whitelist, `CALL_STATUS_OUTPUT`, `uiTool`-Helper, `get_call_status`-Block), `server.js` (uiHost aus `req.body.params.capabilities`, gegated durch `config.mcpUiEnabled`), `config.js` (+`mcpUiEnabled`, Default aus), `.env.example`, `test/helpers.js` (BASE_ENV `MCP_UI_ENABLED=false`), `test/mcp-tools.test.js` (Stub um `registerTool`/`registerResource` erweitert).

Master-Schalter `config.mcpUiEnabled` (Default aus = byte-identisch) + Host-Capability-Pflicht → doppelt fail-closed.

---

## 2. Implementierungs-Zusammenfassung

P1 exakt gemaess Plan umgesetzt. Neuer `UiRenderer`-Seam unter `src/ui/` (contract/ports/registry/adapters/mcp-native + self-contained `widgets/call-status.html`), analog `telephony/`. `get_call_status` liefert nun:

- **Stufe 0:** `structuredContent` (outputSchema-validiert) + Textblock byte-kompatibel (3-Feld-Sicht `status`/`duration_s`/`last_transcript_lines`).
- **Stufe 1:** `ui://hermes/call-status`-Resource + `_meta.ui.resourceUri` NUR fuer faehige Hosts; sonst fail-closed Stufe-0-only.

EIN Whitelist-Filter `pickCallStatus` (`call_id`/`status`/`duration_s`/`last_transcript_lines`) VOR Text und Resource, nach der Tenant-Aufloesung. `server.js` berechnet `uiHost` aus den initialize-Capabilities; `/mcp` bleibt hinter `mcpAuth` (kein neuer Endpunkt, `res.on("close")`-Cleanup unberuehrt). stdio (`mcp-server.js`) unveraendert → `uiHost=null` → Stufe-0-only.

**Dateien erstellt:** `src/ui/contract.js`, `src/ui/ports.js`, `src/ui/registry.js`, `src/ui/adapters/mcp-native.js`, `src/ui/widgets/call-status.html`, `test/mcp-ui.test.js`
**Dateien editiert:** `src/mcp-tools.js`, `src/server.js`, `src/config.js`, `.env.example`, `test/helpers.js`, `test/mcp-tools.test.js`
**Tests:** `test/mcp-ui.test.js` (neu: AC1-AC6 + Seam-Grenzfaelle, 7 Tests); `test/mcp-tools.test.js` (fakeServer-Stub erweitert, keine Assertion-Aenderung); `test/helpers.js` (BASE_ENV)

**Smoke:** `config.js` laedt mit `MCP_UI_ENABLED=true` (`mcpUiEnabled=true`); `registerTools` gegen die ECHTE `McpServer`-Instanz (SDK 1.29.0) sowohl faehig (registerTool+registerResource mit `_meta`) als auch stdio (Stufe-0-only) fehlerfrei. Echter `/mcp`-HTTP-Roundtrip in Claude nicht ausgefuehrt (nur Smoke-Gate laut P0; stateless-Transport sieht initialize-Caps im spaeteren tools/list-POST ohnehin nicht).

### Deviations

1. **Stateless-Transport-Caveat** (im Plan vorgesehen, im `server.js`-Kommentar + Report festgehalten): Bei `sessionIdGenerator=undefined` traegt nur der initialize-POST `params.capabilities`, der spaetere tools/list-POST nicht. Der fail-closed Kern (Master-Schalter `mcpUiEnabled` + Capability-Pflicht) greift trotzdem; der vollstaendige `capabilityDeclaresUi`-Mechanismus ist im Seam getestet und greift, sobald der Transport stateful wird (eigener Schritt, NICHT P1). Echter Live-Render bleibt Smoke-Gate.
2. **Datenfluss-Korrektur ggue. Strategie-Doc Abschnitt 3** (`renderResource(widgetId, filteredData)`): Resource ist STATISCH ohne `filteredData`-Injektion (sonst PII at rest im HTML); `filteredData` fliesst ausschliesslich ueber `structuredContent`. Im Port (`ports.js`) so gespiegelt — im Plan explizit so vorgesehen.
3. **Widget-Kommentar** "kein @import" zu "kein externer CSS-Import" umformuliert, damit der self-contained-Test (`html.includes('@import')`) nicht am eigenen Kommentar scheitert.

---

## 3. Safety-Urteil

**APPROVED.** Saubere, fail-closed Scheibe; alle absoluten Regeln eingehalten.

- **testsPassIndependently:** ja — selbst ausgefuehrt im frischen Worktree (`review-mcp-ui-p1` von `phase/mcp-ui-p1-slice`). Volle Suite `NODE_ENV=test node --test test/*.test.js`: 1029/1029 pass, 0 fail, 6 suites, exit 0 (json-Default; pg-Tests via pglite enthalten). Zusaetzlich `STORE_BACKEND=pg` fuer `test/mcp-ui.test.js` + `test/mcp-tools.test.js`: 10/10 pass. `package.json`/`package-lock.json` unveraendert → kein neuer npm-Dep.
- **safetyGatesIntact / disclosureIntact:** ja — keine Call-Pfad-Datei beruehrt (`claude.js`, `bridge.js`, `telephony/*`, `/voice/*`, `numberGateError`, `disclosureSentence`). P1 ist read-only (Tool ruft nur `GET /api/calls/:id`).
- **authFailClosedIntact:** ja — keine neue Route; `/mcp` bleibt hinter `mcpAuth` (server.js:1532), `res.on('close')`-Cleanup unveraendert (1566); `uiHost` aus `req.body.params.capabilities`, gegated durch `config.mcpUiEnabled` (Default false).
- **whitelistEnforced:** ja — `pickCallStatus` liefert GENAU 4 Felder, an EINER Stelle VOR Text + structuredContent, NACH Tenant-Aufloesung. Test AC4 beweist mit RICH_CALL (`email`/`apiKey`/`tenantId`/`audioUrl`), dass diese NICHT im serialisierten Result/Widget-HTML auftauchen.
- **fallbackFailClosed:** ja — `uiRendererFor` gibt null bei `!enabled`, fehlender/fremder Capability, null-hostHint. Test AC3 deckt 4 Faelle.
- **noSecretsLeaked:** ja — kein neues Logging, keine Secret-Env-Reads, generischer/provider-freier Fehlertext (`wrapHandler`), Widget-HTML self-contained ohne @import/Linkback/Audio.
- **scopeRespected:** ja — genau EIN Tool, EIN MCP-nativer Adapter, EIN statisches Widget; kein Callback/Schreib-Widget (P4), kein zweiter Host (P3), keine weiteren Widgets (P2), kein neuer Dep (Owner-Option A).

**Blockers:** keine.

**Concerns (bewusst, kein Verstoss):**
- Stateless-Caveat (im Code dokumentiert): Worst Case = kein Widget (Stufe 0) → fail-closed, kein Sicherheitsrisiko.
- `structuredContent` + `outputSchema` sind jetzt IMMER an (auch flag-aus), waehrend die `ui://`-Resource flag+capability-gated bleibt — entspricht der Strategie (Stufe 0 universell), Textblock byte-identisch.

---

## 4. Clean-Code-Audit (S1-S4)

**Verdict: PASS — kein Blocker (S1 und S2 leer).**

- **S1:** keine
- **S2:** keine
- **S3:**
  - **S3-1 · `src/ui/widgets/call-status.html`** — Inline-Design-Tokens sind handkopiertes Subset aus `design-system/_shared/tokens.css` (Werte dupliziert) → Drift-Risiko. Bewusster Self-Containment-Tradeoff (Iframe-Sandbox, AC6) und dokumentiert; akzeptabel. Fix: geplanten Token-Sync-CI-Gate verankern.
  - **S3-2 · `src/mcp-tools.js`** — Whitelist-Feldliste erscheint dreifach (pickCallStatus-Literal, `CALL_STATUS_OUTPUT` zod, 3-Feld-Text-Subset). Keine Logik-Duplizierung (Projektion vs. Validierungs-Schema vs. bewusst call_id-freie Legacy-Textsicht/AC8) → kein S2, aber Drift-Punkt. Fix optional: eine Feldquelle als SSOT, nur wenn Lesbarkeit erhalten bleibt.
- **S4:**
  - **S4-1 · `src/ui/ports.js`** — reine JSDoc-Typdef (`export {}`) + registry.js fuer aktuell EINEN Adapter → isoliert Indirektion vor Bedarf. ABER bewusst owner-entschieden, spiegelt etablierte telephony-Seam, naher Konsument (P3 ChatGPT) geplant, laufzeitfrei (0 Kosten), registry.js leistet echtes fail-closed Gating. Kein BDUF. Leichte Anmerkung, kein Verstoss.

**Clean-Code-Selbstpruefung (Impl):** G5/S2 — EIN Whitelist-Filter, EINE Fehlerhuelle `wrapHandler` (geteilt von `tool()`/`uiTool()`), EINE Protokoll-String-Quelle. G25/G35 — `LAST_TRANSCRIPT_LINES`, `UI_MIME`, `UI_CAPABILITY_KEY`, `UI_META_KEY` zentralisiert; `MCP_UI_ENABLED`→`config.mcpUiEnabled`. P15/N7 — Widget-HTML als Modul-Const, `registerResource` benennt Nebeneffekt. F1 — alle Signaturen ≤3 Args (Options-Objekte). DIP/P4 — `mcp-tools.js` kennt nur Registry/Port + `UI_META_KEY`, nie SEP-1865-Strings direkt. Kein toter/auskommentierter Code, keine ungenutzten Imports, Kommentare deutsch ohne Umlaute, kein neuer npm-Dep.

**Top-Todos (nach P1):**
1. Live-Verifikation Stufe 1 mit `MCP_UI_ENABLED=true` gegen echten faehigen Host (Stateless-Caveat → eigener Schritt).
2. Token-Drift entschaerfen: geplanten Token-Sync-CI-Gate einziehen.
3. Optional: Whitelist-Feldliste aus einer Quelle ableiten (nur wenn Lesbarkeit erhalten bleibt).

---

## 5. Fix-Runden

**0 Fix-Runden.** Dualer Review (Safety APPROVED + Clean-Code PASS mit leerem S1/S2) bereits im ersten Durchlauf gruen; keine Nachbesserung noetig.
