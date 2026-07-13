# PLAN: Connector-Icon (Wuerfel) + Live-Widget (Flackern, roter Pfeil)

Stand 2026-07-12. Zwei unabhaengige Bugs, keine gemeinsame Wurzel, kein gemeinsamer Fix.
Beide Wurzeln sind BEWIESEN (Kommandos + Code-Zeilen unten reproduzierbar).

## ERGEBNIS (2026-07-12, LIVE auf 9e677d5)

**Bug 2 (Live-Karte) ist ERLEDIGT.** F1/F2/F3/F5 umgesetzt (Phase `widget-wire`, Spec
`tasks/widget-icon-fix-spec.md`, Report `tasks/widget-wire-report.md`), dualer Review PASS,
2140/2140 Tests gruen. Verifikations-Anruf aus dem echten claude.ai, postMessage-Mitschnitt:

```
91597ms sandbox-proxy-ready -> 91610 ui/initialize -> 91612 initialized
99781ms tools/call   107784ms tools/call   108260ms tools/call    (0 Fehlerantworten)
```

Erster Tool-Call 8,2 s NACH dem Handshake (F2 greift), ausschliesslich `tools/call` (F1 greift),
**kein roter Pfeil mehr**. Render-Logs decken sich exakt: 1x `place_call` + 3x Widget-Poll.
F4 (243-KB-Payload) bewusst offen gelassen.

**Bug 1 (Icon): E1 ist BEANTWORTET — negativ. `websiteUrl` ist KEIN Hebel.** `serverInfo.websiteUrl`
steht live auf `https://www.sundartha.com`; der Connector wurde getrennt und **neu verbunden**
(serverInfo also frisch gelesen), danach fragt claude.ai im DOM unveraendert
`google.com/s2/favicons?domain=sundartha.com`. Der Host leitet die Icon-Domain also aus der
**Connector-URL** (`app.sundartha.com/mcp` → eTLD+1) ab. Damit ist Option E1 tot; es bleiben
Option A (andere registrierbare Domain — vom Owner an den Infra-Cutover gekoppelt, nicht solo)
und Option B (warten). Head-Haertung (ICO vor SVG + `apple-touch-icon`) ist live und sorgt dafuer,
dass ein spaeterer Google-Recrawl richtig landet.

Nebenbefund, der eine Annahme kippt: `get_call_status` stand beim Verifikations-Anruf auf
**"Fragen"**, nicht auf "Zulassen" — die Live-Karte hat trotzdem gepollt. Widget-initiierte
Tool-Calls unterliegen der Rueckfrage-Regel offenbar nicht; W4 war nie die Ursache des roten
Pfeils. Der Reconnect hat die Berechtigungen NICHT zurueckgesetzt.

Methodik: Live-Forensik im echten claude.ai (Chrome-Extension, DOM + postMessage-Mitschnitt),
Render-Logs, Google-Favicon-Endpunkte per curl, plus ein 24-Agenten-Fan-out mit adversarischer
Verifikation (Workflow `hermes-widget-icon-rca`). Widerlegte Thesen stehen explizit drin —
damit sie niemand wieder aufwaermt.

---

## BUG 1 — Connector-Icon zeigt einen grauen Wuerfel statt der Fluegel-Marke

### Symptom
In claude.ai steht neben jedem Hermes-Tool-Aufruf (`Hermes get_agent_status`) und in der
Connector-Liste ein grauer 3D-Wuerfel statt der Marke. Seit Wochen, trotz korrektem Favicon-Deploy.

### Wurzel (bewiesen, liegt NICHT in unserem Code)

claude.ai rendert Connector-Icons als
`<img src="https://www.google.com/s2/favicons?domain=<registrierbare Domain>&sz=32">`
(DOM-verifiziert 2026-07-12: unser Icon-`<img>` traegt exakt `domain=sundartha.com&sz=32`;
alle 5 Connector-Icons tragen die eTLD+1, Subdomains werden gestrippt).

Dieser Legacy-Endpunkt ist nur ein Redirector — und er setzt das Schema **hart auf `http://`**:

```
curl -sI "https://www.google.com/s2/favicons?domain=sundartha.com&sz=32" | grep -i location
location: https://t1.gstatic.com/faviconV2?...&url=http://sundartha.com&size=32
                                                 ^^^^  <- hart gesetzt
```

Googles Favicon-Backend fuehrt seinen Cache **pro URL inklusive Schema**. Der Eintrag fuer
`http://sundartha.com` ist ein alter, **positiver** Treffer (der Wuerfel — vermutlich die
Render-Platzhalterseite aus der Zeit vor dem Website-Launch). Der `https`-Eintrag ist laengst korrekt.

| Schluessel (size=32) | Ergebnis | md5 |
| --- | --- | --- |
| `url=http://sundartha.com` **← das fragt claude.ai** | 559 B, **Wuerfel** | `e4c5f593f6128a7328b2bbf5915e427d` |
| `url=https://sundartha.com` | 745 B, **Fluegel** | `b4d89c223b65b5aa7e68f2a7e7dd125e` |
| `domain=www.sundartha.com` (→ `http://www.…`) | **Fluegel** | — |
| nicht existente Domain | 726 B, generischer Globus | `b8a0bf372c762e966cc99ede8682bc71` |

Der Wuerfel ist **nicht** Googles 404-Fallback (andere Bytes/md5) → es ist ein echter, alter Fetch
unter genau diesem Schluessel. Unsere Auslieferung ist heute fehlerfrei:
`http://sundartha.com/favicon.ico` → 301 → `https://…/favicon.ico` → 200, `image/vnd.microsoft.icon`,
5761 B, Fluegel. Auch mit Googlebot- und `Google Favicon`-User-Agent (keine Bot-Blockade).

### Was NICHT die Ursache ist (widerlegt — nicht wieder aufwaermen)

1. **"Google hat nur noch nicht neu gecrawlt"** — falsch formuliert. Google HAT den Fluegel
   (https-Schluessel + www-Schluessel). Vergiftet ist nur der eine `http://`-Apex-Schluessel.
2. **`sz`-Cache-Busting** (SEO-Folklore: ungewoehnliche Groessen erzwingen Refetch): widerlegt.
   `sz=16…2048` liefern nur zwei feste Blobs (379 B / 559 B), beide aus dem alten Snapshot.
3. **Redirect-Hebel** (Apex→www, Spezial-Redirect fuer `/favicon.ico`): widerlegt. Die Live-Kette
   ist bereits korrekt; ein Redirect aendert Googles gespeicherten Snapshot nicht rueckwirkend.
4. **`serverInfo.icons` / `websiteUrl` im MCP-Handshake**: von claude.ai NICHT ausgewertet.
   `anthropics/claude-ai-mcp` Issue **#152** ist offen, 65 Kommentare, **kein Anthropic-Kommentar**.
   Unsere Icon-Kette (`src/mcp-server-info.js`) ist korrekt, wird von diesem Host aber ignoriert.
5. **Bot-/Cloudflare-Blockade des Google-Fetchers**: widerlegt (200 + korrektes ICO fuer beide UAs).
6. **Re-Connect / Connector neu anlegen**: aendert den Cache-Schluessel nicht.

### Fix-Optionen

| # | Option | Aufwand | Risiko | Empfehlung |
| --- | --- | --- | --- | --- |
| **A** | **Connector auf eine andere registrierbare Domain legen** (neue Apex, z. B. `hermes-<x>.app`; `mcp.<neu>` → Render-Gateway). Einziger selbst steuerbarer, deterministischer Hebel. | mittel (Domain, DNS, TLS, `render.yaml`, MCP-URL) | Alle Nutzer muessen den Connector neu verbinden | **JETZT machen, wenn ueberhaupt** — vor dem Launch sind es ~1 Nutzer, nach dem Launch Tausende |
| **B** | **Warten.** Googles Snapshot altert irgendwann aus. | 0 | Icon bleibt unbestimmt lange falsch. **Keine ETA schaetzen** — die letzte Schaetzung war falsch. | Default, wenn das Icon kein Launch-Blocker ist |
| **C** | **Head-Haertung** (`apps/web/src/pages/index.astro`: ICO vor SVG, `apple-touch-icon`). Aendert heute nichts, sorgt aber dafuer, dass ein spaeterer Google-Recrawl garantiert richtig landet. | klein | keins (additiv) | mitnehmen |
| **E1** | **Billiges Experiment vorab**: `websiteUrl` in `src/mcp-server-info.js` testweise auf eine andere registrierbare Domain setzen, deployen, im claude.ai-DOM den `domain=`-Parameter pruefen. Falls claude.ai die Domain doch aus `websiteUrl` ableitet (statt aus der Connector-URL), ist der Fix eine Zeile. | 1 Zeile + Deploy | keins | **vor Option A ausfuehren** |

**Pflicht-Vorabcheck fuer Option A** (eine neue Domain kann selbst schon vergiftet sein):

```bash
curl -sL "https://www.google.com/s2/favicons?domain=<neue-apex>&sz=32" | md5
# MUSS b8a0bf372c762e966cc99ede8682bc71 sein (generischer 404-Fallback = kein Eintrag).
# Alles andere = fremdes/altes Icon unter dem Schluessel -> Domain verwerfen.
```

**Erfolgs-Check (fuer jede Option):**

```bash
curl -sL "https://www.google.com/s2/favicons?domain=sundartha.com&sz=32" | md5
# e4c5f593f6128a7328b2bbf5915e427d = immer noch der Wuerfel
```

---

## BUG 2 — Live-Karte erscheint, verschwindet, erscheint erneut; erster Versuch scheitert (roter Pfeil)

### Der echte Host-Vertrag von claude.ai (empirisch, 2026-07-12)

claude.ai rendert MCP-Widgets in einer **doppelten Iframe-Kaskade**:

```
claude.ai (Host)
  └─ Proxy-Iframe  https://<hash>.claudemcpcontent.com/mcp_apps
       └─ inneres Iframe  <- unser Widget-HTML (per document.write hineingeschrieben)
```

Der Proxy (Quelle gelesen) **leitet Nachrichten unveraendert weiter** — Host→Widget und
Widget→Host. Mitschnitt eines echten Renderings (`get_agent_status`, postMessage-Hook im Host):

```
 7832ms  ui/notifications/sandbox-proxy-ready
 7844ms  ui/initialize                      <- unser widget-bind.js
 7844ms  ui/notifications/size-changed
 7846ms  ui/notifications/initialized
...
20180ms  ui/notifications/sandbox-proxy-ready   <- ZWEITER kompletter Mount
20192ms  ui/initialize
```

Die App darf laut MCP-Apps-Spec (SEP-1865, `ext-apps` 2026-01-26) genau diese Methoden senden:
`tools/call`, `resources/read`, `notifications/message`, `ui/open-link`, `ui/message`,
`ui/request-display-mode`, `ui/update-model-context`, `ui/initialize`, `ping`.

### Wurzel W1 — Zwei von drei Wire-Formaten sind protokollwidrig (→ roter Pfeil)

`src/ui/widgets/call.html:628-635` (`sendToolCall`): solange kein Format bestaetigt ist, feuert das
Widget bei jedem Tick **alle drei Kandidaten parallel**:

```js
sendViaOpenai(tool, args);                          // window.openai.callTool  -> ChatGPT-Konvention, in claude.ai nicht vorhanden
sendViaPostMessage(METHOD_TOOLS_CALL, tool, args);  // "tools/call"    -> KORREKT (Spec + erreicht nachweislich unseren Server)
sendViaPostMessage(METHOD_UI_TOOL_CALL, tool, args);// "ui/tool-call"  -> EXISTIERT NICHT (von uns erfunden)
```

`ui/tool-call` steht in keiner Spec. Der Proxy reicht die Nachricht unveraendert an claude.ai
weiter, der Host bekommt eine unbekannte JSON-RPC-Methode → Fehlerantwort. Das Widget ignoriert
den Fehler still (`call.html:687`), **der Host zeigt ihn aber im Chat an** — das ist der rote Pfeil.
Ab der ersten gueltigen Antwort friert `confirmedFormat` auf `tools/call` ein, deshalb passiert
es **nur beim ersten Mal**.

Passend dazu die Render-Logs eines echten Anrufs: pro 8-Sekunden-Tick kommt genau **ein**
`tools/call` am Server an — die beiden anderen Kandidaten erreichen ihn nie.

### Wurzel W2 — Der Handshake startet ZULETZT (Reihenfolge im ausgelieferten HTML)

`src/ui/widget-catalog.js:117-121` (`withBindScript`) injiziert das BIND_SCRIPT **direkt vor
`</body>`** — also **nach** dem Inline-Skript von `call.html`. Nachgerechnet am echten Serve-Output:

```
Position pollTick();  (Sofort-Poll)   238489
Position init();      (call.html)     238649
Position run(window); (BIND_SCRIPT)   243573   <- ui/initialize startet erst hier
```

`call.html:712-719` (`init`) startet also Polling, **bevor** die App beim Host initialisiert ist.
Heute rettet uns ein Zufall: der Sofort-Tick bricht ab, weil die `call_id` noch nicht gebunden ist
(`call.html:646`). Das ist eine Zufalls-Sicherung, kein Design — jede Aenderung an der Bind-Reihenfolge
laesst sofort einen Tool-Call vor dem Handshake los. Die Spec ist hier eindeutig (MCP-artiger
Handshake vor allem anderen).

### Wurzel W3 — Doppel-Mount (Host-Verhalten, kosmetisch)

Der Mitschnitt oben zeigt **zwei vollstaendige Mounts** (7,8 s und 20,2 s) — bei einem Widget,
das gar keine Tool-Calls sendet. Das "erscheint → verschwindet → erscheint" ist also
**claude.ai-seitig** (Re-Render, wenn die Nachricht finalisiert wird), nicht unser Bug.
Konsequenz fuer uns: das Widget muss remount-fest sein — jede Instanz beginnt bei Null,
Antworten an die alte (zerstoerte) Instanz gehen verloren, und die neue Instanz schrotflintet
erneut (verstaerkt W1).

Verschaerfend: das ausgelieferte `call.html` ist **243 KB** (davon ~170 KB Wing-PNG als data-URI).
Jeder Remount parst das komplett neu — das macht das Flackern sichtbar lang.

### Nebenbefund W4 — `get_call_status` steht auf "Fragen"

In den Connector-Tool-Berechtigungen (claude.ai → Anpassen → Konnektoren → Hermes) stehen
`Get call status`, `Get my number` und `List calls` auf **"Fragen"** (Hand-Symbol) statt "Zulassen".
`get_call_status` ist genau das Tool, das die Live-Karte alle 8 s **selbst** aufruft — ein Widget
kann eine Rueckfrage nicht beantworten. Auf **"Zulassen"** stellen (Owner-Handgriff, kein Code).

### Fix-Design

| # | Aenderung | Datei |
| --- | --- | --- |
| **F1** | Schrotflinte entfernen: **nur noch `tools/call`** senden. `window.openai.callTool` und `ui/tool-call` (inkl. `FORMAT_OPENAI`, `METHOD_UI_TOOL_CALL`, `confirmedFormat`-Auswahllogik) ersatzlos loeschen. | `src/ui/widgets/call.html` |
| **F2** | Tool-Calls hinter den Handshake gaten: `widget-bind.js` signalisiert nach der `ui/initialize`-Antwort ein `ready` (z. B. `window.__hermesUiReady = true` + CustomEvent); `call.html` startet Polling erst darauf. Damit ist die Reihenfolge unabhaengig von der Injektions-Position garantiert. | `src/ui/widget-bind.js`, `src/ui/widgets/call.html` |
| **F3** | JSON-RPC-Fehlerantworten sichtbar behandeln (nicht still verschlucken): Poll bei wiederholtem Fehler stoppen, Karte behaelt den letzten Stand. | `src/ui/widgets/call.html` |
| **F4** | Remount-Kosten senken: Wing-PNG-data-URI (~170 KB) aus dem Live-Widget nehmen (statische Wing-Marke reicht) oder als Ressource referenzieren. | `src/ui/widget-catalog.js` |
| **F5** | Charakterisierungs-Test: der ausgelieferte Widget-HTML darf **kein** `ui/tool-call` und **kein** `window.openai` mehr enthalten; `run(window)`/Handshake-Gate vor jedem `tools/call`. | `test/` |

### Verifikation

1. `npm test` (neuer Test F5 greift).
2. Lokaler Serve-Check: `node -e "import('./src/ui/widget-catalog.js').then(m=>{const h=m.widgetHtml('call'); console.log(h.includes('ui/tool-call'), h.includes('window.openai'))})"` → `false false`.
3. **Ein** echter Testanruf (kostet Geld, ruft eine echte Nummer an — Owner-Gate): Live-Karte darf
   **keinen** roten Pfeil mehr zeigen; die Karte aktualisiert sich weiter im 8-s-Takt.
   Gegenprobe in den Render-Logs: weiterhin genau ein `tools/call` je Tick.
4. Der Doppel-Mount (W3) bleibt — er ist Host-Verhalten. Nach F1-F4 ist er still und schnell,
   ohne Fehlermeldung.

### Harness zum Nachstellen (fuer kuenftige Sessions)

Im claude.ai-Tab VOR dem Tool-Aufruf ausfuehren (Chrome-Extension, `javascript_tool`), dann
Tool aufrufen und `window.__PM` auslesen — zeigt den kompletten Host-Handshake:

```js
window.__PM = [];
const t0 = performance.now();
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  window.__PM.push({ t: Math.round(performance.now() - t0), kind: d.method || d.type });
}, true);
```

Der Proxy-Quelltext (Host-Vertrag) liegt offen:
`curl -sSL "https://<hash>.claudemcpcontent.com/mcp_apps"`.
