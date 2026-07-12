# Spec: Phase `widget-wire` — Live-Karte: nur noch `tools/call`, hinter dem Handshake gegatet

Autoritative Scope-/Design-Definition. Umbrella-Kontext: `PLAN-MCP-ICON-WIDGET-FIX.md` (Bug 2).
Die Wurzeln sind BEWIESEN (Live-Forensik im echten claude.ai, Proxy-Quelltext, Render-Logs).
Es ist KEINE erneute Diagnose noetig — nur die Umsetzung von F1, F2, F3, F5.

## Ausgangslage (Fakten, nicht neu herleiten)

- claude.ai rendert Widgets in einer Doppel-Iframe-Kaskade; der Proxy
  (`<hash>.claudemcpcontent.com/mcp_apps`) leitet postMessage **unveraendert** in beide Richtungen.
- Erlaubte App→Host-Methoden (MCP-Apps-Spec SEP-1865 / `ext-apps` 2026-01-26):
  `tools/call`, `resources/read`, `notifications/message`, `ui/open-link`, `ui/message`,
  `ui/request-display-mode`, `ui/update-model-context`, `ui/initialize`, `ping`.
- `src/ui/widgets/call.html` feuert heute bis zur ersten Antwort **drei** Wire-Formate parallel:
  `window.openai.callTool` (ChatGPT-Konvention, in claude.ai nicht vorhanden), `tools/call`
  (korrekt, erreicht nachweislich den Server) und `ui/tool-call` (**von uns erfunden, in KEINER
  Spec**). Die unbekannte Methode erzeugt eine Host-Fehlerantwort → **roter Pfeil im Chat**.
- `src/ui/widget-catalog.js` injiziert das BIND_SCRIPT direkt vor `</body>`, also NACH dem
  Inline-Skript von `call.html` → `init()` startet Polling, BEVOR `ui/initialize` gelaufen ist.
  Heute rettet nur ein Zufall (`call_id` noch nicht gebunden → Sofort-Tick bricht ab).
- Der Doppel-Mount ("erscheint → verschwindet → erscheint") ist HOST-Verhalten, kein Bug von uns.

## SCOPE (genau diese vier Punkte, nichts sonst)

### F1 — Schrotflinte raus: nur noch `tools/call`
`src/ui/widgets/call.html` sendet Tool-Calls ausschliesslich als JSON-RPC-postMessage mit der
Methode `tools/call`. Ersatzlos entfernt werden: der `window.openai`-Pfad (`sendViaOpenai`,
`FORMAT_OPENAI`), die erfundene Methode `ui/tool-call` (`METHOD_UI_TOOL_CALL`) und die dann tote
`confirmedFormat`-Auswahllogik. Kein toter Code, keine ungenutzten Konstanten (C5/G9).

### F2 — Tool-Calls hinter den Handshake gaten
`src/ui/widget-bind.js` signalisiert **genau einmal**, nachdem die Antwort auf `ui/initialize`
eingetroffen ist: `window.__hermesUiReady = true` **und** ein `CustomEvent` auf `window`
(Name: `hermes:ui-ready`). `call.html` startet Polling (und jeden `tools/call`) erst darauf —
nicht mehr unbedingt in `init()`.

Late-safe: der Konsument prueft zuerst das Flag (Signal schon gefeuert → sofort starten) und
abonniert sonst das Event (`{ once: true }`). Damit ist die Reihenfolge unabhaengig von der
Injektions-Position und remount-fest.

Kein Timeout-Fallback: ein Host, der den Handshake nicht beantwortet, beantwortet auch keinen
`tools/call` — ein Fallback wuerde genau den Fehler wieder einbauen, den F1/F2 beseitigen.

### F3 — JSON-RPC-Fehlerantworten nicht mehr still verschlucken
Heute wird eine Fehlerantwort im Poll-Pfad stumm ignoriert. Neu: aufeinanderfolgende Fehler
zaehlen; nach einer benannten Obergrenze (Konstante, Wert 3 — Magic Number verboten) wird das
Polling gestoppt. Die Karte behaelt ihren letzten Stand (kein Blanking, kein erfundener
Fehlertext). Ein Erfolg setzt den Zaehler zurueck (transiente Fehler duerfen nicht stoppen).

### F5 — Charakterisierungs-Test (`test/`)
Test gegen das AUSGELIEFERTE Widget-HTML (ueber `src/ui/widget-catalog.js`, nicht gegen die
Roh-Datei), der scharf wird, sobald jemand die Schrotflinte wieder einbaut:
- enthaelt **kein** `ui/tool-call`
- enthaelt **kein** `window.openai`
- der `tools/call`-Pfad ist an das ready-Signal aus F2 gebunden (kein Poll-Start, der beim
  Auswerten des Inline-Skripts sofort einen Tool-Call ausloest)
- die anderen Widgets bleiben ausliefer-faehig (Bestandstests bleiben ohne Aenderung gruen)

## ENTSCHEIDUNGEN (getroffen, nicht neu aufmachen)

1. **`window.openai` fliegt raus**, obwohl es die ChatGPT-Apps-Konvention ist. Der ChatGPT-Adapter
   ist nicht live; ein Host-Pfad, der nachweislich nur Fehler erzeugt, bleibt nicht "vorsichtshalber"
   stehen. Falls ChatGPT-Self-Polling spaeter gebraucht wird, kommt es als eigener, getesteter
   Adapter-Pfad zurueck — NICHT jetzt.
2. **Reihenfolge des BIND_SCRIPT bleibt unveraendert** (nach dem Inline-Skript, vor `</body>`).
   Das ist Absicht: sonst ueberschreibt das Binding formatierte Werte mit Rohwerten. Gegatet wird
   ueber das ready-Signal, NICHT durch Umsortieren der Injektion.
3. **Doppel-Mount wird nicht bekaempft** — Host-Verhalten. Das Widget muss ihn nur still und
   fehlerfrei ueberstehen (jede Instanz beginnt bei Null).
4. **Kein Timeout-Fallback** hinter dem Handshake-Gate (siehe F2).

## INVARIANTEN (Bruch = Blocker)

- `src/ui/widget-bind.js` bleibt die EINE Daten-Binding-Quelle; XSS-sicheres `textContent` bleibt.
  Das ready-Signal ist rein additiv — Binding-, i18n- und Handshake-Verhalten aendern sich nicht.
- Die uebrigen Widgets (`agent-status`, `calls`, `calendar`, `my-number`) bleiben in Serve-Output
  und Verhalten unveraendert (sie pollen nicht).
- Master-Schalter `MCP_UI_ENABLED` unangetastet; `/mcp` bleibt stateless (kein per-Request-Gate).
- Kein Eingriff in Call-Pfad, Safety-Gates, Auth, Disclosure, Billing. Keine neuen Dependencies.
- Kein Build-Step, ESM, kein TypeScript. Kommentare deutsch ohne Umlaute.

## ABGRENZUNG (NICHT in dieser Phase)

- **F4** (243-KB-Payload / Wing-PNG-data-URI abspecken) — bewusst separat, nur auf Zuruf.
- Bug 1 (Connector-Icon / `websiteUrl` / Favicon-Head) — macht der Lead, nicht diese Phase.
- Keine Aenderung an `widget-catalog.js` ausser sie ist fuer F1/F2/F3/F5 zwingend.

## Deterministische Verifikation

1. `npm test` gruen (inkl. des neuen F5-Tests).
2. `node -e "import('./src/ui/widget-catalog.js').then(m=>{const h=m.widgetHtml('call');console.log(h.includes('ui/tool-call'), h.includes('window.openai'))})"`
   → exakt `false false`.
3. `node --check` auf jede geaenderte `.js`-Datei.
