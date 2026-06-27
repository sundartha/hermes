# Phase W3 — Drittes read-only Widget `get_agent_status`

- **Gate:** PASS (dualer Review: Safety APPROVED + Clean-Code keine S1/S2)
- **finalBranch:** `phase/mcp-ui-w3-agent-status`
- **headCommit:** `3e808d611539116a282e9ac1850486c36fe51417`
- **Tests:** 1138 pass / 0 fail (Baseline 1132, +6); `T-P4-06` weiter gruen
- **Fix-Runden:** 1 Selbst-Behebung (kein Review-Blocker)

---

## Plan (gekuerzt)

Baseline `master`. Quelle der Wahrheit: `tasks/mcp-ui-w3-spec.md`. Muster 1:1 wie P2/P4
(Whitelist-Filter + `structuredContent`/`outputSchema` + Widget-HTML + Katalog-Eintrag,
additiv, Seam-Kern unberuehrt). Blast-Radius: 4 Quell-Dateien + 1 neue Widget-HTML + Tests.
Seam-Kern (`contract.js`/`ports.js`/`registry.js`/`adapters/chatgpt.js`/`widget-bind.js`)
bleibt byte-identisch.

Grounding-Befunde (gegen `master`):

- `get_agent_status` war via `tool(...)` (positional) registriert, gab nur `text(...)`
  zurueck; `requireFields` prueft `agent/usage/settings` als Objekte; auf `{}`-Body ->
  isError (Test `T-P4-06`, muss gruen bleiben).
- Whitelist-Muster: `pickCallStatus`/`pickTranscript` + Konstanten `CALL_STATUS_OUTPUT`/
  `TRANSCRIPT_OUTPUT`; Widget-Anhang ueber `enableWidgetUi(widgetId)` (Resource + `_meta`
  nur bei faehigem Renderer, sonst `{}` = fail-closed Stufe-0).
- Katalog `WIDGET_DEFS` = reine Daten-Map (OCP); `withBindScript` injiziert W1-Binding beim
  Modul-Load -> neue Widgets erben W1 ohne Code-Aenderung.
- Token-Lock: `scripts/check-token-sync.js` hasht nur Token-CSS (`HASHED_RELS`), Widget-HTML
  nur strukturell (`assertNoImport`) => `tokens.lock` braucht KEINE Aenderung.
- `/api/state.agent.number` (fail-closed leer moeglich) und `.owner` (Tenant ohne ownerName
  null/undefined) koennen legitim fehlen -> `outputSchema` nullable.

Umsetzungsschritte:

1. **Neue Datei** `src/ui/widgets/agent-status.html`: self-contained, `@dsCard`-Marker
   Zeile 1, Inline-Tokens (kein `@import`/`<link>`/`href`), kein `<script>`/`<button>`
   (read-only, W1-Binding wird beim Serve injiziert). `data-mcp`-Slots == Whitelist-Keys:
   `number`, `owner`, `voiceEngine`, `model`, `calls`, `costEur`, `maxBudgetEur`,
   `allowedNumbers` (Array), `permissions` (String).
2. **`src/ui/widget-catalog.js`**: additiver Eintrag `WIDGET_AGENT_STATUS = "agent-status"`
   + `WIDGET_DEFS`-Zeile (`agent-status.html`, Titel "Hermes Agent Status").
3. **`src/ui/adapters/mcp-native.js`**: `WIDGET_AGENT_STATUS` in Import + Re-Export
   nachziehen; `mcpNativeRenderer`/`chatgpt.js` unveraendert.
4. **`src/mcp-tools.js`**: Import erweitern; `pickAgentStatus`-Whitelist +
   `permissionsSummary`-Helper (EINE Quelle fuer Text + structuredContent) +
   `AGENT_STATUS_OUTPUT` (number/owner `nullable`); Tool `tool(...)` -> `uiTool(...)` mit
   `enableWidgetUi(WIDGET_AGENT_STATUS)`; Stufe-0-Text byte-identisch via `data.*`.
5. **`tokens.lock`**: keine Aenderung.
6. **Tests**: `test/mcp-ui.test.js` neuer Block T-W3-AC1..AC6; `test/mcp-ui-w1-bind.test.js`
   `WIDGET_IDS` um `WIDGET_AGENT_STATUS` erweitert; `test/mcp-tools.test.js` unveraendert.

Pre-Mortem (vor Umsetzung benannt):

1. Capable-Host isError bei frisch onboardetem Tenant ohne aktive Nummer / ohne ownerName ->
   `?? null` + `z.string().nullable()`.
2. Permissions-Objekt rendert als `[object Object]` -> `permissions` bewusst String (ein Slot).
3. Text-Format-Drift bricht stdio-Clients -> Textblock byte-identisch via `data.*`, in
   T-W3-AC1 geprueft.
4. PII-/Cross-Tenant-Leck -> nur 9 Whitelist-Felder; Test fuettert Secrets/fremden State und
   beweist Nicht-Durchreichung (S1).

Deterministisch pruefbar: `node --check` (3 Dateien), `npm run check:tokens` (OK, ohne
Lock-Edit), `npm test` (Baseline 1132 unveraendert + T-W3-AC1..AC6 + erweiterte T-W1-AC1,
`fail 0`).

---

## Impl-Zusammenfassung

`get_agent_status` liefert jetzt Stufe-0 (`structuredContent` via Whitelist
`pickAgentStatus` + `outputSchema AGENT_STATUS_OUTPUT`) und Stufe-1 (neues read-only Widget
`src/ui/widgets/agent-status.html`) ueber den unveraenderten Seam-Kern.

- `tool()` -> `uiTool()` mit `enableWidgetUi(WIDGET_AGENT_STATUS)`; Stufe-0-Text
  byte-identisch (Backward-Compat).
- `permissionsSummary` als EINE Quelle fuer Text + `structuredContent`; `pickAgentStatus`
  EIN Whitelist-Filter VOR allen Sichten.
- Katalog (`widget-catalog.js`) + Re-Export (`mcp-native.js`) additiv erweitert.
- `tokens.lock` unveraendert (Widget-HTML nur strukturell geprueft, `check:tokens` exit 0).
- `node --check` auf allen geaenderten `.js` gruen.

Verifikation:

- `nodeCheckPass`: true
- `testsPass`: true — 1138 pass / 0 fail (Baseline 1132, +6), `T-P4-06` gruen
- `smokePass`: true (best-effort: `src/mcp-tools.js` importiert sauber,
  `registerTools=function`; voller Tool-Pfad end-to-end durch T-W3-AC1..AC6 gegen
  Gateway-Mock abgedeckt — Handler + Resource-Registrierung + `_meta`)
- `committed`: true (`3e808d6`, Tree clean)

Dateien neu:

- `src/ui/widgets/agent-status.html`

Dateien editiert:

- `src/mcp-tools.js`
- `src/ui/widget-catalog.js`
- `src/ui/adapters/mcp-native.js`
- `test/mcp-ui.test.js`
- `test/mcp-ui-w1-bind.test.js`

Tests hinzugefuegt/geaendert:

- `test/mcp-ui.test.js`: T-W3-AC1..AC6 (Stufe-0 additiv, Stufe-1 faehiger Host, Fallback
  fail-closed, Whitelist/PII, Fehlerpfad isError, self-contained read-only + W1-Erbe)
- `test/mcp-ui-w1-bind.test.js`: `WIDGET_IDS` um `WIDGET_AGENT_STATUS` erweitert (T-W1-AC1
  deckt neues Widget mit)

**Deviations:** keine.

---

## Safety-Urteil

**APPROVED.** W3 fuegt ein drittes read-only Widget `get_agent_status` (Stufe-0 Text
byte-identisch + `structuredContent`-Whitelist + Stufe-1 `ui://` nur bei faehigem Host,
fail-closed Fallback) sauber im W1/W2-Muster hinzu. Diff auf 6 Dateien begrenzt, keine neuen
npm-Deps, keine Aenderung an `claude.js`/`bridge.js`/`server.js`/`config.js`. Safety-Gates,
Disclosure und Auth unberuehrt; Widget callback-frei (kein button/callTool/href/link/@import).
`structuredContent`-Whitelist enthaelt nur unkritischen Betriebsstatus (`allowedNumbers` war
schon im Legacy-Text). Flag-off (`uiHost null` -> `enableWidgetUi {}`) ergibt Stufe-0-only =
backward-kompatibel.

- approved: true
- testsPassIndependently: true (frischer Worktree: 1138 pass, 0 fail, 0 skipped, ~47.7s,
  EXIT=0; pg-Backend via pglite-Contract/RLS-Tests in derselben Suite mitgeprueft — beide
  Backends gruen)
- safetyGatesIntact / disclosureIntact / authFailClosedIntact / noSecretsLeaked /
  behaviorAsIntended / scopeRespected: alle true
- blockers: keine
- concerns (nicht-blockierend): Legacy-Text nutzte `s.agent.number/owner` roh, neu via
  `?? null`. In fail-closed Edge (undefined) zeigt der Text jetzt `null` statt `undefined` —
  Verbesserung, kein Regress; Normalbetrieb byte-identisch.

---

## Clean-Code-Audit

**Verdict: PASS** — Saubere, additive Scheibe ohne S1/S2-Blocker. W3 wendet den bestehenden
W1/P4-Seam (`uiTool` + `enableWidgetUi` + `wrapHandler`) 1:1 auf `get_agent_status` an.
Stufe-0-Text bleibt backward-compat, `structuredContent` whitelist-gefiltert
(`pickAgentStatus`), Stufe-1-Widget nur bei faehigem Host (fail-closed). Keine Sicherheitsgates
beruehrt, keine Secrets/PII durchgereicht (per Test bewiesen). Alle 31 mcp-ui-Tests gruen inkl.
6 neuer W3-Tests.

- **S1:** keine
- **S2:** keine
- **S3:**
  - `src/ui/widgets/agent-status.html` — Feld `number` wird zweimal gebunden (Zeile "Nummer"
    UND Footer-`<span data-mcp="number">`), waehrend `.sub` im Head hart `get_agent_status`
    zeigt und der Titel `owner` bindet — der doppelte number-Footer traegt keine zusaetzliche
    Info. Fix: Footer-Slot weglassen oder mit anderem Identifier belegen; nur falls
    Lesbarkeit es verbessert (G5-Geist, nicht hart).
  - `test/mcp-ui.test.js` — `agentStatusOutput` dupliziert das Schema `AGENT_STATUS_OUTPUT`
    aus `mcp-tools.js` inline statt es zu importieren. Bewusst als unabhaengige
    Kontrakt-Assertion akzeptabel (Test soll Drift fangen) — kein echter S2-Verstoss,
    konsistent mit P2/P4-Tests, kein Handlungsbedarf.
- **S4:**
  - `src/mcp-tools.js` — `pickAgentStatus(s)` vs `permissionsSummary(settings)` nutzen
    unterschiedliche Param-Namen (`s` vs `settings`); kosmetisch, `s` folgt der umgebenden
    `const s = await call()`-Konvention, vertretbar.

Pass-Notes: Wiederverwendung statt Neubau (`uiTool`/`enableWidgetUi`/`wrapHandler` +
`pick*`-Whitelist-Idiom gespiegelt, kein neuer Seam, kein Fehlerhuellen-Duplikat).
`permissionsSummary` EINE Quelle fuer Text + structuredContent (G5 erfuellt). Datenkontrakt als
explizite Whitelist mit nullable `number`/`owner` (fail-closed-leerer Zustand bleibt gueltig,
kein isError). Neues Verhalten vollstaendig getestet inkl. Negativ-/Grenzfaelle. Widget
self-contained (inline Tokens, kein @import/Linkback), read-only (kein button/callTool —
passend, da Status keine Schreib-Aktion). `WIDGET_AGENT_STATUS` sauber im Katalog registriert
und nur durchgereicht (keine zweite Quelle).

Top-Todos: keine Pflicht-Todos — merge-faehig. Optional: doppelten `data-mcp="number"`-Footer
im Widget pruefen (S3, rein kosmetisch).

---

## Fix-Runden

Eine Selbst-Behebung (kein Review-Blocker, vor dem dualen Review): literaler `<button>`-String
im HTML-Kommentar liess die AC6-Read-only-Regex anschlagen -> Kommentar zu "Button-Element"
umformuliert. Dualer Review danach: 0 Fix-Runden (Gate direkt PASS, nur 3 kosmetische
S3/S4-Nits, keiner blockierend).
