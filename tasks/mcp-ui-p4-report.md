# Phase P4 — Erstes Callback-Widget (`cancel_call`, hartes Safety-Gate)

- **Gate:** PASS
- **finalBranch:** `phase/mcp-ui-p4-callback`
- **Commit:** `cca28e6730ff241211fd777efeca0fc022fef4a7`
- **Tests:** 1123 pass / 0 fail (Baseline 1117 + 6 P4-Tests); `npm run check:tokens` gruen
- **Fix-Runden:** 0

---

## 1. Plan (gekuerzt)

Erstes Callback-Widget der MCP-Rich-UI-Kette: eine read-only Call-Karte mit interaktivem
Abbrechen-Control, das `cancel_call` auslöst. Hartes Safety-Gate, weil hier zum ersten Mal
ein Widget eine **Schreib-Aktion** zurückruft.

**Kern-Designentscheidung (Spec-sanktioniert):** Das neue Widget `call-result` wird an einen
**neuen, read-only Tool `get_call_result`** verdrahtet (Spec Scope 3 „dedizierter
Rückgabepunkt"), **nicht** an `get_call_status`. Grund (Grounding): `get_call_status` ist durch
P1/P2/P3-Tests fest an `WIDGET_CALL_STATUS` gebunden (`_meta.ui.resourceUri ===
ui://hermes/call-status`); ein MCP-Tool hat genau **einen** `_meta.ui.resourceUri`-Slot — ein
Anhängen von `call-result` würde `call-status` verdrängen und Bestandstests brechen.

Zwei Härtungen gegen den „zwei fast identische Tools"-Smell:
- **(a)** `get_call_result` teilt die komplette Stufe-0-Logik mit `get_call_status` über einen
  extrahierten Closure-Helper `callStatusResult(call_id)` — keine Duplizierung (G5/S2).
- **(b)** `get_call_result` wird **nur registriert**, wenn ein fähiger Rich-UI-Renderer das
  Widget kennt (`uiRenderer && uiRenderer.hasWidget(WIDGET_CALL_RESULT)`). Auf stdio /
  inkompatiblem Host / `mcpUiEnabled=false` (Default) erscheint das Tool gar nicht → Default-
  Tool-Liste **byte-identisch** (DoD d). `place_call` wird bewusst NICHT als Callback verdrahtet
  (Pre-Mortem #3).

**Grounding-Befunde, die den Plan formten:**
1. `cancel_call` existiert bereits und ruft `POST /api/calls/:id/cancel`; der Endpunkt erzwingt
   bereits Tenant-Isolation via `tenantOwnsCall(call, requestTenant(req))` (fail-closed 404
   unter `config.multiTenant`). P4 fügt **keinen** neuen Call-/Abbruch-Codepfad hinzu.
2. DoD(b) („fremder Tenant kann fremden Call nicht abbrechen") ist serverseitig schon bewiesen
   in `test/i6-write-scope.test.js` → nicht duplizieren, im Report zitieren.
3. Token-Gate: `scripts/check-token-sync.js` hasht Widget-HTML nicht; nur `assertNoImport`
   greift. Ein self-contained Widget ohne `@import` hält das Gate ohne Lock-Update grün.

**Geplanter Blast-Radius:** 4 Dateien geändert/neu im `src/ui/`+`src/mcp-tools.js`-Revier +
1 Testdatei. `server.js`, Call-Pfad, `claude.js`, `bridge.js`, Safety-Gate-Funktionen und der
Seam-Kern (`contract.js`/`ports.js`/`registry.js`/`adapters/chatgpt.js`) bleiben unberührt.

**Deterministisches Akzeptanzkriterium:** `node --check` je Datei grün; `npm run check:tokens`
grün; `npm test` = 1123/0; `git diff --name-only master` genau die 5 Dateien;
`git diff master -- src/claude.js src/bridge.js src/server.js` leer (DoD e).

---

## 2. Impl-Zusammenfassung

P4 exakt nach Plan umgesetzt.

**Neu:** `src/ui/widgets/call-result.html` — read-only Karte mit Abbrechen-Control,
self-contained (Inline-Token-Subset wie `call-status.html`, kein `@import`/`<link>`/`href=`).
`<button>` mit Inline-`<script>`, das die host-bereitgestellte Tool-Brücke
(`window.openai.callTool`) für `cancel_call` aufruft und die `call_id` aus dem gepushten
structuredContent übergibt. Fehlt die Brücke → fail-safe no-op (kein Seitenkanal, kein eigener
Endpunkt/Key).

**Edits:**
- `src/ui/widget-catalog.js` — `WIDGET_CALL_RESULT = "call-result"` + Katalog-Eintrag
  (`call-result.html`, Title „Hermes Call Result"); rein additiv (OCP), Lade-Logik unverändert.
- `src/ui/adapters/mcp-native.js` — `WIDGET_CALL_RESULT` importiert + re-exportiert
  (host-agnostisch; `chatgpt.js` zieht das Widget automatisch aus dem Katalog, unberührt).
- `src/mcp-tools.js` — (a) Stufe-0-Logik in Closure-Helper `callStatusResult(call_id)`
  extrahiert; `get_call_status`-Handler delegiert nun (verhaltens-erhaltend). (b) Neues Tool
  `get_call_result` nur unter `if (uiRenderer && uiRenderer.hasWidget(WIDGET_CALL_RESULT))`
  registriert, teilt den Helper, nutzt `CALL_STATUS_OUTPUT` + `enableWidgetUi(WIDGET_CALL_RESULT)`
  unverändert; `cancel_call` bleibt unverändert registriert.
- `test/mcp-ui.test.js` — 6 neue Tests + Helper-Erweiterung (`startGatewayMock` mit
  `requests`-Mitschnitt, `withGatewayCapture`, additiv).

**Neue Tests (T-P4-UI-AC1..AC6):**
- AC1: Stufe 0 — structuredContent + Text exakt wie `get_call_status` (Beweis: geteilter Helper).
- AC2: Stufe 1 — genau eine Resource `ui://hermes/call-result` (`mimeType === UI_MIME`),
  `_meta.ui.resourceUri` zeigt darauf.
- AC3: fail-closed (DoD d) — stdio / `capabilities:{}` / `enabled:false` / fremder mimeType →
  `get_call_result` existiert GAR NICHT, keine `call-result`-Resource; Tool-Liste byte-identisch.
- AC4: Whitelist — `RICH_CALL` (email/apiKey/tenantId/audioUrl) leakt nicht in
  structuredContent/Text/Resource-HTML.
- AC5 (DoD a): Callback = authentisierter `cancel_call`-Tool-Call → genau ein POST auf
  `/api/calls/call_1/cancel` mit Header `x-internal-identity: user@example.com`; kein
  Seitenkanal.
- AC6: `call-result.html` self-contained (kein `@import`/`<link>`/`href=`, `startsWith("<!--
  @dsCard")`), enthält `'cancel_call'` + `data-mcp="call_id"` (zielt auf das gegatete Tool).

**DoD-Belege:** DoD(b) bleibt in `test/i6-write-scope.test.js` bewiesen (nicht dupliziert);
DoD(e) via `git diff` — berührt nur `src/mcp-tools.js`, `src/ui/adapters/mcp-native.js`,
`src/ui/widget-catalog.js`, `src/ui/widgets/call-result.html`, `test/mcp-ui.test.js`;
`claude.js`/`bridge.js`/`server.js`/`disclosureSentence` unverändert. Suite 1117 → 1123, fail 0.

### Deviations
- **Smoke (Server-Boot/healthz) nicht durchführbar:** Boot ist fail-closed durch den
  Owner-Removal Boot-Gate (keine aktive Nummer im Store geseedet) bzw. fehlende Pflicht-Secrets
  — unabhängig von P4 (P4 ändert nur MCP-Tools/Widgets, keinen `/voice`- oder Boot-Pfad).
  Healthz daher nicht erreichbar (000). Verhalten stattdessen vollständig durch die 6 P4-Tests +
  volle Suite (1123/0) + grünes `check:tokens` abgedeckt.
- **node_modules-Symlink im Worktree** war initial self-referenziell (`ln -s ./node_modules`)
  und damit kaputt → `npm test` brach mit Exit 194 ab. Auf den Haupt-Repo-`node_modules`
  umgebogen, danach Suite grün. Symlink NICHT committet (`git ls-files`: 0 node_modules-Einträge).

---

## 3. Safety-Urteil

**APPROVED.** Tests unabhängig im frischen Worktree (`review-p4`) verifiziert: `NODE_ENV=test
node --test test/*.test.js` → EXIT 0, 1123 pass / 0 fail / 0 skipped, beide Backends abgedeckt
(pg via pglite, json default), keine npm-Dep-Änderung.

- **safetyGatesIntact:** ja. Kein neuer Calls/SMS/Geld-auslösender Endpunkt. `cancel_call` ist
  vorbestehend, im Diff unverändert (nur in Kommentaren erwähnt), läuft als authentisierter
  `POST /api/calls/:id/cancel` durch die normale gegatete MCP→REST-Kette mit Tenant-Isolation.
- **disclosureIntact:** ja. `claude.js`/`bridge.js`/`server.js`/`config.js` unberührt → Disclosure
  fest verdrahtet, keine neue Config-Var (kein BASE_ENV-Drift).
- **authFailClosedIntact:** ja. Widget ruft NUR die host-bereitgestellte
  `window.openai.callTool('cancel_call', {call_id})` — kein privilegierter Seitenkanal, kein
  eigener Endpunkt, fail-safe no-op wenn Brücke fehlt.
- **noSecretsLeaked:** ja. structuredContent/Text/Resource nutzen die bestehende
  `pickCallStatus`-Whitelist (call_id/status/duration_s/last_transcript_lines); AC4 prüft aktiv.
- **Flag-off byte-identisch:** `uiRendererFor` gibt bei `!enabled` null (fail-closed);
  `get_call_result` nur unter `uiRenderer && uiRenderer.hasWidget(...)` → ohne fähigen Rich-UI-
  Host existiert das Tool gar nicht, Tool-Liste byte-identisch (AC3).
- **scopeRespected:** ja, nur P4 (get_call_result + Callback-Widget), keine Extras.

**Blockers:** keine.

**Concern:** AC5 (Widget-Button → echte `cancel_call`-Tool-Brücke des Hosts) ist nicht ohne
realen Rich-UI-Host unit-testbar; im Code als Smoke-Gate dokumentiert. Akzeptabel, weil die
Server-Sicherheit nicht davon abhängt — `cancel_call` läuft so oder so als normaler
authentisierter MCP-Tool-Call durch alle Gates + Tenant-Isolation.

---

## 4. Clean-Code-Audit

**Verdict: PASS** — keine S1/S2-Blocker. Saubere, schmale P4-Scheibe: gemeinsamer Helper
`callStatusResult` beseitigt die vorherige Inline-Duplikation, Sicherheits-Invarianten gewahrt,
vollständig getestet.

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine. Hygiene vorbildlich: `callStatusResult` extrahiert die frühere
  doppelte Fetch+Whitelist+Antwortform-Logik in EINE Quelle; `get_call_status` nutzt sie jetzt
  ebenfalls (Diff verkleinert Duplikation statt sie zu schaffen).
- **S3 (Notiz):**
  - **S3-1** · `src/mcp-tools.js:263` · Das Guard-Prädikat `uiRenderer &&
    uiRenderer.hasWidget(WIDGET_CALL_RESULT)` wird hier UND erneut intern in `enableWidgetUi`
    (Z.145) ausgewertet (G5 Form 1, doppelte Bedingung). Bewusst getrennt (äußeres if =
    Tool-Existenz, `enableWidgetUi` = _meta/Resource) und kommentiert; optional über kleinen
    Helper `widgetAvailable(widgetId)` zentralisieren, damit beide Stellen nicht auseinanderlaufen.
  - **S3-2** · `src/ui/widgets/call-result.html` (script) · Der Callback nutzt den
    host-spezifischen Global `window.openai.callTool` in einem MCP-NATIVEN Widget
    (N3/Portabilität: ein mcp-nativer Host bietet ggf. eine andere Tool-Brücke). Dokumentiert als
    smoke-bestätigt + fail-safe no-op; vor Live an einem echten mcp-nativen Host die exakte
    Brücken-API verifizieren.
- **S4 (Nit):** keine.

**Erfüllte Invarianten:** Regel-1/Safety sauber (Widget-Button = normaler authentisierter Call,
AC5 beweist Methode/URL/Header); Whitelist `pickCallStatus` unverändert vor jeder Sicht (AC4
prüft 4 PII-Leaks in Tool-Result UND Resource-HTML); fail-closed-Registrierung (AC3 über 4
incapable-Fälle); Widget self-contained (AC6); neue Widget-Id additiv im host-agnostischen
Katalog (OCP) + reiner Re-Export im Adapter; G25 (title statt Magic-String). Neues Verhalten
durch 6 AC-Tests inkl. Negativ-/Leak-/Grenzfälle abgedeckt.

**Top-Todos (optional, nicht blockierend):**
1. S3-1: doppeltes `hasWidget`-Guard über Helper `widgetAvailable(widgetId)` zentralisieren.
2. S3-2 (vor Live): an einem echten mcp-nativen Host die Tool-Brücke des Callbacks verifizieren
   — `window.openai.callTool` ist ChatGPT-spezifisch; aktuell fail-safe no-op, mcp-native
   Funktion noch unbestätigt.

---

## 5. Fix-Runden

**0 Fix-Runden.** Dualer Review (Safety APPROVED + Clean-Code PASS, keine S1/S2) im ersten
Durchlauf bestanden. Keine FIXES nötig.
