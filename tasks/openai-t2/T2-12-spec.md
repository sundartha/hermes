# T2-12 Spec - Widget: Karten ziehen die Umbenennung nach, Kalender entfaellt

IDs (gepinnt): N-12, N-13, O-25. Risiko: widget. Branch `phase/openai-t2-12-widget-rename-cal-drop`,
Worktree `.../scratchpad/wt-t2-12`, Basis `91fc847` (master nach T2-11).
Diese Datei bleibt UNGETRACKT im Haupt-Arbeitsbaum.

## Ausgangslage (am Code gemessen, Basis 91fc847)

- T2-11 hat die Widget-Haelfte der Umbenennung SCHON erledigt: `src/ui/widgets/call.html:231`
  ist `TOOL_GET_CALL_RESULT = "get_call_result"`, `src/ui/widgets/my-number.html:1,30` nennt
  `get_agent_number`, beide auf v2 gepinnt (`src/ui/widget-versions.json`), T11-f prueft
  Widget-Namen statisch gegen `tools/list`.
  `grep -rn "get_transcript\|get_my_number" src scripts` liefert 0 Zeilen.
- Uebrig in `call.html`: Bezeichner mit altem Begriff - `transcriptFetched` (:402),
  `fetchTranscriptOnce` (:587,:654,:673,:675), `applyTranscript` (:164,:604,:645,:720).
  `renderTranscriptLines`/`last_transcript_lines` bleiben (Feld von `get_call_status`).
  `pickTranscript` (:603, Kommentar) ist der Name der Server-Funktion in `src/mcp-tools.js:236`
  und bleibt als wahrer Verweis stehen.
- `get_calendar` lebt noch: `src/mcp-tools.js:1723-1758` (Registrierung, `if (allowCalendar)`),
  `:961-966` (TOOL_ANNOTATIONS), `:1005` (Statuszeile), `:720-731`
  (`pickCalendarEntry`/`CALENDAR_ENTRY`/`CALENDAR_OUTPUT`), `:23` (Import `WIDGET_CALENDAR`),
  Parameter `allowCalendar = true` `:1097` + Kopfkommentar `:1036-1046`, Aufrufer
  `src/routes/mcp.js:262`. Kommentare mit dem Namen: `src/mcp-tools.js:107,660,890`,
  `src/i18n/mcp-texts.js:139`, `src/store/defaults.js:761`, `src/ui/widget-bind.js:22`.
- Kalender-Texte: `src/i18n/mcp-texts.js` `emptyCalendar` (:117,:209,:277) und `calendarLine`
  (:147,:225,:295) - einziger Leser ist der get_calendar-Handler.
- Kalender-Widget: `src/ui/widget-catalog.js:25,111`, `src/ui/widgets/calendar.html`,
  Pin `calendar: {1: ...}` in `widget-versions.json`, Woerterbuch-Keys `"Hermes · Calendar"` und
  `"Calendar"` in `src/ui/widget-i18n.js:46,49,85,88` (nur calendar.html nutzt sie).
  Kommentare: `src/ui/hud-card-css.js:17,76-83`, `src/ui/widgets/calls.html:12,17`.
- Resources werden NUR ueber `enableWidgetUi()` registriert (`src/mcp-tools.js:1137-1145`), also
  nur, wenn ein Tool das Widget referenziert. Faellt das Tool, faellt die Resource mit.
- **WIDGET_DICT wird in JEDES Widget serialisiert** (`src/ui/widget-i18n.js:186`,
  `I18N_SCRIPT`, injiziert von `widget-catalog.js:93-95`). Das Entfernen der zwei
  Kalender-Keys aendert das ausgelieferte HTML ALLER vier verbleibenden Widgets -> alle vier
  brauchen eine neue Version (Regel im Kopf von `widget-versions.json`, Test
  `test/openai-t2-02-widget-uris.test.js`).
- Telefon-Agent liest die Demo-Kalenderdaten NICHT (Plan-UNKNOWN aufgeloest): kein Treffer fuer
  "calendar" in `src/claude.js`, `src/elevenlabs/`, `src/conversation/`, `src/telephony/`;
  `test/p1b-no-booking.test.js:84-87` belegt `execTool(..., "get_calendar")` = "Unbekanntes Tool.".
  `tenantContext` (`src/store/state-ops.js:2101`) buendelt `calendar`, REST `GET /api/state`
  (`src/routes/api-read.js:78`) und Self-Service (`src/self-service-routes.js:455`) liefern ihn -
  Store/REST/Dashboard bleiben unberuehrt.
- Wer `get_calendar` heute sieht: nur Bootstrap-Owner (HTTP) und stdio (Default
  `allowCalendar = true`). Bezahlte Plaene haben `allowCalendar: false` (`src/plans.js:111`),
  `DEFAULT_PROFILE` ebenso.

## Schritte

### S1 - `get_calendar` als Werkzeug entfernen (O-25, N-13)
- Wo: `src/mcp-tools.js:1723-1758` (Block loeschen), `:961-966` + `:1005` (Eintraege loeschen),
  `:720-731` (loeschen), `:23` (Import), `:1097` + Kopfkommentar `:1036-1046` (Parameter
  `allowCalendar` loeschen, Kommentar nachziehen - der consultAllowed-Satz vergleicht heute mit
  allowCalendar), Kommentare `:107` (pickCall/pickCalendarEntry), `:660`, `:740`, `:890`.
  `src/routes/mcp.js:262` (Argument loeschen). `src/i18n/mcp-texts.js`: `emptyCalendar`,
  `calendarLine` in de/en/fr loeschen, Kommentar `:138-143` nachziehen.
  `src/store/defaults.js:761` Kommentar nach dem Muster von `allowBooking` (:763) umschreiben
  ("ohne Konsumenten, das MCP-Kalender-Werkzeug ist entfallen"). Das Profilfeld selbst, Store,
  pg-Spalte, `plans.js`, `self-service.js`, `db/migrate.js` bleiben.
- `requireFields`-Kommentar `:121-122` nennt `s.calendar.length` als Beispiel - auf ein noch
  lebendes Beispiel umstellen.
- Pfade: HTTP /mcp Legacy, HTTP /mcp OAuth (mit Mandant und ohne Mandant - die Stub-Fassade
  `src/mcp-no-tenant.js` ruft dasselbe `registerTools`), stdio (`src/mcp-server.js:35`).
- Beweis: (b) T12-a (neuer Test, s. S7) - `tools/list` je Pfad: ohne Consult und stdio GENAU
  {cancel_call, check_inbox, get_agent_number, get_agent_status, get_call_result,
  get_call_status, list_action_items, list_calls, place_call} (9); HTTP mit Consult (Legacy
  und OAuth) diese 9 + {answer_consult, await_call_event} (11); OAuth ohne Mandant = dieselbe
  Menge wie Legacy bei gleichem Consult-Zustand. (c) `node --check src/mcp-tools.js
  src/routes/mcp.js src/i18n/mcp-texts.js` gruen.

### S2 - Kalender-Karte entfernen (O-25)
- Wo: `src/ui/widget-catalog.js:25` (Konstante) und `:111` (WIDGET_DEFS-Eintrag),
  `src/ui/widgets/calendar.html` loeschen (`git rm`), `src/ui/widget-versions.json`
  Schluessel `calendar` entfernen, `src/ui/widget-i18n.js` Keys `"Hermes · Calendar"` und
  `"Calendar"` in de UND fr loeschen, Kommentare `src/ui/widget-bind.js:22`,
  `src/ui/hud-card-css.js:17,76-83`, `src/ui/widgets/calls.html:12,17` nachziehen (calls.html
  aendert sich ohnehin, s. S4).
- ENTSCHEIDUNG Pin-Loeschung: `widget-versions.json` sagt "alte Eintraege werden NIE
  ueberschrieben". Der calendar-Eintrag wird GELOESCHT, nicht ueberschrieben: der Schutzzweck
  (eine gecachte URI zeigt nie anderen Inhalt) bleibt erfuellt, weil `ui://hermes/calendar/v1.html`
  danach gar nicht mehr ausgeliefert wird. S7(c) im T2-02-Test ("kein Pin ohne Widget")
  verlangt die Loeschung sogar. Den `_comment` der Pin-Datei um genau diesen Fall ergaenzen
  (Widget entfaellt -> Eintrag faellt mit, Version wird nie wiederverwendet).
- Pfade: resources/list und resources/read ueber HTTP Legacy, HTTP OAuth (mit/ohne Mandant),
  stdio - jeweils mit `MCP_UI_ENABLED=true`.
- Beweis: (b) T12-b: `resources/list` je Pfad = Widget-Kennungen GENAU {agent-status, call, calls,
  my-number}; Verwaisung in beide Richtungen: jede `_meta.ui.resourceUri` aus `tools/list` steht
  in `resources/list`, und jede gelistete Resource wird von mindestens einem Tool referenziert.
  Positiv-Kontrolle: die Pruefung meldet eine kuenstlich zugefuegte URI ohne Tool.
  (c) `grep -c "Calendar" src/ui/widget-i18n.js` -> 0; `test -e src/ui/widgets/calendar.html`
  -> Exit 1.

### S3 - Call-Karte: Bezeichner ehrlich benennen (N-13)
- Wo: `src/ui/widgets/call.html` - `transcriptFetched` -> `callResultFetched` (:402,:668,:676,
  :678), `fetchTranscriptOnce` -> `fetchCallResultOnce` (:587,:654,:673,:675),
  `applyTranscript` -> `applyCallResult` (:164,:604,:645,:720). NICHT: `renderTranscriptLines`,
  `last_transcript_lines`, der Verweis auf die Server-Funktion `pickTranscript` (:603).
  Kommentar in `test/mcp-ui-w1-call-widget.test.js:401` nachziehen.
- Kostet keine zusaetzliche Version: call.html bekommt wegen S2 (Woerterbuch) ohnehin v3.
- Pfade: alle, die das call-Widget ausliefern (HTTP Legacy/OAuth, stdio).
- Beweis: (c) `grep -n "fetchTranscriptOnce\|applyTranscript\|transcriptFetched"
  src/ui/widgets/call.html` -> 0 Zeilen; (b) `test/mcp-ui-w1-call-widget.test.js` gruen
  (Verhalten unveraendert) und T12-d (S7).

### S4 - Neue Versionen fuer ALLE vier Widgets (Cache-Regel T2-02)
- Wo: `src/ui/widget-versions.json` - `agent-status` "2", `calls` "2", `my-number` "3",
  `call` "3" ANHAENGEN (SHA-256 von `widgetHtml(id)` nach S1-S3, alte Eintraege unveraendert).
  `test/openai-t2-02-widget-uris.test.js`: `KNOWN_PINS`-Ledger um die T2-11-Versionen
  (my-number v2, call v2 - fehlen dort heute) UND die neuen Versionen ergaenzen; calendar aus
  `ALL_WIDGET_IDS`, Import, `KNOWN_PINS` und Groessenbudget (:158) entfernen, mit Kommentar
  (s. S2-Entscheidung).
- Hash berechnen: `node -e 'import("./src/ui/widget-catalog.js").then(m=>{const c=require("crypto");for(const id of ["agent-status","my-number","calls","call"])console.log(id,c.createHash("sha256").update(m.widgetHtml(id)).digest("hex"))})'`
  (im Worktree, ERST nach allen Inhaltsaenderungen der Widgets).
- Beweis: (b) `test/openai-t2-02-widget-uris.test.js` gruen (S7(a) Ledger, S7(b), S7(c));
  (b) T12-c: die URIs aus `resources/list` sind genau `ui://hermes/agent-status/v2.html`,
  `ui://hermes/calls/v2.html`, `ui://hermes/my-number/v3.html`, `ui://hermes/call/v3.html`
  - also verschieden von den Pins vor der Phase (v1/v1/v2/v2).
- Abweichung vom Plan: der Plan nennt nur call und my-number - s. widersprueche.

### S5 - Bestehende Tests nachziehen (Kalender faellt, Zaehlungen sinken)
Loeschen oder umbauen, NICHT Assertions aufweichen. Je Datei:
- `test/mcp-ui.test.js`: Import `WIDGET_CALENDAR` (:21), `RESOURCE_URI_CAL` (:1004),
  Block "---- get_calendar ----" (:1190-1270, T-Wb-CAL-*) loeschen; Kommentare :939-942 nachziehen;
  Versions-Kommentare :33 und :1002-1003 (`// ui://hermes/call/v1.html` usw.) versionsneutral
  formulieren (z.B. "ui://hermes/call/v<widgetVersion>.html"), damit sie nicht bei jeder Version
  wieder luegen.
- `test/mcp-tools.test.js:91-127`: der Deref-Guard war am Beispiel get_calendar belegt - auf ein
  anderes `/api/state`-Tool umstellen (`get_agent_status` oder `list_action_items`), der Guard
  bleibt belegt.
- `test/mcp-tools-language.test.js:163,364,503` (drei get_calendar-Tests) loeschen; vorher
  pruefen, dass FMT-03 fuer `list_calls` weiter belegt ist.
- `test/mcp-tools-i18n.test.js:18-20,142,163-171`: MCP-14-Probe fuer den Kalender-Verbinder
  entfaellt; der Beleg "Widget-Werkzeug, Text haengt nicht am Host" auf ein anderes Widget-Tool
  (`list_calls` oder `get_agent_number`) umziehen. ACHTUNG: Namen mit `MCP-14` laufen in
  `test:gates`, nicht in `npm test`.
- `test/openai-t2-01-widget-resource-meta.test.js`: `WIDGET_COUNT` 5 -> 4 (:31), Seed-Zeilen
  :160-163 (`allowCalendar: true` nur fuer das Kalender-Widget) samt Kommentar loeschen,
  `widgetIds` (:498) ohne "calendar". Dies ist der X-6-Sandbox-Scan (T8) - er muss fuer jedes
  Widget gruen bleiben.
- `test/openai-t2-02-widget-uris.test.js`: s. S4.
- `test/mcp-ui-widget-i18n.test.js:29,43` (auch Testname :173 "ALLEN 5" -> 4),
  `test/mcp-ui-w1-bind.test.js:22,30,247` (Objekt-Listen-Bindung nur noch an list_calls),
  `test/mcp-ui-hud-card-injection.test.js:14,19`, `test/mcp-ui-wing-static.test.js:14,18`,
  `test/mcp-ui-wing-dedup.test.js:18,37`: calendar aus den Widget-Listen.
- `test/mcp-tool-annotations.test.js:73,265`, `test/p15-mcp-tool-descriptions-en.test.js:129`,
  `test/openai-p4-ergebnisstruktur-instructions.test.js:132,150,165,182,360`,
  `test/openai-p2-tool-metadaten.test.js:221,252`, `test/el-action-items.test.js:179`:
  get_calendar-Zeilen und das tote `allowCalendar`-Argument an `registerTools` entfernen.
- `test/openai-t2-11-werkzeugtexte.test.js`: `expectedCount` 10 -> 9 und 12 -> 11 (:141-144),
  Kommentar :132 (DEFAULT_PROFILE/allowCalendar veraendert die Namensmenge nicht mehr).
- `test/openai-t2-05-reauth-challenge.test.js:257-259`: Kommentar (allowCalendar bestimmt die
  Werkzeugmenge nicht mehr); Assertions dort pruefen.
- `test/l0-metrics.test.js:165,175`: "get_calendar" ist dort nur ein beliebiger Werkzeug-String
  im Metrik-Fixture - durch einen lebenden Namen ersetzen (Kriterium (e): alte Namen in test/
  nur in Fehlen-Assertions). `test/p1b-no-booking.test.js`, `test/cq-p6-mandate.test.js`
  pruefen das FEHLEN - bleiben.
- Store-/Profil-Tests mit `allowCalendar` als Datenfeld (store-pg, self-service*, plan-profile,
  i9-self-service, tenant-settings-calendar-map, helpers.js-Seed, dashboard-i18n-surface,
  personal-assistant-characterization, openai-p5a) bleiben - das Feld bleibt im Store.
- Beweis: (b) `npm test` gruen (Zeilen `# pass`/`# fail`), jedes Rot isoliert nachgemessen.

### S6 - T2-11-Tests nachschaerfen (N-12, N-13)
- Wo: `test/openai-t2-11-werkzeugtexte.test.js`.
  (1) Neuer Lauf `runOAuthNoTenant(fn, env)`: gleicher IdP/Server wie `runOAuth`, Token mit
  einem NICHT verknuepften `sub` (Muster `test/openai-t2-05-reauth-challenge.test.js:236`).
  In `ALL_PATH_CONFIGS` aufnehmen ("HTTP OAuth, ohne Mandant" mit und ohne Consult;
  `registersConsult` am Draht bestimmen, nicht raten - der Profil-Rueckfall fuer TENANT_REJECT
  entscheidet). Damit laufen T11-d und T11-n auch auf diesem Pfad (`src/routes/mcp.js:258`).
  (2) T11-n prueft neben `name`/`title` ALLE sichtbaren Tool-Texte ueber das vorhandene
  `visibleTexts(tool)` (:108): `title`, `annotations.title`, `description`,
  `_meta["openai/toolInvocation/invoking"|"invoked"]`. NICHT die Beschreibungen einzelner
  `inputSchema`-Properties: dort steht bewusst "accept the best offer" (Mandats-Enum
  `accept_best`, `src/mcp-tools.js:1265`) - beschreibend, nicht werblich; das in den Test-Kommentar.
  Positiv-Kontrolle: ein kuenstlich eingesetztes "official" in einer Beschreibung wird gemeldet.
- Pfade: HTTP Legacy +-Consult, HTTP OAuth mit Mandant +-Consult, HTTP OAuth ohne Mandant
  +-Consult, stdio +-Consult-Env.
- Beweis: (b) `NODE_ENV=test node --test --test-name-pattern="T11-" test/openai-t2-11-werkzeugtexte.test.js`
  gruen, mit Subtest-Label "HTTP OAuth, ohne Mandant" in der Ausgabe.

### S7 - Neuer Test `test/openai-t2-12-widget-namen.test.js` (N-12, N-13, O-25)
Kindprozess `PORT=0`, Temp-`DATA_DIR`, `MCP_UI_ENABLED=true`; Pfade HTTP Legacy (+-Consult),
HTTP OAuth mit Mandant (+-Consult), HTTP OAuth ohne Mandant, stdio (+-Consult-Env). Alles am
Draht (`tools/list`, `resources/list`, `resources/read`), nie am Registrierungsobjekt.
Testnamen mit `T12-` beginnen (keine Katalog-Praefixe wie `UI-`/`MCP-`).
- T12-a: Namensmengen wie in S1 (exakte Mengen, nicht nur Anzahl).
- T12-b: Resource-Menge und Verwaisung in beide Richtungen wie in S2, mit Positiv-Kontrolle.
- T12-c: jede `resources/read`-Antwort enthaelt keinen der drei alten Namen (`get_transcript`,
  `get_my_number`, `get_calendar`); das my-number-Widget enthaelt `get_agent_number`; jedes
  Widget traegt weiter die csp/domain-Metadaten aus T2-01 (am resources/read-`_meta` lesen);
  URIs = die neuen Versionen aus S4.
- T12-d GEGENPROBE: den call-Widget-Text per `resources/read` vom LAUFENDEN Server holen, sein
  eigenes Inline-Skript (letztes `<script>`, BIND_SCRIPT abgezogen) im node:vm-Fake-Window
  ausfuehren, `parent.postMessage` mitschneiden, Handshake, `in_progress`, dann `completed`
  fahren. Pruefen: jeder `params.name` jeder gesendeten `tools/call`-Nachricht steht in der
  `tools/list`-Namensmenge DESSELBEN Servers; Positiv-Kontrolle: die gesendete Menge ist nicht
  leer, enthaelt `get_call_status` und GENAU EINMAL `get_call_result`.
  Dafuer `makeFakeDocument`/`runOwnScript`/`ownScriptSource` aus
  `test/mcp-ui-w1-call-widget.test.js:80-242` in `test/_call-widget-harness.js` auslagern
  (Muster `test/_outbound-harness.js`, kein `.test.js`), `ownScriptSource(html)` nimmt das HTML
  als Parameter; der W1-Test uebergibt `widgetHtml(WIDGET_CALL)`, T12-d den Draht-Text.
  Mindestens HTTP Legacy und stdio.
  Beweiskraft: setzt man in call.html den Namen testweise auf `get_transcript` zurueck, wird T12-d
  rot (einmal lokal vorfuehren, im Bericht belegen, NICHT committen).

### S8 - Doku nachziehen (keine internen Kennungen in docs/OPENAI-*)
- `docs/OPENAI-TOOL-INVENTORY.md`: Table A 12 -> 11 Zeilen (get_calendar-Zeile in Prosa und
  TABLE-A-Block raus), Bedingungsspalte nur noch "always"/"consult" (Absatz :21-28 und veraltete
  Zeilenverweise `src/mcp-tools.js:1454`, `src/routes/mcp.js:162` neu messen), Table B:
  K1 11, K2 9, K3 9, K4 11, K5 9, K6 9 (Prosa + Block, Erklaertexte :262-266 und
  "What the reviewer will see"/"Why the variance ..." umschreiben - die Profil-Varianz
  entfaellt, nur Consult bleibt). Unter "Renamed tools" einen Absatz/eine Zeile "Removed:
  get_calendar - showed demo data, not a real calendar" (ohne interne Kennungen). Mit
  `test/openai-p10a-tool-inventar.test.js` abgleichen: `EXPECTED_TABLE_A_ROWS` 12 -> 11,
  Testnamen "genau 12" -> 11, `CONDITION_BY_PRESENCE` ohne den "calendar"-Eintrag (:53).
- `docs/OPENAI-POLICY-ABGLEICH.md:546` (Tool-Zeile get_calendar) loeschen; :500 Datenzeile
  "Kalender": Empfaenger OpenAI/ChatGPT entfaellt (Daten bleiben im Store, gehen aber ueber kein
  Werkzeug mehr hinaus). `test/openai-policy-abgleich-doku.test.js` muss gruen bleiben.
- `README.md:154` "Bonus-Tools": `get_calendar` streichen.
- Beweis: (b) p10a- und policy-abgleich-Test gruen; (c)
  `grep -rn "get_calendar" docs/OPENAI-*.md README.md` -> nur die Removed-Zeile im Inventar.

### S9 - Design-System-Mockups (Referenz, nicht ausgeliefert)
- Befund: `design-system/mcp/*.html` wird NICHT an MCP-Clients ausgeliefert, ist aber laut
  `design-system/README.md:262-268` die erklaerte Spiegel-Referenz der Widgets ("mirror
  src/ui/widgets/*") und wird vom Token-Gate gelesen (`scripts/check-token-sync.js:54,170`,
  nur @dsCard-Zeile 1 und kein @import - kein Paar-Abgleich). Als Referenz genutzt -> nachziehen:
  `design-system/mcp/my-number.html:1,7,31` auf `get_agent_number`; `design-system/mcp/calendar.html`
  loeschen; README-Zeile :267 ("the 4 read-only cards" -> 3, ohne calendar.html).
  `design-system/_ds_manifest.json` NICHT anfassen (listet heute schon nicht existierende
  Dateien wie `mcp/transcript.html` - generiertes Artefakt, eigener Sync).
- Beweis: (b) `test/mcp-ui-p5-token-sync.test.js` gruen; (c)
  `grep -rn "get_my_number\|get_calendar" design-system` -> nur `_ds_manifest.json`-freie Leere
  (0 Zeilen ausser ggf. im Manifest).

### S10 - Lint-Pins nur SENKEN
- Das Loeschen des Kalender-Blocks senkt Befunde in `src/mcp-tools.js` (registerTools heute 483
  Zeilen; id-length 'e' 4 und 's' 9 enthalten Kalender-Stellen). Das Gate meldet auch
  Bewegungen nach unten. Messen: `npx eslint src/mcp-tools.js --suppressions-location
  eslint-suppressions.empty.json --format json` bzw. `node scripts/check-staged-suppressions.js
  src/mcp-tools.js` gegen die vorgemerkte Fassung; die Pins in `eslint-legacy-exceptions.json`
  auf die gemessenen Werte SENKEN ("PIN GESENKT ..." im reason). NIE anheben.
- Beweis: (c) Befehl oben ohne neue/gestiegene Befunde; Pre-Commit-Hook laeuft ohne `--no-verify`.

### S11 - Abschlussmessung
- `node --check` jede geaenderte src-Datei; `npm test -- -- --test-concurrency=4 > <log> 2>&1`,
  nur `# pass`/`# fail` lesen; jedes Rot isoliert mit
  `NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js` nachmessen.
  Zusaetzlich `npm run test:gates` fuer die MCP-14-Aenderung (darf rot sein, aber nicht durch
  diese Phase NEU rot).
- (c) `grep -rn "get_transcript\|get_my_number\|get_calendar" src scripts` -> 0 Zeilen.
- (c) `grep -rn "get_transcript\|get_my_number\|get_calendar" test` -> nur Fehlen-Assertions
  (T11-*, T12-*, p1b-no-booking, cq-p6-mandate, OLD_NAMES-Konstanten).
- Testserver beenden, mit `ps` pruefen (pgrep ist blind).

## Nicht bauen
- Store, pg-Schema, Profilfeld `allowCalendar`, `plans.js`, REST `GET /api/state`/Self-Service
  `calendar`, Dashboard: Kalenderdaten bleiben Store-Schema und Dashboard-Flaeche; O-25 betrifft
  die Werkzeug-Oberflaeche. Ein Schema-Umbau waere eine Migration ohne Anforderung.
- `apps/web` (HermesDemo.astro:39,69, SettingsIsland, lib/api.js): Website laeuft nur ueber
  staging/Labor, eigene Phase (T2-19).
- Umbenennen von `pickTranscript`/`TRANSCRIPT_OUTPUT` in `src/mcp-tools.js`: serverintern, nie am
  Draht sichtbar, Plan beschraenkt `src/mcp-tools.js` auf die Kalender-Teile.
- Umbenennen der Widget-Kennung `my-number` (URI-Teil): verschoebe nur Cache-Schluessel, keine
  Anforderung (Plan).
- `PLAN-SECURITY.md:2145` (datierter Audit-Text nennt get_calendar): historische Aufzeichnung,
  keine Aussage ueber den Ist-Zustand.
- `design-system/_ds_manifest.json`: generiert und schon heute veraltet, eigener Sync-Weg.
- inputSchema-Property-Texte in T11-n: "best offer" ist beschreibend (s. S6).
- Keine neue Env-Variable, keine Konfigurationsaenderung, keine Beruehrung von Safety-Gates
  oder Offenlegungssatz (die Phase aendert keinen Anruf-/SMS-Pfad).

## Pre-Mortem (ein Jahr spaeter war die Phase ein Fehler - was ist passiert?)
1. Die Anruf-Karte zeigt in ChatGPT nach Anrufende nie ein Ergebnis - sie ruft einen Namen, den
   der Server nicht kennt, alle Tests gruen, weil der Widget-Test das Widget isoliert prueft.
   Entschaerft: T12-d faehrt das VOM DRAHT gelesene Widget und koppelt an tools/list desselben
   Servers, mit Positiv-Kontrolle und vorgefuehrtem Rueckfall-Rot (S7).
2. Die Kalender-Karte steht noch in resources/list, ihr Tool ist weg - der Review-Scan meldet
   eine verwaiste UI (O-25). Entschaerft: Resource-Registrierung haengt strukturell am Tool
   (`enableWidgetUi`), T12-b prueft beide Richtungen auf allen Pfaden.
3. Ein Host cached eine alte Karte (1 h erlaubt) und zeigt ueber dieselbe URI neuen Inhalt oder
   ruft alte Namen. Entschaerft: ALLE vier Widgets bekommen neue URIs (das Woerterbuch steckt in
   jedem Widget - haette man nur call/my-number neu gepinnt, waere der T2-02-Pin-Test rot bzw.
   ein Ueberschreiben noetig gewesen); Ledger um T2-11-Versionen ergaenzt.
4. Das Loeschen von `allowCalendar` aendert still, welche Tools ein restriktives Profil sieht.
   Entschaerft: einzige Lesestelle war `src/mcp-tools.js:1729` (grep belegt); T12-a prueft exakte
   Mengen je Pfad inkl. OAuth ohne Mandant; bezahlte Plaene sahen get_calendar nie.
5. Der Owner verliert ein Werkzeug, auf das sich ein Claude-Workflow stuetzte (Owner-Tenant und
   stdio sahen get_calendar). Akzeptiert: Owner-Entscheidung (b) erlaubt Breaking Changes, wenn
   eine Anforderung sie verlangt (O-25: keine Demo-Funktion); die Daten waren Demo-Daten
   (`src/store/defaults.js:676-680`), kein Nutzer verliert echte Termine. OW-A (Neu-Verbinden).
6. Ein Kostenfall/ungewollter Anruf/Transkript-Leak? Nicht beruehrt: kein Anruf-, SMS-, Gate-
   oder Offenlegungspfad wird geaendert; entfernt wird nur ein Lese-Werkzeug. Die Umbenennung in
   call.html aendert keine Nachrichtenform (T-W1-call-* bleiben gruen), das Widget fordert weiter
   nur get_call_result (Whitelist ohne Roh-Transkript).
7. Die Test-Matrix wird still duenner, weil Kalender-Tests geloescht werden, die nebenbei andere
   Mechanik belegten (Deref-Guard, Formatter, Widget-Text-unabhaengig-vom-Host). Entschaerft: S5
   zieht diese Belege auf lebende Werkzeuge um, statt sie zu loeschen.
8. Lint-Gate blockt den Commit, weil Befunde SANKEN - Versuchung `--no-verify`. Entschaerft: S10
   senkt die Pins messend; nie anheben, nie umgehen.

## Owner-Punkte
- OW-A (bestehend): nach dem Deploy (master enthaelt T2-11 UND T2-12 - nie getrennt deployen)
  den eigenen Claude-Connector trennen und neu verbinden. Erwartet: die Werkzeugliste zeigt
  `get_call_result` und `get_agent_number`, NICHT `get_transcript`, `get_my_number`,
  `get_calendar`; 9 bzw. 11 Werkzeuge (je nach Consult).
- OW-D (bestehend): in ChatGPT (Developer Mode) einen Testanruf an die EIGENE Nummer ausloesen
  und die Anruf-Karte bis zum Ende beobachten. Erwartet: die Karte zeigt nach "completed" das
  Ergebnis (Zusammenfassung, Ziel erreicht); keine Kalender-Karte mehr anwaehlbar.
- Deploy-Vorbedingung: keine neue (keine Env-Variable, kein Boot-Guard, keine Migration).

## Basismessung
- `npm test -- -- --test-concurrency=4` im Worktree auf 91fc847: `# tests 6437`, `# pass 6437`, `# fail 0` (Log: scratchpad/logs-t2-12/baseline.log).
