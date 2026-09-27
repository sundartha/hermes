# Tool-Semantik, Beschreibungen und Nebenwirkungs-Kennzeichnung

Dimension: D3 | Quelle: Code auf Branch master

## Kurzfassung

12 Tools, alle Beschreibungen einsprachig Englisch, durchweg praezise geschrieben und an
mehreren Stellen ehrlich ueber Grenzen (cancel_call sichert keinen Leitungsabbruch zu,
check_inbox nennt seinen Konsum in Grossbuchstaben). KEIN einziges Tool traegt
`annotations` - Grep ueber src/mcp-tools.js liefert 0 Treffer; das SDK (1.29.0) unterstuetzt
sie auf BEIDEN benutzten Registrierungswegen, es ist also keine technische Grenze.
Damit gilt fuer einen fremden Client per MCP-Default: `readOnlyHint=false`,
`destructiveHint=true`, `openWorldHint=true` fuer ALLE 12 - auch fuer reine Lesetools.
Schlimmster Befund: die place_call-Beschreibung verspricht unbedingt eine sich selbst
aktualisierende Live-Karte und sagt woertlich "You do NOT need to poll" - fuer einen
echten ChatGPT-Host ist das am eigenen Code als falsch dokumentiert
(src/ui/registry.js:23-33: die Karte bleibt dort STUMM). Ein Modell, das der Beschreibung
folgt, startet einen echten, kostenpflichtigen Anruf und erfaehrt dessen Ergebnis nie.
Zweitschwerster: get_transcript behauptet, das Roh-Transkript werde nicht aufbewahrt -
das Schwesterfeld `diagnostic` derselben Datei sagt das Gegenteil.

## Pruefpunkte

### PP-D3-01 place_call-Beschreibung verspricht eine Live-Karte, die es im Zielclient nicht gibt
- Status: FAIL
- Evidenz: src/mcp-tools.js:529 - "Returns a call_id immediately and shows a live card that
  updates itself (status, duration, transcript, result). You do NOT need to poll".
  Der Widget-Anhang haengt an `enableWidgetUi` (src/mcp-tools.js:617-622), das ohne faehigen
  Host `{}` liefert; src/ui/registry.js:23-33 haelt ausdruecklich fest, dass fuer einen
  ECHTEN ChatGPT-Host "die live-aktualisierende Karte selbst (Self-Poll, Cancel,
  get_transcript im Call-Widget) ... STUMM" bleibt. Die Beschreibung ist aber unbedingt -
  `placeCallDescription` (src/mcp-tools.js:549-550) haengt nur den Consult-Satz bedingt an,
  nie den Karten-Satz.
- Risiko: In ChatGPT laeuft ein echter, kostenpflichtiger Telefonanruf an einen Dritten,
  das Modell pollt gemaess Anweisung NICHT, es gibt kein Widget - Ergebnis, Fehlschlag und
  Kosten erreichen den Nutzer nie. Bei `consultAllowed=false` existiert await_call_event
  nicht einmal als Ausweg.
- Empfehlung: Karten-Satz genauso bedingt machen wie den Consult-Satz (nur anhaengen, wenn
  `enableWidgetUi(WIDGET_CALL)` ein `_meta` geliefert hat); ohne Widget stattdessen die
  Poll-Anweisung (get_call_status bzw. await_call_event) als Pflicht formulieren.
- Prioritaet/Kategorie: P0 / B

### PP-D3-02 get_transcript behauptet eine Aufbewahrungsregel, die der Code nicht haelt
- Status: FAIL
- Evidenz: src/mcp-tools.js:1018 - "For data protection reasons the raw transcript is not
  kept after the summary (data minimisation)". Widerspruch in derselben Datei,
  src/mcp-tools.js:818 (`diagnostic`-Feld) - "The server keeps the raw transcript of a call
  to the user's OWN verified number for a limited period on its own". Traegermodul:
  src/diagnostic-retention.js -> `diagnosticRetentionGranted()`.
- Risiko: Das Modell gibt dem Nutzer auf Nachfrage eine falsche Datenschutz-Auskunft
  ("wird nicht gespeichert"), obwohl das Roh-Transkript fuer Anrufe an die eigene Nummer
  aufbewahrt wird. Falsche Zusage in einer Datenschutzfrage, vom Client woertlich
  weitergereicht.
- Empfehlung: Satz auf das Wahre reduzieren: das Roh-Transkript wird von DIESEM Tool nie
  zurueckgegeben; die Aufbewahrung folgt der Diagnose-Regel und ist ueber `diagnostic`
  abwaehlbar.
- Prioritaet/Kategorie: P1 / B

### PP-D3-03 place_call nennt die Kostenwirkung nicht
- Status: FAIL
- Evidenz: src/mcp-tools.js:529 nennt "real phone call" und die Gates, aber kein Wort zu
  Kosten. Gebucht wird pro Minute: src/billing/metering.js:126
  (`costCents: minutes * callTariffCentsPerMin(call)`) -> src/store/state-ops.js:4105
  (`bookCents`). `max_duration_s` (src/mcp-tools.js:814-813, Beschreibung Z.808-811) nennt
  nur "remaining credit", erklaert aber nicht, dass ueberhaupt abgerechnet wird.
- Risiko: Ein fremdes Modell behandelt place_call als gewoehnliche Aktion und probiert es
  (z.B. Wiederholung nach Fehler) - jeder Versuch kostet echtes Geld beim Tenant.
- Empfehlung: Einen Satz aufnehmen: der Anruf ist kostenpflichtig, wird minutengenau dem
  Konto des Nutzers belastet und ist nicht rueckgaengig zu machen.
- Prioritaet/Kategorie: P1 / C

### PP-D3-04 place_call nennt die rechtliche Wirkung gegenueber dem Dritten nicht
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:529 und die Feldbeschreibungen (Z.685 `objective`: "read out
  VERBATIM to the called party right after the disclosure") setzen die Offenlegung voraus,
  ohne sie je zu erklaeren. Erst `language` (src/mcp-tools.js:798-806) erwaehnt eine
  "mandatory AI disclosure". Keine Aussage dazu, dass ein realer Mensch angerufen wird,
  der dem nicht zugestimmt hat.
- Risiko: Das Modell kann dem Nutzer nicht sagen, was beim Angerufenen ankommt; es kann die
  Angemessenheit eines Ziels (Notruf, Behoerde, fremde Person) nicht abwaegen, weil die
  Beschreibung diese Abwaegung vollstaendig an den Server delegiert ("just call it").
- Empfehlung: Einen Satz aufnehmen: Ziel ist ein realer Mensch; der Agent legt zu Beginn
  offen, dass er eine KI ist; das Modell soll die Nummer nur auf ausdruecklichen Wunsch des
  Nutzers waehlen und nie selbst erraten.
- Prioritaet/Kategorie: P1 / C

### PP-D3-05 "just call it" laedt zum Probieren ein
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:529 - "just call it; disallowed destinations are refused by the
  server with a clear message".
- Risiko: Die Anweisung verschiebt die gesamte Zielentscheidung in den Server. Gates, die
  greifen (Denylist, Land, Budget), verhindern Schaden - aber ein ERLAUBTES, vom Nutzer
  nicht gewolltes Ziel (falsch verstandene Nummer, Halluzination) wird ohne Rueckfrage
  gewaehlt. Das Gegengewicht steht nur im `to`-Feld ("ask the user ... instead of guessing",
  Z.671-674) und gilt dort nur der Notation, nicht der Absicht.
- Empfehlung: "just call it" durch eine Bestaetigungsregel ersetzen: waehlen nur mit einer
  vom Nutzer in diesem Gespraech genannten Nummer.
- Prioritaet/Kategorie: P1 / C

### PP-D3-06 Widerspruch zwischen place_call und await_call_event bei aktivem Consult-Kanal
- Status: FAIL
- Evidenz: src/mcp-tools.js:529 "You do NOT need to poll" gegen src/mcp-tools.js:543-547
  (angehaengt bei `consultAllowed`) "keep calling it until it returns event=\"done\"" und
  src/mcp-tools.js:861-866 "Call this REPEATEDLY right after place_call". Beide Texte
  stehen bei aktivem Kanal in EINER Beschreibung nebeneinander (`placeCallDescription`,
  Z.549-550).
- Risiko: Ein Modell ohne Vorwissen muss zwischen zwei gegensaetzlichen Anweisungen in
  demselben Text waehlen. Waehlt es den Karten-Satz, bleibt eine Rueckfrage des Agenten
  unbeantwortet, und der Anrufer wartet stumm bis zum Zeitablauf.
- Empfehlung: Bei aktivem Consult-Kanal den Karten-/Kein-Poll-Satz weglassen (eine
  Anweisung je Zustand statt zweier).
- Prioritaet/Kategorie: P0 / B

### PP-D3-07 Kein Tool traegt annotations - alle Defaults sind maximal misstrauisch bzw. falsch
- Status: FAIL
- Evidenz: Grep `annotations|readOnlyHint|destructiveHint|openWorldHint|idempotentHint`
  ueber src/mcp-tools.js: 0 Treffer. Die zwei Registrierungswege sind
  src/mcp-tools.js:650 (`server.tool`) und :655 (`server.registerTool`); beide akzeptieren
  `ToolAnnotations` (node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:141,
  :146, :155). Keine technische Grenze, nur nicht gesetzt. Spec-Defaults:
  tasks/openai-audit/00-mcp-spec.md:107 (N-01).
- Risiko: Ein generischer Client muss laut Spec-Default annehmen: alle 12 Tools sind
  schreibend, destruktiv und weltoffen. Damit ist die Kennzeichnung fuer
  Bestaetigungsdialoge wertlos: `get_calendar` sieht aus wie `place_call`. Umgekehrt gibt
  es keinen maschinenlesbaren Hinweis, dass `check_inbox` NICHT idempotent ist.
- Empfehlung: Annotations gemaess der Tabelle unten setzen; `title` gleich mit
  (tasks/openai-audit/00-mcp-spec.md:93/95, W-07/W-09).
- Prioritaet/Kategorie: P1 / B

### PP-D3-08 Soll/Ist der Nebenwirkungs-Kennzeichnung je Tool

Feldnamen exakt nach Spec: `readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint` (tasks/openai-audit/00-mcp-spec.md:107). "ist" = der am Code belegte
Wahrheitswert; "im Code gesetzt" = was der Deskriptor tatsaechlich traegt.

| Tool | readOnly (ist) | destructive (ist) | openWorld (ist) | im Code gesetzt | empfohlen | Begruendung mit datei:zeile |
|---|---|---|---|---|---|---|
| place_call | false | true | true | nichts | readOnly=false, destructive=true, idempotent=false, openWorld=true | POST /api/calls, echter Anruf, nicht rueckholbar, Geldbuchung: mcp-tools.js:825, metering.js:126, state-ops.js:4105 |
| await_call_event | true | n/a | true | nichts | readOnly=true, openWorld=true | nur GET (Long-Poll + GET /api/calls): mcp-tools.js:877-881; Zustand kommt von der externen Leitung |
| answer_consult | false | false | true | nichts | readOnly=false, destructive=false, idempotent=false, openWorld=true | POST .../consult/answer schreibt Consult-Zustand: mcp-tools.js:934; die Antwort wird im laufenden Gespraech an einen Dritten gesprochen; zweiter final-Versuch endet im Konflikt (mcp-tools.js:963-965) |
| get_call_status | true | n/a | true | nichts | readOnly=true, openWorld=true | reiner GET /api/calls/{id}: mcp-tools.js:971 |
| get_transcript | true | n/a | true | nichts | readOnly=true, openWorld=true | reiner GET, Whitelist pickTranscript: mcp-tools.js:1023-1030 |
| cancel_call | false | true | true | nichts (Legacy-`tool`, aber annotations waeren moeglich: mcp.d.ts:146) | readOnly=false, destructive=true, idempotent=true, openWorld=true | POST .../cancel storniert Datensatz + stoppt Buchung, ggf. Leitungsabbruch: mcp-tools.js:1061, api-calls.js:642-696 |
| get_my_number | true | n/a | false | nichts | readOnly=true, openWorld=false | GET /api/state, liest s.agent.number: mcp-tools.js:1076-1079 |
| list_calls | true | n/a | false | nichts | readOnly=true, openWorld=false | GET /api/state, Mapping pickCall: mcp-tools.js:1104-1107 |
| check_inbox | **false** | false | false | nichts | readOnly=false, destructive=false, **idempotent=false**, openWorld=false | POST /api/inbox/poll markiert Eintraege als gesehen: mcp-tools.js:1133, api-inbox.js:40-53 (`takeInboxEntries`, `marked`) |
| list_action_items | true | n/a | false | nichts (Legacy-`tool`) | readOnly=true, openWorld=false | GET /api/state, Filter: mcp-tools.js:1150-1152 |
| get_calendar | true | n/a | false | nichts | readOnly=true, openWorld=false | GET /api/state, pickCalendarEntry: mcp-tools.js:1180-1184 |
| get_agent_status | true | n/a | false | nichts | readOnly=true, openWorld=false | GET /api/state, pickAgentStatus: mcp-tools.js:1218-1220 |

- Status: FAIL (Ist-Spalte "im Code gesetzt" ist fuer alle 12 leer)
- Risiko/Empfehlung/Prioritaet: siehe PP-D3-07.

### PP-D3-09 check_inbox: Name verschweigt, was die Beschreibung sagt
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:1126 Name `check_inbox`; Beschreibung src/mcp-tools.js:481-486
  nennt den Konsum in Grossbuchstaben ("CONSUMING ... will NOT appear again") und
  verbietet ausdruecklich den Blaetter-Gebrauch ("use list_calls for that").
- Risiko: Der Name liest sich rein lesend; erst der Beschreibungstext korrigiert das. Faellt
  die Beschreibung im Client weg oder wird gekuerzt, konsumiert das Modell die Inbox
  beilaeufig. Kein `idempotentHint=false` als zweite Absicherung (PP-D3-07).
- Empfehlung: Beschreibung so lassen (sie ist gut und test-gepinnt), aber
  `readOnlyHint=false` + `idempotentHint=false` + `title` setzen.
- Prioritaet/Kategorie: P2 / C

### PP-D3-10 Semantische Ueberschneidungen zwischen den Lese-Tools
- Status: PARTIAL
- Evidenz: Vier Tools beantworten aehnliche Fragen: `get_call_status` (mcp-tools.js:1001-1002),
  `get_transcript` (:1018), `await_call_event` (:861-866), `list_calls` (:1098-1099),
  `check_inbox` (:481-486). Abgegrenzt sind sie NUR ueber Prosa: await sagt "no need to call
  get_transcript separately", get_transcript sagt "only once get_call_status reports
  status=completed", check_inbox sagt "use list_calls for that". `list_action_items`
  (:1149) ueberschneidet sich zusaetzlich mit dem Feld `action_items` in der check_inbox-
  Ausgabe (INBOX_OUTPUT).
- Risiko: Die Abgrenzung haengt vollstaendig daran, dass der Client lange Beschreibungen
  vollstaendig mitgibt. Die einzige Verwechslung mit echter Nebenwirkung
  (list_calls statt check_inbox) ist explizit adressiert; die uebrigen kosten nur einen
  ueberfluessigen Aufruf.
- Empfehlung: Kein Tool-Umbau. `title` je Tool setzen, damit die Auswahl auch bei gekuerzter
  Darstellung traegt.
- Prioritaet/Kategorie: P2 / C

### PP-D3-11 Client-spezifische Formulierungen in Beschreibungen und Server-Instructions
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:698 (`briefing`) - "The agent speaks as the personal AI
  assistant of the principal (not as Claude/Gemini)"; src/mcp-tools.js:761 (`context`) -
  "NEVER as Claude/Gemini". src/mcp-server-info.js:78-97 (`MCP_CONSULT_INSTRUCTIONS`) -
  "answer from your own tools and context first (calendar, mail, files, this chat)" setzt
  voraus, dass der Client Kalender-, Mail- und Dateizugriff hat. Dazu der Karten-Satz aus
  PP-D3-01.
- Risiko: Die Namens-Nennungen sind harmlos (Negativ-Liste, kein Client-Zwang). Die
  Quellen-Annahme im Instructions-Block ist in ChatGPT je nach Ausstattung unerfuellbar;
  der Ausgang ist aber sauber abgedeckt ("say ... that you do not know", ebd.).
- Empfehlung: "not as Claude/Gemini" durch "not as the chat assistant it is embedded in"
  ersetzen; die Quellenliste im Instructions-Block als Beispiel kennzeichnen.
- Prioritaet/Kategorie: P2 / C

### PP-D3-12 Versteckte Nebenwirkungen jenseits von Description und Schema
- Status: PARTIAL
- Evidenz: (a) place_call setzt serverseitig die Diagnose-Retention (Opt-out), das ist im
  `diagnostic`-Feld beschrieben (mcp-tools.js:818) - nicht versteckt. (b) place_call
  erzeugt eine Geldbuchung, NICHT beschrieben (PP-D3-03). (c) check_inbox schreibt,
  beschrieben (:481). (d) cancel_call reicht den ROHEN REST-Body durch
  (mcp-tools.js:1061, `text(...)` ohne Whitelist, Helfer :79-81) - kein outputSchema, der
  Feldsatz der Antwort ist aus der Tool-Definition nicht ableitbar. (e) Jeder Tool-Aufruf
  erzeugt einen Audit-Eintrag (z.B. api-inbox.js:52, api-calls.js:648) - nirgends
  beschrieben.
- Risiko: (b) ist der einzige Fall mit Nutzer-Schaden. (d) ist ein Kontrakt-Loch: das Modell
  bekommt undeklarierte Felder. (e) ist Betriebsnormalitaet, aber fuer eine
  Datenschutzauskunft relevant.
- Empfehlung: Kostensatz in place_call (PP-D3-03); cancel_call auf Whitelist +
  outputSchema heben.
- Prioritaet/Kategorie: P1 / C

### PP-D3-13 Tool-Namen: Eindeutigkeit
- Status: PASS (eine Ausnahme)
- Evidenz: 11 von 12 Namen benennen die Funktion praezise (Liste
  mcp-tools.js:666/858/892/999/1015/1058/1096/1126/1149/1172/1210). Ausnahme
  `get_my_number` (:1069, Beschreibung :1071 "Returns the phone number of the phone
  agent."): "my" ist aus Sicht des aufrufenden Modells mehrdeutig - geliefert wird die
  DID des Agenten (`s.agent.number`, :1078), nicht die Privatnummer des Nutzers.
- Risiko: Gering; die Beschreibung korrigiert die Mehrdeutigkeit in einem Satz.
- Empfehlung: `title` "Agent phone number" setzen; Umbenennung nicht noetig.
- Prioritaet/Kategorie: P2 / C

### PP-D3-14 Tool-Menge variiert je Tenant, ohne dass die Beschreibungen das tragen
- Status: PARTIAL
- Evidenz: `await_call_event`/`answer_consult` nur bei `consultAllowed`
  (mcp-tools.js:856), `get_calendar` nur bei `allowCalendar` (:1170); Defaults der
  Signatur :627-636. `place_call` haengt seinen Consult-Satz passend dazu an (:549-550) -
  das ist konsistent geloest.
- Risiko: Ein Client, der die Tool-Liste zwischenspeichert (z.B. ueber Tenants oder ueber
  einen Flag-Wechsel hinweg), ruft ein nicht registriertes Tool auf. Fuer die
  Beschreibungs-Semantik selbst kein Defekt.
- Empfehlung: Keine Aenderung in dieser Dimension; `listChanged`-Notification ist Sache von D2.
- Prioritaet/Kategorie: P2 / C

## Offene Fragen (nicht am Repo entscheidbar)

- Verlangt OpenAI fuer eine oeffentliche Integration `annotations` bzw. `title` verbindlich,
  oder wertet der Host sie nur aus, wenn vorhanden? Das Repo enthaelt nur die MCP-Spec-Seite
  (00-mcp-spec.md N-01: "Optional (Feld), Pflicht (Bedeutung)"), keine OpenAI-Zusage.
- Rendert ein echter ChatGPT-Host das `_meta`-Widget ueber `chatgptRenderer`? src/ui/registry.js:23-33
  sagt ausdruecklich, es gebe keine belegte Live-Probe - der Karten-Satz in place_call ist
  deshalb am Repo als unbelegt, aber nicht als sicher falsch entscheidbar.
- Wie lang darf eine Tool-Description im ChatGPT-Host sein, bevor sie gekuerzt wird?
  Mehrere Abgrenzungen (check_inbox vs. list_calls, get_transcript vs. get_call_status)
  haengen am letzten Satz der Beschreibung; ob der ankommt, ist hier nicht pruefbar.
- Ist `answer_consult` aus Sicht des Hosts "openWorld"? Die Antwort verlaesst das System
  nur indirekt (gesprochen durch den Agenten). Die Spec-Definition (00-mcp-spec.md:107)
  laesst beide Lesarten zu.

## Randbefund (ausserhalb dieser Dimension)

`cancel_call` (src/mcp-tools.js:1058-1062) reicht den kompletten REST-Antwortkoerper
ungefiltert an das Modell durch (`text()`, :79-81) - als einziger Tool-Handler dieser Datei
ohne Feld-Whitelist. Ob die Route (src/routes/api-calls.js:642-696) dort je ein internes
Feld liefert, gehoert zu D2/Leak-Pruefung.
