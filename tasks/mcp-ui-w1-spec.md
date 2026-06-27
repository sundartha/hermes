# W1 — Gemeinsames Client-Daten-Binding fuer alle Widgets (Einzel-Spec)

Autoritative Scope-/Invarianten-Spec fuer Phase **W1** der MCP-Rich-UI-Kette. Verbindlich vor dem
Umbrella-Doc. Umbrella: `docs/mcp-ui-strategy.md`. Status/Kontext: `tasks/mcp-ui-chain.md`
(Abschnitt "Was NOCH FEHLT"). Baseline `master`.

## Problem (Grounding — selbst verifizieren)

Die Widget-HTML (`src/ui/widgets/call-status.html`, `transcript.html`, `call-result.html`) traegt
Platzhalter-Slots (`data-mcp="status"`, `data-mcp="duration_s"`, `data-mcp="last_transcript_lines"`,
`data-mcp="call_id"`, …) mit Wert `—`. **Aber kein Widget liest das vom Host gepushte
`structuredContent` und fuellt diese Slots.** `call-status.html`/`transcript.html` haben gar kein
`<script>`; `call-result.html` hat nur ein Button-Script (`window.openai.callTool`), keine
Datenanzeige. In einem echten Rich-UI-Host wuerden die Karten heute leer rendern (ueberall `—`).

## Ziel (ein Satz)

EIN gemeinsames Client-Daten-Binding, das im Iframe das host-bereitgestellte `structuredContent`
liest und die `data-mcp-*`-Slots ALLER Widgets fuellt — geteilt (DRY), defensiv (fail-safe no-op
ohne Host), XSS-sicher.

## Scope / Deliverables (genau dies — Regel 6)

1. **Eine einzige Quelle fuer das Binding-Script (DRY).** Die Widgets sind self-contained HTML
   (Iframe-Sandbox, kein externer Import moeglich), daher KANN kein gemeinsames externes JS
   verlinkt werden. Loese die DRY-Spannung sauber — bevorzugt: das Binding-Script als EINE benannte
   Konstante/Quelle (z.B. in `src/ui/widget-catalog.js` oder einem kleinen neuen Modul `src/ui/
   widget-bind.js`) und beim Ausliefern der Resource **einmalig in die Widget-HTML injizieren**
   (Serve-Zeit, vor `</body>`), statt denselben Script-Text in jede `.html` zu kopieren. Der
   Plan-Agent waehlt die einfachste Form, die Duplizierung vermeidet UND self-contained bleibt; die
   `.html`-Dateien bleiben moeglichst schlank. Begruende die Wahl im Plan.
2. **Host-Bruecke defensiv per Feature-Detection.** Der exakte Host->Iframe-Daten-Kanal ist die
   einzige echte Unsicherheit und wird erst im Live-Smoke (W2, Owner) endgueltig bestaetigt. Daher:
   beide bekannten Konventionen feature-detecten und die erste vorhandene nutzen —
   (a) ChatGPT/skybridge: `window.openai` (Tool-Output, z.B. `window.openai.toolOutput`);
   (b) MCP-nativ/Claude (SEP-1865): der vom Host bereitgestellte Mechanismus (z.B. ein injiziertes
   Global oder ein `message`-Event/postMessage-Handshake). Fehlt JEDE Bruecke -> **fail-safe no-op**
   (Karte bleibt mit `—`, kein Fehler, kein Crash). KEINE Annahme hart verdrahten, ohne Fallback.
3. **Slot-Fuellung generisch:** fuer jeden Schluessel im `structuredContent` den passenden
   `[data-mcp="<key>"]`-Slot fuellen. Sonderfall `last_transcript_lines` (Array) -> als Zeilen
   rendern (Rolle + Text). Unbekannte/fehlende Felder -> Slot unveraendert (`—`).
4. **Konsistente data-mcp-Slots:** leite die tatsaechlich noetigen Slots aus den 3 Widgets + den
   Whitelist-Filtern (`pickCallStatus`/`pickTranscript`, `src/mcp-tools.js`) ab. Falls
   `transcript.html` andere Slot-Namen nutzt (`result_summary`/`objective_achieved`), das Binding
   muss alle abdecken. KEINE neuen Felder erfinden.

## Harte Invarianten (alle als Test/Check beweisen)

- **XSS-Sicherheit (S1):** Werte NUR via `textContent` ins DOM schreiben, **NIE `innerHTML`** —
  Transkript-/Caller-Text ist Nutzereingabe und darf kein Markup ins Iframe injizieren. Das ist
  blockierend.
- **Daten-Kontrakt unveraendert:** Das Binding zeigt NUR, was im `structuredContent` steht (das der
  Server bereits gewhitelistet hat). KEINE neue Datenquelle, kein Zugriff auf etwas anderes als das
  uebergebene Objekt. Kein PII/Secret/Cross-Tenant/Audio — das Binding kann gar nichts anzeigen, was
  nicht schon durch die Server-Whitelist kam.
- **Self-contained / P5-Gate:** kein `@import`/`<link>`; `npm run check:tokens` bleibt gruen
  (`@dsCard`-Marker Zeile 1 unveraendert, Token-Manifest ggf. nachziehen falls sich HTML-Bytes
  aendern — `tokens.lock` aktualisieren und im Report nennen).
- **Flag-aus byte-identisch:** `config.mcpUiEnabled` AUS -> keine Resource ausgeliefert -> keine
  Verhaltensaenderung. Stufe-0-Text-Pfad unberuehrt.
- **Callback unberuehrt (P4):** das bestehende `cancel_call`-Button-Script in `call-result.html`
  bleibt funktional; das Binding ergaenzt nur die Datenanzeige, ersetzt den Button nicht.
- **Seam-Kern / Safety-Gates / Disclosure / Call-Pfad:** unberuehrt (rein Widget-/Render-Schicht).

## Abgrenzung (NICHT)

- KEIN Live-Smoke in W1 (braucht echten Host-Connector = Owner, das ist W2). W1 implementiert
  defensiv und dokumentiert, was im Smoke zu bestaetigen ist.
- KEIN neues Tool, KEIN neues Widget (das ist W3 `get_agent_status`).
- KEIN neuer npm-Dependency (auch nicht jsdom). Tests ohne DOM-Dep — siehe unten.
- KEINE Seam-Kern-Aenderung am Port/Registry/Adapter-Vertrag, ausser dem noetigen Inject-Punkt.

## Tests (ohne neuen Dep)

Reines Client-JS im Iframe ist ohne Host/DOM nicht voll unit-testbar — teste das Testbare:
- Strukturell: jede ausgelieferte Widget-Resource enthaelt das Binding-Script GENAU einmal
  (DRY-Beweis: identische Quelle in allen Widgets).
- Reine Logik extrahieren und testen: wenn moeglich die Map-/Escape-/Transcript-Render-Logik als
  pure Funktion(en) (z.B. exportiert aus `widget-bind.js`) bauen, sodass node:test sie OHNE DOM
  prueft (u.a.: `innerHTML` wird nie erzeugt; Array-Rendering; unbekannte Felder ignoriert).
- `check:tokens` gruen; Bestandssuite unveraendert gruen (Baseline aktuell 1123, fail 0) + neue Tests.

## Definition of Done

- Gemeinsames Binding in EINER Quelle, in alle 3 Widgets injiziert; `data-mcp-*` werden aus
  `structuredContent` gefuellt (per Feature-Detection, fail-safe ohne Host), XSS-sicher
  (`textContent`).
- `node --check` auf jeder neuen/geaenderten `.js`; `npm run check:tokens` gruen; Bestandssuite +
  neue Tests gruen.
- Report nennt explizit, welche Host-Bruecke(n) angenommen wurden und WAS im W2-Live-Smoke zu
  bestaetigen ist.
- Dualer Review PASS (Safety APPROVED + Clean-Code keine S1/S2). XSS via `innerHTML` = harter S1.
