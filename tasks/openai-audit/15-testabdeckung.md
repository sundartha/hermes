# Testabdeckung der pruefungsrelevanten MCP-Pfade

Dimension: D15 | Quelle: Code auf Branch master

## Kurzfassung

Auth (Legacy-Token/OAuth: fehlend/Muell/abgelaufen/falsche Signatur/falsche Audience),
Tenant-Grenzen (SEC-P4), Consult-Ablauf/-Timeout, PII-Redaction und mehrere Provider-
Ausfallpfade sind dicht und mit echten HTTP-Requests getestet. Der schwerste Befund: **kein
Test ruft `tools/list` als echten JSON-RPC-Request gegen den realen `/mcp`-Endpunkt auf** -
der Werkzeugkatalog, den ein Host tatsaechlich sieht, ist nirgends end-to-end verifiziert.
Fast alle `tools/call`-Tests laufen gegen `registerTools(fakeServer, ctx)` (Handler-Ebene,
kein SDK-Transport); nur eine Handvoll Tools (get_my_number, list_calls, get_call_status,
check_inbox) haben zusaetzlich einen echten `mcpPost`-E2E-Test. Scope-Pruefung (OAuth-Scopes
zur Laufzeit) existiert im Code nicht (kein `scope`-Vergleich in `src/auth.js`) und ist damit
folgerichtig auch nicht getestet. Idempotenz von `place_call` (Doppelklick/Doppel-Tool-Call)
und Prompt-Injection aus dem Gespraechsinhalt sind nicht durch benannte Tests belegt.

## Pruefpunkte

### PP-D15-01 MCP-Initialisierung/Handshake
- Status: PASS
- Evidenz: test/mcp-server-icon.test.js:53 `T-T3-AC3: echter initialize-Request ueber POST /mcp` - realer HTTP-POST mit vollstaendigem `initialize`-Body gegen laufenden Server, prueft `serverInfo.icons`. Regressionslauf (kein Katalog-Praefix im Namen).
- Risiko: nur der 2025-06-18-Legacy-Handshake ist abgedeckt; kein Test fuer die 2026-07-28-Modern-Aera (kein Handshake, `_meta`-Version) laut `tasks/openai-audit/00-mcp-spec.md`.
- Empfehlung: falls der Server je das Modern-Protokoll bedienen soll, eigenen Testfall fuer `_meta`-Versionierung ergaenzen.
- Prioritaet/Kategorie: P2 / C

### PP-D15-02 tools/list liefert den realen Werkzeugkatalog
- Status: FAIL
- Evidenz: `grep -rn "tools/list" test/*.test.js` findet nur Referenzen in Kommentaren/String-Vergleichen von Widget-Code (test/mcp-ui.test.js:268, test/al-p13-consult-channel.test.js:991-1002 testet nur `mcpRequestLabel()`, eine reine Label-Funktion, keinen echten Request). `test/helpers.js:1297 toolCall()` baut ausschliesslich `tools/call`-Bodies; kein Helfer und kein Test baut `{method:"tools/list"}` gegen `mcpPost`.
- Risiko: eine Regressions- oder Konfigurationsaenderung, die den ausgelieferten Werkzeugkatalog verstuemmelt (z.B. Tool faellt aus `registerTools` heraus, Schema wird kaputt, Reihenfolge/Determinismus bricht, Sprachfilter versteckt ein Tool fuer einen Tenant), wird von keinem automatisierten Test bemerkt - genau das, was ein ChatGPT-Host beim Verbinden zuerst sieht.
- Empfehlung: einen e2e-Test ergaenzen, der real `tools/list` gegen `/mcp` postet und Tool-Namen, Pflichtfelder (`name`,`inputSchema`) und Determinismus (W-02/W-03/W-07 aus `00-mcp-spec.md`) prueft.
- Prioritaet/Kategorie: P0 / A (W-02/W-07 sind explizite MCP-Spec-Pflichten)

### PP-D15-03 tools/call end-to-end ueber den realen Transport (nicht nur Handler-Ebene)
- Status: PARTIAL
- Evidenz: echte `mcpPost(...).../mcp"`-E2E-Aufrufe existieren nur fuer `get_my_number` (test/am6-oauth-tenant.test.js:40), `list_calls` (test/mcp-tools-i18n.test.js:209-210), `get_call_status` (test/mcp-tools-language.test.js:305), `check_inbox` (test/inbox-mcp-tool.test.js:300-318). Die grosse Mehrheit der `tools/call`-Tests (test/mcp-tools.test.js, test/mcp-tools-language.test.js grossteils, test/mcp-ui.test.js, test/mcp-fehlergrund-rueckweg.test.js) ruft `registerTools(fakeServer, ctx)` und feuert den Handler direkt, ohne HTTP/JSON-RPC/SDK-Dispatch (`fakeServer` ab z.B. test/mcp-tools.test.js:37).
- Risiko: ein Fehler in der Bridge zwischen echtem SDK-Transport und Handler (Argument-Parsing, Zod-Validierungspfad des SDK, Fehler-Envelope-Form nach JSON-RPC-Spec W-14) waere durch keinen der Handler-Tests sichtbar.
- Empfehlung: fuer die sicherheits-/geldrelevanten Tools (`place_call`, `cancel_call`, `answer_consult`) je einen echten `mcpPost`-Test ergaenzen statt nur Handler-Tests.
- Prioritaet/Kategorie: P1 / B

### PP-D15-04 Auth: fehlendes Token
- Status: PASS
- Evidenz: test/oauth.test.js:42 `ohne Token -> 401 + WWW-Authenticate mit resource_metadata`; test/security.test.js:161 `ohne Token -> 401 (auch von localhost)` fuer den Legacy-Token-Modus. Regressionslauf.
- Risiko: keins.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D15-05 Auth: abgelaufenes Token
- Status: PASS
- Evidenz: test/oauth.test.js:57 `abgelaufenes Token -> 401`. Regressionslauf.
- Risiko: keins.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D15-06 Auth: falsche Signatur
- Status: PASS
- Evidenz: test/oauth.test.js:69 `falsche Signatur (fremder Schluessel) -> 401`. Regressionslauf.
- Risiko: keins.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D15-07 Auth: falsche Audience
- Status: PASS
- Evidenz: test/oauth.test.js:63 `falsche Audience -> 401`; test/oauth.test.js:88-121 zusaetzlicher Block fuer `OAUTH_AUDIENCE`-Override (Token mit kanonischer Audience wird bei aktivem Override abgelehnt). Regressionslauf.
- Risiko: keins.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D15-08 Scope-Pruefung (OAuth-Scopes zur Laufzeit, A-16 der Spec)
- Status: FAIL
- Evidenz: `grep -n "scope\|Scope" src/auth.js` liefert keinen Treffer fuer einen Scope-Vergleich; die einzigen Scope-Vorkommen im Repo betreffen den ElevenLabs-Inbound-Scope (`src/elevenlabs/inbound-scope.js`, thematisch unverwandt) und Mandats-/Booking-Scope in `src/claude.js` (Gespraechslogik, nicht Auth). Kein Test in `test/oauth.test.js` oder `test/am6-oauth-tenant.test.js` prueft `403 insufficient_scope`.
- Risiko: da die Funktion selbst fehlt, ist das kein reines Testluecken-Risiko, sondern ein Architektur-Befund (gehoert eigentlich in eine andere Dimension) - hier nur der Testabdeckungs-Aspekt: es kann keinen Regressionsschutz fuer etwas geben, das nicht existiert.
- Empfehlung: sobald Scopes eingefuehrt werden (falls fuer die OpenAI-Anbindung gefordert), sofort Tests fuer 403+`insufficient_scope`+`scope=`-Header (A-16) mitliefern.
- Prioritaet/Kategorie: P1 / B (Randbefund zur Architektur siehe unten)

### PP-D15-09 Autorisierung ueber Tenant-Grenzen hinweg (fremde call_id)
- Status: PASS
- Evidenz: test/sec-p4-mandanten-token.test.js:210 `erfundene Kennung und GEBUNDENER fremder Anruf sind in Status UND Rumpf ununterscheidbar`, :242 `mit Riegel scheitert der Aufruf fuer Mandant A am Anruf des FAEHIGEN Mandanten B`, :263 Rotprobe (Positiv-Kontrolle: ohne den Riegel ist der fremde Anruf ansprechbar), :287 `GANZ OHNE tenant_token wird abgelehnt (fail-closed)`. Zusaetzlich :310 derselbe Test fuer den Rueckfrage-Webhook. Regressionslauf.
- Risiko: keins, Abdeckung inkl. Positiv-/Negativ-/Rotprobe ist ungewoehnlich vollstaendig.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D15-10 Ungueltige Eingaben je Tool (Schema-/Wertevalidierung)
- Status: PARTIAL
- Evidenz: test/mcp-tools.test.js:83 `degradierte api-Antwort ({}) -> klare Tool-Fehlermeldung, kein .length-Crash`, :136 `Handler-Throw (Gateway 500) -> MCP-Fehlerantwort`. Diese decken Fehlerantworten des Backends ab, nicht systematisch fehlerhafte/fehlende Pflichtfelder je Tool-Input-Schema (z.B. `place_call` ohne `to`, falscher Typ bei `call_id`). test/place-call-context-bridge.test.js:96 prueft nur, dass das Schema strukturell unveraendert bleibt, nicht dessen Fehlerverhalten bei Verletzung.
- Risiko: eine Zod-Schema-Aenderung, die eine Pflichtvalidierung versehentlich lockert (z.B. `to` optional macht), faellt nicht auf, wenn kein Test explizit ein ungueltiges `to` sendet und auf `-32602`/Ausfuehrungsfehler prueft.
- Empfehlung: pro geldrelevantem Tool (`place_call`, `answer_consult`) mindestens einen Negativ-Test mit fehlendem/falsch typisiertem Pflichtfeld ergaenzen, der die JSON-RPC-Fehlerform prueft (W-14 der Spec).
- Prioritaet/Kategorie: P1 / B

### PP-D15-11 Anruf starten (place_call, Erfolgspfad + Fehlerpfad)
- Status: PASS
- Evidenz: test/place-call-error.test.js:45 `Originate-Fehler -> kategorisierte 502, kein Secret/Provider-Name/Twilio-Hint`; test/place-call-context-bridge.test.js:70/116/133/148 Schema-/Beschreibungsvertraege; test/anrufstart-ablehnung-grund.test.js:63 Start-Ablehnung des Anbieters mit Grund. Regressionslauf.
- Risiko: siehe PP-D15-10 (Eingabevalidierung) und PP-D15-12 (Idempotenz).
- Empfehlung: keine zusaetzliche fuer den Erfolgspfad.
- Prioritaet/Kategorie: N/A

### PP-D15-12 Doppelter Anruf / Idempotenz auf MCP-Tool-Ebene
- Status: FAIL
- Evidenz: Idempotenz-Tests existieren nur fuer die Budget-Reservierung (test/outbound-budget-concurrency.test.js:55 `Idempotenz: eine zweite Freigabe desselben Calls ist ein No-Op`) und fuer den Termination-Pfad (test/call-termination-order.test.js), nicht fuer zwei aufeinanderfolgende `place_call`-Tool-Aufrufe mit identischem Ziel/Objective (z.B. ein Host, der den Tool-Call wegen Timeout wiederholt). `test/outbound-per-target-cap.test.js:24` deckelt zwar Wiederholungen aufs selbe Ziel (429 ab dem 4. Versuch), das ist ein Rate-Limit, kein Idempotenz-Schutz (die ersten 3 Anrufe gehen tatsaechlich alle real raus).
- Risiko: ein MCP-Client/Host, der `tools/call` bei einem Netzwerk-Hänger erneut sendet (in der Spec nicht verboten, da MCP keine Idempotenz-Keys fuer Tools vorschreibt), kann echte Doppelanrufe/-kosten ausloesen, ohne dass ein Test das je gepruegt haette.
- Empfehlung: pruefen, ob ein Idempotenz-Key (z.B. clientseitige Request-ID) am `place_call`-Tool sinnvoll ist, und falls ja, mit Test absichern; sonst den Zustand bewusst als akzeptiertes Risiko dokumentieren.
- Prioritaet/Kategorie: P1 / B

### PP-D15-13 Anrufstatus (get_call_status)
- Status: PASS
- Evidenz: test/mcp-tools-language.test.js:305 echter `mcpPost`-Test gegen `get_call_status`; test/mcp-tools.test.js:188 `duration_s springt bei markAnswered nicht zurueck`, :286 `completed-Call misst startedAt..endedAt`. Regressionslauf.
- Risiko: keins.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D15-14 Anruf beenden (cancel_call)
- Status: PASS
- Evidenz: test/audit.test.js:61 `cancel_call: genau eine Zeile`; test/call-termination-order.test.js; test/el-beende-versuch.test.js; test/i6-write-scope.test.js (Schreib-Scope-Vertrag ueber `cancel_call`). Regressionslauf.
- Risiko: keins bekannt.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D15-15 Consult-Ablauf (Rueckfrage waehrend laufendem Anruf)
- Status: PASS
- Evidenz: test/al-d3-consult-pump.test.js:40/80/94; test/al-p13-consult-channel.test.js (44 Tests, u.a. :991 Label-Funktion); test/gq-p2-consult-deadline.test.js:129/160/205. Regressionslauf.
- Risiko: keins bekannt.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D15-16 Consult-Timeout
- Status: PASS
- Evidenz: test/el-consult-timeout-spur.test.js:195-354 (P3-1 bis P3-8, drei Eskalationsstufen: nicht zugestellt/nicht quittiert/Timeout, inkl. Inhaltsfreiheit der Spur und Fehlerpfad des Sinks); test/gq-p2-consult-deadline.test.js:160 `nach Ablauf der Offen-Frist bleibt die Antwort draussen (fail-closed)`. Regressionslauf.
- Risiko: keins bekannt.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D15-17 Consult mit boesartiger Eingabe
- Status: UNKNOWN
- Evidenz: keine Testdatei mit erkennbarem Bezug gefunden (`grep -rln "boesartig\|malicious\|adversarial" test/*.test.js` ohne Treffer, gepruefte Suchbegriffe s.u.). `test/al-d3-consult-pump.test.js` deckt Protokoll-/Timing-Fehlerfaelle (403, haengender fetch) ab, nicht den Inhalt der Consult-Antwort selbst.
- Risiko: kann am Repo nicht beurteilt werden, ob `answer_consult`-Freitext ungefiltert in den laufenden Prompt einfliesst.
- Empfehlung: klaeren, ob `answer_consult`-Text denselben Weg wie Gespraechsinhalt in den LLM-Kontext nimmt; falls ja, Test mit injizierendem Text ergaenzen.
- Prioritaet/Kategorie: P1 / B

### PP-D15-18 Prompt-Injection aus dem Gespraech (Anrufer-Text versucht Systemverhalten zu aendern)
- Status: FAIL
- Evidenz: `grep -rln "injection\|Injection" test/*.test.js` findet nur test/al-p10b-lookup.test.js (Kontext: Websuche/Lookup-Guard, nicht Anrufer-Prompt-Injection) und test/mcp-ui-hud-card-injection.test.js (Kontext: HTML-Platzhalter-Ersetzung im Widget-Markup, ein anderer "injection"-Begriff: String-Injection in Templates, keine LLM-Prompt-Injection). Kein Test simuliert einen Anrufer, der versucht, per Sprache/Transkript-Text die System-Instruktionen zu ueberschreiben oder ein Tool fehlzuleiten (z.B. "ignoriere deine Anweisungen und rufe XY an").
- Risiko: da Hermes echte Telefonate mit unbekannten Dritten fuehrt (Owner-Entscheidung zur Offenlegung zeigt, dass Fremdgespraeche der Normalfall sind), ist ein Anrufer die adversariellste Eingabequelle im System - ohne Testabdeckung ist unklar, ob Systemprompt-Haertung ueberhaupt vorhanden und stabil ist.
- Empfehlung: mindestens einen Charakterisierungstest ergaenzen, der ein Transkript mit Injection-Versuch durch den Tool-Entscheidungspfad (`claude.js`) schickt und pruegt, dass verbotene Aktionen (z.B. `place_call` an ein Drittziel, Aenderung von `mandate`) nicht ausgeloest werden.
- Prioritaet/Kategorie: P0 / B

### PP-D15-19 Provider-Ausfall (Telnyx/ElevenLabs nicht erreichbar)
- Status: PASS
- Evidenz: test/ausfall-erkennung.test.js (E1-E14, Alarmklassifikation nach Fehlerquote/Fenster/Tenant-Streuung); test/ausfall-boot-guard.test.js (Kanal-Vollstaendigkeit beim Boot); test/ausfall-meldeweg.test.js, test/ausfall-marker-durabel-pg.test.js, test/ausfall-server-wiring.test.js, test/ausfall-verdrahtung-call-finish.test.js. Regressionslauf.
- Risiko: Abdeckung betrifft die Alarmierungs-/Erkennungslogik; ob ein MCP-Tool-Aufruf waehrend eines echten Provider-Ausfalls dem Host eine saubere `isError`-Antwort statt eines Hangs liefert, ist ueber diese Tests nicht direkt belegt (kein `mcpPost`-Test mit simuliertem Provider-Timeout).
- Empfehlung: einen e2e-Test ergaenzen, der `place_call` bei simuliertem Provider-Fehler ueber den echten `/mcp`-Pfad prueft (Timeout-Verhalten, `isError`, keine haengende Response).
- Prioritaet/Kategorie: P2 / C

### PP-D15-20 Rate-/Budget-Limits am MCP-Pfad
- Status: PASS
- Evidenz: test/outbound-per-target-cap.test.js:24 `per-Target-Cap: 3x dasselbe Ziel ok, 4. -> 429`; test/outbound-budget-concurrency.test.js:22 `5 parallele Reservierungen -> genau 1x true, 4x false`; test/rate-limit.test.js, test/rate-window.test.js; test/tenant-budget-cap.test.js. Regressionslauf.
- Risiko: keins bekannt fuer den Gate-Mechanismus selbst; PP-D15-12 (Idempotenz) bleibt eine separate Luecke.
- Empfehlung: keine zusaetzliche.
- Prioritaet/Kategorie: N/A

### PP-D15-21 Datenminimierung in MCP-Tool-Antworten
- Status: PASS
- Evidenz: test/mcp-ui.test.js:293 `T-P1-UI-AC4: Whitelist - keine fremden/PII-Felder in structuredContent/Text (get_call_status)`, :459 `T-P2-UI-AC4: Whitelist (DSGVO) - Roh-Transkript NIE in structuredContent/Text (get_transcript)`, :590 `T-P3-AC4: Whitelist unveraendert auch im ChatGPT-Pfad`; test/mcp-audio-text-only.test.js:21 `mcp-tools.js definiert keine Audio-Ausgabefelder`. Regressionslauf.
- Risiko: keins bekannt.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D15-22 Redaction in Logs (Secrets/PII in Audit-/Server-Logs)
- Status: PASS
- Evidenz: test/pii-mask.test.js (maskNumber/hashEmail, deterministisch, kein Klartext); test/audit.test.js:113 `keine Secrets im Log`; test/audit-store.test.js:7 `auditStore.record schreibt eine Zeile (keine Secrets im detail)`; test/place-call-error.test.js:67 `kein Secret/Provider-Name/Twilio-Hint bei Telnyx`; test/sec-p4-mandanten-token.test.js:346 `keine Protokollzeile traegt den abgeleiteten Wert oder das Geheimnis`; test/telnyx-observability-secret-guard.test.js. Regressionslauf.
- Risiko: keins bekannt.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

## Offene Fragen (nicht am Repo entscheidbar)

- Ist fuer die ChatGPT-Integration eine OAuth-Scope-Pruefung (A-16) ueberhaupt gefordert, oder reicht die vorhandene Audience-/Tenant-Bindung? Das Repo zeigt nur den Ist-Zustand (keine Scopes), keine Anforderungsentscheidung.
- Fliesst `answer_consult`-Freitext in denselben LLM-Kontext wie das laufende Gespraech (Voraussetzung fuer PP-D15-17/18-Risiko)? Aus den gelesenen Testdateien nicht abschliessend klaerbar, ohne `src/claude.js`/`src/consult/*` vollstaendig zu lesen (ausserhalb des Auftragsumfangs dieser Dimension).
- Ist eine Idempotenz-Garantie fuer `place_call` bei MCP-Retries vom Produkt ueberhaupt gewuenscht, oder wird das bewusst dem aufrufenden Host ueberlassen? Ohne Owner-Entscheidung nicht bewertbar.

## Randbefund (ausserhalb dieser Dimension)

`src/auth.js` enthaelt keinerlei OAuth-Scope-Vergleich (kein `scope`-Token-Handling ausserhalb
thematisch unverwandter Verwendungen) - das ist ein Architektur-/Sicherheitsbefund, keiner der
Testabdeckung, und gehoert in die Auth-/AuthZ-Dimension dieses Audits.

---

Gesamtzahl Testdateien in `test/`: **~608** `*.test.js`-Dateien (733 Eintraege in `test/`
gesamt inkl. Hilfsdateien wie `_*.mjs`, `helpers.js`, Fixtures, `abnahme-ausgewandert.json`;
exakte Zahl per `ls test/*.test.js | wc -l`).

Suchmethode: `grep -rn`/`grep -rln` ueber Testnamen (`test(...)`-Strings) und gezieltes
`sed`/Lesen einzelner Dateien fuer die in der Aufgabenstellung genannten Pfade; keine
Testsuite ausgefuehrt. Suchbegriffe u.a.: `scope`, `idempot`, `injection`/`Injection`,
`boesartig`/`malicious`/`adversarial`, `mcpPost`, `tools/list`, `tools/call`,
`redact`/`PII`, `ausfall`/outage-Namensraum, `consult`. Wo eine Aussage nicht durch
Dateiname+Zeile belegbar war, wurde UNKNOWN vergeben statt einer Vermutung.
