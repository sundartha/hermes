# P8 — Widget-UI: ChatGPT-Adapter auf Paritaet (CSP, Domain, Metadaten-Schluessel) — Spec

IDs im Auftrag: **T-30**, **T-31**, **X-7**, **T-23** (T-34 und X-3: nicht gebaut, s. §3).
Basis: master `f769841`. Vorgeschlagener Branch: `phase/openai-p8-widget-ui`.
Quellen: `tasks/PLAN-OPENAI-TECHNIK.md` §P8 (:843-940), `tasks/openai-p0-entscheidungen.md`
§2 D0-1 (:36-70), D0-8 (:205-217), §3 (:250-270), U-6 (:387-390);
`tasks/openai-audit/00-openai-anforderungen.md` Zeilen 56 (T-23), 63 (T-30), 64 (T-31),
67 (T-34), 134 (X-3), 135 (X-4), 138 (X-7). `00-mcp-spec.md` ist NICHT massgeblich.
Primaerquellen am 2026-09-21 lesend nachgesehen (Zitate in §0.2).

**Art der Phase: Live-Verhalten, kleinster moeglicher Eingriff.** Ergebnis der Pruefung in
einem Satz: *der ChatGPT-Adapter ist auf dem Draht tot — fuer OpenAI wie fuer Claude —, OpenAI
nimmt den mcp-nativen Pfad, und dort fehlen CSP und Domain an der Stelle, an der OpenAI sie
liest (Resource-Inhalt, nicht Tool-Deskriptor).* Gebaut wird deshalb NICHTS am ChatGPT-Adapter,
sondern zwei OpenAI-Alias-Schluessel am Resource-Inhalt des mcp-nativen Pfads, die ein
MCP-Apps-Client nicht kennt. `tools/list` und `resources/list` bleiben byte-identisch.

Testkommando (einzig gueltig): `npm test -- -- --test-concurrency=4`. Nur `# pass` / `# fail`
zaehlen, nie der Exit-Code. Grundlinie master: **6220 / 6220**. Ein roter Fall zaehlt erst,
wenn er ISOLIERT erneut rot ist (`NODE_ENV=test node --test --test-concurrency=4 test/<datei>`).
Ausgabe nie abschneiden (in eine Datei im Scratchpad umleiten, dann lesen).

Keine neue Env-Variable in dieser Phase (die Domain kommt aus dem bestehenden
`config.server.publicUrl`, Owner-Entscheidung E-1). Die Vier-Orte-Regel greift deshalb nicht.

---

## 0. Ist-Zustand (gemessen, 2026-09-21)

### 0.1 Code

| Stelle | Was dort steht |
|---|---|
| `src/ui/registry.js:43-50` | `uiRendererFor`: `chatgptRenderer` NUR wenn `capabilityDeclaresChatgptUi(hostHint.capabilities)`, sonst `mcpNativeRenderer` |
| `src/routes/mcp.js:152` | `capabilities: req.body?.params?.capabilities` — steht NUR im Body eines `initialize`-POST |
| `src/routes/mcp.js:164` | `sessionIdGenerator: undefined` — stateless: jeder POST baut einen frischen Server |
| `src/mcp-server.js:35-37` | stdio: `uiHost: { enabled }` — **ohne** `capabilities` → immer mcp-nativ |
| `src/ui/contract.js:88-107` | `makeUiRenderer`: `registerResource` (Read-Callback liefert `contents: [{ uri, mimeType, text }]` — **kein `_meta`**) und `toolMeta` |
| `src/ui/contract.js:79-82` | `uiSubmissionMeta()` → `{ csp: UI_CSP, domain? }` |
| `src/ui/adapters/mcp-native.js:16` | `buildMeta: (uri) => ({ resourceUri: uri, ...uiSubmissionMeta() })` → CSP/Domain am **Tool-Deskriptor** `_meta.ui` |
| `src/ui/adapters/chatgpt.js:11` | `buildMeta: (uri) => uri` (flacher String, kein CSP/Domain) |
| `src/ui/contract.js:46-55` | Kommentar: `text/html+skybridge` sei "P0-Befund" |
| `src/ui/contract.js:57-65` | Kommentar-Block "Einreichungs-Pflichtfelder am Widget-_meta (T-30/T-31)" — suggeriert Erledigung |
| `src/mcp-tools.js:1072,1342,1371,1457,1497` | die 5 Widget-Tools: place_call, get_my_number, list_calls, get_calendar, get_agent_status |

### 0.2 Primaerquellen (developers.openai.com, lesend, 2026-09-21)

- `https://developers.openai.com/apps-sdk/reference` (= `plugins/reference`), Tabelle
  "_meta fields": `_meta.ui.resourceUri`, `_meta["openai/outputTemplate"]` → **Tool descriptor**;
  `_meta.ui.csp`, `_meta.ui.domain`, `_meta["openai/widgetCSP"]`, `_meta["openai/widgetDomain"]`,
  `_meta["openai/widgetDescription"]` → **Resource contents**. `openai/outputTemplate` =
  "OpenAI-specific optional/compatibility alias for `_meta.ui.resourceUri`";
  `openai/widgetDomain` = "Compatibility alias for `_meta.ui.domain`"; `openai/widgetCSP` =
  "Legacy ChatGPT compatibility for CSP with snake_case fields"; `_meta.ui.domain` = "required
  when submitting a plugin with UI; must be unique per plugin".
- `https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt`: ChatGPT implementiert den
  MCP-Apps-Standard; Resource-mimeType `text/html;profile=mcp-app`; Bruecke `ui/initialize`,
  `ui/notifications/tool-result`, `tools/call` per postMessage; CSP/Domain im Beispiel am
  `_meta.ui` des **Resource-Inhalts**. `text/html+skybridge` kommt nicht vor.
- `https://developers.openai.com/apps-sdk/deploy/troubleshooting`: "Confirm the tool descriptor
  sets `_meta.ui.resourceUri` to a registered HTML resource with `mimeType:
  "text/html;profile=mcp-app"` (ChatGPT honors `_meta["openai/outputTemplate"]` as an optional
  compatibility alias)".
- MCP-Apps-Spezifikation (`modelcontextprotocol/ext-apps`, `specification/2026-01-26/apps.mdx`):
  `UIResourceMeta` (csp, domain, permissions, prefersBorder) liegt unter `contents[]._meta.ui`
  von `resources/read`; `domain` ist "Host-dependent" (Beispiele
  `a904794854a047f6.claudemcpcontent.com`, `www-example-com.oaiusercontent.com`).
- Referenz-Host `@modelcontextprotocol/ext-apps@2.0.0` (npm pack in den Scratchpad):
  `grep -rl openai package/` = **0 Dateien**. Der Referenz-Host liest `_meta?.ui?.resourceUri` /
  `_meta?.ui?.visibility` und keinen `openai/*`-Schluessel.

### 0.3 Draht-Messungen auf master (lesend, reproduzierbar)

**M-1 — ChatGPT-Adapter ist auf dem Draht tot (HTTP).** Server mit `MCP_UI_ENABLED=true`
gestartet (Test-Helfer `startServer`), `initialize` MIT
`capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes = ["text/html+skybridge"]`
geschickt, danach `tools/list` und `resources/read ui://hermes/call`:

```
init ext {"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}
place_call _meta {"openai/toolInvocation/invoking":"Placing the call","openai/toolInvocation/invoked":"Call started","ui":{"resourceUri":"ui://hermes/call","csp":{"connectDomains":[],"resourceDomains":[]},"domain":"https://agent.test"}}
read text/html;profile=mcp-app [ 'uri', 'mimeType', 'text' ]
```

Ein Client, der sich als Skybridge-Host erklaert, bekommt auf `tools/list` und `resources/read`
**den mcp-nativen Pfad** — weil nur der `initialize`-POST `params.capabilities` traegt und der
stateless Transport nichts in den naechsten POST mitnimmt. Der `initialize`-Response enthaelt
keine Tool-Deskriptoren und keine Resource-Inhalte. Damit erzeugt `chatgptRenderer` auf **keinem**
Pfad (HTTP, stdio) fuer **keinen** Client (Claude, OpenAI) eine sichtbare Ausgabe. D0-8
(deklariert OpenAI `text/html+skybridge`?) ist fuer das Ergebnis gleichgueltig.

**M-2 — Resource-Inhalt traegt kein `_meta` (stdio-aequivalent, alle 5 Widgets).** Capture-Skript
(Anhang A) auf master, `MCP_UI_ENABLED=true`:

```
tools 10 widget [place_call, get_my_number, list_calls, get_calendar, get_agent_status] je _meta = openai/toolInvocation/invoking|openai/toolInvocation/invoked|ui
res  5 Eintraege {uri,name,title,mimeType:"text/html;profile=mcp-app"}
read 5x 'uri,mimeType,text'  (kein _meta)
sha256 master-Capture: 8c22f0008c10ce6e24e388601faf002d395ef0cff76bcbbd4f4ca70b817daf2b
```

Folge: CSP und Domain stehen heute nur am Tool-Deskriptor, wo weder OpenAI noch die
MCP-Apps-Spezifikation sie lesen. **T-30 und T-31 sind auf dem Pfad, den OpenAI tatsaechlich
nimmt, NICHT erfuellt** — entgegen Plan und P0 (s. §5).

---

## 1. Entscheidung: der ChatGPT-Adapter wird NICHT gebaut

Frage des Leads: welchen Pfad nimmt OpenAIs Client? Antwort, zweifach belegt:

1. **Nach OpenAIs eigener Doku den mcp-nativen**: `text/html;profile=mcp-app`,
   `_meta.ui.resourceUri`, MCP-Apps-Bruecke (§0.2). Skybridge kommt in den aktuellen Seiten nicht
   mehr vor.
2. **Nach unserem Code zwangslaeufig den mcp-nativen**, egal was der Client deklariert (M-1).

Welcher heutige Client waehlt den ChatGPT-Adapter? **Keiner, auf dem Draht.** Er wird nur auf
dem `initialize`-POST instanziiert, dessen Antwort nichts von ihm enthaelt. Claude ist deshalb
nicht betroffen — der Adapter ist nicht "schlafend", sondern tot.

Folge: T-30/T-31/X-7/T-23 werden am mcp-nativen Pfad bewertet. Aenderungen an
`src/ui/adapters/chatgpt.js` waeren wirkungslos. Den Adapter zu **entfernen** ist ebenfalls
nicht Teil von P8: `registry.js:29-31` haelt fest, dass der Rueckbau einen Owner-Auftrag
braucht, und die Tests T-P3-AC2..AC7 sowie zwei OpenAI-Phasen-Tests haengen daran (§3, O-P8-1).

Richtiggestellt wird die falsche Behauptung (Schritt 4).

---

## 2. Arbeitsschritte

### Schritt 1 — Vorher-Messung auf master sichern (kein Code)

- **Was:** Anhang A auf master ausfuehren, Ausgabe als `p8-master.json` in den Scratchpad legen,
  sha256 notieren. Erwartet: sha256 `8c22f000…17daf2b` (identisch zu §0.3, solange master
  `f769841` ist; weicht master ab, gilt der neu gemessene Wert und wird im Bericht genannt).
- **Datei:** keine. **IDs:** Beweisgrundlage fuer Regel 1. **Pfade:** mcp-nativ (registerTools,
  den HTTP und stdio teilen).
- **Beweis (c):** `node <scratch>/p8-capture.mjs "$PWD" | shasum -a 256` auf einem
  `git worktree` von master.

### Schritt 2 — Charakterisierungstest: ChatGPT-Adapter ist auf dem Draht tot

- **Was:** Neue Testdatei `test/openai-p8-widget-ui.test.js`. Fall **P8-A (HTTP)**:
  `startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } })`; `initialize` mit
  Skybridge-Capabilities (Body wie M-1); danach `tools/list` und
  `resources/read { uri: "ui://hermes/call" }` als eigene POSTs. Erwartet:
  `place_call._meta.ui.resourceUri === "ui://hermes/call"`,
  `"openai/outputTemplate" in place_call._meta === false`,
  `contents[0].mimeType === "text/html;profile=mcp-app"`. Positiv-Kontrolle: `_meta.ui` ist
  vorhanden (sonst liefe der Test bei `MCP_UI_ENABLED=false` leer gruen).
  Fall **P8-B (stdio)**: `StdioClientTransport` auf `src/mcp-server.js` (Muster
  `test/openai-p5a-datenminimierung.test.js:172-180`), `env: { ...BASE_ENV, MCP_UI_ENABLED: "true" }`,
  Client mit `capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html+skybridge"] } } }`;
  roher `tools/list` (Muster `rawToolsList`, `test/openai-p3-security-schemes.test.js:41,51-53`),
  gleiche Erwartung.
- **Datei:** `test/openai-p8-widget-ui.test.js` (neu). Kein Katalog-/ABNAHME-Praefix am Testnamen
  (sonst landet er im falschen Lauf).
- **IDs:** Beleg fuer die Entscheidung §1 (T-30/T-31/X-7/T-23 am ChatGPT-Adapter gegenstandslos).
- **Pfade:** HTTP + stdio; ChatGPT-Adapter (als Nicht-Wahl) + mcp-nativ.
- **Beweis (b):** der Test ist schon auf master gruen (Charakterisierung) und bleibt gruen. Der
  Pruefer liest, dass `initialize` und `tools/list` **getrennte** POSTs sind und die
  Skybridge-Capability wirklich gesendet wird.

### Schritt 3 — OpenAI-Alias-Schluessel am Resource-Inhalt (mcp-nativ)

- **Was:**
  1. `src/ui/contract.js`, nach `uiSubmissionMeta()` (:79-82): zwei benannte Konstanten
     `OPENAI_WIDGET_CSP_KEY = "openai/widgetCSP"`, `OPENAI_WIDGET_DOMAIN_KEY = "openai/widgetDomain"`
     und eine Funktion `openAiResourceMeta()`, die zur **Aufrufzeit** liefert:
     `{ "openai/widgetCSP": { connect_domains: [...UI_CSP.connectDomains], resource_domains: [...UI_CSP.resourceDomains] }, "openai/widgetDomain": publicUrl }`
     — `openai/widgetDomain` entfaellt bei leerem `config.server.publicUrl` (gleiche Regel wie
     `uiSubmissionMeta`). Die snake_case-Listen werden aus `UI_CSP` **abgeleitet**, nicht
     neu geschrieben (eine Quelle; Regel 5: nie weiter als die mcp-native CSP). Kein
     `redirect_domains` (X-7, s. §3), kein `frame_domains`.
  2. `src/ui/contract.js:88-107` `makeUiRenderer({ mimeType, metaKey, buildMeta, buildResourceMeta })`:
     optionales viertes Objektfeld. Im Read-Callback (:102) wird `_meta: buildResourceMeta()`
     NUR angehaengt, wenn `buildResourceMeta` uebergeben ist; sonst bleibt der Inhalt exakt
     `{ uri, mimeType, text }`. `toolMeta` (:105) und `registerResource`-Config (:101) bleiben
     unveraendert — damit sind `tools/list` und `resources/list` byte-identisch.
  3. `src/ui/adapters/mcp-native.js:10-17`: `buildResourceMeta: openAiResourceMeta` ergaenzen.
     `src/ui/adapters/chatgpt.js` bleibt unberuehrt.
- **Warum die geteilte Fabrik angefasst wird:** der Read-Callback, der den Resource-Inhalt baut,
  existiert NUR in `makeUiRenderer` (:96-104). Ohne Fabrik-Eingriff muesste mcp-native
  `registerResource` duplizieren (G5-Verstoss) oder den Server-Aufruf abfangen. Der Eingriff ist
  ein optionales Feld mit Default "nichts" — der ChatGPT-Adapter ist dadurch nachweislich
  unveraendert (T-P3-AC5/AC7 lesen dessen Inhalt und bleiben gruen).
- **Warum die Alias-Schluessel und NICHT `_meta.ui.csp`/`_meta.ui.domain` am Inhalt (Regel 1):**
  Standard-Schluessel am Resource-Inhalt liest auch Claude — `ui.domain` ist laut Spezifikation
  "host-dependent", Claudes eigenes Format ist `<hash>.claudemcpcontent.com`. Was Claude mit
  `https://app.sundartha.com` dort tut (ignorieren, ablehnen, nicht rendern), ist ohne
  Live-Probe UNKNOWN. `openai/*` dagegen ist ein fremder, nicht reservierter Namensraum
  (MCP-Basis-Spezifikation, `_meta`-Praefixe), die MCP-Apps-Spezifikation definiert am Inhalt
  nur `_meta.ui`, und der Referenz-Host enthaelt 0 `openai`-Vorkommen (§0.2). **Noetig** ist der
  Schluessel, weil OpenAI CSP/Domain ausschliesslich am Resource-Inhalt liest und der Inhalt
  heute kein `_meta` hat (M-2). OpenAI nennt beide Schluessel ausdruecklich als Aliase, die
  ChatGPT honoriert.
- **Datei:** `src/ui/contract.js:79-107`, `src/ui/adapters/mcp-native.js:10-17`.
- **IDs:** T-30, T-31.
- **Pfade:** HTTP `/mcp` + stdio (beide ueber `registerTools` → `mcpNativeRenderer`); nur
  mcp-nativ; nur `resources/read`.
- **Beweis (a)+(b), siehe Schritt 5.**

### Schritt 4 — Falsche Erledigungs-Behauptungen richtigstellen (nur Kommentare)

- **Was:** Kommentare, die Erledigung oder einen Beleg behaupten, den es nicht gibt:
  - `src/ui/contract.js:46-55`: "P0-Befund" fuer `text/html+skybridge` → unbelegt; OpenAIs
    Doku nennt nur `text/html;profile=mcp-app`; der Detektor greift nur auf dem
    `initialize`-POST und erreicht damit nie `tools/list`/`resources/read` (Verweis auf den
    Test aus Schritt 2 per Namen).
  - `src/ui/contract.js:57-65`: der Block behauptet T-30/T-31 am "Widget-_meta". Richtig: die
    Felder am **Tool-Deskriptor** (`uiSubmissionMeta`) liest OpenAI dort nicht; wirksam fuer
    OpenAI sind die Alias-Schluessel am Resource-Inhalt (`openAiResourceMeta`); die
    Standard-Schluessel am Inhalt sind bewusst NICHT gesetzt (Claude-`domain`-Risiko, O-P8-2).
    Der Tool-Deskriptor-Anteil bleibt stehen, weil jede Aenderung `tools/list` fuer Claude
    veraendern wuerde.
  - `src/ui/adapters/mcp-native.js:13-15`: "die zwei Einreichungs-Pflichtfelder liegen dort,
    wo resourceUri schon liegt" → falsch, wie oben.
  - `src/ui/adapters/chatgpt.js:3-6` und `src/ui/registry.js:1-4`: "Erklaert ein Host
    explizit die ChatGPT-Skybridge-Konvention, gewinnt dieser Adapter" → gilt nur fuer den
    `initialize`-POST; auf dem Draht wird der Adapter nie gewaehlt, auch nicht fuer OpenAI.
  - `src/routes/mcp.js:149-151`: "capabilities dienen nur noch der expliziten
    ChatGPT-Adapter-Wahl" → ergaenzen: diese Wahl erreicht keinen Tool-Deskriptor.
- **Datei:** wie aufgezaehlt. **IDs:** Lead-Regel 4 (keine ID). **Pfade:** keiner (Kommentar).
- **Beweis (a)+(c):** `grep -n "P0-Befund" src/ui/contract.js src/ui/adapters/chatgpt.js`
  zeigt keinen Treffer mehr in Zusammenhang mit Skybridge (Zeile 10 bleibt: betrifft `UI_MIME`);
  `git diff master -- src/routes/mcp.js src/ui/registry.js src/ui/adapters/chatgpt.js` enthaelt
  ausschliesslich Kommentarzeilen (`git diff -U0 ... | grep '^[+-][^+-]' | grep -v '^\s*[+-]\s*//'`
  = leer). Der Pruefer liest jede geaenderte Stelle gegen M-1/M-2.

### Schritt 5 — Tests fuer Schritt 3 am echten Draht, beide Pfade

In `test/openai-p8-widget-ui.test.js`:

- **P8-C (HTTP, T-30/T-31):** Server `MCP_UI_ENABLED=true` (BASE_ENV `PUBLIC_URL=https://agent.test`).
  Roher `resources/list`; fuer JEDES Tool aus rohem `tools/list` mit `_meta.ui.resourceUri`
  (erwartet genau 5, Positiv-Kontrolle `=== 5`) ein roher `resources/read`. Je Inhalt:
  `assert.deepEqual(contents[0]._meta, { "openai/widgetCSP": { connect_domains: [], resource_domains: [] }, "openai/widgetDomain": "https://agent.test" })`,
  `"ui" in contents[0]._meta === false`, `"redirect_domains" in ..."openai/widgetCSP" === false`,
  `contents[0].mimeType === "text/html;profile=mcp-app"`.
- **P8-D (stdio, dasselbe):** Kindprozess `src/mcp-server.js`, gleiche Erwartungen. (DP-1: erst
  erfuellt, wenn beide Pfade gruen.)
- **P8-E (T-23 + eine Resource, HTTP):** fuer jedes der 5 Widget-Tools: `_meta.ui.resourceUri`
  vorhanden, `"openai/outputTemplate" in _meta === false`, und
  `resources.filter(r => r.uri === resourceUri).length === 1`.
- **P8-F (Nicht-Regression Tool-Deskriptor, HTTP):** je Widget-Tool
  `Object.keys(_meta).sort()` deepEqual
  `["openai/toolInvocation/invoked","openai/toolInvocation/invoking","ui"]` und
  `Object.keys(_meta.ui).sort()` deepEqual `["csp","domain","resourceUri"]`; je
  `resources/list`-Eintrag Schluesselmenge `["mimeType","name","title","uri"]`.
- **P8-G (fail-safe, in-process):** `config.server.publicUrl = ""` (Muster E7-T12,
  `test/mcp-ui.test.js:658-673`, im `finally` zurueck): Read-Callback des mcp-nativen Renderers
  liefert `_meta` nur mit `openai/widgetCSP`, **ohne** `openai/widgetDomain`.
- **P8-H (ChatGPT-Adapter unveraendert, in-process):** `readbackResource(chatgptRenderer, ...)`
  → `Object.keys(contents[0]).sort()` deepEqual `["mimeType","text","uri"]`.
- **IDs:** T-30, T-31, T-23. **Pfade:** HTTP + stdio, mcp-nativ; ChatGPT-Adapter als
  Unveraendert-Kontrolle.
- **Beweis (b):** `NODE_ENV=test node --test --test-concurrency=4 test/openai-p8-widget-ui.test.js`
  → alle Faelle gruen; Negativ-Kontrolle fuer den Pruefer: Schritt 3.3 lokal zuruecknehmen →
  P8-C und P8-D werden rot (belegt, dass sie den Punkt pruefen und nicht leer laufen).

### Schritt 6 — Nachher-Messung: Byte-Beweis fuer Regel 1

- **Was:** Anhang A auf dem Branch, danach Vergleich mit `p8-master.json`:
  `node -e` (Anhang B) entfernt aus jeder Branch-`rr[i].contents[0]` das Feld `_meta` und
  vergleicht die gesamte Struktur mit master.
- **Erwartet:** `tl` (tools/list) und `rl` (resources/list) **byte-identisch**
  (`JSON.stringify`-Gleichheit); `rr` nach Entfernen von `_meta` byte-identisch; das entfernte
  `_meta` ist in allen 5 Faellen genau
  `{"openai/widgetCSP":{"connect_domains":[],"resource_domains":[]},"openai/widgetDomain":"https://agent.test"}`.
- **Datei:** keine. **IDs:** Regel 1. **Pfade:** mcp-nativ (registerTools = HTTP und stdio).
- **Beweis (c):** Ausgabe von Anhang B: `tools/list identisch: true`, `resources/list identisch: true`,
  `resources/read ohne _meta identisch: true`, `zusatz: 5x <obiges Objekt>`.

### Schritt 7 — CSP-Leerbefund wiederholen (T-30 "exact domains")

- **Was:** keine Codeaenderung; die Aussage "Widgets laden von nirgendwo" wird am ausgelieferten
  HTML wiederholt, weil die leeren Listen sonst eine Falschangabe waeren.
- **Beweis (c):**
  `node --input-type=module -e 'import {widgetHtml} from "./src/ui/widget-catalog.js"; for (const id of ["call","my-number","calls","calendar","agent-status"]) { const h = widgetHtml(id, "en"); console.log(id, (h.match(/https?:\/\/(?!www\.w3\.org\/2000\/svg)[^\s"'"'"'<>)]+/g)||[]).length, /\bfetch\(|XMLHttpRequest|new WebSocket|EventSource|sendBeacon|importScripts|@font-face|<iframe/.test(h)); }'`
  → je Widget `0 false`. Faellt eine Zeile anders aus, ist Schritt 3 NICHT zu mergen, sondern
  die CSP-Liste zuerst zu belegen.

### Schritt 8 — PLAN-SECURITY.md

- **Was:** neuer Abschnitt `## OpenAI-P8 — Widget-CSP und Domain am Resource-Inhalt (2026-09-21)`
  am Dateiende: was gesetzt wird (Aliase, leere Listen, Domain = `PUBLIC_URL`), was bewusst
  NICHT (Standard-Schluessel am Inhalt, `redirect_domains`, ChatGPT-Adapter), warum
  (Claude-`domain`-Risiko), offene Owner-Punkte O-P8-1..3.
- **Beweis (a):** `grep -n "OpenAI-P8" PLAN-SECURITY.md` → 1 Ueberschrift.

### Schritt 9 — Gesamtlauf

- **Beweis (c):** `node --check` fuer jede geaenderte `src/`-Datei; dann
  `npm test -- -- --test-concurrency=4 > <scratch>/p8-suite.txt 2>&1`,
  `grep -E "^# (pass|fail)" <scratch>/p8-suite.txt` → `# pass` = 6220 + Zahl der neuen Faelle,
  `# fail 0`. Rote Faelle einzeln isoliert nachlaufen; nur isoliert rot zaehlt.
- **Erwartete Testbrueche durch diese Phase: keiner.** Begruendung: kein bestehender Test liest
  `resources/read` ueber den Draht (grep `resources/read|readResource|listResources` in `test/`
  = 0 Treffer); die In-process-Tests lesen nur `contents[0].text`/`.mimeType`
  (`test/mcp-ui.test.js:699-700,735,866,877,938,960,1120,1126,1211,1217,1291,1297`), die
  unveraendert bleiben. T-P3-AC2 (`:552-575`) wird NICHT angepasst — er pinnt den
  ChatGPT-Adapter, der unveraendert bleibt.

---

## 3. Was in dieser Phase NICHT gebaut wird

- **ChatGPT-Adapter (T-30/T-31/X-7/T-23 in `chatgpt.js`):** tot auf dem Draht (M-1, Schritt 2).
  Jede Aenderung dort waere wirkungslos. Plan-Abnahmekriterien 1-3 (ChatGPT-`_meta` mit CSP/Domain,
  beide Adapter "in einem Lauf") sind gegenstandslos.
- **Rueckbau des ChatGPT-Adapters:** er ist toter Code, aber der Rueckbau ist laut
  `registry.js:29-31` ein Owner-Auftrag und reisst 7+ Tests mit (T-P3-AC2..AC7, P2-/P3-Tests). →
  O-P8-1.
- **T-23 als "beide Schluessel":** der Wortlaut ist "Standard-Key bevorzugt,
  `openai/outputTemplate` nur als Kompatibilitaets-Alias"; OpenAI kommentiert den Alias im eigenen
  Beispiel aus. Der mcp-native Pfad liefert den Standard-Key allein → erfuellt (belegt in P8-E).
  `openai/outputTemplate` zusaetzlich waere eine Byte-Aenderung an Claudes `tools/list` ohne
  Notwendigkeit (Regel 1).
- **X-7 (`openai/widgetCSP.redirect_domains`):** nur noetig fuer `window.openai.openExternal(...)`.
  Das Widget-HTML enthaelt kein `window.openai` (T-P3-AC7) und kein `href` (T-P3-AC5) → es gibt
  kein Ziel, das freizuschalten waere. Ein leeres `redirect_domains` waere Falschangabe-nah und
  wird weggelassen.
- **Standard-Schluessel `_meta.ui.csp`/`_meta.ui.domain` am Resource-Inhalt:** Claude liest sie;
  `ui.domain` ist host-spezifisch (Claude: `<hash>.claudemcpcontent.com`), die Wirkung von
  `https://app.sundartha.com` dort ist ohne Live-Probe UNKNOWN. → O-P8-2.
- **Entfernen von CSP/Domain am Tool-Deskriptor (`uiSubmissionMeta`, E7):** wirkungslos, aber
  Entfernen aendert Claudes `tools/list`. Bleibt, Kommentar wird ehrlich.
- **T-34 (Sprach-Suffix in der URI):** Lead-Regel 2, Owner O-4, nicht additiv (geteilte Fabrik,
  `contract.js:21,92,97,105`).
- **X-3 (`openai/widgetAccessible`, `openai/visibility`, `openai/profile`, `openai/fileParams`,
  `widgetDescription`):** Lead-Regel 3. Alle optional; `openai/toolInvocation/*` kommt aus P2.
- **X-4 (`openai/locale` u.a.):** Client-Felder, nichts zu bauen.
- **`window.openai`-Bruecke:** unnoetig — ChatGPT spricht laut Doku die MCP-Apps-Bruecke, die das
  Widget-HTML schon spricht; ob die Karte in ChatGPT tatsaechlich lebt, ist eine Live-Probe
  (O-P8-3), kein Code.
- **Schalter `MCP_UI_ENABLED`:** nicht umgelegt, Default nicht geaendert.
- **Keine Safety-Gates, keine Offenlegung, kein Anruf/SMS, kein Deploy, kein Push, kein Merge.**

**Owner-Liste (neu):**
- **O-P8-1:** ChatGPT-Adapter zurueckbauen (toter Code) — ja/nein.
- **O-P8-2:** Standard-Schluessel am Resource-Inhalt setzen — nur nach Live-Probe mit Claude
  (rendert das Widget mit `_meta.ui.domain = https://app.sundartha.com` weiter?). Relevant, falls
  OpenAIs Review den Alias nicht als `_meta.ui.domain` akzeptiert.
- **O-P8-3:** Live-Probe in ChatGPT Developer Mode (haengt am selben Termin wie OW-4): rendert die
  Karte, greifen CSP/Domain-Aliase, meldet der Review-Check die Domain als vorhanden?

---

## 4. Pre-Mortem — ein Jahr spaeter war P8 ein Fehler

1. **Claude-Widgets rendern nicht mehr.** *Was passiert ist:* der Implementierer hat statt der
   Aliase `_meta.ui.domain` an den Resource-Inhalt gehaengt ("das ist doch der Standard"); Claude
   hat den fremden Origin als Sandbox-Domain abgelehnt, jede Karte blieb leer, niemand hat es
   gemerkt, weil Tests nur Strukturen pruefen. *Entschaerfung:* P8-C/D pruefen
   `"ui" in contents[0]._meta === false`; Schritt 6 belegt Byte-Identitaet bis auf genau das
   Alias-Objekt; Standard-Schluessel sind Owner-gegatet (O-P8-2).
2. **OpenAIs Review lehnt ab: "`_meta.ui.domain` fehlt".** *Was passiert ist:* das Pruefwerkzeug
   liest nur den Standard-Schluessel, der Alias zaehlt nicht. *Entschaerfung:* als UNKNOWN offen
   benannt (O-P8-2/O-P8-3); der Weg zum Standard-Schluessel ist ein Einzeiler in
   `openAiResourceMeta`-Naehe, aber nur nach Claude-Live-Probe. Akzeptiertes Risiko: eine
   Review-Runde, kein Live-Schaden.
3. **Die leere CSP war eine Falschangabe.** *Was passiert ist:* ein spaeteres Widget-Update laedt
   eine Schrift von einem CDN; `connect_domains`/`resource_domains` blieben leer; ChatGPT blockt,
   die Karte bricht; oder der Reviewer wertet es als falsche Angabe. *Entschaerfung:* Schritt 7
   wiederholt den Leerbefund am ausgelieferten HTML; die Alias-Listen sind aus `UI_CSP`
   **abgeleitet**, eine Aenderung dort traegt automatisch in beide Formen.
4. **Der tote Adapter wurde wieder lebendig.** *Was passiert ist:* jemand hat den Transport auf
   stateful umgestellt (Session-ID), plotzlich tragen `tools/list`-Requests die
   initialize-Capabilities, der ChatGPT-Adapter greift fuer Skybridge-Clients — ohne CSP/Domain,
   mit `text/html+skybridge`, den OpenAI nicht mehr dokumentiert. *Entschaerfung:* Test P8-A
   pinnt "Skybridge-initialize → mcp-nativ auf tools/list"; faellt er, zwingt das die Frage
   O-P8-1 auf den Tisch. Der korrigierte Kommentar nennt den Test beim Namen.
5. **Zweiter Pfad vergessen.** *Was passiert ist:* nur HTTP getestet, stdio lieferte ohne `_meta`
   aus (z.B. weil ein kuenftiger stdio-Umbau einen eigenen Renderer baut). *Entschaerfung:* P8-D
   (echter stdio-Kindprozess) ist Pflicht; Schritt 3 sitzt im Renderer, den beide Pfade teilen.
6. **Die geteilte Fabrik veraendert still den ChatGPT-Inhalt.** *Entschaerfung:* optionales Feld
   ohne Default-Wirkung; P8-H pinnt die Schluesselmenge des ChatGPT-Inhalts.
7. **Kosten/Anrufe/Transkripte:** diese Phase beruehrt keinen Calls-/SMS-/Budget-Pfad und keine
   Tool-Handler; die neuen Felder enthalten nur `PUBLIC_URL` (oeffentlich) und leere Listen — kein
   Tenant-, Transkript- oder Secret-Inhalt. Test P8-C prueft das exakte Objekt per `deepEqual`, ein
   zusaetzliches Feld faellt auf.

---

## 5. Widersprueche Plan / P0 / Code und ihre Aufloesung

Siehe StructuredOutput-Feld `widersprueche` der Planungsrunde; hier die Kurzfassung:

1. Plan §P8 und P0 D0-8/§3: "T-30/T-31 sind am mcp-nativen Pfad bereits erfuellt" — falsch. OpenAI
   liest CSP/Domain am Resource-Inhalt; Hermes setzt sie am Tool-Deskriptor (M-2). Primaerquelle
   gewinnt.
2. P0: "ChatGPT-Adapter-Teil ungestartet bis OW-4/D0-8" — gegenstandslos: der Adapter ist
   unabhaengig von D0-8 tot (M-1). P8 braucht OW-4 nicht.
3. Plan T-23 "beide Schluessel am selben Deskriptor" — ueberinterpretiert; Wortlaut und
   OpenAI-Beispiel verlangen nur den Standard-Key.
4. Lead/Plan/Stand: "`widgetDescription` existiert in keiner Quelle" — falsch:
   `apps-sdk/reference` fuehrt `_meta["openai/widgetDescription"]` (Resource contents). Nicht in
   der 100er-Liste, optional → trotzdem nicht gebaut.
5. Plan X-7 "Legacy-Key noetig" — nur fuer `openExternal`-Redirects; Widget hat keine.
6. Plan-Zeilenangaben: `uiSubmissionMeta :88-92` ist tatsaechlich `:79-82`, `makeUiRenderer
   :96-107` ist `:88-107`, `widget-catalog.js:161-176` → `hasWidget :170`, `widgetHtml :175`.
7. Plan-Abnahme 1-3 fordern ChatGPT-Adapter-Pruefungen — gegenstandslos (§3).
8. `test/mcp-ui.test.js:531-533` ("Nach W2 traegt ausschliesslich place_call ein Widget-_meta")
   widerspricht dem Code (5 `enableWidgetUi`-Aufrufer, M-2 zeigt 5 Tools). Nur notiert, nicht
   Scope.

---

## Anhang A — Capture-Skript (lesend)

In den Scratchpad als `p8-capture.mjs`, Aufruf `MCP_UI_ENABLED=true node p8-capture.mjs "<repo-root>"`:

```js
const root = process.argv[2];
const { McpServer } = await import(root + "/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js");
const { Client } = await import(root + "/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { InMemoryTransport } = await import(root + "/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js");
const { z } = await import(root + "/node_modules/zod/index.js");
const { registerTools } = await import(root + "/src/mcp-tools.js");
const { config } = await import(root + "/src/config.js");
config.server.publicUrl = "https://agent.test";
const s = new McpServer({ name: "p8", version: "0" });
registerTools(s, { uiHost: { enabled: true } });
const [a, b] = InMemoryTransport.createLinkedPair();
const c = new Client({ name: "c", version: "0" });
await Promise.all([s.connect(a), c.connect(b)]);
const ANY = z.object({}).passthrough();
const tl = await c.request({ method: "tools/list" }, ANY);
const rl = await c.request({ method: "resources/list" }, ANY);
const rr = [];
for (const r of rl.resources) rr.push(await c.request({ method: "resources/read", params: { uri: r.uri } }, ANY));
process.stdout.write(JSON.stringify({ tl, rl, rr }, null, 1));
process.exit(0);
```

## Anhang B — Vergleich

```sh
node -e '
const m=require(process.argv[1]), b=require(process.argv[2]);
const eq=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
console.log("tools/list identisch:", eq(m.tl,b.tl));
console.log("resources/list identisch:", eq(m.rl,b.rl));
const zus=b.rr.map(r=>{const c=r.contents[0]; const z=c._meta; delete c._meta; return JSON.stringify(z);});
console.log("resources/read ohne _meta identisch:", eq(m.rr,b.rr));
console.log("zusatz:", zus);' <scratch>/p8-master.json <scratch>/p8-branch.json
```
