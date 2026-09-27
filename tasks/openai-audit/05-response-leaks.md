# D5: Tool-Antworten - Datenlecks und Datenminimierung

Dimension: D5 | Quelle: Code auf Branch master

## Kurzfassung

Die MCP-Tool-Schicht (`src/mcp-tools.js`) ist durchgaengig als Whitelist gebaut: jedes
Tool projiziert ueber eine benannte `pick*`/`*View`-Funktion auf ein festes Feld-Set,
bevor `content`/`structuredContent` entstehen. Die darunterliegende REST-Schicht
(`publicCall` in `src/store/views.js`) ist dagegen eine BLACKLIST (strippt bekannte
interne Felder, reicht den Rest per `...rest` durch) und liefert `tenantId`,
`callControlId`, `assistantId`, `twilioSid`/Provider-Call-ID roh an `/api/calls/:id`
und `/api/state` aus - diese erreichen den MCP-Client heute NICHT, weil die MCP-Whitelist
davor sitzt, ABER `cancel_call` (`src/mcp-tools.js:1057-1061`) reicht die REST-Antwort
ungefiltert durch (`text(await call(...))`, kein Whitelist-Schritt, kein `outputSchema`).
Heute ist das folgenlos, weil die Route selbst eine kleine Antwort baut - es ist die
einzige Stelle im Tool-Set, die strukturell von einem zukuenftigen REST-Refactor
abhaengt, um sicher zu bleiben. Konkreter, bereits wirksamer Befund: `list_action_items`
gibt die interne Item-ID (`a.id`) aus, obwohl kein Tool sie je entgegennimmt - exakt das
Muster, das state-ops.js beim Nachbar-Feature (Inbox-Action-Items) bewusst ausschliesst
("Kennungen gehen bewusst NICHT mit ... waeren nur ein zusaetzliches Handle", state-ops.js:800-802).

## Pruefpunkte

### PP-D5-01 get_call_status / get_transcript / await_call_event: Feld-Whitelist vor Ausgabe
- Status: PASS
- Evidenz: src/mcp-tools.js:164-173 (`pickCallStatus`), :206-215 (`pickTranscript`),
  :259-271 (`awaitEventView`) - jede Funktion baut ein neues Objekt aus benannten
  Quellfeldern, kein Spread des Rohobjekts `c`. `resultCardView` (src/call-result.js:94-103)
  laesst `facts` und `evidence` (verbatim Zitate, kurze Retention) explizit aus.
- Risiko: keins in der aktuellen Form.
- Empfehlung: keine Aenderung noetig; Muster als Referenz fuer neue Tools halten.
- Prioritaet/Kategorie: N/A / N/A

### PP-D5-02 cancel_call reicht die REST-Antwort ungefiltert durch (kein Whitelist-Schritt)
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:1057-1061 - `tool("cancel_call", ..., async ({call_id}) =>
  text(await call("POST", `/api/calls/${call_id}/cancel`)))`. Die REST-Route
  (src/routes/api-calls.js:642-697) antwortet heute mit einem handgebauten kleinen
  Objekt (`{status, line_hangup_confirmed, max_line_s, hangup_attempted}` bzw.
  `{status}`), NICHT mit `publicCall(call)` - deshalb aktuell kein Leck.
- Risiko: Genau diese Route ist die einzige der sieben Call-bezogenen MCP-Tools, die
  keinen eigenen Feld-Filter hat und kein `outputSchema` deklariert. Wuerde die Route
  kuenftig (Refactor, Bugfix, "gleiche Antwort wie GET") auf `res.json(publicCall(call))`
  umgestellt, flossen `tenantId`, `callControlId`, `assistantId`,
  `twilioSid` (Provider-Call-Control-ID) sofort und ungeprueft an den MCP-Client - ohne
  dass ein Schema-Test es faengt, weil `cancel_call` `tool()` statt `uiTool()` mit
  `outputSchema` nutzt.
- Empfehlung: `cancel_call` auf denselben Whitelist-Stil umstellen wie `pickCallStatus`
  (explizite Feldliste + `outputSchema`), statt sich auf die Disziplin der REST-Route zu
  verlassen.
- Prioritaet/Kategorie: P1 / B (kein aktueller Verstoss, aber die einzige Stelle ohne
  strukturelle Absicherung gegen genau das Muster, das O-13/T-19 verbieten).

### PP-D5-03 REST-Schicht (publicCall) ist Blacklist, nicht Whitelist - Fangnetz nur in der MCP-Schicht
- Status: PARTIAL
- Evidenz: src/store/views.js:33-75 - `publicCall({streamToken, ..., elNachlaufStartedAt,
  ...rest}) { return rest; }`. Nicht gestrippt (bleiben in `rest` und verlassen
  `/api/calls/:id`, `/api/state`, `/api/tenant-data/export`): `tenantId`, `callControlId`,
  `assistantId`, `twilioSid`, `requestedBy`, `id`. Belegt am Feldkatalog von
  `createCall` (src/store/state-ops.js:265-401), der diese Felder setzt und NICHT in
  publicCall's Strip-Liste erscheinen laesst.
- Risiko: Fuer die MCP-Route ist das aktuell folgenlos, weil `pickCallStatus`/
  `pickTranscript`/`pickCall` je eine ZWEITE, echte Whitelist davorschalten (Verifikation:
  keine dieser drei Funktionen liest `tenantId`/`callControlId`/`twilioSid`). Fuer das
  Dashboard (nicht MCP) ist die Blacklist der bewusste Vertrag (Kommentarhistorie zeigt
  gezielt nachgezogene Strips je Phase, z.B. Zeilen 40-72) - dort ist sie in Ordnung, weil
  sie von Menschen im eigenen Browser gelesen wird. Fuer MCP bedeutet es: die einzige
  Sicherung gegen ein REST-Feld, das kuenftig hinzukommt, ist Disziplin bei jedem
  einzelnen MCP-Tool, nicht eine gemeinsame Schranke.
  Nicht selbst geprueft: `provider`, `openingLineSha256`, `answeredUnclearReason`,
  `lookupLog` - diese verlassen `/api/calls/:id` ebenfalls ungestrippt (nicht in
  publicCall's Strip-Liste), erreichen aber laut Code-Lesung KEIN MCP-Tool (nicht in
  `pickCallStatus`/`pickTranscript`/`pickCall` gelesen). Nicht mit einem Laufzeit-Aufruf
  verifiziert (Regel: nur lesen).
- Empfehlung: Kein Umbau der REST-Schicht selbst noetig (sie hat einen anderen
  Konsumenten, das Dashboard) - aber jedes NEUE MCP-Tool, das `/api/calls/:id` oder
  `/api/state` liest, MUSS durch eine eigene `pick*`-Funktion laufen; das sollte als
  Repo-Konvention (clean-code.md oder ein Kommentar an `publicCall`) explizit
  festgehalten werden, weil die aktuelle Sicherheit rein aus Einzelfall-Disziplin besteht.
- Prioritaet/Kategorie: P2 / C

### PP-D5-04 list_action_items gibt eine ungenutzte interne Item-ID aus
- Status: FAIL
- Evidenz: src/mcp-tools.js:1149-1162 - `open.map((a) => `[${a.id}] ...`)`. Kein
  MCP-Tool in dieser Datei nimmt eine Action-Item-ID entgegen (grep ueber die gesamte
  Datei: keine `item_id`/`action_item_id`-Parameter). Der Schwester-Fall in
  `inboxEntryView` (src/store/state-ops.js:786-807) laesst genau diese Art Kennung
  bewusst weg, mit ausdruecklicher Begruendung eine Funktion darunter (Zeile 800-802):
  "Kennungen gehen bewusst NICHT mit (F-7): der Assistent kann sie nicht abhaken, also
  waeren sie nur ein zusaetzliches Handle auf fremde Gespraechsinhalte."
- Risiko: Interne, sonst nirgends verwendete Store-ID (Format `ai_<base36-zeit><random>`,
  state-ops.js `newId`) geht an den MCP-Client, obwohl sie dort keine Funktion hat -
  exakt der Fall, den O-13 ("keine internen Identifikatoren ... unless strictly required")
  und die eigene Inbox-Nachbarfunktion bereits als falsch erkannt und vermieden haben.
  Kein Secret, aber ein unbegruendetes Handle nach aussen.
- Empfehlung: `a.id` aus der Textzeile entfernen (analog zur Inbox-Loesung), solange kein
  Tool existiert, das eine Item-ID entgegennimmt.
- Prioritaet/Kategorie: P1 / A (O-13 ist ein woertliches Zitat; der eigene Code hat den
  identischen Fall im Nachbarmodul bereits bewusst anders geloest, das ist keine
  Ermessensfrage mehr).

### PP-D5-05 place_call/call_id, event_id, after_event_id: funktional erforderliche Handles
- Status: PASS
- Evidenz: src/mcp-tools.js:825-836 (`call_id` einzige Rueckgabe von `place_call`, noetig
  fuer `get_call_status`/`get_transcript`/`cancel_call`/`await_call_event`); `event_id`
  analog fuer `answer_consult`. `newId()` (state-ops.js:195-197) ist eine opake
  Zeitstempel+Zufalls-Kennung, keine sequentielle DB-ID, kein Cross-Tenant-Bezug erkennbar.
- Risiko: minimal - der Zeitstempelanteil der ID verraet grob den Erzeugungszeitpunkt,
  das ist dem Aufrufer aber ohnehin bekannt (er hat den Call gerade selbst ausgeloest).
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A / N/A

### PP-D5-06 Fehlerpfad (isError/errText) leakt keine Provider-/Stack-Details
- Status: PASS
- Evidenz: `wrapHandler` (src/mcp-tools.js:630-647) uebersetzt bekannte `ToolError`-Codes
  ueber `loc.mcp.errors` (generische, lokalisierte Saetze, src/i18n/mcp-texts.js:40-47);
  unbekannte Fehler fallen auf `err.message` aus `api()` (src/mcp-tools.js:56-77), das
  wiederum NUR das JSON-`error`-Feld der REST-Antwort liest. Die REST-Routen selbst
  vermeiden nachweislich Rohfehler: POST /api/calls faengt Provider-Exceptions ab und gibt
  eine feste, provider-neutrale Meldung aus (src/routes/api-calls.js:550-569, Kommentar:
  "Rohe Provider-Message NICHT an den Client ... Provider-SDK-Fehler koennen URL-/Auth-/
  Nummern-Fragmente tragen"). Globales Error-Netz (`src/app.js:595-603`) gibt bei
  unerwarteten Exceptions nur eine generische 500 aus, `err.stack` ausdruecklich nur
  serverseitig geloggt. `/mcp`-Transportfehler ebenso generisch (`src/routes/mcp.js:120-126`,
  `{code:-32603, message:"internal error"}`).
- Risiko: keins gefunden. Nicht ausgefuehrt (nur Code-Lesung): ob JEDE denkbare
  Exception-Klasse (z.B. ein DB-Treiberfehler im pg-Backend) tatsaechlich ueber denselben
  Pfad landet, ist nicht bahnabdeckend verifizierbar ohne Testlauf.
- Empfehlung: keine Aenderung; ggf. ein expliziter Test, der einen erzwungenen 500 auf
  `/api/calls/:id` gegen einen MCP-Aufruf fuehrt und den Tool-Fehlertext auf Abwesenheit
  von `Error:`/Stack-Mustern prueft (Regressionsschutz fuer dieses bereits gute Verhalten).
- Prioritaet/Kategorie: N/A (PASS) - Empfehlung selbst waere P2 / C

### PP-D5-07 check_inbox: caller-Telefonnummer und Ergebnis-Karte sind zweckgebunden, keine Fremd-Tenant-Daten
- Status: PASS
- Evidenz: `inboxEntryView` (src/store/state-ops.js:786-798) gibt `caller` (die anrufende
  Nummer - das IST der Zweck des Tools), `summary`, die fuenf Karten-Felder aus
  `resultCardView` (ohne `facts`/`evidence`) und `action_items` als reine Texte (ohne IDs,
  bewusst laut Kommentar). `check_inbox` (mcp-tools.js:1125-1144) reicht diese Felder
  1:1 durch `inboxEntryForModel` (Zeile 457-460), tauscht nur `started_at` gegen
  formatiertes `at`.
- Risiko: keins - Nummer/Zusammenfassung sind die angeforderte Nutzlast, nicht ein Leck.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A / N/A

### PP-D5-08 Widget-Pfad (src/ui/) fordert keine zusaetzlichen Felder jenseits der Tool-Whitelist an
- Status: PASS
- Evidenz: Alle ausgehenden Widget->Host-Aufrufe (`src/ui/widgets/call.html:644-655`,
  `TOOL_GET_STATUS`/`TOOL_GET_TRANSCRIPT`/`TOOL_CANCEL`) sind `tools/call` an dieselben,
  bereits gepruef­ten MCP-Tools - keine eigene REST-Route, kein zusaetzlicher Datenkanal.
  Das geteilte Binding (`src/ui/widget-bind.js:99-118`) rendert nur Felder, die im
  `structuredContent` bereits enthalten sind (`applyField`/`bind`), erfindet keine
  eigenen Requests. Keine Secrets/API-Keys/Gateway-URLs in `widget-catalog.js`,
  `registry.js`, `adapters/*.js` gefunden (grep negativ).
- Risiko: keins gefunden.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A / N/A

### PP-D5-09 get_my_number / get_agent_status / list_calls / get_calendar: reine Eigen-Tenant-Daten
- Status: PASS
- Evidenz: `pickMyNumber`/`pickAgentStatus`/`pickCall`/`pickCalendarEntry`
  (mcp-tools.js:391-411, 361-373, 401-411, 498-506) lesen ausschliesslich Felder des
  eigenen Tenant-Kontexts (`s.agent`, `s.calls`, `s.calendar` - bereits am Gateway
  tenant-gescoped ueber `GET /api/state`, src/routes/api-read.js:57-84). Kein Feld
  identifiziert einen anderen Tenant.
- Risiko: keins.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A / N/A

## Offene Fragen (nicht am Repo entscheidbar)

- Ob `provider`, `openingLineSha256`, `answeredUnclearReason`, `lookupLog` (nicht von
  `publicCall` gestrippt, aber von keinem MCP-Tool gelesen) irgendwann ueber ein neues
  Tool erreichbar werden - reine Zukunftsfrage, im heutigen Code nicht beantwortbar.
- Ob das pg-Backend (`src/store/pg.js`) bei einem echten DB-Fehler denselben generischen
  Fehlerpfad durchlaeuft wie der json-Store - ohne Testlauf/DB-Fehler-Injektion nicht am
  Code allein zu verifizieren (PP-D5-06).
- Ob OpenAI's Continuous-Review-Scan (T-33) den Unterschied zwischen "aktuell sicher,
  weil REST-Route klein" und "strukturell abgesichert" ueberhaupt erkennt - das ist eine
  Policy-Frage an OpenAI, keine Code-Frage.

## Randbefund (ausserhalb dieser Dimension)

`cancel_call` und `list_action_items` sind ueber `tool()` (Legacy-API) statt `uiTool()`
registriert und tragen deshalb kein `outputSchema` (T-18-Pflicht) und keine
`readOnlyHint`/`destructiveHint`/`openWorldHint`-Annotationen (N-1/N-7) - das ist primaer
ein Befund fuer D-Annotationen/D-Schema, nicht fuer D5, wird aber hier vermerkt, weil es
dieselben zwei Fundstellen betrifft.

## Gegenpruefung

- PP-D5-04: BESTAETIGT - src/mcp-tools.js:1158 gibt `[${a.id}]` aus, und kein Tool-Input dieser Datei nimmt eine Item-Kennung (grep ueber alle inputSchema: nur `call_id`/`event_id`/`include_seen`); Milderung: die Kennung traegt kein Tenant-Feld (src/store/pg.js:1680-1689 rowToActionItem: id/callId/text/type/done/createdAt), ist also ein funktionsloser Eigen-Handle, kein Cross-Tenant-Leck - die Prioritaet P1 ist damit eine Minimierungs-, keine Sicherheitsfrage.
- PP-D5-02: WIDERLEGT - die Begruendung ("ohne dass ein Schema-Test es faengt") ist am Bestand falsch: test/el-beende-versuch.test.js:429 prueft den Telnyx-Zweig per `assert.deepEqual(body, { status: "cancelled" })`, der EL-Zweig ist feldweise gepinnt (:411-413) - ein Refactor auf `res.json(publicCall(call))` bricht beide Tests; zusaetzlich ist die empfohlene Absicherung wirkungslos, weil `outputSchema` nicht filtert (node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:201-206: `safeParseAsync` validiert, `parseResult.data` wird verworfen).
- PP-D5-03: BESTAETIGT, und zu eng gefasst - src/store/views.js:33-75 reicht per `...rest` durch, und kein Test pinnt eine erlaubte Gesamt-Feldmenge (die Tests nennen publicCall selbst eine "Sperrliste", test/el-sip-call-id-join.test.js:400-407); der Auditor hat uebersehen, dass `actionItems` und `notifications` in GET /api/state durch GAR KEINE View laufen (src/routes/api-read.js:77 und :83, rohe Store-Datensaetze), die Luecke ist also breiter als publicCall.

### Vom Erst-Auditor uebersehen

#### PP-D5-G1 check_inbox ist selbst ein ungefilterter Rest-Spread der REST-Antwort - schwaecher abgesichert als das als "einzige Stelle" gemeldete cancel_call
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:457-460 - `inboxEntryForModel` destrukturiert nur `started_at` heraus und spreadet `...rest` in das Modell-Ergebnis; der einzige Struktur-Test vergleicht RELATIV (test/inbox-mcp-tool.test.js:165-168: REST-Schluessel minus `started_at` plus `at`), nicht gegen eine feste Liste - ein neues Feld in `inboxEntryView` (src/store/state-ops.js:786-798) haelt diesen Test gruen und erreicht den Client.
- Risiko: Dieselbe Klasse, die PP-D5-02 als einzigartig beschreibt, existiert ein zweites Mal - hier ohne den byte-genauen Pin, den cancel_call hat, und auf dem Pfad mit den meisten Inhalten (Rufnummer, Zusammenfassung, Ergebniskarte).
- Empfehlung: Entweder eine echte Feldliste in inboxEntryForModel oder ein Test, der die MCP-Schluessel gegen eine im Test hartkodierte Liste prueft (absolut, nicht relativ zur Quelle).
- Prioritaet/Kategorie: P1 / B

#### PP-D5-G2 outputSchema ist KEIN Filter - die zentrale Empfehlung des Berichts beruht auf einem Mechanismus, den der SDK nicht hat
- Status: PARTIAL
- Evidenz: node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:185-206 - `validateToolOutput` parst `result.structuredContent` und verwirft das Ergebnis (`parseResult.data` wird nicht zurueckgeschrieben); der Handler-Rueckgabewert geht unveraendert raus (:132-133). Ein zod-Objekt ohne `.strict()` laesst unbekannte Schluessel ausserdem fehlerfrei passieren, so dass auch die Validierung nicht anschlaegt.
- Risiko: Kommentare wie "Stufe 0 schema-validiert" (src/mcp-tools.js:175, :227, :375) und die Empfehlung in PP-D5-02 ("+ outputSchema") suggerieren eine Schranke, die es nicht gibt - die Whitelist-Disziplin in den `pick*`-Funktionen ist die EINZIGE wirksame Schranke.
- Empfehlung: Kommentare entschaerfen ("validiert Typen, filtert NICHT") und, wo eine Schranke gewollt ist, die zod-Objekte strikt machen oder explizit projizieren.
- Prioritaet/Kategorie: P1 / B

#### PP-D5-G3 get_call_status liefert das ROHE Transkript (letzte 6 Zeilen, wortwoertlich) - waehrend get_transcript dem Modell sagt, das Roh-Transkript werde nicht zurueckgegeben
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:169-172 (`c.transcript.slice(-LAST_TRANSCRIPT_LINES).map(...t.text)`, Konstante 6 in :42) gegen die Tool-Beschreibung von get_transcript (src/mcp-tools.js:1016-1018: "the raw transcript is not kept after the summary (data minimisation) and is NOT returned").
- Risiko: Woertliche Aeusserungen der Gegenseite (Dritter, nicht des Nutzers) verlassen den Dienst ueber MCP an den Host - zulaessig nach Absolute Regel 5 (Transkripte erlaubt), aber die Beschreibung stellt gegenueber dem Modell eine Minimierung dar, die nur fuer EIN Tool gilt. Bei O-13/Datenminimierung ist genau diese Diskrepanz der angreifbare Punkt.
- Empfehlung: Entweder die Beschreibung praezisieren (Roh-Zeilen gibt es bei get_call_status, nur nicht nach dem Purge) oder die Live-Zeilen auf den Widget-Pfad beschraenken.
- Prioritaet/Kategorie: P2 / C

#### PP-D5-G4 get_agent_status legt interne Infrastruktur-Konfiguration offen (exakte LLM-Modell-Kennung, Voice-Engine)
- Status: PARTIAL
- Evidenz: src/config.js:523 (`claudeModel: process.env.CLAUDE_MODEL || "claude-haiku-4-5"`) -> src/routes/api-read.js:92-93 -> src/mcp-tools.js:365-366 (`voiceEngine`, `model` in der get_agent_status-Whitelist) und damit in `structuredContent` + Textblock.
- Risiko: Der Host erfaehrt Anbieter und exakte Modell-Version des Gespraechs-Gehirns sowie den Namen der Voice-Engine - Betreiber-Interna ohne Nutzerfunktion, gleiche Familie wie die vom Auditor nicht geprueften Geldwerte: die Budget-Ablehnungstexte tragen Verbrauch und Kostendecke in EUR in die MCP-Antwort (src/i18n/gate-texts.js:43-50 -> src/telephony/outbound-gates.js:878-879), waehrend src/routes/api-read.js:24-34 EUR-Werte aus /api/state ausdruecklich entfernt hat.
- Empfehlung: `model`/`voiceEngine` aus der MCP-Whitelist nehmen (Dashboard darf sie behalten) oder auf eine grobe Klasse abbilden; die EUR-Werte sind eine Owner-Entscheidung (KS-P4) und bleiben, sollten aber als bewusste Abweichung notiert sein.
- Prioritaet/Kategorie: P2 / C

#### PP-D5-G5 Der Fehlertext hat eine dritte, ungeprueft gebliebene Quelle: den SDK selbst - heute auf dem Normalpfad von get_transcript erreichbar
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:1024 (`if (c.status === "active") return text({ error: loc.mcp.callStillRunning })`) liefert KEIN `structuredContent`, obwohl das Tool `outputSchema: TRANSCRIPT_OUTPUT` deklariert (:1019); der SDK wirft dann (mcp.js:196-199) und antwortet mit `createToolError(error.message)` (mcp.js:141) - also mit "Output validation error: Tool get_transcript has an output schema but no structured content was provided" statt dem lokalisierten Hinweis. Kein Test faengt das, weil die Tests einen Fake-Server ohne SDK-Validierung benutzen (test/mcp-tools-language.test.js:32-44).
- Risiko: PP-D5-06 (PASS) begruendet die generischen Fehlertexte allein mit `wrapHandler`; diese Kante liegt AUSSERHALB von wrapHandler. Fachlich: das Modell erhaelt auf dem haeufigsten Fehlbedienungspfad (Transkript waehrend des laufenden Anrufs) einen internen Validierungstext statt der Anweisung weiterzupollen. Kein Secret, aber interne Schema-Sprache nach aussen.
- Empfehlung: Den Fruehausgang als `isError`-Ergebnis oder mit vollstaendigem `structuredContent` zurueckgeben und mindestens einen Testpfad ueber den echten SDK-Server (nicht den Fake) fuehren.
- Prioritaet/Kategorie: P1 / B
