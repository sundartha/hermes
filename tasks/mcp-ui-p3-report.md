# P3 — Zweiter Host-Adapter (ChatGPT Apps SDK) hinter dem `UiRenderer`-Port

- **Phase:** P3 (MCP-UI-Kette) — zweiter Host-Adapter (ChatGPT Apps SDK / OpenAI "skybridge") hinter dem bestehenden `UiRenderer`-Port
- **Gate:** **PASS** (nachgeholt 2026-06-27; das urspruengliche BLOCKED war ein reines Workflow-Capture-Artefakt — die finalen Safety-/Clean-Code-Urteile kamen `null` zurueck, NICHT wegen echter Blocker)
- **finalBranch:** `phase/mcp-ui-p3-chatgpt-adapter` (`bf4026c`)
- **Merge:** GEMERGT lokal `master=6b39217` (`--no-ff`, NICHT origin/upstream/live); konfliktfrei auf aktuellem master (P3-Dateien seit aa272b7 unberuehrt)
- **headCommit:** `bf4026c40a11e48e5646289cf6cd45d6c412dcb4`
- **Tests:** 1108 / 1108 gruen, 0 Fails (6 Suites, json+pglite) — auf aktuellem master selbst verifiziert
- **node --check:** OK auf allen 8 betroffenen Dateien
- **Nachgeholter dualer Review (2026-06-27):** Safety = **APPROVED** (fail-closed bei unbekanntem Host bestaetigt, Whitelist unveraendert, Call-Pfad/Gates unberuehrt, read-only kein Callback). Clean-Code = **PASS** (S1 keine, S2 keine; DRY-Extraktion `widget-catalog.js` echt, mcp-nativ byte-identisch). Nicht-blockierende Nits: S3 `registerResource` strukturell aehnlich in beiden Adaptern (bewusste Adapter-Autonomie), S4 `widgetTitle/widgetHtml` werfen bei unbekanntem id (alle Aufrufer guarden via `hasWidget`).

---

## 1. Plan (gekuerzt)

Scope-Autoritaet: `tasks/mcp-ui-chain.md` §P3. Baseline `master`.

**Kernbefund (P3-Problem):** Die `_meta`-Erzeugung lag bisher host-NATIV hartkodiert in `mcp-tools.js:148` (`{ _meta: { [UI_META_KEY]: { resourceUri: … } } }` -> verschachteltes `_meta.ui.resourceUri`). Der ChatGPT-Vertrag (P0) ist eine andere Form: `_meta["openai/outputTemplate"] = "<uri>"` (flacher String, anderer Schluessel) mit mimeType `"text/html+skybridge"`. Die `_meta`-Form ist damit host-spezifisch und muss hinter den Port wandern.

**Design-Entscheidungen:**
- **E1** — Host-spezifische `_meta`-Erzeugung wandert hinter den Port: Port bekommt additiv `toolMeta(widgetId) -> object`; jeder Adapter liefert seine eigene `_meta`-Form. `registerResource`/`resourceUri` bleiben unveraendert (sonst broeche der Direkttest).
- **E2** — Host-agnostischer Widget-Katalog (`src/ui/widget-catalog.js`) wird aus `mcp-native.js` extrahiert; beide Adapter konsumieren ihn (keine Adapter-zu-Adapter-Kopplung, keine duplizierte Lade-Logik = S2-Vermeidung schlaegt den einen Zusatz-Modul S4).
- **E3** — Registry als geordnete, fail-closed Dispatch-Tabelle (genau ein Adapter pro Host-Hinweis, erster Treffer gewinnt, OCP: neuer Host = eine Zeile).
- **E4** — ChatGPT-Protokoll-Strings + Detektor leben additiv in `contract.js` (die einzige Stelle, die Protokoll-Strings kennt).
- **E5** — Kein Eingriff in `server.js`/`mcp-server.js`/Config/Env; `MCP_UI_ENABLED` gilt fuer beide Hosts; Tool-Handler-Signaturen unveraendert.

**Liefer-Punkte:** (1) neuer `chatgpt.js`-Adapter mit `_meta["openai/outputTemplate"]`; (2) Registry-Dispatch ueber Host-Hinweis; (3) minimaler `mcp-tools.js`-Eingriff (delegiert `_meta` an `uiRenderer.toolMeta`); (4) additiver P3-Testblock; (5) deterministisch pruefbar (`node --check` + `npm test`, `# fail 0`).

**Pruefbares Ergebnis:** alle 8 Dateien `node --check` ok; `npm test` -> bisherige Zahl + 6 neue Tests, 0 Fails; P1/P2-Tests unveraendert gruen (Beweis reiner Refactor des mcp-nativen Pfads).

---

## 2. Implementierungs-Zusammenfassung

P3 umgesetzt exakt gemaess Plan: zweiter Host-Adapter (ChatGPT Apps SDK, OpenAI skybridge) hinter dem bestehenden `UiRenderer`-Port.

**Neu:**
- `src/ui/adapters/chatgpt.js` — zweiter Renderer (gleicher Port-Vertrag); host-spezifisch nur `mimeType` (`text/html+skybridge`) + `toolMeta` (flacher String unter `openai/outputTemplate`); Widget-HTML host-agnostisch aus dem Katalog.
- `src/ui/widget-catalog.js` — host-agnostischer Katalog (Id-Konstanten, `WIDGET_DEFS`, Einmal-`readFileSync`-Load, `hasWidget`/`widgetHtml`/`widgetTitle`); kein Host-/Protokoll-String.

**Geaendert:**
- `src/ui/contract.js` — additiv `CHATGPT_UI_MIME`, `CHATGPT_META_KEY`, `capabilityDeclaresChatgptUi` (fail-closed, symmetrisch zum mcp-nativen Detektor); Bestands-Exporte byte-identisch.
- `src/ui/registry.js` — fail-closed Dispatch-Tabelle (`UI_ADAPTERS`), genau ein Adapter pro Host; Master-Schalter zuerst, unbekannt -> `null` -> Stufe 0.
- `src/ui/ports.js` — additive JSDoc-Erweiterung um `toolMeta`.
- `src/ui/adapters/mcp-native.js` — auf Katalog umgestellt + `toolMeta` (exakt die alte `_meta`-Form, nur relokiert); Widget-Ids re-exportiert -> Bestands-Importe unveraendert; Verhalten byte-identisch.
- `src/mcp-tools.js` — `_meta`-Zeile delegiert an `uiRenderer.toolMeta(widgetId)`; ungenutzter `UI_META_KEY`-Import entfernt. Tool-Handler (`get_call_status`/`get_transcript`/…) und Whitelist-Filter (`pickCallStatus`/`pickTranscript`) funktional unberuehrt.
- `test/mcp-ui.test.js` — additiver P3-Block (s. u.); P1/P2-Tests unveraendert, nur Import-Zeile erweitert.

**Tests T-P3-AC1..AC6:** beide Widgets je Host (AC1 mcp-nativ / AC2 ChatGPT flat String); Registry-Dispatch fail-closed (AC3); Whitelist unveraendert im ChatGPT-Pfad, kein PII-/Secret-/Audio-/Cross-Tenant-Leck (AC4); byte-gleiche Widget-Bytes in beiden Hosts (AC5); Adapter-Grenzfaelle + disjunkte Detektoren (AC6).

**toolHandlersUnchanged:** true · **mcpNativeUnchanged:** true (verhaltens-erhaltend) · **committed:** true (`bf4026c`, node_modules-Symlink nicht committet).

**Smoke (best-effort Seam-Smoke):** `uiRendererFor` mit `MCP_UI_ENABLED=true` liefert drei getrennte Auspraegungen — mcp-nativ (`text/html;profile=mcp-app`) -> `_meta {"ui":{"resourceUri":"ui://hermes/call-status"}}`; ChatGPT (`text/html+skybridge`) -> `_meta {"openai/outputTemplate":"ui://hermes/call-status"}` (flach); unbekannter mimeType (`text/html`) -> `null` (fail-closed Stufe 0). Hinweis: `npm test` (Wrapper) endet im Sandbox mit Exit 194 OHNE TAP-Ausgabe; identisches Kommando direkt (`NODE_ENV=test node --test "test/*.test.js"`) laeuft sauber durch (tests 1041 / pass 1041 / fail 0, suites 6). Der 194-Exit ist ein npm-Wrapper-/Sandbox-Quirk, kein Testfehler.

### Deviations
Keine (`deviations: []`). Umsetzung exakt gemaess Plan.

---

## 3. Safety-Urteil

`null` — kein finales Safety-Urteil im Workflow-Ergebnis hinterlegt.

---

## 4. Clean-Code-Audit (S1-S4)

Kein finales Clean-Code-Auditor-Urteil im Workflow-Ergebnis hinterlegt (`null`).

**Impl-Self-Check (zur Einordnung, kein Auditor-Urteil):**
- **G5/S2:** gemeinsame Widget-Lade-Logik in `widget-catalog.js` extrahiert statt im ChatGPT-Adapter dupliziert; beide Adapter konsumieren denselben Katalog (keine kuenstliche Adapter-zu-Adapter-Kopplung).
- **G17:** host-spezifische `_meta`-Form hinter den Port (`toolMeta` je Adapter) statt hartkodiert in `mcp-tools.js`.
- **G12:** ungenutzter `UI_META_KEY`-Import aus `mcp-tools.js` entfernt.
- **G25/Magic Numbers:** keine; Protokoll-Strings als benannte Konstanten in `contract.js` (`CHATGPT_UI_MIME`/`CHATGPT_META_KEY`).
- **G23/OCP:** Registry als geordnete Dispatch-Tabelle, neuer Host = eine Zeile; fail-closed invariant.
- **F1:** alle Funktionen <= 2 Args. Kommentare deutsch ohne Umlaute. Kein neuer npm-Dep. Keine toten/auskommentierten Codeteile, keine abgeschalteten Sicherungen.

---

## 5. Fix-Runden

- **r1:** (kein Ergebnis)
- **r2:** (kein Ergebnis)

Trotz gruener Tests (1041/1041), sauberem `node --check` und committetem Stand endet die Phase mit **Gate = BLOCKED** — die finalen Safety-/Clean-Code-Urteile fehlen (beide `null`), und die beiden Fix-Runden lieferten kein Ergebnis. Der Branch `phase/mcp-ui-p3-chatgpt-adapter-fix2` ist NICHT gemergt.
