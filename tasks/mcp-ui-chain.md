# MCP Rich-UI — Status & Restarbeit

Umbrella/Architektur: `docs/mcp-ui-strategy.md` (Zwei-Stufen-Modell, Seam, Sicherheits-Kontrakt).
Diese Datei = **kompakter Stand + was noch fehlt**. Detail-Reports je Phase: `tasks/mcp-ui-pN-report.md`.

Stand: **2026-06-27. Kette P0-P5 implementiert & gemergt (lokal `master`, NICHT origin/upstream/live).**
Master-Schalter `config.mcpUiEnabled` Default **AUS** = byte-identisch zum heutigen Verhalten.

## Was gebaut wurde (Server-Seite — bewiesen & getestet)

Progressive Enhancement: **Stufe 0** (jedes Tool gibt Text + `structuredContent` zurueck,
universell) IMMER; **Stufe 1** (optionale `ui://`-HTML-Resource) nur fuer faehige Hosts, sonst
fail-closed Fallback auf Stufe 0. Renderer hinter host-abstraktem Port (`src/ui/`, analog
`src/telephony/`).

| Phase | Inhalt | Stand |
| --- | --- | --- |
| P0 | Research: Standard SEP-1865 "MCP Apps" belegt (Claude Web/Desktop rendert `ui://`-HTML gesandboxt); Host-Erkennung via Capability `io.modelcontextprotocol/ui` | erledigt |
| P1 | `UiRenderer`-Seam (`src/ui/` contract/ports/registry/adapters) + erstes Widget `get_call_status` Stufe-0/1 + fail-closed Fallback | gemergt |
| P2 | zweites read-only Widget `get_transcript` (DSGVO-Whitelist: nur Summary, nie Roh-Transkript) | gemergt |
| P3 | zweiter Host-Adapter `chatgpt.js` (ChatGPT Apps SDK / skybridge) hinter demselben Port; mcp-nativer Kern unberuehrt | gemergt |
| P4 | erstes Callback-Widget `call-result` -> ruft `cancel_call` zurueck (NICHT `place_call`); hartes Safety-Gate: Callback = normaler authentisierter Tool-Call durch ALLE Gates, Tenant-Isolation, kein Seitenkanal | gemergt |
| P5 | Token-Sync-Gate `scripts/check-token-sync.js` (+ `tokens.lock`-Manifest, `@import`-Verbot, `@dsCard`-Check, `npm run check:tokens`) gegen Token-Drift | gemergt |

Tools mit Widget heute: `get_call_status`, `get_transcript`, `get_call_result` (3 von 9). Die
uebrigen Tools sind Text-only (Stufe 0).

## Was NOCH FEHLT (die eigentliche Verdrahtung)

**Befund (2026-06-27): Die Client-seitige Daten-Bindung fehlt in ALLEN Widgets — nicht nur in
einem.** Die Widget-HTML (`src/ui/widgets/*.html`) traegt Platzhalter-Slots (`data-mcp="status"`,
`data-mcp="duration_s"`, …) mit Wert `—`, aber **kein Widget liest das gepushte
`structuredContent` und schreibt es in diese Slots.** `call-status.html`/`transcript.html` haben
gar kein `<script>`; `call-result.html` hat nur ein Script fuer den Abbrechen-Button (`window.
openai.callTool`), nicht fuer die Datenanzeige. In einem echten Host wuerden die Karten heute
**leer** rendern (ueberall `—`).

Daraus folgt die offene Restarbeit (Reihenfolge):

- **W1 — Gemeinsames Binding (EINMAL fuer alle):** ein kleiner, geteilter Bootstrap, der im Iframe
  das vom Host bereitgestellte `structuredContent` liest (`window.openai.toolOutput` o.ae., per
  Live-Smoke verifizieren) und die `data-mcp-*`-Slots fuellt. Geteilt, nicht pro Widget dupliziert
  (DRY). Danach zeigen ALLE drei Widgets echte Daten.
- **W2 — Live-Host-Smoke:** `mcpUiEnabled` einschalten, MCP-Server als Connector in Claude
  verbinden, Tool ausloesen, Karte mit echten Daten im Chat bestaetigen. (Bis dahin ist die
  Render-Seite unbewiesen — P0 hatte den Beleg bewusst auf "live spaeter" gestellt.)
- **W3 — Weitere Tool-Widgets nach Bedarf:** z.B. `get_agent_status` (Mockup
  `design-system/mcp/agent-status.html` existiert, nicht verdrahtet), `list_calls`, `get_my_number`.
  Pro Tool: HTML nach `src/ui/widgets/`, Eintrag in `src/ui/widget-catalog.js`, in `mcp-tools.js`
  per `enableWidgetUi(...)` verdrahten, Whitelist + Test. **Mit W1 bekommen neue Widgets das
  Binding automatisch.**
- **W4 — optional:** Design verfeinern (HTML in `src/ui/widgets/`, self-contained, `check:tokens`
  gruen halten); evtl. `place_call`-Callback-Widget (zuerst owner-gegatet, wie P4); origin/upstream-
  Push der ganzen Kette (separate Owner-Entscheidung).

## Wie man ein Widget hinzufuegt (Muster, gilt fuer W3)

Reines additives Muster, KEINE Seam-Kern-Aenderung (wie P2/P3/P4):
1. `src/ui/widgets/<name>.html` — self-contained (Inline-Tokens, kein `@import`/`<link>`), mit
   `@dsCard`-Marker in Zeile 1 und `data-mcp-*`-Slots fuer die gewhitelisteten Felder.
2. Eintrag in `src/ui/widget-catalog.js` (`WIDGET_<NAME>` + `WIDGET_DEFS`).
3. In `src/mcp-tools.js` am Tool per `...enableWidgetUi(WIDGET_<NAME>)` anhaengen (nur bei faehigem
   Host; Default-Tool-Liste bleibt byte-identisch).
4. Whitelist-Filter (analog `pickCallStatus`/`pickTranscript`) + Test (Fallback, Whitelist,
   Flag-aus byte-identisch).

## Absolute Regeln (jede Phase, siehe CLAUDE.md)

Safety-Gates nie aufweichen; Widget-Callbacks = normale authentisierte Tool-Calls durch ALLE Gates;
Disclosure fest verdrahtet; Auth fail-closed (`/mcp` hinter `mcpAuth`, unbekannter Host -> Stufe 0);
keine Secrets/PII/Cross-Tenant/Audio ins Widget/`structuredContent`; kein neuer npm-Dep ohne
Freigabe; Stufe 0 bleibt additiv (Text-Pfad byte-kompatibel).

## Owner-Entscheidungen (gepinnt, umgesetzt)

Erstes Widget `get_call_status` (Q4); Seam-Kern MCP-nativ, ChatGPT als Adapter (Q5); zwei
Host-Konventionen dauerhaft akzeptiert (Q1); Token-Pull als CI-/Review-Gate (Q6, in P5 umgesetzt);
Callback nur ueber authentisierten `/mcp`, kein offener Postback (Q3, in P4 bestaetigt);
Host-Erkennung via `initialize`-Capability, fail-closed (Q2, in P0 belegt).
