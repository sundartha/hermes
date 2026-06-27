# W3 — Drittes read-only Widget: get_agent_status (Einzel-Spec)

Autoritative Scope-/Invarianten-Spec fuer Phase **W3** der MCP-Rich-UI-Kette. Verbindlich vor dem
Umbrella-Doc. Umbrella: `docs/mcp-ui-strategy.md`. Status/Kontext + Widget-Muster:
`tasks/mcp-ui-chain.md`. Baseline `master`. Voraussetzung erfuellt: **W1 (gemeinsames Binding) ist
gemergt** — das neue Widget erbt die Daten-Bindung automatisch.

## Ziel (ein Satz)

`get_agent_status` bekommt Stufe-0 (`structuredContent`) + Stufe-1 (`ui://`-Widget `agent-status`)
ueber den UNVERAENDERTEN Seam-Kern (additives Muster wie P2/P3/P4), read-only, kein Callback.

## Grounding (selbst verifizieren)

- `get_agent_status` (`src/mcp-tools.js`, Handler ~Zeile 383) gibt **heute nur Text** zurueck
  (`return text(...)`), KEIN `structuredContent`, KEIN Widget. Felder aus `/api/state`:
  `agent.number`, `agent.owner`, `agent.voiceEngine`, `agent.model`, `usage.calls`,
  `usage.costEur`, `usage.maxBudgetEur`, `agent.allowedNumbers` (Array), sowie Berechtigungen
  `settings.allowCalendar/allowBooking/allowSummaries/allowPersonalData/allowBankData`.
- Es sind durchweg **Eigendaten des aufrufenden Tenants** (sein eigener Agent), bereits ueber die
  Tenant-Kette (`X-Internal-Identity` -> `requestTenant`) aufgeloest. Keine Secrets/Keys, kein
  Cross-Tenant, kein Audio.
- Mockup `design-system/mcp/agent-status.html` existiert als DESIGN-ONLY (nur `@dsCard`-Marker, noch
  KEINE `data-mcp-*`-Slots). Es ist Vorlage, nicht direkt verdrahtbar.
- W1-Binding (`src/ui/widget-bind.js`) fuellt **flache** `data-mcp="<key>"`-Slots aus
  `structuredContent[key]` (Arrays werden als Zeilen gerendert). Das `structuredContent` fuer dieses
  Widget MUSS daher flach sein (Schluessel == Slot-Name).

## Scope / Deliverables (genau dies — Regel 6)

1. **Whitelist-Filter `pickAgentStatus`** (analog `pickCallStatus`/`pickTranscript` in
   `src/mcp-tools.js`): nimmt die `/api/state`-Antwort und liefert ein **flaches** Objekt mit NUR
   diesen Feldern: `number`, `owner`, `voiceEngine`, `model`, `calls`, `costEur`, `maxBudgetEur`,
   `allowedNumbers` (Array), `permissions` (z.B. ein flacher String oder ein kleines flaches Objekt
   der allow*-Flags — so dass es in genau EINEN data-mcp-Slot passt). NICHTS anderes. Keine internen
   IDs, keine weiteren state-Felder.
2. **`structuredContent` + `outputSchema`** an `get_agent_status` (wie bei `get_call_status`): die
   gefilterten Felder, schema-validiert. Der Textblock bleibt erhalten (Stufe-0 additiv,
   Backward-Compat) — Format darf gleich bleiben.
3. **Widget `agent-status`**: self-contained HTML nach `src/ui/widgets/agent-status.html`
   (Inline-Tokens, kein `@import`/`<link>`, `@dsCard`-Marker Zeile 1), mit `data-mcp-*`-Slots fuer
   genau die gewhitelisteten Felder (Slot-Namen == Whitelist-Schluessel). Optik darf sich am Mockup
   `design-system/mcp/agent-status.html` orientieren. KEIN eigenes Binding-Script (erbt W1).
4. **Katalog + Verdrahtung:** Eintrag in `src/ui/widget-catalog.js` (`WIDGET_AGENT_STATUS` +
   `WIDGET_DEFS`); in `src/mcp-tools.js` am `get_agent_status`-Tool per
   `...enableWidgetUi(WIDGET_AGENT_STATUS)` anhaengen — NUR bei faehigem Host (`uiRenderer.hasWidget`)
   bzw. ueber den bestehenden Helper, sodass die Default-Tool-Liste/Stufe-0 byte-identisch bleibt.
5. **Token-Manifest:** `tokens.lock` ggf. nachziehen (neue Widget-Bytes), `npm run check:tokens`
   gruen halten.

## Harte Invarianten (als Test beweisen)

- **Daten-Kontrakt (S1):** NUR die gewhitelisteten Eigen-Felder im `structuredContent`/Widget. Test
  fuettert eine `/api/state`-Antwort mit Zusatzfeldern/PII/Secrets und beweist, dass NICHTS ausser
  der Whitelist durchkommt (analog P2-AC4).
- **Read-only, kein Callback:** das Widget hat keinen Tool-Trigger/Button (kein Callback in W3).
- **Seam-Kern unveraendert:** contract/ports/registry/adapters byte-identisch; nur additiver
  Katalog-Eintrag + Widget-HTML + Tool-Verdrahtung + Whitelist (wie P2/P3 bewiesen).
- **Flag-aus byte-identisch:** `config.mcpUiEnabled` AUS -> kein Widget/Resource, Stufe-0-Text
  unveraendert. Auch bei Flag-AN bleibt der Text-Pfad erhalten.
- **Self-contained / W1:** kein `@import`; `check:tokens` gruen; Binding wird (einmal, via W1) beim
  Serve injiziert, NICHT im Widget dupliziert.
- Safety-Gates / Disclosure / Call-Pfad unberuehrt (reine Read-/Render-Schicht).

## Abgrenzung (NICHT)

- KEIN Callback/Schreib-Aktion. KEIN weiteres Tool. KEINE Aenderung an W1-Binding oder Seam-Kern.
- KEIN neuer npm-Dependency. KEIN Build-Step. ESM, deutsche Kommentare ohne Umlaute.

## Definition of Done

- `get_agent_status` liefert Stufe-0 (`structuredContent`, geschema-t) + Stufe-1 (`agent-status`
  Widget) bei faehigem Host; Fallback Stufe-0 bei unfaehigem; Flag-aus byte-identisch.
- `pickAgentStatus`-Whitelist greift (Test mit Zusatzfeldern beweist Nicht-Durchreichung).
- `node --check` auf jeder neuen/geaenderten `.js`; `npm run check:tokens` gruen; Bestandssuite
  unveraendert gruen (Baseline aktuell 1132, fail 0) + neue Tests.
- Dualer Review PASS (Safety APPROVED + Clean-Code keine S1/S2).
