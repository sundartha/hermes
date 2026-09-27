# T2-15 - Restricted Data: Eingabepruefung und Ausgabe-Maskierung (O-14)

Stand: Planung 2026-09-25. Basis: master `252d154`. Worktree:
`/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/wt-t2-15`,
Branch `phase/openai-t2-15-restricted-data-mask`. ALLE Arbeit NUR dort. Diese Datei bleibt ungetrackt im
Haupt-Arbeitsbaum, nie in den Worktree kopieren, nie committen.

## Primaerquelle (woertlich, developers.openai.com/plugins/app-guidelines, abgerufen 2026-09-25)

> "Gather only the minimum data required to perform the tool's function."
>
> "Do not collect, solicit, or process the following categories of Restricted Data:
> - Information subject to Payment Card Information Data Security Standards (PCI DSS)
> - Protected health information (PHI)
> - Government identifiers (such as social security numbers)
> - Access credentials and authentication secrets (such as API keys, MFA/OTP codes, or passwords)."

O-14 in `tasks/openai-audit/00-openai-anforderungen.md:109` (Kategorie A). Die "Autonomen Entscheidungen"
in `tasks/openai-technik-stand.md` enthalten nichts zu O-14.

## Ziel dieser Phase (geschnitten)

1. Eingabe: `prepare_call`, `place_call` und `answer_consult` lehnen Freitext mit Luhn-gueltiger
   Kartennummer oder mod-97-gueltiger IBAN an der MCP-Grenze ab, BEVOR irgendein REST-Hop laeuft.
   EINE reine Funktion fuer alle drei; `to`, `confirmation_code`, `language` sind ausgenommen.
2. Ausgabe: jede MCP-Ausgabe, die Transkript-/Freitext traegt, maskiert dieselben Muster - in den
   Modul-Views (EIN Filter vor Text + structuredContent + Widget), NIE im Store, NIE im Telefonie-/Prompt-Pfad.
3. Ehrliche Grenze: PHI, Ausweis-/Steuer-/Sozialversicherungsnummern und Zugangsdaten werden NICHT
   maschinell erkannt (keine zuverlaessige Pruefsumme/Struktur) - dokumentiert in `PLAN-SECURITY.md`.
4. Werkzeug-/Feldbeschreibungen und server-instructions bleiben in dieser Phase BYTE-GLEICH
   (s. "Nicht bauen" und "Widersprueche").

## Code-Befunde (am Worktree gelesen, nicht aus dem Plan uebernommen)

- `src/mcp-tools.js:445` `confirmCallHop` ist Modul-Ebene und wird von `prepare_call` (`:1497`) UND
  `place_call` (`:1553`, Body `{...request, confirmation_code}`) VOR jedem anderen Hop aufgerufen. Der
  spaetere `placeCallHopCall(request)` (`:1563`) bekommt eine Teilmenge desselben Bodys. -> Pruefung
  gehoert als erste Anweisung in `confirmCallHop` (vor dem `try`): eine Stelle, beide Werkzeuge, keine
  Zeile mehr in `registerTools`, HMAC-Bindung unberuehrt (Argumente werden nicht veraendert, nur abgelehnt).
- `answer_consult` (`:1630`, Hop `:1659`) sendet `answers` direkt per `call("POST", ...)`.
- Ausgabe-Views (alle Modul-Ebene): `pickCallStatus` `:194` (last_transcript_lines), `pickTranscript`
  `:236` (result_summary + `resultCardView`), `awaitEventView` `:289` (questions + Ergebnis),
  `pickCall` `:679` (summary), `inboxEntryForModel` `:735` (`...rest` aus REST: summary, Ergebniskarte,
  action_items). `callTextLine`/`inboxTextLine` bauen den Text aus diesen Views - gedeckt, wenn die
  Views maskieren.
- LECK-STELLE 1: `get_call_result` baut den Text (`:1783`) aus `resultCardView(c.result)` DIREKT, nicht
  aus `data`. Maskiert man nur `pickTranscript`, steht die Karte im `content`-Text weiter roh. Muss auf
  die Felder von `data` umgestellt werden.
- LECK-STELLE 2: `list_action_items` (`:1906-1927`) baut den Text inline in `registerTools` aus
  `item.text` - keine View. Braucht eine Modul-Funktion (die zugleich maskiert).
- `cancel_call` liefert nur `{status}` (`src/routes/api-calls.js:762`) - kein Freitext. `get_agent_status`
  (owner = Tenant-Name) und `get_agent_number` tragen kein Transkript - nicht maskieren.
- `prepare_call`-structuredContent ist das Echo der (dann bereits geprueften) Eingabe - NICHT maskieren
  (sonst zeigt die Karte etwas anderes als das, woran der Code gebunden ist; bei Treffer kommt es gar
  nicht bis dorthin).
- `_meta` der Ergebnisse traegt nur Bestaetigungscode/Ablauf und Widget-Sprache - wird NIE maskiert.
  Das Widget liest Transkript nur ueber `get_call_status`/`get_call_result` (Host-Bruecke) -> serverseitig
  gedeckt, KEINE Widget-Aenderung, `src/ui/**` bleibt unberuehrt.
- stdio (`src/mcp-server.js`) und HTTP `/mcp` (Legacy-Token wie OAuth) registrieren ueber dasselbe
  `registerTools` -> eine Implementierung, aber drei Draht-Belege.
- Lint-Pin `eslint-legacy-exceptions.json` `src/mcp-tools.js`: `max-lines-per-function registerTools (404)`.
  Der Schluessel enthaelt die Zahl: waechst registerTools auf 405, ist das ein NEUER Befund = Verstoss.
  Alles Neue auf Modul-Ebene bzw. in die neue Datei; registerTools darf nur gleich bleiben oder
  schrumpfen (dann Pin mit gemessener Zahl SENKEN, Begruendung anhaengen wie im Bestand).
- Fehlerweg: `toolErrorText` `:544` -> `knownToolErrorCodeText` `:477` liefert `texts.errors[code]`
  (statischer String). Fuer "Feld + Kategorie" braucht es eine kleine Erweiterung (s. Schritt 2).
- `ToolError` (`:128ff`) setzt `message = code` -> der bestehende `console.error`-Pfad loggt nie Inhalt.

## Schritte

### Schritt 1 - Reine Erkennungs-/Maskier-Datei `src/restricted-data.js` (neu)
- Was: reine Funktionen, keine Imports ausser ggf. Konstanten:
  - `findRestrictedData(text)` -> Liste `{ category, start, end }` (Kategorien als eingefrorene
    Konstante, z.B. `RESTRICTED_CATEGORY.PAYMENT_CARD` / `.BANK_ACCOUNT`).
  - `maskRestrictedText(text)` -> String; Nicht-String unveraendert zurueck.
  - `firstRestrictedField(value, exemptKeys)` -> `{ category, field }` oder `null`; laeuft rekursiv ueber
    Objekte/Arrays, prueft nur Strings, `field` = Schluesselpfad OHNE Werte (z.B. `context.key_facts`;
    Array-Index darf fehlen). Fail-closed fuer kuenftige Felder: ALLE Strings werden geprueft ausser
    den ausdruecklich ausgenommenen Schluesseln.
- Kartenregel (alle Bedingungen zugleich): Ziffernfolge nicht direkt nach `+` oder Ziffer beginnend und
  nicht von einer Ziffer gefolgt; erste Ziffer 2-6 (Visa/Mastercard/Amex/Diners/JCB/Discover/UnionPay/
  Maestro; schliesst alle 0-/00-/1-Rufnummern aus); Form = zusammenhaengend 13-19 Ziffern ODER
  4er-Gruppen mit EINHEITLICHEM Trenner (ein Leerzeichen oder ein Bindestrich), letzte Gruppe 1-4,
  13-19 Ziffern gesamt ODER Amex-Form 4-6-5 / Diners 4-6-4; Luhn gueltig. Punkt, Schraegstrich,
  Doppelpunkt sind KEINE Trenner (Datum/Uhrzeit).
- IBAN-Regel: 2 Buchstaben (Gross-/Kleinschreibung egal) + 2 Pruefziffern + alphanumerisch mit optional
  einzelnen Leerzeichen, 15-34 Zeichen ohne Leerzeichen, mod 97 == 1 (stueckweise rechnen, kein BigInt
  noetig). IBAN wird ZUERST gesucht; ihre Spanne ist fuer die Kartensuche gesperrt (sonst wird der
  Ziffernteil einer IBAN als "Karte" gemeldet).
- Maskierung: Karte -> `****` + letzte 4 Ziffern; IBAN -> Laendercode + `****` + letzte 4 Zeichen
  (PCI-zulaessige Kuerzung, sprachneutral, keine i18n noetig). Rest des Textes byte-gleich.
- Muster linear: keine verschachtelten Quantoren, keine Rueckreferenz-Kaskaden; Laengen als benannte
  Konstanten (13, 19, 15, 34, 97, 4 ...) - keine Magic Numbers. Kein Log, kein Seiteneffekt.
- Datei: `src/restricted-data.js` (neu), `test/openai-t2-15-restricted-data.test.js` (neu, Unit-Teil).
- IDs: O-14. Pfade: transportunabhaengig (reine Funktion).
- Beweis (b): Unit-Tabelle im neuen Test, POSITIV: `4111 1111 1111 1111`, `4111-1111-1111-1111`,
  `4111111111111111`, `5555 5555 5555 4444`, `3782 822463 10005` (Amex), `DE89 3704 0044 0532 0130 00`,
  `de89370400440532013000`, `GB82 WEST 1234 5698 7654 32`, Karte mitten im Satz. NEGATIV (kein
  Treffer): `+4915112345678`, `+49 151 12345678`, `0151 12345678`, `0049 151 12345678`, `015112345678`,
  `25.09.2026`, `2026-09-25 14:30`, `2026-09-25 2026-09-26`, `14:30`, PLZ `10115`, Kundennummer
  `4111 1111 1111 1112` (nicht Luhn), `1234567890123` (erste Ziffer 1), zwei Rufnummern hintereinander,
  UUID `12345678-1234-4123-8123-123456789012`, `call_…`-IDs, IBAN mit falscher Pruefziffer
  `DE88 3704 0044 0532 0130 00`, 12-stellige Folgen. Maskierung: Rohwert weg, `****1111` da, Resttext
  unveraendert. Laufzeit-Kontrolle: 1 MB aus Ziffern/Leerzeichen/Bindestrichen wird ohne Ausnahme
  verarbeitet (grosszuegige Grenze, z.B. < 2 s, um Flakes zu vermeiden - Ziel ist "kein
  exponentielles Verhalten", nicht ein Benchmark).

### Schritt 2 - Fehlerkennung und neutraler Ablehnungstext in Tenant-Sprache
- Was: in `src/i18n/mcp-texts.js` `MCP_ERROR_CODE` um eine Kennung je Kategorie erweitern (z.B.
  `RESTRICTED_PAYMENT_CARD`, `RESTRICTED_BANK_ACCOUNT`) und Texte de/en/fr in `errors` (`:84`, `:232`,
  `:329`) anlegen. Text nennt FELD und KATEGORIE und sagt, dass nichts gesendet/kein Anruf ausgeloest
  wurde und die Angabe weggelassen werden muss - NIE den Wert, nie Ziffern daraus. Beispiel EN:
  "Not sent: the field objective contains what looks like a payment card number. Hermes does not accept
  payment card or bank account numbers - remove it and try again." DE mit Umlauten? NEIN - bestehende
  mcp-texts-Konvention pruefen (gesprochene Strings tragen Umlaute, Tool-Texte folgen dem Bestand der
  Datei) und uebernehmen.
- Feldnennung: `ToolError` (`src/mcp-tools.js:128ff`) um ein optionales, wertfreies `field` erweitern;
  `knownToolErrorCodeText` (`:477`) darf einen Text-Eintrag als Funktion `(field) => string` aufrufen.
  Fehlt/leer -> bestehender Rueckfall `LAST_RESORT_ERROR_TEXT` greift weiterhin (`toolErrorText :544`).
  Modul-Ebene, KEINE Zeile in registerTools.
- Kein Log des Treffers. Falls ueberhaupt geloggt wird: nur Kategorie + Feldpfad, via `console.warn`/
  `console.error` (nie `console.log` - stdout ist im stdio-Transport das Protokoll).
- Datei: `src/i18n/mcp-texts.js`, `src/mcp-tools.js:128-133, :477-479`.
- IDs: O-14. Pfade: alle (EINE Kante `wrapHandler` -> `toolErrorText`, geteilt von stdio/HTTP).
- Beweis (b): Unit-Test: `toolErrorText(new ToolError(code, "objective"), MCP_TEXTS[lang].errors…)`
  fuer de/en/fr liefert nicht-leeren Text mit "objective", ohne Ziffernfolge >= 4; bestehender Test
  `test/openai-t2-09-neutrale-fehlertexte.test.js` bleibt gruen (jede Kennung hat Text in allen drei Sprachen,
  falls dort so gepinnt - pruefen und ggf. erweitern).

### Schritt 3 - Eingabepruefung prepare_call UND place_call (eine Stelle)
- Was: erste Anweisung in `confirmCallHop` (`src/mcp-tools.js:445`, vor dem `try`): 
  `firstRestrictedField(body, CALL_ARGS_EXEMPT_KEYS)`; Treffer -> `throw new ToolError(code, field)`.
  `CALL_ARGS_EXEMPT_KEYS` = `to`, `confirmation_code`, `language` (Modul-Konstante). Nicht-String-Felder
  (max_duration_s, diagnostic, mandate.on_out_of_scope-Enum) sind unkritisch, weil nur Strings geprueft
  werden. Die Argumente werden NICHT veraendert (keine Maskierung der Eingabe - sonst bricht die
  HMAC-Bindung an den unveraenderten Tupel-Inhalt).
- Wirkung: kein Hop zu `/api/call-confirmations` (kein Code, kein Store-Schreiben), kein Hop zu
  `/api/calls` (kein Anruf, keine Reservierung). place_call mit Treffer scheitert, bevor der Code
  verbraucht wird.
- Datei: `src/mcp-tools.js:445`.
- IDs: O-14. Pfade: HTTP /mcp Legacy-Token, HTTP /mcp OAuth, stdio.
- Beweis (b), Draht-Test im neuen Testfile (Muster `test/openai-t2-13-bestaetigung.test.js:37-61`,
  `startServer` mit `FAKE_ORIGINATE=true`, `MCP_UI_ENABLED=true`, `CALL_CONFIRMATION_SECRET`):
  (i) `prepare_call` mit `objective` = "Bitte Karte 4111 1111 1111 1111 hinterlegen" -> `isError: true`,
  Text nennt `objective`, KEIN `_meta`-Bestaetigungscode, Antwort-JSON enthaelt nicht
  `4111 1111 1111 1111`/`4111111111111111`; (ii) dasselbe mit IBAN in `context.key_facts[1]` -> Feld
  `context.key_facts` genannt; (iii) `place_call` mit Karte in `briefing` und beliebigem
  `confirmation_code` -> `isError`, Store (`store.json` im DATA_DIR) hat KEINEN neuen Anruf-Datensatz;
  (iv) NEGATIV am Draht: `prepare_call` mit `to` = `+4915112345678`, objective mit
  "Rueckruf unter 0151 12345678 am 25.09.2026 um 14:30, Kundennummer 4111 1111 1111 1112, PLZ 10115"
  -> KEIN isError, Code in `_meta` (Fehlalarm-Probe); (v) `to` selbst Luhn-gueltig 13-15-stellig mit `+`
  wird nie abgelehnt. Legacy-Token: ueber `externalIp()` + `MCP_API_TOKEN` (nicht localhost, s.
  `test/helpers.js:621`); OAuth: `startIdp()` (Muster `test/am6-oauth-tenant.test.js:47-66`); stdio: gespawnter
  `src/mcp-server.js` (Muster T2-13-Test, `StdioClientTransport`) - je mindestens Fall (i).
  Bestehend gruen: `test/openai-t2-13-bestaetigung.test.js`, `test/openai-t2-14-call-widget-confirm.test.js`,
  `test/call-confirmation.test.js` (HMAC unveraendert).

### Schritt 4 - Eingabepruefung answer_consult
- Was: vor dem Hop `/consult/answer` (`src/mcp-tools.js:1659`) dieselbe Funktion auf `{ answers }` (kein
  Ausnahme-Schluessel). Um den registerTools-Pin nicht anzuheben: Pruefung + Hop in eine Modul-Funktion
  (z.B. `consultAnswerHop({ call, callId, body })`) auslagern oder die Zeile anderweitig kompensieren
  (Schritt 6). Das 400/409-Mapping im catch bleibt unveraendert; die Pruefung wirft AUSSERHALB davon,
  damit ein Treffer nicht als "nicht angenommen" (400) getarnt wird.
- Datei: `src/mcp-tools.js:1630-1682`.
- IDs: O-14. Pfade: HTTP /mcp (Legacy + OAuth), stdio - nur wenn Consult registriert ist
  (`consultAllowed`, `CONSULT_ENABLED`).
- Beweis (b): Draht-Test mit `CONSULT_ENABLED=true` (Freischaltung wie `test/al-p13-consult-channel.test.js:780-790`):
  `answer_consult` mit `call_id` = unbekannt, `answers` = ["4111 1111 1111 1111"] -> Restricted-Text
  (Feld `answers`), NICHT der not-found-/rejected-Text - belegt, dass die Pruefung VOR dem Hop greift;
  Kontrolle mit harmloser Antwort -> anderer (Hop-)Text. `status: "working"` ohne answers -> kein Treffer.

### Schritt 5 - Ausgabe-Maskierung in den Views (EIN Filter vor Text + structuredContent + Widget)
- Was, alles Modul-Ebene in `src/mcp-tools.js`:
  - `pickCallStatus` `:194`: jede Zeile von `last_transcript_lines` durch `maskRestrictedText`.
  - `pickTranscript` `:236`: `result_summary` und die Ergebniskarte (`outcome`, `next_step`, jedes
    Element von `commitments`, `counterparty_commitments`, `open_points`) maskiert. Eine kleine
    Modul-Funktion `maskedResultCard(result)` = `resultCardView` + Maskierung, von `pickTranscript` UND
    `awaitEventView` genutzt (G5). `src/call-result.js` bleibt unveraendert (Store-/REST-Seite).
  - `awaitEventView` `:289`: `questions[]` + Ergebnisfelder maskiert (ueber `pickTranscript`/`maskedResultCard`).
  - `pickCall` `:679`: `summary`.
  - `inboxEntryForModel` `:735`: `summary`, Ergebniskarte, `action_items[]`.
  - `list_action_items` (`:1906-1927`): Textbau in Modul-Funktion auslagern (z.B.
    `actionItemsText(items, texts)`), `item.text` maskiert.
  - `get_call_result` (`:1783`): Text aus den Kartenfeldern von `data` statt `resultCardView(c.result)`.
- NIE maskiert: `call_id`, `id`, `event_id`, `to`, `counterparty`, `caller`, `number`, `status`,
  `failure_reason`-Kennung, `_meta` jeder Art, `prepare_call`-Vorschau.
- Store, `src/call-result.js`, `src/store/**`, `src/claude.js`, `src/elevenlabs/**`, `src/telephony/**`,
  Prompts: NICHT anfassen.
- Datei: `src/mcp-tools.js` (Views + zwei Handler-Stellen).
- IDs: O-14. Pfade: HTTP /mcp Legacy-Token, HTTP /mcp OAuth, stdio; Werkzeuge get_call_status,
  get_call_result, await_call_event (Consult), list_calls, check_inbox, list_action_items.
- Beweis (b), Draht-Test: Seed (`seedState`/`seedCall`, `test/helpers.js:645/:732`) mit beendetem Anruf,
  dessen `transcript` "meine Karte ist 4111 1111 1111 1111" und "IBAN DE89 3704 0044 0532 0130 00",
  `summary`, `result.outcome`/`commitments`, ein Action Item und ein Inbox-Eintrag (inbound) dieselben
  Werte tragen. Fuer jedes der sechs Werkzeuge: GANZE JSON-RPC-Antwort (content-Text, structuredContent,
  _meta) als String -> enthaelt weder `4111 1111 1111 1111` noch `4111111111111111` noch
  `DE89 3704 0044 0532 0130 00`/`DE89370400440532013000`; enthaelt `****1111`. POSITIV-KONTROLLE im selben
  Test: derselbe Such-Ausdruck findet den Rohwert in `store.json` NACH den Aufrufen (Store unveraendert,
  und der Scanner sucht tatsaechlich). Fehlalarm-Kontrolle: Rufnummer `+4915112345678` im Transkript
  und `counterparty` bleibt byte-gleich sichtbar. Je Transport (Legacy extern, OAuth, stdio) mindestens
  `get_call_status` und `get_call_result`; alle sechs Werkzeuge mindestens auf einem HTTP-Pfad.
  Bestehend gruen: `test/mcp-fehlergrund-rueckweg.test.js` (Fall 6 byte-identisch ohne Treffer),
  `test/al-p13-consult-channel.test.js`, `test/mcp-ui-w1-call-widget.test.js`, `test/anruf-inbox*`/check_inbox-Tests.

### Schritt 6 - Lint: registerTools-Pin nicht anheben, neue Datei 0 Befunde
- Was: `npx eslint src/mcp-tools.js src/restricted-data.js src/i18n/mcp-texts.js --suppressions-location
  eslint-suppressions.empty.json --format json` messen. registerTools <= 404 Zeilen; sinkt sie, Pin in
  `eslint-legacy-exceptions.json` mit gemessener Zahl SENKEN (Begruendung an `reason` anhaengen, Muster
  "PIN GESENKT 2026-09-.. (T2-15 ...)"). Keine neuen Eintraege, kein disable-Marker, eine Anweisung je
  Zeile, keine Magic Numbers. Die uebrigen Zaehler (id-length, no-magic-numbers, no-restricted-syntax)
  duerfen nicht steigen.
- Datei: `eslint-legacy-exceptions.json` (nur senken), die geaenderten Dateien.
- IDs: O-14 (Hygiene). Pfade: -.
- Beweis (c): obiger Befehl; erwartet: `src/restricted-data.js` 0 Befunde; `src/mcp-tools.js` nur die
  gepinnten Schluessel mit Zahlen <= Pin; `node scripts/check-staged-suppressions.js` (Commit-Hook) gruen.

### Schritt 7 - Werkzeugtexte/instructions byte-gleich belegen
- Was: KEINE Aenderung an `describe(...)`, `description`, `PLACE_CALL_REQUEST_SCHEMA`-Texten,
  `src/mcp-server-info.js`. (Grund s. Widersprueche W1.)
- Beweis (c): `git -C <worktree> diff master -- src/mcp-server-info.js` leer; tools/list-Ausgabe
  (HTTP `/mcp`, `MCP_UI_ENABLED=true`, `CONSULT_ENABLED=true`) auf master und Branch als JSON
  sichern und vergleichen: `jq '[.result.tools[] | {name, description, inputSchema}]'` identisch
  (gleiches Kommando beide Male, erwartet: `diff` leer). Zusaetzlich `git diff master --stat -- src/ui/`
  leer (keine Widget-Aenderung, `widget-versions.json` unveraendert).

### Schritt 8 - PLAN-SECURITY.md: Abschnitt "OpenAI-T2-15 - Restricted Data an der MCP-Grenze"
- Was: neuer Abschnitt nach `## OpenAI-T2-14` (`PLAN-SECURITY.md:6417`): was geprueft wird (Karte:
  Luhn+Laenge+IIN-Ziffer+Form; IBAN: mod 97), wo (Eingabe: prepare_call/place_call/answer_consult; Ausgabe:
  sechs Werkzeuge), was NICHT (PHI, Ausweis-/Steuer-/SV-Nummern, Zugangsdaten/OTP, Kartennummern als
  Zahlwoerter, IBAN/Karte ueber Umwege wie Punkte als Trenner, nationale Kontonummern ohne IBAN, der
  Sprachagent selbst - er hoert und spricht unveraendert, das Transkript im Store bleibt roh), bewusst
  akzeptierte Fehlalarme (Luhn-gueltige 13-19-stellige Bestellnummer mit Anfangsziffer 2-6, Rufnummer
  ohne `+`/`0` in Kartenform), Rueckbau = Revert. Keine Produktionswerte.
- IDs: O-14. Pfade: -.
- Beweis (a): Abschnitt vorhanden, `grep -n "OpenAI-T2-15" PLAN-SECURITY.md`.

### Schritt 9 - Gesamtlauf
- `npm test -- -- --test-concurrency=4 > <log> 2>&1`, nur `# pass`/`# fail` zaehlen; jeder rote Test
  isoliert nachpruefen (`NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js`).
  Baseline master 252d154 (Planung, gleiche Maschine, 2026-09-25): `# pass 6513`, `# fail 0`. Gestartete Server beenden, mit `ps` pruefen.
- Neue Env-Variable: KEINE (kein Schalter - die Pruefung verschaerft nur; Rueckbau = Revert). Damit
  entfaellt der Vier-Orte-Schritt.

## Tests: was bricht, was beweist

- Brechen koennen: Tests, die den `get_call_result`-Text byte-genau pinnen (ohne Treffer bleibt er
  gleich - pruefen), Tests, die `MCP_ERROR_CODE` vollstaendig aufzaehlen (dann um die neuen Kennungen
  erweitern, nicht lockern), Tests zum registerTools-Pin/Lint-Gate.
- Neu: `test/openai-t2-15-restricted-data.test.js` (Unit-Tabelle + Draht HTTP Legacy/OAuth + stdio).
  KEINE Katalog-ID am Namensanfang (sonst landet der Test im Gates-Lauf, s. CLAUDE.md) - Namen wie
  "T2-15: ..." sind ok, sofern `package.json config.i18nCatalogPattern`/`abnahmePattern` nicht greifen (pruefen).

## Nicht bauen (mit Grund)

1. Feldhinweise in Werkzeugbeschreibungen/`describe()` und server-instructions ("keine Zahlungsdaten,
   Ausweisnummern, Gesundheitsakten, Zugangsdaten"): Werkzeugtext-Aenderungen nur mit Bench (Lead-Vorgabe);
   der Plan selbst ordnet die place_call-Feldtexte der T2-16-Messung (OW-H) zu, und O-15 (Art.-9-Mindestmass)
   liegt in T2-16. Status fuer den "solicit"-Teil von O-14: UNKNOWN/offen, Uebergabe an T2-16.
   Heute vorhanden: `context.key_facts` sagt bereits "NO secrets/passwords/payment data" (`src/mcp-tools.js:1293`).
2. Erkennung von PHI, Ausweis-/Steuer-/Sozialversicherungsnummern, API-Keys/OTP/Passwoertern: keine
   zuverlaessige maschinelle Pruefung (keine Pruefsumme, OTP = beliebige 6 Ziffern) - Scheinsicherheit
   und Fehlalarme gegen Termin-/Kundennummern. Ehrlich als Grenze in PLAN-SECURITY.md.
3. Maskierung im Store, im REST (`/api/calls/:id`, `/api/state`, Dashboard), im Sprachagenten, in Prompts
   oder im Transkript-Schreibpfad: Lead-Vorgabe (c); Store bleibt Beweismittel, Telefonie-/Prompttexte
   brauchen convo-bench.
4. Pruefung in den REST-Routen `/api/call-confirmations`/`/api/calls` (Dashboard-Weg): O-14 betrifft die
   OpenAI-App; die MCP-Grenze ist der geforderte Ort (Plan "vor dem REST-Hop"). Moegliche spaetere
   Haertung, nicht diese Phase.
5. Widget-Aenderung (`src/ui/widgets/call.html`): unnoetig, das Widget bekommt Transkript nur ueber die
   serverseitig maskierten Werkzeuge.
6. Env-Schalter fuer die Pruefung: ein Abschalter waere eine neue abschaltbare Sicherung; Rueckbau = Revert.
7. Maskierung der Eingabe statt Ablehnung: bricht die HMAC-Bindung (Karte zeigt anderes als gewaehlt wird)
   und verarbeitet die Daten trotzdem.

## Pre-Mortem (ein Jahr spaeter war T2-15 ein Fehler - was ist passiert?)

1. Fehlalarm blockiert legitime Anrufe: eine 16-stellige Bestell-/Vertragsnummer in 4er-Gruppen mit
   Anfangsziffer 2-6 ist zufaellig Luhn-gueltig (~10 % solcher Nummern) - Nutzer kann den Anruf nicht
   starten. Entschaerft: IIN-Ziffer 2-6 (alle 0/00/1-Rufnummern fallen raus), Datumsformen durch
   Gruppenregel ausgeschlossen, `+`-Token und `to` ausgenommen, Text nennt Feld + Kategorie, Tabelle von
   Gegenbeispielen im Test. Rest-Risiko bewusst akzeptiert und in PLAN-SECURITY.md benannt.
2. Pruefung nur auf einem Pfad: Karte sagt ok, place_call lehnt ab (oder umgekehrt). Entschaerft: EINE
   Stelle `confirmCallHop`, die beide Werkzeuge vor jedem Hop durchlaufen; Pruefung ist eine reine Funktion
   der unveraenderten Argumente -> identisches Ergebnis in beiden Aufrufen; HMAC unberuehrt.
3. Leck an einer uebersehenen Ausgabe: `get_call_result`-Text (baut aus `c.result` direkt) oder
   `list_action_items` (Inline-Text) bleiben roh, obwohl structuredContent maskiert ist. Entschaerft:
   beide Stellen ausdruecklich umgebaut; Draht-Test scannt die GANZE Antwort je Werkzeug, mit
   Positiv-Kontrolle gegen store.json.
4. Maskierung zerstoert Steuerdaten: call_id/Rufnummer/Bestaetigungscode wird "maskiert", Widget-Polling
   oder Rueckruf bricht. Entschaerft: Maskierung nur an benannten Freitext-Feldern der Views, nie `_meta`,
   nie IDs/Nummern; UUID- und `+`-Negativfaelle im Test.
5. Ablehnung echot die Karte oder ein Log schreibt sie. Entschaerft: Text aus Tabelle mit Feldpfad
   (Schluessel, keine Werte), `ToolError.message` = Kennung, kein neues Log mit Inhalt; Test prueft, dass
   die Antwort den Rohwert nicht enthaelt.
6. ReDoS/Last: ein langes Transkript legt den Worker lahm. Entschaerft: lineare Muster ohne
   verschachtelte Quantoren, 1-MB-Test; HTTP-Eingaben ohnehin durch BODY_LIMIT (`src/app.js:181`) begrenzt.
7. Scheinsicherheit gegenueber OpenAI/Nutzern: man glaubt, PHI/Ausweisdaten seien gefiltert. Entschaerft:
   Grenzen offen in PLAN-SECURITY.md; Feldhinweise (solicit-Teil) als offen an T2-16 uebergeben, nicht als
   erfuellt gemeldet.
8. Safety-Gates beruehrt: nein - die Pruefung laeuft VOR allen Gates und fuegt nur eine weitere Ablehnung
   hinzu; POST /api/calls-Kette, Offenlegungssatz, Kostendecke unveraendert. Beweis: `git diff master --stat`
   zeigt keine Datei unter `src/routes/`, `src/telephony/`, `src/claude.js`, `src/elevenlabs/`.
9. registerTools-Pin steigt still (neuer Befund-Schluessel mit 405). Entschaerft: Schritt 6 misst.

## Widersprueche Plan <-> Code/Vorgaben

- W1: Plan T2-15 verlangt "jede Freitext-Feldbeschreibung schliesst ... aus" und Abnahme "Feldbeschreibungen
  am Draht enthalten den Ausschluss"; Lead-Vorgabe: keine Werkzeugtext-Aenderung ohne Bench, und der Plan
  selbst schiebt die Messung der place_call-Feldtexte nach T2-16. Aufgeloest zugunsten der Lead-Vorgabe:
  Texte byte-gleich, Punkt offen/UNKNOWN, Uebergabe an T2-16.
- W2: Plan-Abschnittstitel "Eingabepruefung, Ausgabe-Maskierung, Feldhinweise" - die gepinnte Phase heisst
  "Eingabepruefung und Ausgabe-Maskierung"; IDs stimmen (nur O-14).
- W3: Plan nennt fuer die Ausgabe nur "Zusammenfassung, last_transcript_lines, Action Items"; am Code
  tragen zusaetzlich Ergebniskarte (get_call_result, check_inbox, await_call_event), Consult-`questions`,
  `list_calls.summary` und der get_call_result-Text (aus `c.result` direkt, `:1783`) Freitext.
- W4: Plan: "ausgenommen ... Token mit fuehrendem `+`" reicht nicht gegen Fehlalarme (z.B.
  `2026-09-25 2026-09-26`, 16 Ziffern, Anfang 2) - zusaetzlich IIN-Ziffer 2-6 und Gruppenregel.
- W5: Lead nennt call.html mit 265289 von 266240 Byte; die Quelldatei `src/ui/widgets/call.html` hat
  53631 Byte - vermutlich zaehlt das Budget die ausgelieferte, eingebettete Fassung. Fuer diese Phase
  folgenlos (keine Widget-Aenderung).
- W6 (UNKNOWN): Tenant-Einstellung `allowBankData` (`src/claude.js:232`, Default false,
  `src/self-service.js:24` nur einschraenkbar) erlaubt dem Sprachagenten, Bankdaten im Gespraech zu nutzen -
  das ist der Telefonie-/Prompt-Pfad, ausserhalb dieser Phase; ob das O-14 ("process") beruehrt, ist eine
  Produkt-/Rechtsfrage und nicht am Code entscheidbar.

## Owner-Punkte

- Keine Deploy-Vorbedingung (keine Env-Variable, kein Live-Wert).
- Nach Deploy (nur Owner: Live-Probe in ChatGPT/Claude): im verbundenen Connector `prepare_call` mit einem
  Auftrag, der die Testkarte `4111 1111 1111 1111` enthaelt, anstossen. Erwartet: Fehlermeldung, die das Feld
  und "Kartennummer" nennt, KEINE Karte/kein Code, kein Anruf in `list_calls`. Danach denselben Auftrag
  ohne Karte, aber mit Rufnummer ohne `+` und Datum -> Karte erscheint normal.
