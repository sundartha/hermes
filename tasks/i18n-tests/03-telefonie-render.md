# VOICE - Telefonie-Renderschicht - STT, TTS, Stimme, Assistant

## Ist-Stand (belegt)

- Das Locale-Bundle (`src/i18n/locales.js`) ist die einzige Sprachquelle. Fuer EN sind
  `dateLocale` UND `sttLocale` auf `en-GB` gesetzt (britisches Englisch, nicht en-US) -
  `src/i18n/locales.js:219-220`.
- Twilio-Adapter mappt `VOICE_PROFILE.EN_FEMALE_NEURAL` auf `Polly.Amy-Neural` +
  `language: "en-GB"` fuer TTS-Voice UND STT-Gather (dieselbe Map, `voiceAttrs()`) -
  `src/telephony/adapters/twilio/render.js:17` (Map-Definition Zeile 10-18,
  `gatherOpts()` Zeile 29-37).
- Telnyx-Adapter mappt `EN_FEMALE_NEURAL` auf `Azure.en-GB-SoniaNeural` +
  `language: "en-GB"` (identische GB-Bindung) - `src/telephony/adapters/telnyx/render.js:24`
  (Map Zeile 15-25, `gatherAttrs()` Zeile 104-111).
- `LANGUAGE_FOR_COUNTRY` (Land -> Sprache) enthaelt KEINEN Eintrag fuer `US`; nur
  DE/AT/CH/FR/GB/IE sind gemappt - `src/i18n/locales.js:268-275`.
- `languageForCountry("US")` ist GETESTET auf `DEFAULT_LANGUAGE` ("de") gepinnt, kein
  Zufall - `src/i18n/locales.js:278-280`; Test-Beweis `test/f1-geo-port.test.js:61`.
- Land-Praezedenz beim Onboarding ist EXPLIZIT dokumentiert und im Code so umgesetzt:
  `body.country` (User-Wahl, autoritativ) > IP-Geo-Vorschlag (nur bei `GEO_ENABLED`) >
  `config.provisioning.provisioningCountry` > `DEFAULT_COUNTRY` - `src/routes/api-onboard.js:131-147`.
  `language = languageForCountry(country)` direkt danach (Zeile 147) - selbst ein
  EXPLIZITES `body.country = "US"` erzeugt wegen der fehlenden Tabellen-Zeile weiterhin
  `language = "de"`.
- `GEO_ENABLED` ist per Default AUS (`fallback: false`) - `src/config.js:794`. Ohne
  explizite Env-Aktivierung liefert `proposedCountry` in `api-onboard.js:141` immer `null`.
- Kein Frontend im Repo (`apps/web/src`, `public/*.html`) sendet `body.country` an
  `POST /api/onboard` - Rechercheergebnis per `grep -rn "country" apps/web/src public/*.html`,
  0 Treffer (verifiziert, kein Beleg noetig da Negativbefund).
- Laufzeit-Sprach-Praezedenz pro Call: `settings.language` (Tenant-Override) >
  `number.language` > `tenant.defaultLanguage` > `DEFAULT_LANGUAGE` ("de") -
  `src/store/state-ops.js:648-651` (`resolveCallLanguage`). Bereits vollstaendig
  stufenweise getestet in `test/f1-geo-store.test.js:105-136`.
- `language` ist ein gueltiges Self-Service-Feld (`POST /api/settings`) -
  `src/self-service.js:20` (`SELF_SERVICE_FREE_FIELDS`); Katalog-Validierung gegen
  `SUPPORTED_LANGUAGES` in `src/store/state-ops.js:2498-2503` (`OPTIONAL_ENUM_FIELDS`).
- Im Tenant-Dashboard existiert fuer `agentStyle` ein `<select id="styleSelect">`
  (`public/tenant.html:177`), fuer `language` existiert KEIN Select-Element im gesamten
  Dokument (einziger Treffer fuer "language" ist ein Kommentar in Zeile 523).
- Der MCP-Tool-Parameter `language` bei `place_call` wird laut Code-Kommentar
  serverseitig ignoriert (`store.resolveCallLanguage` entscheidet) -
  `src/mcp-tools.js:446-448`. Es existiert kein MCP-Tool, um `settings.language` zu setzen
  (registrierte Tools laut Datei: `place_call`, `get_call_status`, `get_transcript`,
  `cancel_call`, `get_my_number`, `list_calls`, `get_calendar`, `get_agent_status`,
  `list_action_items`).
- ElevenLabs-Say (Telnyx-Relay-Pfad, `src/telephony/adapters/telnyx/render.js:53-77`)
  traegt bewusst KEIN `language`-Attribut - EINE globale Stimme, die dem Text folgt,
  fuer alle drei Sprachen. Bereits getestet: `test/telnyx-elevenlabs-render.test.js:42-56`
  (STT-Locale folgt dem Profil, Voice-ID bleibt gleich fuer DE/FR/EN).
- Der Play-TTS-Pfad (`src/tts/directive-synth.js`) synthetisiert mit `cfg.voiceId`
  (`config.voice.elevenLabsPlayTts.voiceId`, EIN globaler Env-Wert) ohne jedes
  `call.language`-Routing im Synth-Aufruf - `src/tts/directive-synth.js:43-53`;
  `cfg.voiceId` aus `src/config.js:243`. Flag `ELEVENLABS_PLAY_TTS_ENABLED` Default AUS
  (`src/config.js:234-236`).
- Der Telnyx-AI-Assistant ist EINE globale Plattform-Instanz mit EINEM
  `voice_settings.voice` (`ElevenLabs.<Model>.<VoiceId>`), kein per-Sprache-Zweig -
  `scripts/telnyx-assistant-provision.mjs` (`buildAssistantConfig`), gespiegelt in
  `src/telephony/adapters/telnyx/voice.js:265-278` (`speakVoiceFields`, KEIN
  `language`-Feld im ElevenLabs-Zweig laut Kommentar Zeile 267-269).
- Realtime-Engine (`VOICE_ENGINE=realtime`, NICHT der Live-Default) mappt EN separat:
  `realtimeVoice: REALTIME_VOICE_EN`, `whisperLocale: "en"` -
  `src/i18n/locales.js:222-224`; konsumiert in `src/bridge.js:172-189`
  (`session.update` setzt `voice: loc.realtimeVoice`, `input_audio_transcription.language`
  NUR wenn `loc.whisperLocale` truthy ist - DE bleibt ohne `language`-Feld, Auto-Detect).
  EN-Pfad bereits getestet: `test/bridge-openai-event.test.js:262-268`.
- Twilio-Gather (Budget-Engine) setzt `speechModel: "deepgram_nova-2-general"`
  sprachunabhaengig konstant - `src/telephony/adapters/twilio/render.js:29-37`
  (`gatherOpts`, Wert in Zeile 34). Kein `bargeIn`-/Interrupt-Attribut in Twilio- ODER
  Telnyx-Gather (Budget-Engine) - `src/telephony/adapters/twilio/render.js:29-37`,
  `src/telephony/adapters/telnyx/render.js:104-111`. Der Telnyx-Assistant-Pfad DAGEGEN
  hat `interruption_settings.enable=true`, getestet in
  `test/telnyx-assistant-config.test.js:62-72` (K1: "Barge-in ist Launch-Pflicht, darf
  nie aus sein").
- Der Telnyx-Assistant-STT-Sprachhint (`deepgram/flux`) deckt `"en"` explizit ab
  (`STT_FLUX_HINTS`) und faellt fuer Sprachen ausserhalb der Liste (auch das
  Telnyx-Sonderwort `"multi"`) fail-open auf `"auto"` statt zu werfen -
  `src/telephony/adapters/telnyx/voice.js:201` (Konstante), `:293-297`
  (`transcriptionFields`). Fuer diese Funktion existiert laut Grep KEIN dedizierter Test
  in `test/` (`transcriptionFields`/`STT_FLUX_HINTS` kommt in keiner Testdatei vor) -
  echte Luecke.
- `claude.js` nutzt `loc.dateLocale` fuer `new Date().toLocaleString(...)` im Prompt-Baustein
  `now` - `src/claude.js:43` (`promptInputs`). Fuer EN-Calls ist das `en-GB`
  (`toLocaleString` liefert TT.MM.JJJJ-artiges GB-Format, nicht US-MM/DD).
- `resolveCallLanguage` ist bereits vollstaendig stufenweise getestet
  (`test/f1-geo-store.test.js:105-136`); `updateSettings` mit Sprach-Enum-Validierung
  ebenfalls (`test/f1-geo-store.test.js:140-154`, dort implizit).

## Luecken

| Luecke | Schaden | Beleg | Schwere |
| --- | --- | --- | --- |
| `US` fehlt in `LANGUAGE_FOR_COUNTRY`; selbst explizites `body.country="US"` im Onboarding liefert `language="de"` | Ein US-Kunde, der sich mit `country: "US"` registriert, bekommt einen deutsch sprechenden Agenten - ohne sichtbaren Fehler | `src/i18n/locales.js:268-280`; `src/routes/api-onboard.js:147`; `test/f1-geo-port.test.js:61` | S1 |
| `GEO_ENABLED=false` per Default + kein Frontend sendet `body.country` | Selbst mit korrekter Tabelle gaebe es aktuell keinen belegten automatischen Pfad zu `language="en"` fuer einen echten US-Signup | `src/config.js:794`; `src/routes/api-onboard.js:141`; grep-Negativbefund `apps/web/src`, `public/*.html` | S1 |
| Kein Self-Service-UI-Element fuer `language` in `public/tenant.html` (nur `agentStyle` hat ein Select) | Ein Tenant, der merkt dass der Agent falsch spricht, hat im Dashboard keinen sichtbaren Weg zur Korrektur | `public/tenant.html:177` (styleSelect) vs. kein languageSelect | S1 |
| `place_call`-MCP-Parameter `language` wird serverseitig ignoriert; kein MCP-Tool setzt `settings.language` | claude.ai-Nutzer, die `language: "en"` mitgeben, bekommen trotzdem die serverseitig aufgeloeste Sprache - stille Divergenz | `src/mcp-tools.js:446-448` | S2 |
| EN ist durchgehend en-GB, kein en-US-Zweig existiert | US-Anrufer bekommen britische TTS-Stimme + britisches STT-Locale-Tuning; Erkennungsguete fuer US-Akzente ungetestet/unbelegt | `src/i18n/locales.js:219-220`; `src/telephony/adapters/twilio/render.js:17`; `src/telephony/adapters/telnyx/render.js:24` | S2 |
| ElevenLabs-Relay- UND Play-TTS-Pfad nutzen GENAU EINE globale Stimme fuer alle Sprachen (kein `call.language`-Routing im Voice-Wert) | Eine fuer Deutsch gewaehlte Stimme spricht auch Englisch/Franzoesisch; Aussprachequalitaet fuer EN nie gesondert evaluiert, kein Mechanismus zur Unterscheidung | `src/telephony/adapters/telnyx/render.js:53-77`; `src/tts/directive-synth.js:43-53`; `scripts/telnyx-assistant-provision.mjs` (`buildAssistantConfig`) | S1 |
| Telnyx-Assistant ist EINE globale Instanz/Config fuer alle Tenants/Sprachen; kein EN-spezifischer Test deckt Sprach-Interaktion ab | Ein Regressionsfehler in der EN-STT-Sprachweiche des Assistant-Pfads wuerde von der bestehenden Suite nicht gefangen | `test/telnyx-assistant-config.test.js:44-56` (nur Voice-Referenz, keine Sprach-Assertion) | S3 |
| `transcriptionFields()` (Telnyx-Assistant-STT-Hint-Mapping inkl. `"multi"`-Sonderfall und Fail-open auf `"auto"`) hat KEINEN dedizierten Test | Ein kaputtes Hint-Mapping (z.B. Regression von `"en"` auf ein nicht-existentes Kuerzel) wuerde erst live durch Kauderwelsch-Transkripte auffallen (identisch zur historischen RCA-Wurzel R2) | `src/telephony/adapters/telnyx/voice.js:198-201,293-297`; grep `transcriptionFields\|STT_FLUX_HINTS` in `test/` -> 0 Treffer | S1 |
| Budget-Engine (Twilio+Telnyx Gather) hat fuer keine Sprache Sprach-Barge-in (nur DTMF); Telnyx-Assistant-Pfad hat es | Anrufer koennen den Agenten in der Live-Default-Engine grundsaetzlich nicht per Sprache unterbrechen - sprachunabhaengig, aber besonders bei laengeren EN-Gespraechen ein Produktrisiko | `src/telephony/adapters/twilio/render.js:29-37`; `src/telephony/adapters/telnyx/render.js:104-111`; Kontrast `test/telnyx-assistant-config.test.js:69-72` | S3 |
| `dateLocale="en-GB"` liefert GB-Datumsformat in claude.js-Prompts (`now`), nicht US-Format | Missverstaendnisse bei Terminen/Daten in Gespraechen mit US-Anrufern (z.B. 03/04 als 3. April statt 4. Maerz) moeglich, ungetestet | `src/claude.js:43`; `src/i18n/locales.js:219` | S3 |

## Tests

### VOICE-01 - EN-Locale-Bundle bleibt auf en-GB gepinnt (sttLocale + dateLocale)
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: keine (reiner Modul-Import, kein Server/Store noetig)
- **Schritte**:
  1. `LOCALES.en` aus `src/i18n/locales.js` importieren.
  2. `LOCALES.en.sttLocale` und `LOCALES.en.dateLocale` pruefen.
- **Erwartetes Ergebnis**: `LOCALES.en.sttLocale === "en-GB"` UND
  `LOCALES.en.dateLocale === "en-GB"`. Ein Wechsel auf `"en-US"` MUSS diesen Test
  bewusst brechen (Signal fuer eine Produktentscheidung, kein stiller Drift).
- **Verifikation**: `node --test test/f1-i18n-locale.test.js` (Test existiert bereits
  und pinnt genau diese Werte).
- **Heute erwartbar**: gruen - bereits gepinnt und bestehend.
- **Belegt durch**: src/i18n/locales.js:219-220; test/f1-i18n-locale.test.js (LOCALES.en-Assertions)

### VOICE-02 - Twilio-TwiML fuer EN nutzt Polly.Amy-Neural + en-GB (TTS UND STT)
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**:
  1. Direktiven-Liste (Say+Gather) mit `voiceProfile = VOICE_PROFILE.EN_FEMALE_NEURAL`
     bauen.
  2. `renderDirectives()` (Twilio-Adapter) aufrufen.
  3. Resultierendes TwiML auf `<Say voice="Polly.Amy-Neural" language="en-GB">` UND
     `<Gather ... language="en-GB" ...>` pruefen.
- **Erwartetes Ergebnis**: Byte-identisches TwiML wie im bestehenden Snapshot
  (`'<Gather input="speech" language="en-GB" speechTimeout="auto" speechModel="deepgram_nova-2-general" actionOnEmptyResult="true" ...'`).
- **Verifikation**: `node --test test/directive-render.test.js` (Test "EN: Turn-Direktiven
  -> TwiML mit en-GB-STT + Polly.Amy-Neural", Zeile 165ff.)
- **Heute erwartbar**: gruen - bestehender Snapshot-Test.
- **Belegt durch**: src/telephony/adapters/twilio/render.js:10-18,29-37; test/directive-render.test.js:165-181

### VOICE-03 - Telnyx-TeXML fuer EN nutzt Azure.en-GB-SoniaNeural + en-GB (TTS UND STT)
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**: analog VOICE-02, aber Telnyx-Adapter (`renderDirectives` TeXML).
- **Erwartetes Ergebnis**: `<Say voice="Azure.en-GB-SoniaNeural" language="en-GB">...</Say>`
  UND `<Gather ... language="en-GB" transcriptionEngine="Deepgram" model="deepgram/nova-3" ...>`.
- **Verifikation**: `node --test test/telnyx-render.test.js` (EN-Abschnitt ab Zeile 209).
- **Heute erwartbar**: gruen - bestehender Snapshot-Test.
- **Belegt durch**: src/telephony/adapters/telnyx/render.js:15-25,104-111; test/telnyx-render.test.js:209ff

### VOICE-04 - languageForCountry("US") liefert weiterhin "de" (dokumentierter Launch-Blocker)
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `languageForCountry("US")` aufrufen.
  2. Ergebnis mit `DEFAULT_LANGUAGE` vergleichen.
- **Erwartetes Ergebnis**: `languageForCountry("US") === "de"` (Vertrag heute). Dieser
  Test ist ein BEWUSSTER Trip-Wire: sobald US-Launch entschieden ist, MUSS er rot
  werden (dann `LANGUAGE_FOR_COUNTRY.US = "en"` ergaenzen und Test aktualisieren).
- **Verifikation**: `node --test test/f1-geo-port.test.js`
- **Heute erwartbar**: gruen - Test besteht, dokumentiert aber genau die S1-Luecke
  (ein "gruen" hier ist ein Launch-Blocker, kein Qualitaetsnachweis).
- **Belegt durch**: src/i18n/locales.js:268-280; test/f1-geo-port.test.js:61

### VOICE-05 - GEO_ENABLED Default AUS: proposedCountry ist immer null ohne Env-Flag
- **Prioritaet**: P1
- **Modus**: offline (node)
- **Vorbedingung**: `GEO_ENABLED` NICHT gesetzt (Default)
- **Schritte**:
  1. `src/config.js` ohne `GEO_ENABLED` in der Env importieren.
  2. `config.provisioning.geoEnabled` pruefen.
- **Erwartetes Ergebnis**: `config.provisioning.geoEnabled === false`.
- **Verifikation**: `node -e "process.env.DATA_DIR='/tmp/x'; import('./src/config.js').then(m=>console.log(m.config.provisioning.geoEnabled))"`
  (Konsolenausgabe `false`); alternativ vorhandenen Test erweitern
  `test/f1-geo-onboard.test.js` um eine explizite `geoEnabled===false`-Assertion.
- **Heute erwartbar**: gruen - `boolEnv(..., {fallback:false})`.
- **Belegt durch**: src/config.js:794

### VOICE-06 - POST /api/onboard mit explizitem body.country="US" liefert TROTZDEM language="de"
- **Prioritaet**: P0
- **Modus**: offline (npm test, Integrationstest gegen Server-Kindprozess mit `DATA_DIR`-Override)
- **Vorbedingung**: `DATA_DIR` Temp-Verzeichnis, `PORT=0`, gueltiger Onboarding-Payload
  (firstName/lastName/privateNumber/idpSubject etc. je nach `api-onboard.js`-Contract)
- **Schritte**:
  1. Server mit Test-Helpers starten (wie in `test/f1-geo-onboard.test.js`).
  2. `POST /api/onboard` mit `body.country = "US"` senden.
  3. Persistierten Tenant laden, `tenantGeo(s, tenantId).defaultLanguage` lesen.
- **Erwartetes Ergebnis**: `defaultLanguage === "de"` (NICHT "en") - das ist der
  dokumentierte, aber ueberraschende IST-Zustand; ein Reviewer, der "en" erwartet,
  MUSS hier stolpern.
- **Verifikation**: `node --test test/f1-geo-onboard.test.js` (Test existiert
  vermutlich fuer FR/DE-Faelle - pruefen, ob ein US-Fall bereits abgedeckt ist; falls
  nicht, als neuer Testfall in derselben Datei ergaenzen statt neue Datei).
- **Heute erwartbar**: unbekannt - Existenz eines expliziten US-Testfalls in
  `test/f1-geo-onboard.test.js` wurde nicht Zeile-fuer-Zeile verifiziert; die
  Code-Logik (`languageForCountry(country)` direkt nach `resolveOnboardCountry`)
  belegt aber zwingend das beschriebene Verhalten.
- **Belegt durch**: src/routes/api-onboard.js:131-147

### VOICE-07 - Kein Frontend im Repo sendet body.country an POST /api/onboard
- **Prioritaet**: P1
- **Modus**: offline (grep)
- **Vorbedingung**: keine
- **Schritte**: `grep -rn "country" apps/web/src public/*.html`
- **Erwartetes Ergebnis**: 0 Treffer fuer ein Feld, das erkennbar `body.country`
  beim Onboarding-POST setzt (Kommentar-/Legal-Treffer zu "country" als Wort waeren
  toleriert, aber kein `fetch`/`body`-Zusammenhang).
- **Verifikation**: `grep -rn "country" apps/web/src public/*.html | grep -i "onboard\|body\|country:"`
  -> erwartete Trefferzahl 0.
- **Heute erwartbar**: gruen (im Sinne von "Befund bestaetigt sich") - ist aber
  gleichzeitig der Beleg fuer die S1-Luecke VOICE-04/06.
- **Belegt durch**: grep-Rechercheergebnis (kein datei:zeile-Beleg, da Negativbefund)

### VOICE-08 - resolveCallLanguage-Praezedenz bleibt vierstufig (settings > number > tenant > default)
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: keine (reine Store-Funktion, kein Netz)
- **Schritte**: siehe bestehende Testfaelle in `test/f1-geo-store.test.js:105-136`
  (vier separate `test()`-Bloecke fuer jede Stufe).
- **Erwartetes Ergebnis**: Override gewinnt (Zeile 110), sonst number.language
  (Zeile 117), sonst tenant.defaultLanguage (Zeile 124), sonst DEFAULT_LANGUAGE
  (Zeile 136).
- **Verifikation**: `node --test test/f1-geo-store.test.js`
- **Heute erwartbar**: gruen - bestehende, bereits granulare Tests.
- **Belegt durch**: src/store/state-ops.js:648-651; test/f1-geo-store.test.js:105-136

### VOICE-09 - Self-Service POST /api/settings mit language="en" setzt und validiert korrekt
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: aktiver Tenant, gueltige Tenant-Auth (Bearer-Token o.ae. je nach
  Self-Service-Route)
- **Schritte**:
  1. `updateSettings(s, tenantId, { language: "en" })` aufrufen (oder ueber
     `POST /api/settings` bei Server-Integrationstest).
  2. `settingsFor(s, tenantId).language` lesen.
- **Erwartetes Ergebnis**: `"en"`. Ein unbekannter Wert (z.B. `"xx"`) wird IGNORIERT
  (nicht uebernommen, kein Throw) - siehe `test/f1-geo-store.test.js:140`
  ("Freitext/unbekannt ignoriert").
- **Verifikation**: `node --test test/f1-geo-store.test.js` (Test Zeile 140,
  "updateSettings: bekannte Sprache uebernommen; '' setzt zurueck auf null;
  Freitext/unbekannt ignoriert" - pruefen ob explizit `"en"` als bekannter Wert
  getestet wird, sonst dort ergaenzen statt neue Datei).
- **Heute erwartbar**: unbekannt - Test-Existenz fuer den Fall "bekannte Sprache
  uebernommen" ist belegt (Zeile 140), ob der konkrete Wert `"en"` (statt nur `"fr"`)
  im Testkoerper steht, wurde nicht Zeile-fuer-Zeile gelesen.
- **Belegt durch**: src/self-service.js:20; src/store/state-ops.js:2498-2503; test/f1-geo-store.test.js:140

### VOICE-10 - public/tenant.html hat kein UI-Element zum Sprachwechsel
- **Prioritaet**: P1
- **Modus**: offline (grep) / manuell (Auge im Browser)
- **Vorbedingung**: keine
- **Schritte**: `grep -n "language\|langSelect\|<select" public/tenant.html`
- **Erwartetes Ergebnis**: KEIN `<select>`- oder `<input>`-Element mit
  `id`/`name` in der Naehe von "language"; einziger Treffer fuer "language" ist der
  Kommentar in Zeile 523. `styleSelect` (Zeile 177) existiert als Kontrastbeweis,
  dass das Muster fuer andere Felder vorhanden ist.
- **Verifikation**: `grep -n "id=\"languageSelect\"\|id=\"langSelect\"" public/tenant.html`
  -> erwartete Trefferzahl 0.
- **Heute erwartbar**: gruen (Befund bestaetigt) - gleichzeitig Beleg der S1-Luecke.
- **Belegt durch**: public/tenant.html:177,523

### VOICE-11 - place_call MCP-Tool: language-Parameter ist dokumentiert wirkungslos
- **Prioritaet**: P1
- **Modus**: offline (npm test / grep)
- **Vorbedingung**: keine
- **Schritte**:
  1. `place_call` mit `language: "en"` UND einer Tenant-Konfiguration mit
     `settings.language = "fr"` aufrufen (ueber MCP-Tool-Handler-Test, nicht echten
     Anruf).
  2. Resultierende `call.language` bzw. tatsaechlich verwendete Locale pruefen.
- **Erwartetes Ergebnis**: Die verwendete Sprache ist `"fr"` (aus
  `resolveCallLanguage`), NICHT `"en"` aus dem MCP-Parameter - der Kommentar in
  `mcp-tools.js:446-448` wird durch Verhalten bestaetigt.
- **Verifikation**: bestehenden `place-call-context-bridge.test.js` oder aehnlichen
  MCP-Tool-Test pruefen/erweitern: `node --test test/place-call-context-bridge.test.js`;
  falls kein Test den `language`-Parameter explizit gegen `settings.language` kontrastiert,
  dort ergaenzen statt neue Datei.
- **Heute erwartbar**: unbekannt - Kommentar-Beleg ist eindeutig, ob ein Test das
  Verhalten (statt nur den Kommentar) tatsaechlich exekutiert, wurde nicht verifiziert.
- **Belegt durch**: src/mcp-tools.js:446-448

### VOICE-12 - ElevenLabs-Say traegt fuer alle drei Sprachen dieselbe Voice-ID, kein language-Attribut
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**: siehe bestehenden Test "ElevenLabs + FR/EN-Profil: STT-Locale folgt
  dem Profil, Voice bleibt dieselbe ID (multilingual)".
- **Erwartetes Ergebnis**: `<Say voice="ElevenLabs.Default.<id>" api_key_ref="...">`
  identisch fuer DE/FR/EN (kein `language`-Attribut); NUR das Gather-STT-`language`
  folgt weiterhin dem Profil (de-DE/fr-FR/en-GB).
- **Verifikation**: `node --test test/telnyx-elevenlabs-render.test.js` (Test Zeile 42-56).
- **Heute erwartbar**: gruen - bestehender Test.
- **Belegt durch**: src/telephony/adapters/telnyx/render.js:53-77; test/telnyx-elevenlabs-render.test.js:42-56

### VOICE-13 - Play-TTS-Direktiven-Synth nutzt EINEN globalen voiceId fuer jede call.language
- **Prioritaet**: P1
- **Modus**: offline (npm test, ggf. neuer Test)
- **Vorbedingung**: `config.voice.elevenLabsPlayTts.enabled = true` (im Test injiziert),
  `cfg.voiceId` gesetzt
- **Schritte**:
  1. `makeDirectiveSynth({config, ttsStore, store, onQuotaWarning})` mit einer
     `synthesizeSpeech`-Mock-Injektion (oder Monkeypatch) fuer zwei Direktiven-Listen
     mit `call.language = "de"` bzw. `"en"` aufrufen.
  2. Den an `synthesizeSpeech` uebergebenen `voiceId`-Parameter fuer beide Faelle
     vergleichen.
- **Erwartetes Ergebnis**: `voiceId` ist IDENTISCH fuer beide Sprachen
  (`cfg.voiceId`, kein `call.language`-Zweig in `synthToServeUrl`).
- **Verifikation**: `grep -rln "synthesizeDirectiveAudio\|directive-synth" test/` pruefen,
  ob `voice-play-tts.test.js` diesen Vergleich bereits explizit macht; sonst dort
  ergaenzen: `node --test test/voice-play-tts.test.js`.
- **Heute erwartbar**: unbekannt - `src/tts/directive-synth.js` selbst enthaelt
  keinen `call.language`-Parameter im Synth-Aufruf (Code-Beleg eindeutig), ob
  `voice-play-tts.test.js` das bereits als Sprachvergleich exekutiert wurde nicht
  Zeile-fuer-Zeile geprueft.
- **Belegt durch**: src/tts/directive-synth.js:33-53; src/config.js:243

### VOICE-14 - Telnyx-Assistant-Config hat EIN voice_settings-Feld ohne Sprach-Dimension
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**: siehe bestehenden Test "buildAssistantConfig: Ela-Voice-Referenz aus
  voiceModel + voiceId".
- **Erwartetes Ergebnis**: `cfg.voice_settings.voice === "ElevenLabs.Default.voice_xyz"`
  unabhaengig von jedem `language`-Argument (die Funktion nimmt gar kein
  `language`-Argument entgegen - grep-Beleg).
- **Verifikation**: `node --test test/telnyx-assistant-config.test.js` (Zeile 44-51);
  zusaetzlich `grep -n "language" scripts/telnyx-assistant-provision.mjs` sollte
  KEINEN Treffer in `buildAssistantConfig` fuer eine sprachabhaengige Voice-Wahl liefern.
- **Heute erwartbar**: gruen - bestehender Test, kombiniert mit Negativ-Grep.
- **Belegt durch**: scripts/telnyx-assistant-provision.mjs (buildAssistantConfig); test/telnyx-assistant-config.test.js:44-51

### VOICE-15 - Realtime-Engine: EN-Call setzt whisperLocale="en" + realtimeVoice=REALTIME_VOICE_EN
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: `VOICE_ENGINE=realtime` (nur fuer diesen Testpfad relevant, nicht
  der Live-Default)
- **Schritte**: siehe bestehenden Test "EN-Realtime: kuratierte Voice + Whisper-en +
  EN-Inbound-Opener".
- **Erwartetes Ergebnis**: `sessionUpdate.session.voice === REALTIME_VOICE_EN` UND
  `sessionUpdate.session.input_audio_transcription.language === "en"`.
- **Verifikation**: `node --test test/bridge-openai-event.test.js` (Test Zeile 262-268).
- **Heute erwartbar**: gruen - bestehender Test.
- **Belegt durch**: src/i18n/locales.js:222-224; src/bridge.js:172-189; test/bridge-openai-event.test.js:262-268

### VOICE-16 - DE-Realtime bleibt ohne Whisper-language-Feld (Auto-Detect, Bestand)
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**: siehe bestehenden Test "DE-Realtime byte-identisch: keine
  Whisper-language (Auto-Detect, Bestand)".
- **Erwartetes Ergebnis**: `sessionUpdate.session.input_audio_transcription` hat KEIN
  `language`-Feld fuer DE-Calls (Kontrast zu EN/FR, wo es gesetzt wird).
- **Verifikation**: `node --test test/bridge-openai-event.test.js` (Test Zeile 232-245).
- **Heute erwartbar**: gruen - bestehender Test; wichtig als Regressionsschutz, damit
  ein EN-Fix nicht versehentlich DE mitveraendert.
- **Belegt durch**: src/i18n/locales.js:103-104; test/bridge-openai-event.test.js:232-245

### VOICE-17 - Telnyx-Assistant STT-Hint deckt "en" explizit ab (kein Fallback auf auto)
- **Prioritaet**: P0
- **Modus**: offline (npm test, NEUER Test - Luecke)
- **Vorbedingung**: keine (reine Funktions-Unit gegen `transcriptionFields`)
- **Schritte**:
  1. `transcriptionFields("en")` importieren/aufrufen (ggf. Export in `voice.js`
     pruefen/als internen Test via Modul-Reexport, falls nicht exportiert:
     Verhalten indirekt ueber `startAssistant`-Body pruefen).
  2. Resultierendes `transcription.language` pruefen.
- **Erwartetes Ergebnis**: `transcription.language === "en"` (NICHT `"auto"`,
  NICHT `"multi"`) UND `transcription.model === "deepgram/flux"`.
- **Verifikation**: `node --test test/telnyx-voice.test.js` NACH Ergaenzung eines
  Testfalls (aktuell 0 Treffer fuer `transcriptionFields`/`STT_FLUX_HINTS` in `test/`,
  grep-belegt) - `grep -rn "transcriptionFields\|STT_FLUX_HINTS" test/` sollte danach
  >=1 Treffer liefern.
- **Heute erwartbar**: rot - kein Test existiert, Funktion ist ungetestet (echte
  Luecke, grep-Negativbefund).
- **Belegt durch**: src/telephony/adapters/telnyx/voice.js:198-201,293-297; grep test/ (0 Treffer)

### VOICE-18 - Telnyx-Assistant STT-Hint faellt fuer unbekannte Sprache (z.B. "xx", "multi") fail-open auf "auto"
- **Prioritaet**: P1
- **Modus**: offline (npm test, NEUER Test - Luecke)
- **Vorbedingung**: keine
- **Schritte**:
  1. `transcriptionFields("xx")` und `transcriptionFields("multi")` aufrufen.
  2. `transcription.language` pruefen.
- **Erwartetes Ergebnis**: Beide liefern `transcription.language === "auto"`, KEIN
  Throw, KEIN `"multi"` im Ergebnis (historische RCA-Wurzel: `"multi"` bedeutete bei
  Telnyx woertlich "kein Sprachhint" und fuehrte zu Kauderwelsch-Transkripten).
- **Verifikation**: `node --test test/telnyx-voice.test.js` (nach Ergaenzung).
- **Heute erwartbar**: rot - ungetestet.
- **Belegt durch**: src/telephony/adapters/telnyx/voice.js:196-202,293-297

### VOICE-19 - transcriptionFields(null/undefined) liefert leeres Objekt (Bestand byte-identisch)
- **Prioritaet**: P2
- **Modus**: offline (npm test, NEUER Test - Luecke)
- **Vorbedingung**: keine
- **Schritte**: `transcriptionFields(undefined)` und `transcriptionFields(null)` aufrufen.
- **Erwartetes Ergebnis**: `{}` (kein `transcription`-Feld) - der Inbound-Pfad ruft
  `startAssistant` ohne `language` auf, das MUSS byte-identisch zum Bestand bleiben.
- **Verifikation**: `node --test test/telnyx-voice.test.js` (nach Ergaenzung).
- **Heute erwartbar**: rot - ungetestet, Code-Verhalten aber eindeutig belegt
  (`if (!language) return {};`).
- **Belegt durch**: src/telephony/adapters/telnyx/voice.js:293-294

### VOICE-20 - languageForCountry ist gross-/kleinschreibungs-unabhaengig (Edge Case)
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**: `languageForCountry("gb")`, `languageForCountry("Gb")`,
  `languageForCountry("GB")` vergleichen.
- **Erwartetes Ergebnis**: Alle drei liefern `"en"` (`.toUpperCase()` in der
  Implementierung normalisiert).
- **Verifikation**: `node --test test/f1-geo-port.test.js` (pruefen ob Gross-/
  Kleinschreibung bereits getestet ist; falls nicht, dort ergaenzen).
- **Heute erwartbar**: unbekannt - Code-Beleg fuer `.toUpperCase()` ist eindeutig
  (`src/i18n/locales.js:279`), ob genau dieser Cast-Fall in der Testdatei steht wurde
  nicht Zeile-fuer-Zeile verifiziert.
- **Belegt durch**: src/i18n/locales.js:278-280

### VOICE-21 - localeFor() faellt bei unbekanntem/leerem/grossgeschriebenem language-Wert auf DE zurueck
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `localeFor("xx")`, `localeFor("")`, `localeFor(null)`, `localeFor(undefined)`,
     `localeFor("EN")` (Grossschreibung!) aufrufen.
  2. Jeweils `sttLocale`/`voiceProfile` des Ergebnisses pruefen.
- **Erwartetes Ergebnis**: Alle fuenf Faelle liefern `LOCALES.de` (Fallback), AUCH
  `"EN"` (Grossschreibung) - da `LOCALES`-Keys `Object.freeze({de,fr,en})` sind und
  `localeFor` KEIN `.toLowerCase()`/`.toUpperCase()` anwendet (anders als
  `languageForCountry`!). Dieser Kontrast (`languageForCountry` normalisiert,
  `localeFor` NICHT) ist ein realer Edge Case: ein Aufrufer, der `"EN"` statt `"en"`
  in `call.language`/`settings.language` schreibt, bekommt STILL Deutsch statt eines
  Fehlers.
- **Verifikation**: `node --test test/f1-i18n-locale.test.js` (Fallback-Faelle
  pruefen, ob Grossschreibung `"EN"` bereits Teil des Testkoerpers ist; falls nicht,
  dort als Edge-Case-Testfall ergaenzen statt neue Datei).
- **Heute erwartbar**: unbekannt fuer die Grossschreibungs-Variante spezifisch (Code
  hat kein `toLowerCase`, Kontrast-Beleg via `grep -n "toLowerCase\|toUpperCase"
  src/i18n/locales.js` zeigt `.toUpperCase()` NUR in `languageForCountry`, nicht in
  `localeFor`); die reinen Fallback-Faelle (unbekannt/leer/null) sind laut
  Dateikommentar "R7" bereits Testgegenstand.
- **Belegt durch**: src/i18n/locales.js:282-284 (localeFor); src/i18n/locales.js:278-280 (Kontrast languageForCountry mit .toUpperCase())

### VOICE-22 - Twilio-STT-Modell bleibt sprachunabhaengig konstant (deepgram_nova-2-general)
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**: `gatherOpts()` fuer DE/FR/EN-Profile aufrufen (indirekt ueber
  `renderDirectives` mit GATHER-Direktive), `speechModel`-Attribut vergleichen.
- **Erwartetes Ergebnis**: `speechModel === "deepgram_nova-2-general"` fuer alle drei
  Sprachen (kein sprachspezifisches Modell-Override).
- **Verifikation**: `node --test test/directive-render.test.js` (DE/FR/EN-Gather-Faelle
  gemeinsam betrachten, `speechModel` in jedem Snapshot).
- **Heute erwartbar**: gruen - aus den bestehenden Snapshot-Strings ablesbar.
- **Belegt durch**: src/telephony/adapters/twilio/render.js:29-37

### VOICE-23 - Budget-Engine (Twilio+Telnyx Gather) setzt fuer keine Sprache ein Barge-in-/Interrupt-Attribut
- **Prioritaet**: P1
- **Modus**: offline (grep + npm test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n "bargeIn\|interrupt" src/telephony/adapters/twilio/render.js src/telephony/adapters/telnyx/render.js`
- **Erwartetes Ergebnis**: 0 Treffer in beiden Dateien (Gather-Attribute enthalten
  weder `bargeIn` noch `interrupt*`).
- **Verifikation**: `grep -c "bargeIn\|interrupt" src/telephony/adapters/twilio/render.js src/telephony/adapters/telnyx/render.js`
  -> beide `0`.
- **Heute erwartbar**: gruen (Befund bestaetigt) - dokumentiert eine bewusste,
  sprachunabhaengige Produktluecke der Live-Default-Engine.
- **Belegt durch**: src/telephony/adapters/twilio/render.js:29-37; src/telephony/adapters/telnyx/render.js:104-111

### VOICE-24 - Telnyx-Assistant-Pfad hat Barge-in AN (Kontrast zur Budget-Engine)
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**: siehe bestehenden Test "K1: interruption_settings.enable bleibt true
  UND interrupt_prediction_threshold=0.4".
- **Erwartetes Ergebnis**: `cfg.interruption_settings.enable === true`,
  `cfg.interruption_settings.interrupt_prediction_threshold === 0.4`, unabhaengig von
  jeder Sprache (Funktion nimmt keine Sprache entgegen).
- **Verifikation**: `node --test test/telnyx-assistant-config.test.js` (Zeile 69-72).
- **Heute erwartbar**: gruen - bestehender Test, explizit als "Launch-Pflicht"
  kommentiert.
- **Belegt durch**: scripts/telnyx-assistant-provision.mjs; test/telnyx-assistant-config.test.js:69-72

### VOICE-25 - Konkurrierende Calls mit unterschiedlicher Sprache leaken keine Voice-/STT-Werte (Nebenlaeufigkeit)
- **Prioritaet**: P1
- **Modus**: offline (npm test, NEUER Test moeglich, oder Code-Review-Argument)
- **Vorbedingung**: keine
- **Schritte**:
  1. Zwei `renderDirectives()`-Aufrufe fuer denselben Provider (Twilio ODER Telnyx)
     "gleichzeitig" (in einem Event-Loop-Tick, ohne await dazwischen) mit
     `voiceProfile = DE` bzw. `voiceProfile = EN` ausfuehren.
  2. Beide Ergebnisse pruefen.
- **Erwartetes Ergebnis**: Der DE-Aufruf liefert `de-DE`/Polly.Vicki (bzw. Azure.Katja),
  der EN-Aufruf `en-GB`/Polly.Amy (bzw. Azure.Sonia) - KEINE Vermischung. Das ist
  strukturell garantiert, da `TWILIO_VOICE`/`TELNYX_VOICE` `Object.freeze`-Konstanten
  sind und `voiceAttrs(profile)` zustandslos pro Aufruf liest (kein modul-globaler
  mutabler Zustand) - Code-Review-Beleg reicht, ein expliziter Test ist zusaetzliche
  Absicherung.
- **Verifikation**: `node --test test/directive-render.test.js test/telnyx-render.test.js`
  gemeinsam ausfuehren und pruefen, dass DE- und EN-Testfaelle in derselben Datei
  unabhaengig gruen bleiben (implizite Nebenlaeufigkeits-Absicherung durch
  Zustandslosigkeit).
- **Heute erwartbar**: gruen - strukturell durch `Object.freeze` + reine Funktionen
  garantiert, kein dedizierter Concurrency-Test noetig/vorhanden.
- **Belegt durch**: src/telephony/adapters/twilio/render.js:10-23; src/telephony/adapters/telnyx/render.js:15-38

### VOICE-26 - dateLocale=en-GB liefert GB-Datumsformat im claude.js-Prompt (nicht US-Format)
- **Prioritaet**: P2
- **Modus**: offline (npm test, NEUER Test - Luecke)
- **Vorbedingung**: keine
- **Schritte**:
  1. `promptInputs({ language: "en", ... })` (oder direkt
     `new Date(2026, 6, 22).toLocaleString("en-GB", {...})`) aufrufen.
  2. Formatiertes Datum pruefen.
- **Erwartetes Ergebnis**: Format entspricht dem britischen Muster
  ("Wednesday, 22 July 2026, ..." - Tag VOR Monat in numerischer Kurzschreibung,
  nicht US-Format "July 22, 2026"). Dient als Trip-Wire: sollte das Produkt auf
  en-US umgestellt werden, MUSS dieser Test das Datumsformat mitziehen.
- **Verifikation**: `grep -n "dateLocale\|now:" src/claude.js` als Beleg, dann
  `node --test test/f1-i18n-locale.test.js` oder neuen Testfall dort ergaenzen
  (Datei importiert bereits `claude.js`-Faelle laut Modul-Doc-Kommentar Zeile 1-7).
- **Heute erwartbar**: rot - kein Test pinnt aktuell explizit das EN-Datumsformat
  (grep-Negativbefund fuer `toLocaleString.*en-GB` in `test/`).
- **Belegt durch**: src/claude.js:43; src/i18n/locales.js:219

### VOICE-27 - Live-Smoke: echter EN-Outbound-Call klingt hoerbar britisch, nicht US-amerikanisch
- **Prioritaet**: P1
- **Modus**: manuell (echter Testanruf an eine eigene, verifizierte Nummer, kostet Geld)
- **Vorbedingung**: `PAYMENT_ENABLED` erlaubt echten Outbound-Call; Test-Tenant mit
  `settings.language = "en"`; Ziel-Nummer ist die eigene verifizierte Nummer des
  Testers (Diagnose-Retention-Pfad); Live-Deploy oder lokal mit echten Twilio/Telnyx-
  Credentials (NICHT `SKIP_TWILIO_SIGNATURE_CHECK`, das waere nur fuer Webhook-Tests
  relevant)
- **Schritte**:
  1. `place_call` (MCP oder API) mit Ziel = eigene Nummer, Tenant-Sprache = `en`.
  2. Anruf entgegennehmen, Stimme UND Aussprache beurteilen (Ohr).
  3. Dabei explizit auf US-Ortsnamen/Zahlen/Datumsangaben im Gespraech achten.
- **Erwartetes Ergebnis**: Stimme ist hoerbar Polly Amy-Neural (Twilio) bzw. Azure
  Sonia-Neural (Telnyx) ODER die konfigurierte ElevenLabs-Stimme, mit britischem statt
  amerikanischem Akzent. Wird das als "unpassend fuer US-Zielgruppe" beurteilt, ist
  das der empirische Beleg fuer S2 "kein en-US-Zweig".
- **Verifikation**: kein automatisiertes Kommando - Protokoll (Datum, Uhrzeit,
  Tenant-ID, Call-ID, subjektive Beurteilung) in `tasks/` festhalten.
- **Heute erwartbar**: unbekannt - erfordert echten Anruf, nicht offline pruefbar.
- **Belegt durch**: src/i18n/locales.js:219-224; src/telephony/adapters/twilio/render.js:17; src/telephony/adapters/telnyx/render.js:24

### VOICE-28 - Live-Smoke: US-STT-Erkennungsguete (amerikanischer Akzent) mit en-GB-Locale
- **Prioritaet**: P1
- **Modus**: manuell (echter Testanruf, idealerweise mit US-amerikanischem Sprecher, kostet Geld)
- **Vorbedingung**: wie VOICE-27, zusaetzlich ein Sprecher mit deutlich amerikanischem
  Akzent/US-Vokabular (z.B. "zip code", "apartment" statt "postcode"/"flat")
- **Schritte**:
  1. Inbound- oder Outbound-Testanruf mit `settings.language = "en"` fuehren.
  2. Waehrend des Calls typische US-Begriffe/Zahlen (Datum im US-Format, Telefonnummer,
     Adresse) nennen.
  3. Transkript via `get_transcript` (MCP) oder Store abrufen und mit dem
     tatsaechlich Gesagten vergleichen.
- **Erwartetes Ergebnis**: Kein deterministischer Zielwert - das Ergebnis IST der
  Messwert. Erwartungshaltung: erhoehte Fehlerrate/Fehltranskriptionen bei
  US-spezifischem Vokabular gegenueber einem britischen Sprecher, da sowohl
  `sttLocale="en-GB"` als auch die Deepgram/Nova-Modelle britisch/allgemein statt
  US-optimiert konfiguriert sind - dies ist ein Risiko-Nachweis-Test, kein
  Pass/Fail-Gate.
- **Verifikation**: kein automatisiertes Kommando - Transkript-Diff manuell
  protokollieren.
- **Heute erwartbar**: unbekannt - kein bestehender Messwert im Repo, rein empirisch.
- **Belegt durch**: src/i18n/locales.js:219-220; src/telephony/adapters/telnyx/voice.js:196-202 (STT_MODEL deepgram/flux, keine US-Variante)

### VOICE-29 - Fail-closed-Beweis: unbekanntes voiceProfile wirft in BEIDEN Adaptern (kein stiller Fallback)
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**: siehe bestehende Tests "Unbekanntes voiceProfile -> wirft (fail-closed,
  kein stiller Default-Voice)" in beiden Adaptern.
- **Erwartetes Ergebnis**: `renderDirectives()` MIT einem nicht in
  `TWILIO_VOICE`/`TELNYX_VOICE` enthaltenen `voiceProfile`-String wirft einen Error
  (`unbekanntes voiceProfile: ...`), produziert KEIN TwiML/TeXML mit stillem
  DE-Fallback. Wichtig als Garant dafuer, dass ein zukuenftiger `en-US`-Profilwert,
  der nur in EINEM der beiden Adapter ergaenzt wird, im anderen laut kracht statt
  leise auf Deutsch zu degradieren.
- **Verifikation**: `node --test test/directive-render.test.js test/telnyx-render.test.js`
  (jeweiliger "Unbekanntes voiceProfile"-Testfall).
- **Heute erwartbar**: gruen - bestehende Tests in beiden Dateien.
- **Belegt durch**: src/telephony/adapters/twilio/render.js:20-24; src/telephony/adapters/telnyx/render.js:34-38; test/directive-render.test.js:84-88; test/telnyx-render.test.js:89-93

## Hinweise zur Verifikation dieses Katalogs

- Alle Belege wurden gegen den aktuellen Arbeitsstand (`master`, Commit `566ccd6` zum
  Zeitpunkt der Erstellung) mit `grep -n`/`sed -n`/`Read` gegengelesen, NICHT geraten.
- Der Recon-Befund war in den stichprobenartig geprueften Kernpunkten (EN=en-GB in
  locales.js, Twilio/Telnyx-Voice-Mapping, LANGUAGE_FOR_COUNTRY ohne US, US-Test-Pinning,
  resolveCallLanguage-Praezedenz, ElevenLabs ohne language-Attribut, Telnyx-Assistant-
  Barge-in, fehlendes languageSelect in tenant.html, fehlender body.country in
  apps/web/src+public) durchgehend akkurat - keine Korrektur noetig.
  Eine kleine Praezisierung: die Land-Praezedenz-Kommentare in `api-onboard.js`
  benennen den Fallback ausdruecklich als
  `config.provisioning.provisioningCountry` (nicht direkt `DEFAULT_COUNTRY`) - beide
  sind aber gemaess `src/config.js:779` und `src/store/defaults.js:330` im
  unkonfigurierten Fall identisch ("DE").
- Als echte, bisher ungetestete Luecken wurden identifiziert: `transcriptionFields()`/
  `STT_FLUX_HINTS` (VOICE-17/18/19, KEIN Testtreffer im gesamten `test/`-Verzeichnis)
  und das EN-Datumsformat in `claude.js` (VOICE-26).
