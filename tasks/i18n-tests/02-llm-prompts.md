# PROMPT - LLM-/Prompt-Schicht - hartcodiertes Deutsch

## Ist-Stand (belegt)

Alle Punkte unten wurden gegen den echten Code verifiziert (Stichprobe: `src/claude.js`,
`src/i18n/locales.js`, `src/routes/voice.js`, `src/store/defaults.js`, `src/self-service.js`,
`src/mcp-tools.js`, `src/precall-briefing.js`, `src/routes/api-calls.js`,
`src/routes/api-onboard.js`, `src/billing/provision-trigger.js`, `src/telephony/call-finish.js`,
`src/telnyx-conversation-watchdog.js`, `src/store/state-ops.js`). Der Recon-Befund war in allen
gepruepften Punkten sachlich korrekt; keine Korrektur noetig.

- `systemPrompt(call)` baut sich aus `personaHeader`, `outboundSituation`/`inboundSituation`,
  `speechRules`, `clarificationRules`, `boundaryRules`, `mandateSection`,
  `OUTBOUND_OUTCOME_SECTION`/`INBOUND_OUTCOME_SECTION` zusammen (`src/claude.js:214-224`). Von
  diesen Sektionen ist NUR `loc.speechClause` (`src/claude.js:93-98`, z. B.
  `"Reply only in natural, spoken English."` fuer en) und `loc.styleClause(...)`
  (`src/claude.js:94`) sprachabhaengig. Alle Ueberschriften/Fliesstexte/Persona-Zeile
  (`src/claude.js:56-58,75-90,106-121,123-138`) sind Modul-Literale auf Deutsch, unabhaengig
  von `call.language`.
- `toolDefs()` (`src/claude.js:303-353`) nimmt keinen Sprachparameter entgegen; der
  Code-Kommentar in Zeile 310 bestaetigt es explizit: "Keine Sprach-Variante noetig - toolDefs
  ist locale-frei." Beide Tool-Beschreibungen (`end_call`, `take_message`) sind zu 100 %
  deutscher Text.
- Die neutrale Anrede-Klausel `NEUTRAL_ADDRESS_CLAUSE = "Sieze fremde Anrufer."`
  (`src/i18n/locales.js:66`) ist EIN modul-globaler String, den `makeStyleClause` (Zeile 91-93)
  fuer `agentStyle=null`/unbekannt in ALLEN drei Sprachen einsetzt (Fallback in
  `STYLE_CLAUSES_DE/FR/EN`, Zeilen 68-83).
- `mandateSection` (`src/claude.js:182-196`) und ihre Bausteine `MANDATE_SCOPE_RULES`
  (Zeile 149-150), `MANDATE_CONSTRAINTS_PRECEDENCE` (153), `MANDATE_FALLBACK_RULES` (154-155),
  `MANDATE_OUT_OF_SCOPE_SENTENCE` (159-166), `MANDATE_OUT_OF_SCOPE_RULES` (167-168) sind
  Modul-Konstanten ohne `loc`-Parameter; sie haengen an `call.mandate`, nicht an
  `call.language`.
- Bootstrap-/Marker-Strings `OUTBOUND_OPENING_BOOTSTRAP`/`INBOUND_OPENING_BOOTSTRAP`
  (`src/claude.js:407-408`), `SILENT_TURN_MARKER` (413), `END_CALL_WAIT_INSTRUCTION`
  (418-419) sind Modul-Konstanten ohne Sprachverzweigung an ihren Verwendungsstellen
  (Zeilen 550-561 im Tool-Loop).
- `assistantContextSection` (`src/claude.js:237-248`) rendert die Labels
  `"Worum es geht:"`, `"Verhaeltnis zum Angerufenen:"`, `"Gewuenschtes Ergebnis:"`,
  `"Wichtige Fakten:"`, `"HINTERGRUND (nur zu deiner Information):"` fest deutsch; der
  Code-Kommentar Zeile 240-241 sagt es selbst: "Labels deutsch (das Prompt-Geruest ist
  deutsch, auch fuer fr/en - nur speechClause/Datum wechseln, P0)."
- Inbound-Greeting (Budget-Engine, Live-Default): `src/routes/voice.js:265` liest
  `ctx.settings.greeting`, NICHT `locale.greetingDefault`. `settings.greeting` wird bei
  Tenant-Anlage aus `DEFAULT_GREETING` geseedet (`src/store/defaults.js:320-321,336`), einem
  hartcodiert deutschen String. `locale.greetingDefault` existiert im Bundle
  (`src/i18n/locales.js:156,205,249`, inkl. kuratierter EN-/FR-Texte), hat aber laut
  `grep -rn "greetingDefault" src/` ausser innerhalb `locales.js` selbst keinen Konsumenten -
  toter Code.
- `GREETING_TEMPLATES` (`src/self-service.js:29-33`) enthaelt genau drei Eintraege, alle drei
  deutsch (der erste ist `DEFAULT_GREETING`). `SELF_SERVICE_FREE_FIELDS` (Zeile 19) erlaubt
  `language` frei, aber `greeting` laeuft ausschliesslich ueber die Vorlagen-Whitelist gegen
  `GREETING_TEMPLATES` (`selfServicePatch`, Zeile 49-54) - Freitext wird abgelehnt.
- `LANGUAGE_FOR_COUNTRY` (`src/i18n/locales.js:268-275`) kennt nur `DE/AT/CH->de`, `FR->fr`,
  `GB/IE->en`. `languageForCountry('US')` liefert `DEFAULT_LANGUAGE` ("de")
  (`src/i18n/locales.js:278-280`). Bewusst gepinnt in `test/f1-geo-port.test.js:61-65`
  ("unbekanntes/leeres/null Land -> DEFAULT_LANGUAGE (de, R7)").
- `POST /api/onboard` leitet `language = languageForCountry(country)` aus dem
  vom Nutzer gewaehlten Herkunftsland ab (`src/routes/api-onboard.js:132-147`, Kommentar
  "User-Wahl ... EXPLIZIT, autoritativ"). Fuer `country='US'` ergibt das `language='de'`.
- `src/billing/provision-trigger.js:42` setzt ebenfalls `language: languageForCountry(homeCountry)`.
- Keine Dashboard-UI setzt `settings.language`: `grep -n "language" public/tenant.html` liefert
  nur einen Code-Kommentar (Zeile 523), `public/index.html` liefert 0 Treffer.
- `fetchPrecallBriefing({objective, ownerNotes, constraints, to, tenantId})`
  (`src/precall-briefing.js:190`) hat keinen `language`-Parameter. Der Aufrufer
  (`src/routes/api-calls.js:91`) loest `language` VOR dem Briefing-Aufruf auf
  (`const language = store.resolveCallLanguage(...)`), reicht es aber im Aufruf
  (Zeilen 116-121) nicht durch.
- `briefingTool`/`briefingSystem` (`src/precall-briefing.js:34-80,114-136`) sind vollstaendig
  deutsch und enthalten keine Sprachvorgabe fuer die vom Modell erzeugten Freitextfelder.
- `summarizeCall()` ist SAUBER lokalisiert ueber `locale.summarySystem(owner)`
  (`src/claude.js:663-665`; `src/i18n/locales.js:134-135,191,240` fuer de/fr/en, JSON-Keys
  bleiben sprachneutral).
- SMS-Wrapper (`src/telephony/call-finish.js:80-96`): `who = "Anruf bei ..."`/`"Anruf von ..."`
  und `"Action Items:"` sind hartcodiert deutsch und umwickeln die (ggf. englische)
  LLM-Summary, unabhaengig von `call.language`.
- Dashboard-Notification-Texte (`src/telephony/call-finish.js:56-60,81`):
  `"Anruf abgebrochen"`/`"Anruf nicht zustande gekommen"`/`"Neue Call Summary"` sind
  hartcodiert deutsch.
- `src/mcp-tools.js` ist DURCHGAENGIG hartcodiertes Deutsch ohne jede Sprachverzweigung:
  `requireFields`-Fehlertexte (Zeile 63), Rollenlabels `"Agent"`/`"Gegenseite"` (Zeile 110),
  `permissionsSummary` (194-198), `"Noch keine Anrufe."` (633), `"Keine offenen Action
  Items."` (645), `"Kalender ist leer."` (671-675), alle Tool-/Feldbeschreibungen. Kein
  einziger `loc()`/`language`-Bezug in der gesamten Datei bestaetigt.
- `fmt()` in `src/mcp-tools.js:48-55` ist fest auf `"de-DE"` verdrahtet
  (`new Date(iso).toLocaleString("de-DE", ...)`), genutzt in `pickCall` (Zeile 267) und
  `pickCalendarEntry` (Zeile 293) - unabhaengig von Tenant-/Call-Sprache.
- `test/mcp-tools.test.js` hat 8 Tests, `grep -n "language\|locale\|en-US\|en-GB"` liefert 0
  Treffer.
- `FAREWELL_CALIBRATION_BY_LANGUAGE` (`src/telnyx-conversation-watchdog.js:80-82`) enthaelt
  NUR einen `de`-Eintrag; jede andere Sprache faellt auf
  `FAREWELL_FALLBACK_CALIBRATION` (Zeile 78-79, das alte, unspezifische Bestandsverhalten)
  zurueck - kein Text-Leak, aber ein dokumentiertes Timing-Risiko fuer EN/FR-Abschiedssaetze.
- `test/f1-i18n-locale.test.js` (258 Zeilen) prueft `systemPrompt(de)` und `systemPrompt(fr)`
  jeweils NUR auf das Vorhandensein der einen `speechClause`-Zeile (Zeilen 212-215, 251-254).
  Es gibt in dieser Datei KEINEN `systemPrompt(enCall(...))`-Aufruf ueberhaupt (verifiziert per
  `grep -n "enCall\|LOCALES.en" test/f1-i18n-locale.test.js` - nur direkte
  `LOCALES.en.*`-Assertions, nie ueber `systemPrompt`).
- `updateSettings` (`src/store/state-ops.js:2509-2527`) validiert `language` fail-closed exakt
  gegen `SUPPORTED_LANGUAGES` (String-Gleichheit, `Array.includes`, Zeile 2492) - Grossschreibung
  wie `"EN"` wird also beim Schreiben ueber `POST /api/settings` bereits abgelehnt
  (kein Case-Folding). Der tiefere Resolver `localeFor()` (`src/i18n/locales.js:285-287`) selbst
  normalisiert Gross-/Kleinschreibung NICHT und faellt bei jedem Nicht-Treffer (auch
  Grossschreibungs-Varianten) fail-safe auf `de` zurueck.
- `resolveCallLanguage(s, {tenantId, numberRecord})` (`src/store/state-ops.js:648-651`):
  Praezedenz `settings.language || numberRecord?.language || tenant?.defaultLanguage ||
  DEFAULT_LANGUAGE`, additiv NULLABLE je Stufe - ein Legacy-`numberRecord` ohne `language`-Feld
  faellt sauber zur naechsten Stufe durch.

## Luecken

| Luecke | Schaden | Beleg | Schwere |
| --- | --- | --- | --- |
| systemPrompt-Geruest (Persona, SITUATION, SO SPRICHST DU-Ueberschrift, WENN ETWAS UNKLAR IST, DEINE GRENZEN, SO KOMMST DU ZUM ERGEBNIS, Mandats-Sektion, Bootstrap-Marker) bleibt fuer EN/FR-Calls zu ~99 % deutsch; nur `speechClause`/`styleClause` wechseln. | Priming-Risiko: Haiku bekommt bei jedem Turn ein deutsches Prompt-Geruest mit einem einzelnen eingebetteten "reply only in English"-Satz - plausible Wurzel fuer gelegentliches Deutsch-Durchschlagen bei US-Calls. Kein Test prueft heute, dass ein EN-Call durchgaengig Englisch spricht. | `src/claude.js:56-247` | S1 |
| `toolDefs()` ist zu 100 % deutsch und `toolDefs ist locale-frei` (Code-Kommentar), unabhaengig von `call.language` bei JEDEM Turn genutzt. | Tool-Descriptions wirken laut Repo-eigener Erkenntnis (RCA call-quality-chain) STAERKER aufs Modellverhalten als Prompt-Fliesstext - ein komplett deutsches Tool-Schema ist ein hochfrequentes Deutsch-Priming-Signal bei jedem EN-Call. | `src/claude.js:303-353` | S1 |
| Gesprochener Inbound-Greeting (Budget-Engine, Live-Default) ist strukturell NIE englisch/franzoesisch: `settings.greeting` kommt aus `DEFAULT_GREETING` (deutsch), `locale.greetingDefault` ist toter Code, alle drei Self-Service-Vorlagen sind deutsch. | Ein US-Anrufer hoert als ALLERERSTEN Satz eines Telefonats mit hoher Wahrscheinlichkeit Deutsch, selbst wenn `settings.language='en'` explizit gesetzt ist - der Standardfall, nicht die Ausnahme. | `src/routes/voice.js:265`; `src/store/defaults.js:320-321,336`; `src/self-service.js:29-33` | S1 |
| `languageForCountry('US')=='de'` (keine US/CA/AU-Eintraege) + keine Dashboard-UI zum Setzen von `settings.language`. | Ein selbst-onboardender US-Kunde (primaeres Zielsegment) bekommt `language='de'` zugewiesen, ohne sichtbaren Korrekturweg im Self-Service - macht alle sauber lokalisierten Bausteine (Disclosure, speechClause, summarySystem) unwirksam, weil sie nie mit `language='en'` aufgerufen werden. | `src/i18n/locales.js:268-280`; `src/routes/api-onboard.js:132-147`; `test/f1-geo-port.test.js:61-65` | S1 |
| Pre-Call-Briefing (Sonnet) hat weder Sprachparameter noch Sprachvorgabe fuer die generierten Freitextfelder. | Bei einem EN-Call kann der HINTERGRUND-Block, den der Telefon-Agent liest, in unvorhersehbarer (vermutlich deutsch-geprimter) Sprache erzeugt werden - ein Sprachbruch mitten im Kontext. Ungetestet. | `src/precall-briefing.js:114-136,190`; `src/routes/api-calls.js:91,116-121` | S2 |
| `assistantContextSection`-Labels sind hartcodiert deutsch, unabhaengig von `call.language`. | Zusaetzliches, staendiges Deutsch-Priming bei jedem EN-Call mit Kontext-Block - separater Code-Pfad zum systemPrompt-Geruest-Problem. | `src/claude.js:237-248` | S2 |
| `src/mcp-tools.js` (Tool-/Feldbeschreibungen, Fehlermeldungen, Text-Ausgaben, Datumsformat) ist komplett unlokalisiert deutsch. | Ein US-Endnutzer, der Hermes ueber den claude.ai-MCP-Connector auf Englisch bedient, sieht bei jedem Tool-Aufruf deutsche Beschreibungen/Fehlermeldungen/Statuszeilen und deutsch formatierte Datumswerte - durchgaengiger Bruch fuer die Kern-Nutzungsart "Hermes aus Claude heraus steuern", 0 Sprach-Assertions in `mcp-tools.test.js`. | `src/mcp-tools.js` (gesamte Datei); `test/mcp-tools.test.js` (0 Treffer fuer language/locale) | S1 |
| SMS-Summary-Wrapper und Dashboard-Notification-Texte wickeln die (ggf. englische) LLM-Summary in hartcodiert deutsche Labels. | US-Tenant/Owner bekommt nach einem englischen Anruf eine SMS/Notification mit deutschem Rahmentext um englischen Kerninhalt - direkt sichtbarer Sprachbruch fuer den Produktbesitzer selbst. | `src/telephony/call-finish.js:56-60,80-96` | S2 |
| Kein Test prueft end-to-end, dass ein EN-Call konsistent Englisch spricht (Prompt-Geruest + Tool-Descriptions + Greeting + Briefing zusammen). | Bestehende i18n-Tests suggerieren "EN ist unterstuetzt", decken aber genau an den Stellen NICHT ab, wo noch Deutsch steht - das eigentliche Produktrisiko bleibt ungemessen. | `test/f1-i18n-locale.test.js` (kein systemPrompt(en)-Test, verifiziert per grep) | S1 |

## Tests

### PROMPT-01 - systemPrompt(en) enthaelt weiterhin ein durchgaengig deutsches Geruest
- **Prioritaet**: P0
- **Modus**: offline (npm test / node)
- **Vorbedingung**: `DATA_DIR` auf Temp-Verzeichnis (Muster `tempDataDir`/`seedState` aus
  `test/helpers.js`), ein Tenant mit `ownerName` gesetzt, ein Call mit `language: "en"`
  (`seedCall({tenantId, language: "en", direction: "inbound"})`).
- **Schritte**:
  1. `systemPrompt(enCall)` aufrufen (analog `test/f1-i18n-locale.test.js` fuer de/fr).
  2. Pruefen, dass `LOCALES.en.speechClause` ("Reply only in natural, spoken English.") im
     Prompt vorkommt.
  3. Zusaetzlich pruefen: die deutschen Sektions-Ueberschriften `"SITUATION:"`,
     `"SO SPRICHST DU:"`, `"WENN ETWAS UNKLAR IST:"`, `"DEINE GRENZEN:"`,
     `"SO KOMMST DU ZUM ERGEBNIS:"` sind ALLE weiterhin im Prompt enthalten (dokumentiert den
     IST-Zustand, nicht das Wunsch-Verhalten).
- **Erwartetes Ergebnis**: Schritt 2 gruen (Regressionsschutz, existiert schon fuer de/fr).
  Schritt 3 ist HEUTE ebenfalls gruen (alle fuenf Ueberschriften stecken im EN-Prompt) - das
  ist der Beleg fuer die Luecke, nicht ihr Fix. Sobald das Prompt-Geruest lokalisiert wird,
  MUSS Schritt 3 rot werden (die deutschen Ueberschriften verschwinden aus dem EN-Prompt) -
  dieser Test ist damit der Fixpunkt fuer die Lokalisierung.
- **Verifikation**: `node --test test/f1-i18n-locale.test.js` (Erweiterung dieser Datei um
  einen `enCall`-Block analog zum vorhandenen `frCall`-Block).
- **Heute erwartbar**: gruen (dokumentiert den Bestand: EN-Prompt traegt deutsche
  Ueberschriften; genau das ist der Launch-Blocker, kein Testfehler).
- **Belegt durch**: src/claude.js:56-247; test/f1-i18n-locale.test.js (kein bestehender
  enCall-Test, grep-bestaetigt)

### PROMPT-02 - toolDefs() bleibt fuer JEDE Sprache identisch deutsch
- **Prioritaet**: P0
- **Modus**: offline (npm test / node)
- **Vorbedingung**: keine (reine Funktions-Signatur-Pruefung, kein Store/Config noetig fuer
  `toolDefs` selbst - Import aus `src/claude.js` erfordert aber den bestehenden
  `DATA_DIR`-Bootstrap wie in `f1-i18n-locale.test.js`).
- **Schritte**:
  1. `toolDefs()` aufrufen und pruefen, dass die Funktion 0 Argumente entgegennimmt
     (`toolDefs.length === 0`).
  2. `description` von `end_call` und `take_message` auf deutsche Schluesselwoerter pruefen
     (z. B. `"Beendet das Telefonat"`, `"Nimmt eine Nachricht"`).
  3. Pruefen, dass es KEINE Variante von `toolDefs(language)` gibt, die englische
     Beschreibungen liefert (Aufruf mit `toolDefs("en")` liefert dieselbe Ausgabe wie
     `toolDefs()`, weil das zweite Argument ignoriert wird).
- **Erwartetes Ergebnis**: `toolDefs.length === 0`; beide `description`-Strings enthalten
  ausschliesslich deutschen Text; `toolDefs("en")` deep-equal `toolDefs()`.
- **Verifikation**: neuer Test in `test/f1-i18n-locale.test.js` oder neue Datei
  `test/prompt-tooldefs-locale.test.js`; `node --test test/f1-i18n-locale.test.js`.
- **Heute erwartbar**: gruen (dokumentiert den IST-Zustand "locale-frei" exakt wie im
  Code-Kommentar behauptet - der Test faengt eine kuenftige stille Teil-Lokalisierung, die
  DE/EN inkonsistent macht).
- **Belegt durch**: src/claude.js:303-353 (toolDefs), Zeile 310 (Kommentar
  "toolDefs ist locale-frei")

### PROMPT-03 - Inbound-Greeting fuer einen EN-Tenant ist strukturell deutsch
- **Prioritaet**: P0
- **Modus**: offline (curl gegen lokalen Server, `SKIP_TWILIO_SIGNATURE_CHECK=true`)
- **Vorbedingung**: Server lokal mit `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`,
  Tenant mit `settings.language = "en"` UND `settings.greeting` unveraendert (Default aus
  Tenant-Anlage, keine manuelle Korrektur), eine aktive Nummer fuer diesen Tenant.
- **Schritte**:
  1. `curl -X POST http://localhost:3999/voice/incoming -d "To=<Tenant-Nummer>" -d "From=+491701234567"`
     (bzw. `/voice/incoming/telnyx` je nach Provider-Route).
  2. TwiML/TeXML-Antwort auf den `<Say>`-Text pruefen.
- **Erwartetes Ergebnis**: Der gesprochene Begruessungstext enthaelt `"Hallo, hier ist der
  KI-Assistent von"` (aus `DEFAULT_GREETING`) - NICHT `"Hi, this is the AI assistant of"`
  (der kuratierte EN-Text aus `locale.greetingDefault`), obwohl `settings.language="en"`
  gesetzt ist.
- **Verifikation**: `curl`-Smoke-Test wie oben; alternativ ein neuer Integrationstest nach dem
  Muster bestehender Voice-Route-Tests (Server als Kindprozess, `PORT=0`,
  `DATA_DIR`-Override), der `store.tenantContext` mit `settings.language="en"` seedet und die
  gerenderte `<Say>`-Zeile parst.
- **Heute erwartbar**: rot bezogen auf das GEWUENSCHTE Verhalten (EN-Greeting erwartet),
  gruen bezogen auf das TATSAECHLICHE Verhalten (DE-Greeting kommt raus) - dieser Test soll
  als Launch-Gate rot bleiben, bis die Greeting-Kette an `language` gekoppelt ist.
- **Belegt durch**: src/routes/voice.js:265; src/store/defaults.js:320-321,336

### PROMPT-04 - Self-Onboarding mit country='US' liefert language='de'
- **Prioritaet**: P0
- **Modus**: offline (npm test, bestehende Suite erweitern)
- **Vorbedingung**: `test/f1-geo-onboard.test.js` als Vorbild (Onboard-Route-Test); Request-Body
  mit `country: "US"`, `GEO_ENABLED` aus (kein IP-Vorschlag noetig).
- **Schritte**:
  1. `POST /api/onboard` mit `{country: "US", ...Pflichtfelder}` aufrufen.
  2. Den persistierten Tenant-/Number-Record auf `language` pruefen.
- **Erwartetes Ergebnis**: `language === "de"` (heutiger Ist-Zustand, `languageForCountry('US')`
  liefert `DEFAULT_LANGUAGE`).
- **Verifikation**: `node --test test/f1-geo-onboard.test.js` bzw. neuer Testfall dort;
  ergaenzend `node --test test/f1-geo-port.test.js` (dort bereits als Pin vorhanden, Zeile
  61-65).
- **Heute erwartbar**: gruen (Verhalten ist bereits gepinnt) - das ist der eigentliche
  Launch-Blocker: ein funktionierender, aber fuer den US-Markt falscher Pin. Dieser Test
  MUSS vor US-Launch auf `language === "en"` umgestellt werden (Produktentscheidung noetig,
  siehe offene Frage).
- **Belegt durch**: src/i18n/locales.js:268-280; src/routes/api-onboard.js:132-147;
  test/f1-geo-port.test.js:61-65

### PROMPT-05 - Kein Dashboard-Weg, settings.language selbst zu korrigieren
- **Prioritaet**: P1
- **Modus**: manuell (Dashboard-Sichtpruefung) + offline (grep als Regressionsschutz)
- **Vorbedingung**: `public/tenant.html` und `public/index.html` im aktuellen Stand.
- **Schritte**:
  1. `grep -n "language" public/tenant.html public/index.html` ausfuehren.
  2. Tenant-Dashboard im Browser oeffnen (lokal, `npm start`), nach einem Sprach-Auswahl-Element
     suchen (Select/Radio/Toggle fuer "Language"/"Sprache").
- **Erwartetes Ergebnis**: `grep` liefert in `public/tenant.html` GENAU einen Treffer (Zeile
  523, ein Code-Kommentar, kein UI-Element) und in `public/index.html` 0 Treffer. Im Browser
  ist kein bedienbares Sprach-Auswahl-Element vorhanden.
- **Verifikation**: `grep -n "language" public/tenant.html public/index.html | wc -l` ->
  erwartet `1`.
- **Heute erwartbar**: gruen (dokumentiert die Luecke als bestehenden Zustand; wird rot,
  sobald jemand faelschlich ein UI-Element hinzufuegt, ohne den Test anzupassen - dann als
  Anlass zur bewussten Testkorrektur, nicht als Fehlalarm).
- **Belegt durch**: public/tenant.html:523 (Kommentar); public/index.html (0 Treffer)

### PROMPT-06 - fetchPrecallBriefing bekommt call.language nicht durchgereicht
- **Prioritaet**: P1
- **Modus**: offline (npm test, Signatur-/Aufruf-Pruefung)
- **Vorbedingung**: keine Netzwerkaufrufe noetig - reine Code-Struktur-Pruefung.
- **Schritte**:
  1. `fetchPrecallBriefing.length` bzw. die destrukturierten Parameter-Namen der Funktion
     pruefen (`objective, ownerNotes, constraints, to, tenantId`).
  2. In `src/routes/api-calls.js` den Aufruf-Block (Zeilen 116-121) auf das Vorhandensein
     eines `language`-Keys im uebergebenen Objekt pruefen (Quelltext-Grep, kein Laufzeittest
     noetig, da `language` bereits vor dem Aufruf aufgeloest wird, Zeile 91).
- **Erwartetes Ergebnis**: Der Parametername `language` taucht WEDER in der
  `fetchPrecallBriefing`-Signatur NOCH im Aufruf-Objekt auf.
- **Verifikation**: `grep -n "language" src/precall-briefing.js` -> 0 Treffer;
  `sed -n '116,121p' src/routes/api-calls.js | grep -c language` -> `0`.
- **Heute erwartbar**: gruen (Luecke besteht, grep bestaetigt 0 Treffer).
- **Belegt durch**: src/precall-briefing.js:190; src/routes/api-calls.js:91,116-121

### PROMPT-07 - Briefing-System-Prompt gibt dem Modell keine Sprachvorgabe fuer die Freitextfelder
- **Prioritaet**: P1
- **Modus**: offline (npm test, ergaenzt `test/cq-p8-briefing.test.js`)
- **Vorbedingung**: bestehendes Test-Setup aus `test/cq-p8-briefing.test.js`/
  `cq-p8-briefing-http.test.js` (LLM-Antwort gemockt).
- **Schritte**:
  1. `briefingSystem(toolNames)` mit einer Beispiel-Toolliste aufrufen.
  2. Den Rueckgabe-String auf das Vorkommen von `"Englisch"`, `"English"`, `"language"` oder
     `"Sprache"` als Anweisung fuer den Output pruefen.
- **Erwartetes Ergebnis**: Keines dieser Schluesselwoerter kommt in einem Kontext vor, der dem
  Modell eine Ausgabesprache vorgibt (der String ist komplett deutsch und enthaelt keine
  "antworte auf Englisch, wenn ..."-Klausel).
- **Verifikation**: `grep -in "english\|antworte auf\|reply in" src/precall-briefing.js` -> 0
  Treffer.
- **Heute erwartbar**: gruen (bestaetigt die Luecke).
- **Belegt durch**: src/precall-briefing.js:34-80,114-136

### PROMPT-08 - assistantContextSection-Labels bleiben deutsch fuer einen EN-Call
- **Prioritaet**: P1
- **Modus**: offline (npm test, Erweiterung von `test/f1-i18n-locale.test.js` oder eigener
  Assistant-Context-Testdatei, falls vorhanden - Verifikation zeigt: keine dedizierte Datei
  gefunden, am naechsten ist `assistant-context-render` laut Code-Kommentar Zeile 62/65 in
  claude.js, ggf. `test/assistant-context*.test.js` pruefen)
- **Vorbedingung**: `config.tenancy.assistantContextEnabled = true`
  (`ASSISTANT_CONTEXT_ENABLED=true` im Testprozess), ein Call mit `language: "en"` und
  gesetztem `call.context = {summary: "Test", recipient_relationship: "Freund",
  desired_outcome: "Termin", key_facts: ["Fakt 1"]}`.
- **Schritte**:
  1. `systemPrompt(enCallWithContext)` aufrufen.
  2. Pruefen, dass `"HINTERGRUND (nur zu deiner Information):"`, `"Worum es geht:"`,
     `"Verhaeltnis zum Angerufenen:"`, `"Gewuenschtes Ergebnis:"`, `"Wichtige Fakten:"` im
     Prompt vorkommen.
- **Erwartetes Ergebnis**: Alle fuenf deutschen Labels sind im EN-Prompt vorhanden (dokumentiert
  den Ist-Zustand).
- **Verifikation**: `node --test test/f1-i18n-locale.test.js` (nach Erweiterung) bzw. neue
  Datei `test/prompt-assistant-context-locale.test.js`.
- **Heute erwartbar**: gruen (Luecke besteht wie belegt).
- **Belegt durch**: src/claude.js:237-248

### PROMPT-09 - mcp-tools.js enthaelt keine einzige loc()/language-Verzweigung
- **Prioritaet**: P0
- **Modus**: offline (grep, deterministisch)
- **Vorbedingung**: keine.
- **Schritte**:
  1. `grep -n "loc(\|localeFor\|call.language\|settings.language" src/mcp-tools.js` ausfuehren.
- **Erwartetes Ergebnis**: 0 Treffer.
- **Verifikation**: `grep -c "loc(\|localeFor\|call.language\|settings.language" src/mcp-tools.js`
  -> `0`.
- **Heute erwartbar**: gruen (bestaetigt die durchgaengige Deutsch-Verdrahtung als Ist-Zustand;
  wird zum Fixpunkt, sobald Lokalisierung eingefuehrt wird - dann MUSS der Treffer > 0 werden
  und dieser Test entsprechend umgeschrieben werden).
- **Belegt durch**: src/mcp-tools.js (gesamte Datei, u. a. Zeilen 63,110,194-198,633,645,671-675)

### PROMPT-10 - fmt() in mcp-tools.js formatiert Datumswerte immer als de-DE
- **Prioritaet**: P1
- **Modus**: offline (npm test, Erweiterung von `test/mcp-tools.test.js`)
- **Vorbedingung**: `captureTools(ctx)`-Muster aus `test/mcp-tools.test.js` (Zeilen 22-32),
  Gateway-Mock liefert einen `list_calls`-Body mit einem Call, dessen Tenant
  `settings.language="en"` traegt (bzw. ein Call-Objekt mit `startedAt` als ISO-String).
- **Schritte**:
  1. `list_calls`-Handler ueber den gemockten Gateway aufrufen.
  2. Den `startedAt`-String im Toolergebnis parsen/inspizieren.
- **Erwartetes Ergebnis**: Der Datumsstring folgt dem `de-DE`-Kurzformat (z. B.
  `"Mo., 22.07."`-artiges Muster mit Punkt-getrennten Feldern), NICHT dem `en-GB`- oder
  `en-US`-Format, unabhaengig vom Tenant/Call-`language`-Feld.
- **Verifikation**: neuer Test in `test/mcp-tools.test.js` (Vorbild: bestehende
  `captureTools`/`startGatewayMock`-Helfer); `node --test test/mcp-tools.test.js`.
- **Heute erwartbar**: gruen (fmt() ist hart auf "de-DE" verdrahtet, Zeile 48-55, unabhaengig
  vom Input).
- **Belegt durch**: src/mcp-tools.js:48-55,267,293

### PROMPT-11 - mcp-tools.js Text-Ausgaben bleiben deutsch, egal welche Sprache der Aufrufer nutzt
- **Prioritaet**: P1
- **Modus**: offline (npm test, Erweiterung von `test/mcp-tools.test.js`)
- **Vorbedingung**: `captureTools(ctx)`-Muster, Gateway-Mock liefert leere Listen
  (`calendar: []`, `calls: []`, `actionItems: []`).
- **Schritte**:
  1. `get_calendar` mit leerem Kalender aufrufen -> Text pruefen.
  2. `list_calls` mit leerer Liste aufrufen -> Text pruefen.
  3. `list_action_items` mit leerer Liste aufrufen -> Text pruefen.
- **Erwartetes Ergebnis**: Texte sind exakt `"Kalender ist leer."`, `"Noch keine Anrufe."`,
  `"Keine offenen Action Items."` - unabhaengig davon, ob der MCP-Client/das aufrufende
  Claude-Modell auf Englisch kommuniziert.
- **Verifikation**: `node --test test/mcp-tools.test.js` (Erweiterung).
- **Heute erwartbar**: gruen (bestaetigt Ist-Zustand, siehe Ist-Stand-Belege Zeilen
  633,645,671-675).
- **Belegt durch**: src/mcp-tools.js:633,645,671-675

### PROMPT-12 - SMS-Zusammenfassung nach einem EN-Call traegt deutsche Rahmen-Labels
- **Prioritaet**: P1
- **Modus**: offline (npm test, Erweiterung eines call-finish-Tests, falls vorhanden - sonst
  neue Datei `test/prompt-sms-wrapper-locale.test.js`)
- **Vorbedingung**: Tenant mit `settings.language="en"`, ein abgeschlossener Outbound-Call mit
  Transkript, `summarizeCall` liefert (gemockt) eine englische Summary
  (`"Called the restaurant, table booked for 8pm."`) + `actionItems: ["Call back tomorrow"]`.
- **Schritte**:
  1. `finishCall(call)` (bzw. den entsprechenden internen Pfad) mit obigem Zustand ausfuehren.
  2. Den erzeugten SMS-Body inspizieren.
- **Erwartetes Ergebnis**: Der SMS-Body enthaelt `"Anruf bei "` (deutsches Praefix) gefolgt von
  der englischen Summary, und bei vorhandenen Action-Items den Praefix `"Action Items:"`
  (identisch in beiden Sprachen, aber unbeabsichtigt - kein `"Called: "`/kein
  lokalisiertes Aequivalent).
- **Verifikation**: neuer/erweiterter Test gegen `finishCall`/den SMS-Bau-Pfad in
  `src/telephony/call-finish.js`; `node --test test/<datei>.test.js`.
- **Heute erwartbar**: gruen (bestaetigt Ist-Zustand aus den Facts).
- **Belegt durch**: src/telephony/call-finish.js:80-96

### PROMPT-13 - Dashboard-Notification-Titel bleiben deutsch fuer EN-Calls
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: wie PROMPT-12, zusaetzlich ein Call mit `status !== "completed"`
  (z. B. `"cancelled"`).
- **Schritte**:
  1. `finishCall(call)` mit `call.status = "cancelled"` ausfuehren.
  2. Den erzeugten `store.addNotification(...)`-Aufruf (Titel + Text) pruefen.
- **Erwartetes Ergebnis**: Titel ist exakt `"Anruf abgebrochen"` (nicht `"Call cancelled"`),
  unabhaengig von `call.language`/`tenant.defaultLanguage`.
- **Verifikation**: neuer/erweiterter Test; `node --test test/<datei>.test.js`.
- **Heute erwartbar**: gruen (bestaetigt Ist-Zustand).
- **Belegt durch**: src/telephony/call-finish.js:56-60

### PROMPT-14 - End-to-End: ein simulierter EN-Call spricht an mindestens einer Stelle nachweisbar Deutsch
- **Prioritaet**: P0
- **Modus**: offline (Integrationstest, Server als Kindprozess wie bestehende
  Integrationstests) mit LLM-Mock/Stub ODER manuell mit echtem Haiku-Call (siehe PROMPT-23)
- **Vorbedingung**: Server lokal (`PORT=0`, `DATA_DIR`-Override), Tenant mit
  `settings.language="en"`, `SKIP_TWILIO_SIGNATURE_CHECK=true`. Falls ein LLM-Stub genutzt
  wird: Stub liefert eine realistische EN-Antwort, das Prompt-System bleibt aber das echte
  (kein Mock von `systemPrompt`/`toolDefs`).
- **Schritte**:
  1. Inbound-Call simulieren (`/voice/incoming`), Greeting-Text erfassen (PROMPT-03).
  2. `systemPrompt(call)` fuer den erzeugten Call erfassen (PROMPT-01) und auf deutsche
     Ueberschriften pruefen.
  3. `toolDefs()` erfassen (PROMPT-02) und auf deutsche Beschreibungen pruefen.
  4. Nach Call-Ende: SMS-Body (PROMPT-12) und Notification-Titel (PROMPT-13) erfassen.
  5. Eine Zusammenzaehlung: Anzahl der Stellen, an denen deutscher Text in den fuer den
     Anrufer/Owner sichtbaren ODER dem Modell zugefuehrten Kanaelen auftaucht.
- **Erwartetes Ergebnis**: Die Zaehlung ist > 0 (heute: mindestens 4 der 5 Kanaele - Greeting,
  Prompt-Geruest, toolDefs, SMS/Notification - tragen deutschen Text). Dieser Test ist ein
  AGGREGATIONS-Test ueber PROMPT-01/02/03/12/13 und dient als einzelner Launch-Gate-Indikator
  ("ist der EN-Call-Pfad frei von hartcodiertem Deutsch? Ja/Nein" statt vieler Einzelbefunde).
- **Verifikation**: neue Datei `test/prompt-en-call-e2e.test.js`, die die o. g. Einzelpruefungen
  buendelt und EINE zusammenfassende Assertion traegt (`germanLeakCount === 0` als Ziel-Wert
  fuer den Launch, heute bewusst `> 0` dokumentiert).
- **Heute erwartbar**: rot bezogen auf das Launch-Ziel (`germanLeakCount === 0`); der Test
  sollte bewusst so geschrieben sein, dass er HEUTE fehlschlaegt und erst nach der
  vollstaendigen EN-Lokalisierung gruen wird (Launch-Gate).
- **Belegt durch**: src/claude.js:56-247,303-353; src/routes/voice.js:265;
  src/telephony/call-finish.js:56-60,80-96 (Summen-Beleg der Einzelbefunde)

### PROMPT-15 - Edge Case: unbekannter Sprachcode faellt fail-safe auf de zurueck (Regressionsschutz)
- **Prioritaet**: P2
- **Modus**: offline (npm test, bereits vorhanden)
- **Vorbedingung**: keine.
- **Schritte**:
  1. `localeFor("xx")`, `localeFor(undefined)`, `localeFor(null)`, `localeFor("")` aufrufen.
- **Erwartetes Ergebnis**: alle vier liefern `LOCALES.de` (`.language === "de"`).
- **Verifikation**: `node --test test/f1-i18n-locale.test.js` (Test "localeFor: unbekannte/
  fehlende/null Sprache faellt fail-safe auf de (R7)", bereits vorhanden, Zeilen 21-26).
- **Heute erwartbar**: gruen (bestehender, bestandener Test - reine Bestandsaufnahme, kein
  neuer Test noetig).
- **Belegt durch**: src/i18n/locales.js:285-287; test/f1-i18n-locale.test.js:21-26

### PROMPT-16 - Edge Case: Grossschreibung "EN" wird von localeFor NICHT normalisiert
- **Prioritaet**: P2
- **Modus**: offline (npm test, neuer Testfall)
- **Vorbedingung**: keine.
- **Schritte**:
  1. `localeFor("EN")` aufrufen (Grossschreibung, wie sie z. B. bei einem rohen, fehlerhaften
     `POST /api/settings`-Body mit `{language: "EN"}` entstehen KOENNTE, falls dieser die
     Enum-Validierung in `updateSettings` umgeht - z. B. direkter DB-/JSON-Store-Edit).
  2. Ergebnis pruefen.
- **Erwartetes Ergebnis**: `localeFor("EN").language === "de"` (kein Case-Folding, fail-safe
  Fallback greift wie bei jedem unbekannten String). Ergaenzend: `updateSettings` lehnt
  `{language: "EN"}` regulaer ab (`isOptionalEnumOverride` prueft `Array.includes`, das ist
  case-sensitiv) - ein Aufrufer, der die REST-API nutzt, kann diesen Zustand also gar nicht
  ueber `POST /api/settings` erzeugen, wohl aber ueber einen direkten Store-Edit/Migration.
- **Verifikation**: neuer Test in `test/f1-i18n-locale.test.js`; zusaetzlich
  `node --test test/i9-self-service.test.js` (bestehende Enum-Validierung fuer `language`
  nicht separat auf Grossschreibung geprueft - Luecke, siehe offene Empfehlung unten).
- **Heute erwartbar**: gruen (fail-safe-Fallback funktioniert bereits korrekt fuer diesen
  Fall, dokumentiert nur die fehlende Normalisierung als bewusst hingenommenes Verhalten).
- **Belegt durch**: src/i18n/locales.js:285-287; src/store/state-ops.js:2490-2493,2509-2527

### PROMPT-17 - Edge Case: Legacy-Nummer ohne language-Feld durchlaeuft die Praezedenzkette korrekt
- **Prioritaet**: P1
- **Modus**: offline (npm test, neuer Testfall)
- **Vorbedingung**: `seedState` mit einem `numberRecord`, das KEIN `language`-Feld traegt
  (simuliert Bestandsdaten vor F1), `tenant.defaultLanguage = "en"` gesetzt,
  `settings.language` NICHT gesetzt (`null`/`undefined`).
- **Schritte**:
  1. `store.resolveCallLanguage(s, {tenantId, numberRecord})` aufrufen.
- **Erwartetes Ergebnis**: liefert `"en"` (dritte Praezedenz-Stufe `tenant?.defaultLanguage`
  greift, die fehlende `numberRecord.language` wird sauber uebersprungen, kein Crash bei
  `numberRecord?.language` auf einem Objekt ohne dieses Feld).
- **Verifikation**: neuer Test, Vorbild `test/f1-geo-store.test.js`;
  `node --test test/f1-geo-store.test.js`.
- **Heute erwartbar**: gruen (additiv-nullable Praezedenzkette ist bereits so gebaut,
  `src/store/state-ops.js:648-651`).
- **Belegt durch**: src/store/state-ops.js:640-651

### PROMPT-18 - Edge Case: paralleler EN- und DE-Call faerben sich nicht gegenseitig ab
- **Prioritaet**: P2
- **Modus**: offline (npm test, Erweiterung von `test/f1-i18n-locale.test.js`)
- **Vorbedingung**: wie PROMPT-01, zusaetzlich ein deutscher Call im selben Testlauf.
- **Schritte**:
  1. `systemPrompt(deCall())` UND `systemPrompt(enCall())` in derselben Test-Ausfuehrung
     nacheinander (bzw. Promise.all fuer echte Nebenlaeufigkeit) aufrufen.
  2. Pruefen, dass der DE-Prompt weiterhin `DE_SPEECH_CLAUSE` traegt und NICHT
     `LOCALES.en.speechClause`, und umgekehrt.
- **Erwartetes Ergebnis**: beide Prompts bleiben strikt getrennt (kein Shared-State-Leck ueber
  `promptInputs`/`localeFor`, die pro Aufruf neu aufloesen).
- **Verifikation**: `node --test test/f1-i18n-locale.test.js` (Analogie zum bestehenden Test
  "Gegenprobe: ein FR-Call faerbt einen parallelen DE-Call nicht ab", Zeilen 253-258 -
  Erweiterung um EN).
- **Heute erwartbar**: gruen (Resolver ist call-lokal, kein Modul-globaler State fuer
  aufgeloeste Locale; bereits fuer FR/DE bewiesen).
- **Belegt durch**: src/claude.js:29-36 (promptInputs, `loc = localeFor(call.language)` pro
  Aufruf); test/f1-i18n-locale.test.js:253-258 (FR/DE-Analogtest)

### PROMPT-19 - GREETING_TEMPLATES sind alle drei deutsch, keine EN/FR-Vorlage waehlbar
- **Prioritaet**: P1
- **Modus**: offline (npm test, neuer Testfall)
- **Vorbedingung**: keine.
- **Schritte**:
  1. `GREETING_TEMPLATES` importieren und jeden Eintrag auf deutsche Schluesselwoerter pruefen
     (`"KI-Assistent"`, `"Nachricht"`).
  2. Pruefen, dass `LOCALES.en.greetingDefault`/`LOCALES.fr.greetingDefault` NICHT in
     `GREETING_TEMPLATES` enthalten sind.
- **Erwartetes Ergebnis**: alle drei Eintraege sind deutsch; die kuratierten EN-/FR-Greetings
  aus dem Locale-Bundle fehlen in der Self-Service-Auswahlliste.
- **Verifikation**: neuer Test in `test/i9-self-service.test.js` (Erweiterung); `node --test
  test/i9-self-service.test.js`.
- **Heute erwartbar**: gruen (bestaetigt Ist-Zustand, `src/self-service.js:29-33`).
- **Belegt durch**: src/self-service.js:29-33; src/i18n/locales.js:156,205,249

### PROMPT-20 - Gemischter Zustand: settings.language="en" aendert das Greeting NICHT
- **Prioritaet**: P0
- **Modus**: offline (npm test, Integrationstest analog `test/i9-self-service.test.js`)
- **Vorbedingung**: Tenant B mit `settings.language` per `POST /api/settings` (Self-Service)
  explizit auf `"en"` gesetzt; `settings.greeting` bleibt auf dem geseedeten
  `DEFAULT_GREETING` (keine manuelle Greeting-Aenderung).
- **Schritte**:
  1. `selfServicePatch({language: "en"}, current)` bzw. den vollen Self-Service-Request
     ausfuehren.
  2. Danach `store.tenantContext(tenantId).settings.greeting` lesen.
- **Erwartetes Ergebnis**: `settings.language === "en"`, ABER `settings.greeting` ist weiterhin
  der deutsche `DEFAULT_GREETING`-Text - die beiden Felder sind vollstaendig entkoppelt.
- **Verifikation**: neuer Test in `test/i9-self-service.test.js`; `node --test
  test/i9-self-service.test.js`.
- **Heute erwartbar**: gruen (bestaetigt die strukturelle Entkopplung - das ist der
  Kern-Launch-Blocker aus PROMPT-03/PROMPT-05 in einem einzigen deterministischen Test).
- **Belegt durch**: src/self-service.js:19,29-33; src/store/defaults.js:320-321

### PROMPT-21 - Farewell-Delay-Kalibrierung nur fuer 'de' gemessen; EN/FR nutzen die alte, ungemessene Fallback-Kalibrierung
- **Prioritaet**: P2
- **Modus**: offline (npm test, Erweiterung eines bestehenden Watchdog-Tests)
- **Vorbedingung**: `test/telnyx-stab-p9-watchdog.test.js` als Ausgangspunkt (noch nicht im
  Detail auf Sprachaufloesung geprueft laut Recon).
- **Schritte**:
  1. Farewell-Delay-Berechnung mit `language: "de"` UND einem Abschiedssatz bekannter Laenge
     aufrufen -> Delay X.
  2. Dieselbe Berechnung mit `language: "en"` (identischer Satz, gleiche Laenge) aufrufen ->
     Delay Y.
  3. Pruefen, dass Y NICHT die de-Kalibrierung nutzt (`baseMs=500, msPerChar=65, minMs=1500`),
     sondern den Fallback (`baseMs=1500, msPerChar=70, minMs=3000`).
- **Erwartetes Ergebnis**: X != Y bei identischer Zeichenlaenge (Y ist tendenziell laenger,
  wegen des hoeheren Fallback-Sockels); Y entspricht exakt der Fallback-Formel.
- **Verifikation**: neuer/erweiterter Test in `test/telnyx-stab-p9-watchdog.test.js`;
  `node --test test/telnyx-stab-p9-watchdog.test.js`.
- **Heute erwartbar**: gruen (Fallback-Verhalten ist explizit so gebaut, Kommentar bestaetigt
  es; das Risiko ist Timing, nicht Korrektheit - siehe Schaden-Spalte in den Luecken).
- **Belegt durch**: src/telnyx-conversation-watchdog.js:41-86

### PROMPT-22 - mandateSection bleibt deutsch, auch wenn ein EN-Call ein Mandat traegt
- **Prioritaet**: P1
- **Modus**: offline (npm test, Erweiterung von `test/f1-i18n-locale.test.js`)
- **Vorbedingung**: EN-Call mit `call.mandate = {decide_freely: "bis 50 Euro Aufpreis",
  on_out_of_scope: "take_message"}`.
- **Schritte**:
  1. `systemPrompt(enCallWithMandate)` aufrufen.
  2. Pruefen, dass `"DEIN SPIELRAUM:"`, `"AUSSERHALB DEINES SPIELRAUMS:"` und der
     `MANDATE_OUT_OF_SCOPE_SENTENCE`-Text im Prompt stehen.
- **Erwartetes Ergebnis**: alle Mandats-Labels/-Saetze sind deutsch, unabhaengig von
  `call.language`.
- **Verifikation**: neuer Testfall in `test/f1-i18n-locale.test.js`; `node --test
  test/f1-i18n-locale.test.js`.
- **Heute erwartbar**: gruen (bestaetigt Ist-Zustand, keine `loc`-Verzweigung in
  `mandateSection`).
- **Belegt durch**: src/claude.js:149-168,182-196

### PROMPT-23 - Manueller Pre-Launch-Smoke-Call: echter EN-Anruf auf Deutsch-Drift abhoeren
- **Prioritaet**: P0
- **Modus**: live (echter Anruf, echte DID, kostet Geld - NUR mit expliziter Freigabe des
  Owners direkt vor Launch durchfuehren)
- **Vorbedingung**: `PAYMENT_ENABLED`/Provisioning aktiv, ein Test-Tenant mit
  `settings.language="en"`, eine echte US- oder GB-Zielnummer (eigenes Zweitgeraet, KEIN
  fremder Teilnehmer wegen Kosten/Belaestigung), `ALLOWED_COUNTRY_CODES` bzw. die
  Outbound-Gates so konfiguriert, dass das Zielland erlaubt ist.
- **Schritte**:
  1. Ueber `place_call`/Dashboard einen Outbound-Testanruf mit `language="en"` und einem
     einfachen Auftrag ausloesen (z. B. "ask if they deliver on Sundays").
  2. Das komplette Gespraech (Disclosure, Opening, mind. 3 Turns) live mithoeren oder als
     Aufzeichnung/Transkript nachpruefen.
  3. Auf JEDES deutsche Wort/jeden deutschen Satzfetzen im GESPROCHENEN Output achten
     (nicht im Prompt - das ist PROMPT-01/14).
- **Erwartetes Ergebnis**: Kein deutsches Wort im gesprochenen Output. Falls doch: der genaue
  Turn/die Stelle wird dokumentiert (Transkript-Zeile, Audiozeitstempel) als Beleg fuer
  Prompt-Priming-Leck.
- **Verifikation**: manuelle Protokollierung (Transkript-Export ueber `get_transcript`
  MCP-Tool oder Dashboard), kein automatisiertes Kommando.
- **Heute erwartbar**: unbekannt (bisher kein dokumentierter EN-Testanruf in den Memory-Notizen
  des Projekts; das Risiko aus PROMPT-01 ist real, aber ob es sich in gesprochenem Output
  manifestiert, ist ohne echten Call nicht belegbar).
- **Belegt durch**: src/claude.js:56-247 (Priming-Hypothese); keine bestehende Live-Call-
  Evidenz fuer EN gefunden

### PROMPT-24 - Fail-closed: localeFor mit unerwartetem Typ (Zahl/Objekt) crasht nicht
- **Prioritaet**: P2
- **Modus**: offline (npm test, neuer Testfall)
- **Vorbedingung**: keine.
- **Schritte**:
  1. `localeFor(42)`, `localeFor({lang: "en"})`, `localeFor(["en"])` aufrufen.
- **Erwartetes Ergebnis**: kein Crash, alle drei Aufrufe liefern `LOCALES.de`
  (`LOCALES[language]` ist bei Nicht-String-Keys/Nicht-Treffern `undefined` -> `|| LOCALES[DEFAULT_LANGUAGE]`
  greift).
- **Verifikation**: neuer Test in `test/f1-i18n-locale.test.js`; `node --test
  test/f1-i18n-locale.test.js`.
- **Heute erwartbar**: gruen (JS-Objektzugriff mit einem Nicht-String-Key wie `{lang:"en"}`
  wird intern zu `"[object Object]"` gecastet, kein Treffer in `LOCALES` -> Fallback greift;
  keine Sonderbehandlung noetig, aber auch keine, die es kaputt machen koennte).
- **Belegt durch**: src/i18n/locales.js:285-287

## Offene Fragen / Empfehlungen fuer den Owner (nicht Teil der Tests, zur Kenntnis)

- PROMPT-04 zeigt: `languageForCountry('US')=='de'` ist ein FUNKTIONIERENDER, aber fuer den
  US-Launch falscher Pin. Bevor der Testkatalog als "PASS" gelten kann, muss der Owner
  entscheiden: US bekommt `language='en'` (Code-Aenderung + Test-Update noetig) ODER US bleibt
  bewusst hinter einem Sprach-Onboarding-Schritt zurueck (dann braucht es zwingend PROMPT-05
  als UI-Fix: einen sichtbaren Weg, `language` beim/nach dem Onboarding zu waehlen).
- Die vorhandene Testabdeckung fuer EN (`test/f1-i18n-locale.test.js`) endet strukturell genau
  dort, wo der Code noch Deutsch spricht (Prompt-Geruest, toolDefs, mcp-tools.js, Greeting).
  PROMPT-01/02/09/14 sind bewusst so geschrieben, dass sie HEUTE "gruen" im Sinn von
  "bestaetigt die Luecke" sind - vor dem eigentlichen Launch muessen sie in echte
  Anti-Regressions-Gates umgeschrieben werden (`expect(...).to.NOT.include(deutscherText)`),
  sobald die Lokalisierung nachgezogen ist.
