# T2-01 Spec - Widget: csp/Origin am Resource-Inhalt, Skybridge-Adapter raus

Stand: 2026-09-22. Umfang GENAU: T-30, T-31, T-23 (Gegenprobe X-3/X-7).
Basis: master `288376b`. Branch `phase/openai-t2-01-widget-csp`, Worktree
`.../scratchpad/wt-t2-01` (node_modules als Symlink). Diese Datei bleibt UNGETRACKT.

## 0. Quellen und Entscheidung

- Plan `tasks/PLAN-OPENAI-TECHNIK-2.md` Abschnitt 2.1 (Harte Nuesse) + "T2-01".
- Loesung laut 2.1, fuer Claude UND ChatGPT, EIN anfrageunabhaengiger Resource-Inhalt fuer HTTP
  und stdio:
  `contents[0]._meta = { ui: { csp: { connectDomains: [], resourceDomains: [] } }, "openai/widgetDomain": <Origin aus PUBLIC_URL> }`
  und bewusst KEIN `_meta.ui.domain` (Claude verweigert jeden Wert ausser dem Hash der
  Connector-URL; ohne Feld rendert Claude mit Standard-Origin). Keine Host-Erkennung mehr.
- Tool-Deskriptoren tragen danach nur noch `_meta.ui.resourceUri` (+ `openai/toolInvocation/*`).
- Der Skybridge-/ChatGPT-Adapter (`text/html+skybridge`, `openai/outputTemplate`) faellt ersatzlos.
- Gemessen im Worktree (lesend, In-Memory, SDK 1.29.0): ein `_meta` am Resource-Inhalt aus dem
  read-Callback kommt im `resources/read`-Ergebnis unveraendert an (wird NICHT gestrippt). Das ist
  nur Vorab-Plausibilitaet - Beleg bleibt der Draht-Test (Schritt 7).
- Gemessen: alle 5 Widgets (agent-status, calendar, call, calls, my-number) x en/de/fr laden von
  nirgendwo; einziger URL-Treffer ist der SVG-Namespace `http://www.w3.org/2000/svg` INNERHALB
  eines `url("data:image/svg+xml,...")` im call-Widget. Leere CSP-Listen sind damit exakt (T-30).
- Baseline (Worktree, 6 betroffene Testdateien, `--test-concurrency=4`): 86 pass / 0 fail.

## 1. Schritte

### S1 - Resource-Inhalt traegt csp + widgetDomain (T-30, T-31)
- Wo: `src/ui/contract.js:131-134` (`uiSubmissionMeta` ersetzen durch `uiResourceMeta()`),
  `src/ui/contract.js:144-163` (`makeUiRenderer`: der read-Callback in `registerResource`, Z. 158,
  liefert `{ uri, mimeType, text, _meta: uiResourceMeta() }`).
- `uiResourceMeta()` wird zur AUFRUFZEIT ausgewertet (Getter-Config, In-Process-Tests setzen
  publicUrl nach Import - Begruendung aus dem Bestandskommentar Z. 128-130 bleibt gueltig):
  `{ ui: { csp: UI_CSP } }` plus `"openai/widgetDomain": origin` NUR wenn
  `normalisierterOrigin(config.server.publicUrl)` (aus `src/middleware.js:150`, wiederverwenden,
  keine zweite Origin-Logik) einen Wert liefert. Unparsbar/leer -> Schluessel fehlt (fail-safe,
  nie ein erfundener Origin). Grund fuer `.origin` statt Rohwert: `PUBLIC_URL` koennte einen Pfad
  tragen; der Alias verlangt einen Origin.
- Schluesselname in EINER benannten Konstante (z.B. `OPENAI_WIDGET_DOMAIN_KEY`), kein Literal
  verstreut.
- Kein `ui.domain` irgendwo.
- Kommentare `contract.js:68-117` und `:136-143` neu schreiben: sie argumentieren heute das
  Gegenteil (Alias sei "Legacy", resources/read bleibe ohne `_meta`). Neuer Stand = Plan 2.1
  inkl. der UNKNOWNs (OW-C/OW-D/OW-E).
- Pfade: HTTP /mcp (OAuth + Token), stdio - alle ueber denselben `makeUiRenderer`.
- Beweis: (b) Schritt 7, Tests T1-T4 ueber echten `resources/read`-Output.

### S2 - Tool-Deskriptor nur noch resourceUri (T-23, T-30/T-31-Aufraeumen)
- Wo: `src/ui/adapters/mcp-native.js:19` -> `buildMeta: (uri) => ({ resourceUri: uri })`;
  Kommentar Z. 13-25 neu (csp/domain wandern an den Inhalt).
- Pfade: HTTP (beide Auth-Modi), stdio.
- Beweis: (b) T5 - `tools/list` ueber HTTP und stdio: jedes Widget-Tool hat
  `Object.keys(_meta.ui)` = `["resourceUri"]`.

### S3 - Skybridge-/ChatGPT-Adapter entfernen (T-23)
- `src/ui/adapters/chatgpt.js` LOESCHEN.
- `src/ui/contract.js:46-66`: `CHATGPT_UI_MIME`, `CHATGPT_META_KEY`, `capabilityDeclaresChatgptUi`
  und Kommentar entfernen. `makeCapabilityDetector` hat danach genau einen Nutzer
  (`capabilityDeclaresUi`); inline-en ist erlaubt, nicht Pflicht - `capabilityDeclaresUi`
  bleibt exportiert (Tests nutzen es).
- `src/ui/registry.js:44-58`: Import von chatgpt/Detektor raus;
  `uiRendererFor(hostHint)` = `hostHint?.enabled ? mcpNativeRenderer : null`. Kopfkommentar
  Z. 1-43 kuerzen auf den neuen Stand (ein Renderer, Master-Schalter entscheidet).
- `src/routes/mcp.js:158`: `const uiHost = { enabled: config.tenancy.mcpUiEnabled };`
  (kein `capabilities` mehr); Kommentar Z. 145-157 entsprechend kuerzen. SONST NICHTS in dieser
  Datei (Auth, Transport, securitySchemes unberuehrt).
- Kommentare nachziehen: `src/ui/ports.js:2,16-18`, `src/ui/widget-catalog.js:5`,
  `src/mcp-tools.js:777` (erwaehnen den ChatGPT-Adapter / `openai/outputTemplate`).
- `src/mcp-server.js:36` bleibt (liefert schon `{ enabled }`).
- Pfade: HTTP (der einzige Ort, der `params.capabilities` las), stdio (unveraendert).
- Beweis: (c) `find src -name chatgpt.js` -> leer; `grep -rn -E "capabilityDeclaresChatgptUi|CHATGPT_|skybridge|openai/outputTemplate" src` -> leer
  (Positiv-Kontrolle: `grep -rn capabilityDeclaresUi src` -> >=1 Treffer). Zusaetzlich (b) T6.

### S4 - Tests umbauen (bestehende, die brechen)
Alle Nennungen am Worktree-Stand gemessen:
- `test/openai-p8-widget-ui.test.js`
  - Z. 27 Import `chatgptRenderer` raus; Z. 32 `CHATGPT_UI_MIME` nur noch als Literal fuer die
    Skybridge-Anfrageform.
  - P8-A/P8-B (Z. 163/196): bleiben sinngemaess, zusaetzlich `params.capabilities` IM
    `tools/list`-Request selbst (das war der einzige Weg, der den alten Adapter erreichte).
  - P8-C/P8-D (Z. 220/241) UMDREHEN: Inhalt traegt `["_meta","mimeType","text","uri"]`,
    `_meta` deepEqual Sollwert (s. T1).
  - P8-F (Z. 290): `Object.keys(tool._meta.ui)` -> `["resourceUri"]`;
    resources/list-Eintraege bleiben 4 Felder (unveraendert).
  - P8-H (Z. 325): loeschen (Adapter weg) - ersetzt durch T6.
  - P8-I/P8-J (Z. 343/364): Hashes neu pinnen (Z. 41-44). Vorher das kanonisierte Capture
    einmal ansehen: Unterschied zu master darf NUR sein (a) `csp`/`domain` fehlen am Tool,
    (b) `_meta` am Inhalt. Diese Sichtpruefung im Bericht dokumentieren.
  - Kopfkommentar Z. 1-20 auf neuen Stand.
- `test/mcp-ui.test.js`
  - Import Z. 17 (`chatgptRenderer`) und Z. 29-30 (`CHATGPT_UI_MIME`, `CHATGPT_META_KEY`) raus;
    `CHATGPT_CAPS` (Z. 527) als Literal nur noch fuer "Skybridge-Caps aendern nichts".
  - T-P3-AC2 (Z. 570), E7-T13 (Z. 687), T-P3-AC5 (Z. 704): loeschen (nur ChatGPT-Adapter).
  - T-P3-AC3 (Z. 594): Registry: enabled -> mcpNativeRenderer (auch mit Skybridge-Caps),
    disabled -> null.
  - T-P3-AC4 (Z. 609): ChatGPT-Variante loeschen, wenn die mcp-native Whitelist-Variante bereits
    existiert (vorher per grep belegen); sonst auf mcpNativeRenderer umstellen.
  - E7-T10/T11/T12 (Z. 636-685): auf `resources/read`-Inhalt umstellen (csp am Inhalt;
    widgetDomain = Origin am Inhalt; leere publicUrl -> kein widgetDomain, csp bleibt) und
    am Tool pruefen, dass `_meta.ui` NUR `resourceUri` traegt.
  - T-P3-AC6 (Z. 719): auf mcpNativeRenderer umstellen; `capabilityDeclaresUi(Skybridge-Caps)
    === false` bleibt.
  - T-P3-AC7 (Z. 741): auf mcpNativeRenderer umstellen (kein `window.openai`, einziger
    Sendeweg `"tools/call"`) - diese Invariante gilt jetzt fuer BEIDE Hosts; Kommentar
    Z. 732-740 neu (ChatGPT bekommt dasselbe HTML ueber den MCP-Apps-Standard; ob ChatGPTs
    Bruecke `tools/call` bedient = OW-C).
  - Z. 1423: `CHATGPT_META_KEY` durch das Literal `"openai/outputTemplate"` ersetzen (der Test
    prueft `ohneWidgetMeta`, bleibt inhaltlich).
- `test/openai-p2-tool-metadaten.test.js:279` (Schritt 14): ersetzen durch "Skybridge-Caps im
  uiHost / im Request aendern nichts: place_call traegt `_meta.ui.resourceUri` +
  toolInvocation, KEIN `openai/outputTemplate`". Z. 14/41 Kommentar/Konstante nachziehen.
- `test/openai-p3-security-schemes.test.js:227` (Schritt 6b, ChatGPT-Adapter + securitySchemes):
  loeschen; vorher per grep belegen, dass die mcp-native Variante securitySchemes schon prueft.
  Z. 43 Konstante raus.
- `test/openai-p10a-ui-capabilities.test.js`: enthaelt KEINEN Bezug auf chatgpt/csp/domain -
  voraussichtlich keine Aenderung; muss nur gruen bleiben.
- `test/mcp-tools-i18n.test.js:135`: nur Kommentar ("ohne chatgpt-mimeType") anpassen.
- Beweis: (b) Suite gruen (s. S8).

### S5 - Neue Draht-Tests (Beweise fuer die Abnahme)
Env ueberall: `MCP_UI_ENABLED=true`, `PUBLIC_URL=https://probe.example`.
Sollwert `_meta` = `{ ui: { csp: { connectDomains: [], resourceDomains: [] } }, "openai/widgetDomain": "https://probe.example" }`.
- T1 HTTP OAuth: `startIdp()` + `MCP_AUTH=oauth`, `OAUTH_ISSUER_URL=idp.issuer`,
  `MULTI_TENANT=true` (Muster `test/mcp-tools-i18n.test.js:197-220`), Request ueber
  `srv.externalUrl` (Interface-IP, NICHT localhost; skip nur wenn keine externe IP, Muster
  `test/openai-p10b-healthz.test.js:70`). Fuer ALLE URIs aus `resources/list` (Positiv-Kontrolle:
  genau 5): `contents[0]._meta` deepEqual Sollwert. Zwei Tenants mit verschiedener Sprache:
  `_meta` identisch (kein Tenant-Bezug im Metadatum).
- T2 HTTP Token/Legacy: `MCP_AUTH=token`, `MCP_AUTH_TOKEN=<Testwert>`, ueber `srv.externalUrl`
  mit Bearer; derselbe Beleg. Zusaetzlich einmal Legacy-Loopback (Bestand, localUrl ohne Token)
  - das decken die umgebauten P8-C/P8-I ab.
- T3 stdio: echter Kindprozess (`withStdioClient`), derselbe Beleg.
- T4 stdio ohne `PUBLIC_URL` (`PUBLIC_URL: ""`, `RENDER_EXTERNAL_URL: ""`): `openai/widgetDomain`
  fehlt, `_meta.ui.csp` = Sollwert-CSP.
- T5 Waechter `ui.domain` (Abnahme 2): rekursiver Walker ueber das GESAMTE JSON von
  `tools/list` + allen `resources/read` (HTTP und stdio) meldet jedes Objekt unter Schluessel
  `ui`, das einen Schluessel `domain` hat. Erwartet: 0. POSITIV-KONTROLLE im selben Test: der
  Walker auf `{ a: [{ _meta: { ui: { domain: "x" } } }] }` meldet 1. Ausserdem: kein Schluessel
  `openai/outputTemplate` irgendwo; jedes Widget-Tool `Object.keys(_meta.ui)` = `["resourceUri"]`.
- T6 Byte-Gleichheit Skybridge (Abnahme 3): HTTP `tools/list` einmal ohne, einmal mit
  `params.capabilities = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html+skybridge"] } } }`
  im tools/list-Request -> kanonisierter JSON-String identisch; dasselbe fuer ein
  `resources/read` (mimeType bleibt `text/html;profile=mcp-app`).
- T7 Quelltext-Waechter (Abnahme 5): `quelltexteUnter("src")` (helpers.js:590): keine Datei
  `chatgpt.js`, kein Treffer fuer `capabilityDeclaresChatgptUi|skybridge|openai/outputTemplate`.
  Positiv-Kontrolle: derselbe Scanner findet `capabilityDeclaresUi`.
- T8 Widget-Scan "laedt von nirgendwo" (T-30 Exaktheit, Pre-Mortem-Pflicht - EXISTIERT HEUTE
  NICHT, s. Widersprueche): ueber den Draht (`resources/read`, HTTP) alle 5 Widgets, zusaetzlich
  in-process `widgetHtml(id, lang)` fuer jede Sprache in `LOCALES`. Vor dem Scan ganze
  `data:`-URIs entfernen (bis zum schliessenden Anfuehrungszeichen/Klammer des `url(...)`, NICHT
  bis zum ersten `'` - im call-Widget stehen einfache Anfuehrungszeichen im data:-URI). Danach
  keine Treffer fuer: `https?://`, `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `sendBeacon`, `importScripts`, `@font-face`, `@import`, `<iframe`, `<embed`, `<object`,
  `<link`, `<script ... src=`, `window.open`, `openExternal`. Positiv-Kontrolle: ein
  synthetisches `<img src="https://x.test/a.png">` und ein `fetch("/x")` werden gemeldet.
  Deckt zugleich X-7 (kein openExternal -> kein redirect_domains noetig).
- T9 X-3-Gegenprobe: bestehende `test/openai-p2-*` bleiben gruen (toolInvocation an allen Tools,
  `ui.resourceUri` an Widget-Tools); keine Aenderung ausser S4.
- Neue Tests in EINE neue Datei `test/openai-t2-01-widget-resource-meta.test.js` (Name
  OHNE Katalog-ID/ABNAHME-Praefix am Testnamensanfang, sonst landen sie in einer anderen Bank).

### S6 - Doku
- `PLAN-SECURITY.md`: neuer Abschnitt "OpenAI-T2-01" (Resource-`_meta`, Adapter raus, UNKNOWNs,
  Rueckfall `MCP_UI_ENABLED=false`); der Abschnitt ab Z. 5156 (P8, "ChatGPT-Adapter tot, bleibt")
  bekommt einen Verweis "abgeloest durch T2-01". Keine Produktionswerte.
- `docs/OPENAI-AUTH-ABWEICHUNGEN.md:696` (Absatz "mcp-nativer vs. ChatGPT-Adapter") auf den
  neuen Stand.
- Beweis: (c) `grep -rn "chatgpt.js" PLAN-SECURITY.md docs/OPENAI-AUTH-ABWEICHUNGEN.md` zeigt nur
  noch historische Erwaehnung mit "entfernt in T2-01".

### S7 - Syntax + Diff-Grenze
- `node --check` fuer jede geaenderte `src/`-Datei.
- (c) `git diff --stat master` zeigt NUR: `src/ui/contract.js`, `src/ui/registry.js`,
  `src/ui/adapters/mcp-native.js`, `src/ui/adapters/chatgpt.js` (geloescht), `src/ui/ports.js`,
  `src/ui/widget-catalog.js` (Kommentar), `src/mcp-tools.js` (nur Kommentar Z. ~777),
  `src/routes/mcp.js` (Z. ~145-158), die Testdateien aus S4/S5, `PLAN-SECURITY.md`,
  `docs/OPENAI-AUTH-ABWEICHUNGEN.md`. Nichts in `src/config.js`, `src/auth.js`,
  `outbound-gates`, `claude.js`, `routes/voice.js`, `boot-guard.js`.
- (c) `git diff master -- src/mcp-tools.js src/routes/mcp.js` enthaelt ausser der `uiHost`-Zeile
  nur Kommentarzeilen.

### S8 - Suite
- `npm test -- -- --test-concurrency=4 > <logs-t2-01>/full.log 2>&1`; nur `# pass`/`# fail`
  (bzw. `ℹ pass`/`ℹ fail`) lesen. Rote Tests isoliert wiederholen
  (`NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js`); zaehlt nur
  isoliert rot. Danach `ps -ax | grep wt-t2-01` - keine verwaisten Server.

Keine neue Env-Variable (PUBLIC_URL / MCP_UI_ENABLED existieren) - daher kein Vier-Orte-Schritt.

## 2. Nicht bauen (mit Grund)
- `_meta.ui.domain` in irgendeiner Form - Plan 2.1: Claude verweigert jeden Wert ausser dem
  Connector-URL-Hash; fuer ChatGPT gibt es den Alias. Rueckfall "eigener ChatGPT-Pfad mit
  ui.domain" ist eine eigene Auth-Phase NACH OW-E, nicht vorab.
- `_meta` an `resources/list`-Eintraegen (ext-apps nennt sie nur als Fallback) - nicht im Plan,
  Hosts lesen primaer `resources/read`; P8-F pinnt die 4 Felder weiter.
- Legacy `openai/widgetCSP` / `redirect_domains` - X-7: kein openExternal im Widget (T8 belegt).
- `frameDomains` - optional laut T-30, 0 Frames.
- Versionierte / sprachfreie Resource-URIs und byte-gleiches HTML (T-34) - Phase T2-02.
- Host-Erkennung pro Request (User-Agent, IP, Capabilities) - Plan 2.1 verworfen.
- Neue `window.openai`-Bruecke o.ae. fuer ChatGPT - ChatGPT spricht laut OpenAI-Doku den
  MCP-Apps-Standard; ob die Karte dort live aktualisiert, klaert OW-C, nicht Code auf Verdacht.
- `src/mcp-server.js` - liefert bereits `{ enabled }`, keine Aenderung noetig.

## 3. Pre-Mortem (ein Jahr spaeter war T2-01 ein Fehler)
1. Widget rendert in Claude nicht mehr: Claude stolpert ueber den unbekannten Schluessel
   `openai/widgetDomain` am Inhalt oder setzt die jetzt deklarierte leere CSP strenger durch.
   Entschaerfung: T8 belegt "laedt nichts" (Bilder nur data:, keine Fonts); leere Listen =
   Host-Default-CSP laut ext-apps (keine Verschaerfung gegen heute, wo Claude das Tool-csp
   ignoriert). OW-D direkt nach Deploy; Rueckfall ohne Code `MCP_UI_ENABLED=false` (Text-Fallback
   bleibt, Anrufe per place_call gehen weiter).
2. OpenAI-Scan lehnt Alias statt `ui.domain` ab -> Einreichung blockiert. Entschaerfung: OW-E vor
   Einreichung; Rueckfall-Design in Plan 2.1.
3. Falscher Origin im Alias: `PUBLIC_URL` leer und `RENDER_EXTERNAL_URL` (onrender-Adresse) greift
   als Fallback (`config.js:1499`), oder PUBLIC_URL traegt einen Pfad. Entschaerfung:
   `normalisierterOrigin` (nur Origin, lowercase), fehlt/unparsbar -> Schluessel fehlt; OW-G prueft
   PUBLIC_URL = Einreichungs-Origin; Produktion verweigert ohnehin den Boot ohne publicUrl.
4. Transkript-/Tenant-Leak ueber das Metadatum: ausgeschlossen, weil `_meta` nur Konstante + oeffentlichen
   Server-Origin enthaelt; T1 belegt Gleichheit ueber zwei Tenants.
5. Gebrochener Client durch Adapter-Loeschung: der Adapter war nur bei `params.capabilities` IM
   tools/list-/resources/read-Request erreichbar (kein Standard-Client tut das; P8-A/B/T6).
   Restrisiko akzeptiert.
6. ChatGPT zeigt nach dem Deploy bis zu 1 h den gecachten Resource-Inhalt ohne `_meta` ->
   falsch-negatives OW-C. Entschaerfung: Probe fruehestens 1 h nach Deploy (oder neuer Connector);
   echte Loesung (URI-Version) in T2-02.
7. Ungewollter Anruf / Kosten / Gate-Aufweichung: T2-01 beruehrt keinen Call-/SMS-Pfad, keine
   Safety-Gates, keine Auth; `routes/mcp.js` nur `uiHost`. Beleg S7 (Diff-Grenze).
8. Bau-Falle: Test prueft nur Registrierungsobjekt statt Draht (SDK strippt still). Entschaerfung:
   alle Abnahme-Tests T1-T6 ueber echten `resources/read`/`tools/list`-Output (HTTP-Kindprozess,
   stdio-Kindprozess); In-Memory nur ergaenzend.

## 4. Widersprueche Plan <-> Anforderung/Code
- T-31 (00-openai-anforderungen.md:64) verlangt woertlich `_meta.ui.domain`; der Plan liefert
  bewusst nur `openai/widgetDomain` (offizieller ChatGPT-Alias) und verbietet `ui.domain`.
  T-31 ist damit nur unter Vorbehalt OW-E erfuellt (UNKNOWN).
- Bestandskommentar `src/ui/contract.js:80-102` sagt das Gegenteil des Plans (Alias sei Legacy und
  erfuelle T-30/T-31 nicht; resources/read bleibe ohne `_meta`). Plan 2.1 (Primaerquellen) gilt;
  Kommentar wird ersetzt.
- Pre-Mortem des Plans: "Draht-Scan-Test 'keine externe Quelle im HTML' bleibt Pflicht" - ein
  solcher Test EXISTIERT NICHT (grep ueber test/). Er wird in S5/T8 neu gebaut.
- Dateiliste des Plans unvollstaendig: es fehlen `test/openai-p3-security-schemes.test.js:227`
  (bricht beim Loeschen des Adapters), `test/mcp-ui.test.js` ausserhalb :632-680 (Z. 17, 29-30,
  570-748, 1423), `src/ui/ports.js`, `src/ui/widget-catalog.js:5`, `src/mcp-tools.js:777`
  (Kommentare), `PLAN-SECURITY.md`, `docs/OPENAI-AUTH-ABWEICHUNGEN.md:696`.
- Plan nennt `test/openai-p10a-ui-capabilities.test.js` als zu aendern; die Datei hat keinen Bezug
  zu chatgpt/csp/domain - voraussichtlich keine Aenderung.
- Zeilenangaben des Plans stimmen: contract.js:131-134 (uiSubmissionMeta), :144-160
  (makeUiRenderer, tatsaechlich bis 163), registry.js:57, routes/mcp.js:158.
- "HTTP Legacy" im Plan ist mehrdeutig (Loopback-Bypass vs. `MCP_AUTH=token`); diese Spec prueft
  beide (T2 ueber Interface-IP mit Token, Loopback ueber Bestandstests).

## 5. Owner-Punkte (nur Deploy/Live-Proben)
- Deploy/Push (Owner-Gate). Deploy-Vorbedingung: keine.
- OW-D Claude (Web + Desktop), fruehestens nach Deploy: `get_agent_status` und ein Anruf-Widget
  aufrufen. Erwartet: Widget rendert, kein "ui.domain"-/CSP-Fehler, Selbstaktualisierung laeuft.
  Rendert nichts: `MCP_UI_ENABLED=false` im Dashboard, melden.
- OW-C (4) ChatGPT Developer Mode, fruehestens 1 h nach Deploy (Cache): `get_agent_status`.
  Erwartet: Widget rendert; Iframe-Origin in den DevTools ist eine vom Origin abgeleitete
  `oaiusercontent.com`-Subdomain, NICHT `web-sandbox.oaiusercontent.com`. Zusaetzlich melden, ob
  die Karte sich selbst aktualisiert (tools/call-Bruecke).
- OW-E OpenAI-Dashboard Entwurf (nicht einreichen): Scan gegen `https://<origin>/mcp`. Erwartet:
  keine Warnung zu `_meta.ui.domain`/CSP. Warnung -> Rueckfall "eigener ChatGPT-Pfad" beauftragen.
- OW-G (Render-Werte): PUBLIC_URL = Einreichungs-Origin, MCP_UI_ENABLED an. Werte nicht ins Repo.
