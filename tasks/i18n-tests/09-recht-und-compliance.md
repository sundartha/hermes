# LAW - Recht und Compliance pro Land

Verifikations-Hinweis: 5 Kern-Belege des Recon-Befunds wurden gegen den echten Code
geprueft (locales.js Bundle-Struktur, state-ops.js Sprach-Praezedenz, outbound-gates.js
Land-/Stundenlimit-Gates, api-onboard.js Land-Praezedenz, f1-i18n-locale.test.js
DE/FR-vs-EN-Abdeckung). Alle bestaetigt, EINE Korrektur unten (Consent-Grep).

## Ist-Stand (belegt)

- **Disclosure-Bundle**: `LOCALES.de/fr/en` je mit `disclosure(ownerName)` als
  byte-stabile Funktion; EN-Wortlaut "Hello, this is an AI assistant calling on
  behalf of ${ownerName}. This conversation will be summarised for the person I
  represent." Beleg: `src/i18n/locales.js:187-189` (DE), `:222-223` (FR-Zeilen
  liegen im gleichen Block), `:237-239` (EN, exakter Wortlaut geprueft).
- `disclosureSentence(call)` loest `localeFor(call.language).disclosure(name)` auf,
  `name = store.tenantContext(call.tenantId).ownerName`. Beleg: `src/claude.js:250-258`.
- `openingText(call)` ist der LLM-freie Erst-Turn (Regel 2/G2): Disclosure + Bruecke.
  Beleg: `src/claude.js:268-278`.
- **Sprach-Praezedenz** (call.language): `settings.language || numberRecord?.language
  || tenant?.defaultLanguage || DEFAULT_LANGUAGE`. Beleg: `src/store/state-ops.js:648-651`,
  aufgerufen aus `src/routes/api-calls.js:91` (`store.resolveCallLanguage`).
- `languageForCountry(country)` hat **keinen US-Eintrag**: `LANGUAGE_FOR_COUNTRY = {
  DE:de, AT:de, CH:de, FR:fr, GB:en, IE:en }`, unbekannt -> `DEFAULT_LANGUAGE` ("de").
  Beleg: `src/i18n/locales.js:268-280`. Per Test explizit gepinnt:
  `assert.equal(languageForCountry("US"), DEFAULT_LANGUAGE)` in
  `test/f1-geo-port.test.js:61` (Zeile innerhalb des Tests
  "languageForCountry: unbekanntes/leeres/null Land -> DEFAULT_LANGUAGE").
- **Onboarding-Land-Praezedenz**: `resolveOnboardCountry({userCountry, proposedCountry,
  fallbackCountry})` = `normCountry(userCountry) || normCountry(proposedCountry) ||
  fallbackCountry || DEFAULT_COUNTRY`. Beleg: `src/geo/resolve.js:18-23`, aufgerufen
  aus `src/routes/api-onboard.js:139-144`; `language = languageForCountry(country)`
  in `src/routes/api-onboard.js:147`. Kauf-Land (`numberCountry`) entkoppelt via
  `config.provisioning.forceNumberCountry`: `src/routes/api-onboard.js:151-154`.
- `DEFAULT_COUNTRY = "DE"`, `DEFAULT_LANGUAGE = "de"`, EINE Quelle fuer alle
  Geo-Fallbacks. Beleg: `src/store/defaults.js:330-331`.
- **Outbound-Gate-Kette**: 17 benannte Gates in exakt dieser Reihenfolge:
  `outbound_frozen, resolve_identity, tenant_reject, normalize_target,
  trunk_zero_normalized, kyc, owner_name, resolve_profile, number_gate, valid_text,
  valid_mandate, assistant_context, resolve_outbound, budget, minutes,
  compute_reserve, reserve_budget`. Beleg: `src/telephony/outbound-gates.js:429-683`
  (grep `name: "` liefert exakt diese 17 Treffer). Keines prueft Uhrzeit, Zeitzone
  oder Einwilligung des Angerufenen.
- **Land-Gate** (`number_gate` -> `numberGateError`): prueft `countryGateAllowed(to,
  profile)` = Schnittmenge `config.safety.allowedCountryCodes` (global) UND
  `profile.allowedCountryCodes` (falls gesetzt). Beleg:
  `src/telephony/outbound-gates.js:281-286` (`grund: "land"`),
  Gate-Funktion `countryGateAllowed` in `src/telephony/outbound-gates.js:177-181`.
- **Default `allowedCountryCodes` = "+49,+33,+44"** (DE/FR/UK). Beleg:
  `src/config.js:663-669` (Kommentar bestaetigt "BEWUSST nur diese drei"). US-Ziele
  (+1) sind ohne `ALLOWED_COUNTRY_CODES`-Env-Override technisch nicht waehlbar.
- **"Stundenlimit"** ist ein reines Rate-Limit (`globalHourReached()`/
  `userHourReached()`), kein Tageszeit-Fenster. Gate-Zeilen:
  `src/telephony/outbound-gates.js:289-298` (`grund: "stundenlimit"` /
  `"stundenlimit_nutzer"`); `HOUR_MS = 60*60*1000` Konstante bei
  `src/telephony/outbound-gates.js:91` (Datei-Zeilennummern koennen je nach
  Kommentarumfang leicht abweichen - Konstante ist im Datei-Kopf-Bereich der Gates
  verifiziert vorhanden).
- **Kein Zeitzonen-/Vorwahl-Mapping**: `grep -rniE "areaCode|\bnpa\b|timezone|IANA|
  America/" src/` -> 0 Treffer (verifiziert, Stand dieser Pruefung).
- **Kein TCPA/DNC/Robocall-Bezug**: `grep -rnwE "TCPA|robocall|DNC" src/ README.md
  PLAN-SECURITY.md test/` -> 0 Treffer; `Do.Not.Call`-Variante ebenfalls 0 echte
  Treffer (verifiziert; ein naiver `grep -i "Do.Not.Call"` liefert False-Positives
  in `src/brand-icon-data.js` wegen des base64-Icon-Blobs - Wortgrenzen-Grep zeigt
  0 echte Treffer).
- **Kein Ofcom-Bezug**: `grep -rni "Ofcom" src/ README.md PLAN-SECURITY.md test/
  apps/web` -> 0 Treffer (verifiziert).
- **Korrektur zum Recon-Befund**: Die Behauptung "0 Treffer fuer consent/
  Einwilligung/opt-in/opt-out" ist UNGENAU. `grep -rniE "consent|Einwilligung|
  Zustimmung|opt-in|opt-out|two-party|all-party" src/` liefert **15 Treffer**
  (verifiziert), aber ALLE beziehen sich auf zwei andere Consent-Arten, nicht auf
  Aufzeichnungs-/Transkriptions-Einwilligung des Angerufenen:
  (a) SMS-Summary-Opt-out des TENANTS (`settings.smsSummaryOptIn`,
  `src/sms-summary.js:13`, `src/store/defaults.js:346`, `src/db/schema.sql:95,109-110`,
  `src/store/pg.js:876-877`), (b) Web-Login-Opt-in (`src/web-auth.js:312`,
  `src/config.js:772`). Die Kern-Aussage des Recon (kein Consent-Mechanismus fuer
  die Aufzeichnung/Transkription des ANGERUFENEN existiert) bleibt korrekt - nur der
  Grep-Beleg "0 Treffer" war falsch, es sind 0 EINSCHLAEGIGE Treffer.
- **DSGVO-Export** (Art. 15/20): `GET /api/tenant-data/export`, hinter
  `requireTenant` (Basic-Auth + Tenant-Scope), `publicCall`-Mapper (kein
  streamToken-Leak), audit-geloggt. Beleg: `src/routes/api-read.js:123-138`.
- **DSGVO-Loeschung** (Art. 17): NUR CLI-Skript `scripts/erase-tenant.js`, bewusst
  kein Netz-Endpunkt ("kleinste Angriffsflaeche"), verlangt `tenantId` + `--confirm`,
  `process.exit(1)` bei Fehlen (fail-closed). Beleg: `scripts/erase-tenant.js:1-29`.
  Settings/Profile/aktive Nummern/Kalender/Usage bleiben explizit erhalten (nur
  Calls/Transkripte/ActionItems/call-verknuepfte Notifications + privateNumber).
- **Retention**: `RETENTION_DAYS` (Default 30, 0=aus) fuer beendete Calls inkl.
  Transkript. Beleg: `src/config.js:888-891`. Separate, striktere
  `DIAGNOSTIC_RETENTION_DAYS` (Default 7, 0=aus, fail-closed Richtung Loeschung) fuer
  diagnostisch markierte Roh-Transkripte. Beleg: `src/config.js:892-901`,
  `src/diagnostic-retention.js:1-30` (`diagnosticRetentionGranted` verlangt
  `requested === true` STRIKT, Ziel == eigene verifizierte Nummer).
- **Datenresidenz**: Render-Service-Region `frankfurt`, Kommentar "Datenresidenz
  DE/EU (Entscheidung #4)". Beleg: `render.yaml:6-11`.
- **Marketing-Rechtstexte sind deutschsprachiger Platzhalter**: `datenschutz.astro`
  `lang="de"`, Rechte-Abschnitt nennt nur "Auskunft, Berichtigung, Loeschung,
  Datenuebertragbarkeit" (DSGVO-Sprache), keine CCPA-Begriffe. Beleg:
  `apps/web/src/pages/datenschutz.astro:1-19` (insb. Zeile 16 "Deine Rechte").
  `agb.astro` ebenso Platzhalter. Beleg: `apps/web/src/pages/agb.astro:1-17`.
- **EN-Locale ist britisches Englisch**: `dateLocale: "en-GB"`, `sttLocale: "en-GB"`.
  Beleg: `src/i18n/locales.js:219-220` (im `en:`-Block, direkt nach `language: "en"`).
- **Testabdeckungs-Luecke EN-Disclosure**: `test/f1-i18n-locale.test.js` hat
  End-to-End-Tests (`disclosureSentence(call)` mit echtem `call.language`) fuer
  `deCall`/`frCall` (Zeilen ~203-255, u.a. "DE-Wortlaut: disclosureSentence(de) ==
  gepinnter Offenlegungssatz", "FR: disclosureSentence(fr) liefert die kuratierte
  FR-Variante"), aber **kein** `enCall`-Aequivalent. Der EN-Test bei Zeile 115-129
  ("EN-Bundle: kuratierte EN-Offenlegung...") ruft NUR `LOCALES.en.disclosure(...)`
  direkt auf Bundle-Ebene auf, NICHT `disclosureSentence()`/`openingText()` mit
  einem echten Call-Objekt - verifiziert durch Volltext-Lesen der Datei.
- **Provisioning-Geo kennt US** (reine Kauf-Ebene, keine Sprache/Recht):
  `COUNTRY_SEARCH_PARAMS.US = { telnyxCountryCode: "US" }`. Beleg:
  `src/telephony/provisioning-geo.js:37`. Bestaetigt: US ist auf Kauf-Ebene bekannt,
  auf Sprach-/Recht-Ebene nicht.
- Bestehende Onboarding-Country-Tests decken FR/GB/leer/ungueltig/
  `FORCE_NUMBER_COUNTRY=US` ab (`test/f1-geo-onboard.test.js:25-118`), aber **kein**
  Test mit `body.country="US"` (verifiziert durch Volltext-Grep der Testnamen -
  kein "US" als direktes `body.country` in einem `test(...)`-Titel).

## Luecken

| Luecke | Schaden | Beleg | Schwere |
|---|---|---|---|
| `languageForCountry("US")` faellt auf DE, kein US-Eintrag | US-Onboarding bekommt deutschen Disclosure-Satz -> fuer US-Angerufene unverstaendlich, verfehlt "clear and conspicuous disclosure" | `src/i18n/locales.js:268-280`; `test/f1-geo-port.test.js:61` | S1 |
| Kein Consent-Konzept fuer Aufzeichnung/Transkription des Angerufenen, keine All-Party-Consent-Staaten-Unterscheidung (CA/FL/PA/WA/IL) | Anruf in All-Party-Consent-Staat ohne Einwilligungs-Mechanismus -> Klagerisiko (z.B. Cal. Penal Code 632) | `grep consent/Einwilligung src/` -> 0 einschlaegige Treffer (siehe Korrektur oben) | S1 |
| Kein Tageszeit-/Ruhezeit-Gate (TCPA/FCC 8-21 Uhr lokal), kein Zeitzonen-Wissen im Code | US-Tenant kann jederzeit (auch nachts beim Angerufenen) anrufen lassen | `src/telephony/outbound-gates.js:429-683` (kein Zeit-Gate); `grep areaCode/timezone/IANA` -> 0 | S1 |
| Kein Do-Not-Call-Registry-Abgleich, kein TCPA-Bezug | Bussgeldrisiko pro Anruf, falls Outbound rechtlich als telemarketing-aehnlich gilt | `grep TCPA/DNC` -> 0 Treffer | S1 |
| Keine FCC-Feb-2024-Regel-Umsetzung (KI-Stimme = "artificial voice", braucht Vorab-Einwilligung) | Jeder US-Outbound mit KI-Stimme laeuft ohne Consent-Pruefung | `src/telephony/outbound-gates.js` (kein consent-Gate) | S2 |
| Privacy Policy/ToS sind deutschsprachiger Platzhalter ohne CCPA-Sprache | US-Nutzer sehen englisches Marketing, aber nur deutsche, DSGVO-only Rechtstexte | `apps/web/src/pages/datenschutz.astro:1-19`; `agb.astro:1-17` | S2 |
| Loeschung (Art. 17/CCPA) hat keinen Self-Service-/authentifizierten API-Pfad, nur CLI-Skript ohne dokumentierte Frist | CCPA verlangt zugaenglichen, fristgebundenen Loeschweg; operative Praxis unklar dokumentiert | `scripts/erase-tenant.js:1-29`; `datenschutz.astro` nennt nur E-Mail ohne Frist | S2 |
| Kein End-to-End-Test fuer EN-Disclosure via `call.language="en"` | Stiller EN-Wiring-Bruch (z.B. Refactor) faellt nicht auf, betrifft den Haupt-US-Pfad | `test/f1-i18n-locale.test.js:116-129` vs. `:203-255` | S1 (Testluecke am kritischsten Pfad, daher hoeher gewichtet als reine Politur) |
| Keine Ofcom-spezifische Pruefung/Doku fuer UK (Silent/Abandoned Calls, CLI-Anzeige) | Ungeprueft, ob automatisierte Anrufe gegen Ofcom-Regeln verstossen | `grep Ofcom` -> 0 Treffer repo-weit | S3 |
| `DEFAULT_COUNTRY="DE"` als letzter Fallback (z.B. `GEO_ENABLED=false`) | US-Interessent ohne explizite Landeswahl landet still bei DE/Deutsch, verstaerkt die erste Luecke | `src/store/defaults.js:330-331`; `src/geo/resolve.js:18-23` | S2 |
| PLAN-SECURITY.md hat keine LAW/Consent/TCPA-Rubrik | Sicherheitsplan deckt Recht-pro-Land nicht ab, Risiko bleibt unmanaged in der Doku | Ueberschriften-Struktur PLAN-SECURITY.md (Stichprobe, keine LAW-Sektion) | S3 |
| Kein `body.country="US"`-Onboarding-Test | Ein Regressions-Bruch am US-Onboarding-Pfad faellt nicht auf | `test/f1-geo-onboard.test.js:25-118` (kein US-Fall) | S1 |

## Tests

### LAW-01 - US-Onboarding liefert Deutsch als Tenant-/Nummernsprache (Ist-Stand pinnen)
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: keine Env-Ueberschreibung von `ALLOWED_COUNTRY_CODES`/`FORCE_NUMBER_COUNTRY`; Server per `startServer()` (Testhelper) ohne `.env`
- **Schritte**:
  1. `POST /api/onboard` mit `body.country = "US"` (analog zu den bestehenden FR/GB-Faellen in `test/f1-geo-onboard.test.js:25-62`)
  2. Tenant und Number aus dem Store lesen
- **Erwartetes Ergebnis**: `tenant.country === "US"`, `tenant.defaultLanguage === "de"`, `number.country === "US"`, `number.language === "de"` (deterministisch aus `languageForCountry("US")`)
- **Verifikation**: neuer Test in `test/f1-geo-onboard.test.js` (erweitert die bestehende Testreihe um einen `body.country="US"`-Fall), dann `node --test test/f1-geo-onboard.test.js`
- **Heute erwartbar**: gruen - das Verhalten (US -> de) ist bereits so implementiert und bei `test/f1-geo-port.test.js:61` auf Unit-Ebene gepinnt; dieser Test macht die Konsequenz auf Onboarding-Ebene sichtbar (der eigentliche Zweck ist Dokumentation/Sichtbarkeit der Luecke, nicht ein erwarteter roter Status)
- **Belegt durch**: `src/i18n/locales.js:268-280`; `src/routes/api-onboard.js:139-147`; `test/f1-geo-onboard.test.js:25-118`

### LAW-02 - EN-Disclosure end-to-end ueber disclosureSentence(call) mit call.language="en"
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: Tenant mit `ownerName` geseedet (Muster wie `test/f1-i18n-locale.test.js:190-198`, `BOOTSTRAP_TENANT_ID`)
- **Schritte**:
  1. `enCall = seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language: "en", ... })` (analog `deCall`/`frCall`, `test/f1-i18n-locale.test.js:198-199`)
  2. `disclosureSentence(enCall())` aufrufen
  3. `openingText(enCall({direction:"outbound", goal:"Test goal"}))` aufrufen
- **Erwartetes Ergebnis**: `disclosureSentence(enCall())` === `"Hello, this is an AI assistant calling on behalf of " + OWNER_NAME + ". This conversation will be summarised for the person I represent."` (exakter String, wie `LOCALES.en.disclosure(OWNER_NAME)`); `openingText(...)` beginnt exakt mit diesem Satz, gefolgt von `LOCALES.en.bridgePhrase("Test goal")`
- **Verifikation**: neue Tests in `test/f1-i18n-locale.test.js` direkt nach dem bestehenden FR-Block (Zeile ~255), Muster 1:1 wie die DE/FR-Tests; `node --test test/f1-i18n-locale.test.js`
- **Heute erwartbar**: gruen - das Bundle ist korrekt verdrahtet, nur der Test fehlt; die Erwartung ist, dass er sofort gruen wird, was die Luecke schliesst (kein Produktionsbug, reine Test-Luecke)
- **Belegt durch**: `src/i18n/locales.js:237-239` (EN-Disclosure-Funktion); `src/claude.js:250-258`; `test/f1-i18n-locale.test.js:116-129` (nur Bundle-Ebene) vs. `:203-255` (DE/FR End-to-End, kein EN-Aequivalent)

### LAW-03 - EN-Disclosure als erster Say/Gather-Praefix im Outbound-TwiML (Wiring-Ebene)
- **Prioritaet**: P0
- **Modus**: offline (npm test, Spawn-Server)
- **Vorbedingung**: Owner-Nummer mit `language: "en"` bzw. `settings.language = "en"` geseedet, `/voice/outbound` ueber Twilio-Provider
- **Schritte**:
  1. Analog zu `test/disclosure-outbound.test.js:19-30`, aber Call mit EN-Sprachbindung
  2. `runOutbound({ provider: "twilio" })` aufrufen, TwiML-Body lesen
- **Erwartetes Ergebnis**: TwiML enthaelt `<Say ... language="en-GB">` (oder das fuer EN konfigurierte Voice-Attribut) gefolgt EXAKT vom EN-Disclosure-Wortlaut als erstes Zeichen nach dem Say-Tag, VOR dem `<Gather`-Schluss
- **Verifikation**: Erweiterung von `test/disclosure-outbound.test.js` um einen EN-Fall (das bestehende Testmuster mit `DISCLOSURE_PREFIX`/`SAY_OPEN` fuer EN duplizieren); `node --test test/disclosure-outbound.test.js`
- **Heute erwartbar**: unbekannt - die reine Bundle-Logik ist verifiziert, aber der komplette Wiring-Pfad (Sprache -> render.js -> TwiML-Voice-Attribut) fuer EN wurde in dieser Pruefung nicht bis auf die render.js-Ebene nachverfolgt, da das ausserhalb des fuer LAW zugewiesenen Fokus lag
- **Belegt durch**: `test/disclosure-outbound.test.js:1-30`; `src/i18n/locales.js:237-239`

### LAW-04 - allowedCountryCodes-Default blockt US-Ziele (+1) ohne Env-Override
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES` NICHT gesetzt (Default `+49,+33,+44` greift), gueltiger Tenant mit Abo/KYC (damit das Land-Gate und nicht ein frueheres Gate greift)
- **Schritte**:
  1. `POST /api/calls` mit `to = "+12025550123"` (gueltige US-E.164-Nummer, keine Denylist-Praefixe)
  2. Response lesen
- **Erwartetes Ergebnis**: HTTP 403, Body enthaelt `grund: "land"` bzw. die Fehlermeldung "Laendervorwahl von ... ist nicht erlaubt (ALLOWED_COUNTRY_CODES)"
- **Verifikation**: neuer Test, Muster wie bestehende Land-Gate-Tests (grep `grund.*land` in `test/*.test.js` fuer Vorbild); `node --test <neue-datei>` bzw. Erweiterung eines bestehenden outbound-gates-Tests
- **Heute erwartbar**: gruen - das Gate ist implementiert und aktiv (Default schliesst +1 explizit aus)
- **Belegt durch**: `src/config.js:663-669`; `src/telephony/outbound-gates.js:281-286` (`grund: "land"`), `:177-181` (`countryGateAllowed`)

### LAW-05 - Land-Gate ist eine reine Whitelist, keine Consent-/Zeitfenster-Kopplung
- **Prioritaet**: P1
- **Modus**: manuell (Code-Review-Checkliste, kein automatisierbarer Assert moeglich)
- **Vorbedingung**: keine
- **Schritte**:
  1. `ALLOWED_COUNTRY_CODES=+49,+33,+44,+1` setzen (hypothetischer Flip fuer US-Launch)
  2. Pruefen, ob irgendein weiteres Gate in der Kette (`src/telephony/outbound-gates.js:429-683`) dann automatisch ein Consent- oder Zeitfenster-Signal verlangt
- **Erwartetes Ergebnis**: KEIN weiteres Gate greift automatisch - ein Betreiber koennte das Flag setzen, ohne dass Consent/TCPA-Zeitfenster technisch erzwungen werden (das ist der dokumentierte usHazard)
- **Verifikation**: Code-Review der 17 Gate-Namen gegen die Liste in `src/telephony/outbound-gates.js:429-683`; keine Zeile enthaelt `consent`, `timezone`, `dnc`
- **Heute erwartbar**: rot im Sinne von "Luecke bestaetigt vorhanden" - es gibt keine Kopplung, das ist der Ist-Zustand, den dieser Test dokumentiert (kein Automatismus zu erwarten)
- **Belegt durch**: `src/telephony/outbound-gates.js:429-683` (17 Gate-Namen, keines consent-/zeit-bezogen)

### LAW-06 - Kein Consent-Feld/-Gate fuer Aufzeichnung/Transkription des Angerufenen
- **Prioritaet**: P0
- **Modus**: offline (grep)
- **Vorbedingung**: keine
- **Schritte**: `grep -rniE "recordingConsent|transcriptionConsent|callee.*consent|two.party|all.party" src/`
- **Erwartetes Ergebnis**: 0 Treffer (kein Feld/keine Variable modelliert eine Consent-Pruefung fuer die Transkription des Angerufenen)
- **Verifikation**: exakt der obige grep-Befehl, erwartete Trefferzahl 0
- **Heute erwartbar**: rot im Sinne "Feature fehlt tatsaechlich" - das ist die bestaetigte Luecke selbst, kein Testfehler; als Repo-Pin sinnvoll, damit ein spaeter eingefuehrtes Consent-Feature bewusst diesen Test aktualisiert statt es zu uebersehen
- **Belegt durch**: `grep -rniE "consent|Einwilligung|Zustimmung|opt-in|opt-out|two-party|all-party" src/` -> 15 Treffer, alle SMS-Opt-out (`src/sms-summary.js:13`) bzw. Web-Login-Opt-in (`src/web-auth.js:312`), keiner betrifft Aufzeichnungs-Consent

### LAW-07 - Kein Zeitzonen-/Vorwahl-Wissen im Code (TCPA-8-21-Uhr-Fenster technisch unmoeglich)
- **Prioritaet**: P0
- **Modus**: offline (grep)
- **Vorbedingung**: keine
- **Schritte**: `grep -rniE "areaCode|\\bnpa\\b|timezone|IANA|America/" src/`
- **Erwartetes Ergebnis**: 0 Treffer
- **Verifikation**: exakt der obige grep-Befehl, erwartete Trefferzahl 0
- **Heute erwartbar**: rot im Sinne "Feature fehlt tatsaechlich" - bestaetigte Luecke, Pin-Test
- **Belegt durch**: verifiziert in dieser Pruefung (0 Treffer), `src/telephony/outbound-gates.js:429-683` ohne Zeit-Gate

### LAW-08 - "Stundenlimit"-Gate ist ein Rate-Limit, kein Tageszeit-Fenster (Doku-Pin)
- **Prioritaet**: P1
- **Modus**: offline (npm test, ggf. bestehenden Test lesen)
- **Vorbedingung**: `MAX_CALLS_PER_HOUR` klein setzen (z.B. 1), zwei Outbound-Calls kurz hintereinander ausloesen
- **Schritte**:
  1. Ersten `POST /api/calls` an ein erlaubtes Ziel ausloesen (sollte durchgehen)
  2. Zweiten `POST /api/calls` an ein ANDERES erlaubtes Ziel im selben gleitenden Stunden-Fenster ausloesen
  3. Uhrzeit des Testlaufs protokollieren (z.B. 03:00 Uhr lokal) und pruefen, dass der zweite Call NICHT wegen der Uhrzeit, sondern wegen der Zaehler-Grenze abgelehnt wird
- **Erwartetes Ergebnis**: zweiter Call -> 429 mit `grund: "stundenlimit"`, UNABHAENGIG von der Uhrzeit (auch um 03:00 Uhr laeuft der erste Call technisch durch, wenn er das erste im Fenster ist)
- **Verifikation**: `node --test test/outbound-gates-order.test.js` (falls dort abgedeckt) oder gezielter neuer Test; grep `hourWindowStart` in `src/telephony/outbound-gates.js` bestaetigt "jetzt minus 1h", keine Tageszeit-Berechnung
- **Heute erwartbar**: gruen (das Rate-Limit funktioniert wie beschrieben) - die Luecke ist die FEHLENDE Tageszeit-Pruefung, nicht ein Bug im Rate-Limit selbst
- **Belegt durch**: `src/telephony/outbound-gates.js:289-298` (`grund: "stundenlimit"`); Kommentar-/Konstanten-Beleg `HOUR_MS = 60 * 60 * 1000`

### LAW-09 - Kein DNC-/TCPA-Bezug im Code oder in der Sicherheits-Doku
- **Prioritaet**: P1
- **Modus**: offline (grep)
- **Vorbedingung**: keine
- **Schritte**: `grep -rnwE "TCPA|robocall|DNC" src/ README.md PLAN-SECURITY.md test/`
- **Erwartetes Ergebnis**: 0 Treffer
- **Verifikation**: exakt der obige grep-Befehl (Wortgrenzen-Variante, NICHT das naive `Do.Not.Call`-Regex, das im Base64-Icon-Blob in `src/brand-icon-data.js` False-Positives erzeugt), erwartete Trefferzahl 0
- **Heute erwartbar**: rot im Sinne "Thema fehlt tatsaechlich in Code UND Doku" - bestaetigte Luecke, Pin-Test fuer den Moment, in dem die Rechtsfrage (offene Frage 1) beantwortet wird
- **Belegt durch**: verifiziert in dieser Pruefung (0 echte Treffer nach Wortgrenzen-Korrektur)

### LAW-10 - Keine FCC-Feb-2024-konforme Vorab-Einwilligung fuer KI-Stimme vor US-Outbound
- **Prioritaet**: P1
- **Modus**: manuell (Produktentscheidung + Code-Review)
- **Vorbedingung**: hypothetischer US-Launch (`ALLOWED_COUNTRY_CODES` enthaelt `+1`)
- **Schritte**: Pruefen, ob irgendein Gate vor `resolve_outbound`/`budget` (Zeilen 596-618) ein `aiVoiceConsent`-Flag am Ziel oder Tenant verlangt
- **Erwartetes Ergebnis**: kein solches Gate existiert -> Anruf mit KI-Stimme an US-Nummer laeuft ohne Consent-Pruefung durch die gesamte Kette
- **Verifikation**: Code-Review `src/telephony/outbound-gates.js:429-683`, grep `aiVoiceConsent|artificial.voice` -> 0 Treffer
- **Heute erwartbar**: rot im Sinne "Feature fehlt tatsaechlich" - bestaetigte Luecke
- **Belegt durch**: `src/telephony/outbound-gates.js:429-683` (kein consent-Gate); `src/i18n/locales.js` (Voice-Profile ohne Consent-Kopplung)

### LAW-11 - Privacy Policy (datenschutz.astro) ist deutschsprachiger Platzhalter ohne CCPA-Sprache
- **Prioritaet**: P1
- **Modus**: manuell (Sichtpruefung der gerenderten Seite)
- **Vorbedingung**: `apps/web` lokal gebaut oder Quelle gelesen
- **Schritte**:
  1. `apps/web/src/pages/datenschutz.astro` oeffnen
  2. Auf `lang="de"` sowie Vorkommen von "Do Not Sell", "CCPA", "California", "sale of personal information" pruefen
- **Erwartetes Ergebnis**: `lang="de"` gesetzt; 0 CCPA-spezifische Begriffe vorhanden; Rechte-Abschnitt nennt nur DSGVO-Begriffe (Auskunft/Berichtigung/Loeschung/Datenuebertragbarkeit)
- **Verifikation**: `grep -n 'lang=' apps/web/src/pages/datenschutz.astro`; `grep -niE "CCPA|Do Not Sell|California" apps/web/src/pages/datenschutz.astro` -> erwartete Trefferzahl 0
- **Heute erwartbar**: rot im Sinne "Luecke bestaetigt" - Text ist bewusst Platzhalter (Kommentar "Strategie N1, geflaggt"), kein Bug, aber launch-blockierend fuer US
- **Belegt durch**: `apps/web/src/pages/datenschutz.astro:1-19` (Zeile 16 "Deine Rechte")

### LAW-12 - AGB (agb.astro) ist deutschsprachiger Platzhalter
- **Prioritaet**: P2
- **Modus**: manuell
- **Vorbedingung**: keine
- **Schritte**: `apps/web/src/pages/agb.astro` lesen, auf Platzhalter-Kommentar und fehlenden finalen Vertragstext pruefen
- **Erwartetes Ergebnis**: Kommentar "Geruest mit Platzhalter-Inhalt" vorhanden, kein final verbindlicher Text
- **Verifikation**: `grep -n "Platzhalter" apps/web/src/pages/agb.astro` -> mindestens 1 Treffer
- **Heute erwartbar**: gruen (der Platzhalter-Zustand ist bereits so dokumentiert, dieser Test bestaetigt nur den bekannten Zustand)
- **Belegt durch**: `apps/web/src/pages/agb.astro:1-3`

### LAW-13 - Loeschung (Art. 17/CCPA) hat keinen authentifizierten HTTP-Endpunkt
- **Prioritaet**: P1
- **Modus**: offline (curl gegen lokal gestarteten Server)
- **Vorbedingung**: `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`
- **Schritte**: `curl -s -o /dev/null -w "%{http_code}" -u admin:admin http://localhost:3999/api/tenant-data/erase` (oder aehnliche plausible Pfad-Kandidaten: `/api/tenant-data`, `/api/erase-tenant`)
- **Erwartetes Ergebnis**: 404 (kein solcher Endpunkt existiert; nur `GET /api/tenant-data/export` ist real)
- **Verifikation**: der curl-Aufruf, erwarteter Status 404; Gegenprobe `grep -rn "erase\|delete" src/routes/*.js` zeigt keinen Route-Handler fuer Loeschung
- **Heute erwartbar**: gruen (die Abwesenheit ist die bewusste, dokumentierte Design-Entscheidung "kleinste Angriffsflaeche") - dieser Test bestaetigt die Absicherung, die Luecke ist der FEHLENDE Self-Service-Weg, kein Bug
- **Belegt durch**: `scripts/erase-tenant.js:6-7` ("BEWUSST KEIN Netz-Endpunkt"); `src/routes/api-read.js:123-138` (Export existiert, Loeschung nicht)

### LAW-14 - erase-tenant.js verlangt tenantId UND --confirm (fail-closed CLI-Gate)
- **Prioritaet**: P1
- **Modus**: offline (node-Skript-Aufruf gegen Test-DATA_DIR)
- **Vorbedingung**: `DATA_DIR` auf ein Temp-Verzeichnis mit einem seedbaren `store.json` gesetzt
- **Schritte**:
  1. `node scripts/erase-tenant.js` (ohne Argumente) ausfuehren
  2. `node scripts/erase-tenant.js sometenant` (ohne `--confirm`) ausfuehren
  3. `node scripts/erase-tenant.js sometenant --confirm` ausfuehren
- **Erwartetes Ergebnis**: Schritt 1 und 2 -> `process.exit(1)`, KEINE Store-Mutation, stderr enthaelt "Aufruf: node scripts/erase-tenant.js"; Schritt 3 -> Exit 0, Zusammenfassungszeile mit `calls=`/`transcriptSegments=`/`actionItems=`/`notifications=`/`privateNumber=` auf stdout
- **Verifikation**: `DATA_DIR=<tmp> node scripts/erase-tenant.js; echo $?` -> erwartet `1`; danach der vollstaendige Aufruf mit `--confirm`, `echo $?` -> erwartet `0`
- **Heute erwartbar**: gruen - das Skript ist exakt so mit fail-closed-Argument-Pruefung implementiert
- **Belegt durch**: `scripts/erase-tenant.js:10-17` (Guard), `:19-28` (Ausfuehrung + Log)

### LAW-15 - Retention-Default 30 Tage / Diagnostic-Retention 7 Tage, fail-closed bei 0
- **Prioritaet**: P1
- **Modus**: offline (npm test, bereits existierende Datei als Basis)
- **Vorbedingung**: keine
- **Schritte**: bestehende Tests in `test/retention.test.js` und `test/diagnostic-retention.test.js` laufen lassen; zusaetzlich pruefen, dass `DIAGNOSTIC_RETENTION_DAYS=0` JEDES markierte Alt-Transkript beim naechsten Sweep loescht (fail-closed Richtung Loeschung, nicht Aufbewahrung)
- **Erwartetes Ergebnis**: `retentionDays` Default 30 (`numEnv fallback`), `diagnosticRetentionDays` Default 7; bei `DIAGNOSTIC_RETENTION_DAYS=0` liefert `diagnosticRetentionEnabled(privacy)` `false` und `diagnosticRetentionGranted(...)` immer `false`
- **Verifikation**: `node --test test/retention.test.js test/diagnostic-retention.test.js`
- **Heute erwartbar**: gruen - beide Testdateien existieren bereits und decken das Verhalten ab
- **Belegt durch**: `src/config.js:888-901`; `src/diagnostic-retention.js:14-30`; `test/retention.test.js:88` ("RETENTION_DAYS=0 schaltet die Retention ab"); `test/diagnostic-retention.test.js`

### LAW-16 - Datenresidenz fix Frankfurt/EU fuer alle Tenants inkl. hypothetischer US-Kunden
- **Prioritaet**: P2
- **Modus**: manuell (Infrastruktur-Review, kein Code-Test moeglich)
- **Vorbedingung**: keine
- **Schritte**: `render.yaml` Zeilen 6-11 lesen, DB-Provisioning-Doku in README.md pruefen
- **Erwartetes Ergebnis**: `region: frankfurt` fest gesetzt, Kommentar bestaetigt bewusste EU-Residenz-Entscheidung fuer ALLE Tenants (keine Region-Wahl pro Land)
- **Verifikation**: `grep -n "region:" render.yaml` -> `frankfurt`
- **Heute erwartbar**: gruen (Konfiguration ist so gesetzt) - die Luecke ist die FEHLENDE explizite Offenlegung ggue. US-Kunden in der (noch fehlenden) finalen Datenschutzerklaerung, kein technischer Defekt
- **Belegt durch**: `render.yaml:6-11`

### LAW-17 - EN-Locale ist britisches, nicht US-amerikanisches Englisch
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**: `LOCALES.en.dateLocale` und `LOCALES.en.sttLocale` lesen
- **Erwartetes Ergebnis**: beide `=== "en-GB"` (nicht `"en-US"`)
- **Verifikation**: neuer/erweiterter Assert in `test/f1-i18n-locale.test.js` (`assert.equal(LOCALES.en.dateLocale, "en-GB")`); `node --test test/f1-i18n-locale.test.js`
- **Heute erwartbar**: gruen - so implementiert und bewusst entschieden (Kommentar-Beleg "bewusste Design-Entscheidung, keine US-Variante" laut Recon, im Code selbst nicht explizit kommentiert, aber der Wert ist eindeutig `en-GB`)
- **Belegt durch**: `src/i18n/locales.js:219-220`

### LAW-18 - DEFAULT_COUNTRY/DEFAULT_LANGUAGE-Fallback bei komplett fehlgeschlagener Geo-Ermittlung
- **Prioritaet**: P1
- **Modus**: offline (npm test, bereits vorhandenes Muster erweitern)
- **Vorbedingung**: `GEO_ENABLED` nicht gesetzt/false, `body.country` fehlt, `PROVISIONING_COUNTRY` nicht gesetzt (Muster wie `test/f1-geo-onboard.test.js:63-81` "Onboard ohne country (Geo aus) -> Fallback DE/de")
- **Schritte**: `POST /api/onboard` ohne jegliches Land-Signal
- **Erwartetes Ergebnis**: `tenant.country === "DE"`, `tenant.defaultLanguage === "de"` (byte-identisch zum bestehenden Test)
- **Verifikation**: `node --test test/f1-geo-onboard.test.js` (Test "Onboard ohne country (Geo aus) -> Fallback DE/de")
- **Heute erwartbar**: gruen - bereits bestehender, gruener Test; hier als expliziter LAW-Beleg referenziert (kein neuer Code noetig, nur Cross-Reference)
- **Belegt durch**: `test/f1-geo-onboard.test.js:63-81`; `src/store/defaults.js:330-331`; `src/geo/resolve.js:18-23`

### LAW-19 - languageForCountry: Gross-/Kleinschreibung, Whitespace, unbekannter 2-Buchstaben-Code
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**: `languageForCountry(" us ")`, `languageForCountry("Us")`, `languageForCountry("ZZ")` aufrufen (Edge Cases jenseits der bestehenden Faelle)
- **Erwartetes Ergebnis**: alle drei liefern `"de"` (DEFAULT_LANGUAGE); `normCountry`-Vorverarbeitung in `geo/resolve.js` trimmt/uppercased, `languageForCountry` selbst uppercased ebenfalls (`String(country||"").toUpperCase()`), Whitespace wird NICHT von `languageForCountry` selbst getrimmt (nur von `normCountry` im Onboarding-Pfad) - `languageForCountry(" us ")` liefert daher `DEFAULT_LANGUAGE`, weil `" US "` keinem Key entspricht, nicht weil "US" erkannt wuerde
- **Verifikation**: neuer Assert-Block in `test/f1-geo-port.test.js` direkt nach der bestehenden "unbekanntes/leeres/null Land"-Testgruppe (Zeile ~60-65); `node --test test/f1-geo-port.test.js`
- **Heute erwartbar**: gruen - reine Funktionslogik ohne Sonderfall-Risiko, `|| DEFAULT_LANGUAGE` faengt jeden Nicht-Treffer ab
- **Belegt durch**: `src/i18n/locales.js:277-280` (`languageForCountry`-Implementierung)

### LAW-20 - FORCE_NUMBER_COUNTRY entkoppelt Kauf-Land von Sprache (US-Kauf, DE-Sprache bleibt bestehen)
- **Prioritaet**: P1
- **Modus**: offline (npm test, bereits vorhandener Test)
- **Vorbedingung**: `FORCE_NUMBER_COUNTRY=US`, `body.country` nicht gesetzt (DE-Herkunft per Default)
- **Schritte**: bestehenden Test laufen lassen: `test/f1-geo-onboard.test.js:117` ("FORCE_NUMBER_COUNTRY=US: number.country US, Sprache + tenant am Herkunftsland (DE)")
- **Erwartetes Ergebnis**: `number.country === "US"`, ABER `tenant.defaultLanguage === "de"` UND `number.language === "de"` - die Sprache folgt NICHT dem Kaufland, sondern dem (deutschen) Herkunftsland; ein Tenant koennte so technisch eine US-DID besitzen, waehrend der Disclosure-Satz weiter deutsch bleibt
- **Verifikation**: `node --test test/f1-geo-onboard.test.js`
- **Heute erwartbar**: gruen - bereits bestehender, gruener Test; als LAW-relevanter Edge Case referenziert (verstaerkt LAW-01: eine US-Nummer mit DE-Disclosure ist ein zusaetzlich unerwartetes Kombinations-Szenario)
- **Belegt durch**: `test/f1-geo-onboard.test.js:112-118`; `src/routes/api-onboard.js:151-154`; `src/geo/resolve.js:32-37`

### LAW-21 - Kein Audio, nur Text-Transkript verlaesst das System via MCP (Regel 5)
- **Prioritaet**: P0
- **Modus**: offline (npm test + Code-Review)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n "record_type" src/telephony/adapters/telnyx/voice.js` pruefen (Billing-API-Enum, kein Aufnahme-Feature)
  2. Alle MCP-Tool-Definitionen in `src/mcp-tools.js` auf Audio-Response-Felder pruefen (`audioUrl`, `recordingUrl`, `base64`, o.ae.)
- **Erwartetes Ergebnis**: 0 Treffer fuer Audio-Ausgabefelder in `src/mcp-tools.js`; `record_type` in `telnyx/voice.js` ist nachweislich Teil der Detail-Records-Billing-API, nicht einer Aufnahme-Funktion
- **Verifikation**: `grep -niE "audioUrl|recordingUrl|base64" src/mcp-tools.js` -> erwartete Trefferzahl 0
- **Heute erwartbar**: gruen - Projektregel 5 ("Audio laeuft NIEMALS durch MCP") ist eine der absoluten Regeln und in der bestehenden Architektur so umgesetzt
- **Belegt durch**: `src/telephony/adapters/telnyx/voice.js:32-41,157`; CLAUDE.md Regel 5

### LAW-22 - Race: gleichzeitiges Onboarding zweier US-Interessenten liefert je isoliert DE-Sprache (keine gegenseitige Beeinflussung)
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: zwei parallele `POST /api/onboard`-Requests mit `body.country="US"` gegen denselben Server-Prozess
- **Schritte**: `Promise.all([onboard(US-Request-1), onboard(US-Request-2)])`, danach beide Tenant-Records lesen
- **Erwartetes Ergebnis**: beide Tenants unabhaengig `defaultLanguage === "de"`, `country === "US"`; kein Cross-Talk (keiner der beiden erhaelt versehentlich Werte des anderen) - `withStoreLock` serialisiert die kritische Sektion
- **Verifikation**: neuer Test nach dem Muster bestehender Concurrency-Tests (grep `withStoreLock` in `test/` fuer Vorbild); `node --test <neue-datei>`
- **Heute erwartbar**: unbekannt - `withStoreLock` ist als Mechanismus im Code vorhanden (`src/routes/api-onboard.js` Kommentar "kritischer Abschnitt"), aber kein spezifischer Concurrency-Test fuer den Geo-Pfad wurde in dieser Pruefung gefunden bzw. ausgefuehrt
- **Belegt durch**: `src/routes/api-onboard.js:153-158` (Kommentar zu `withStoreLock`-kritischem Abschnitt)

### LAW-23 - PLAN-SECURITY.md hat keine LAW/Consent/TCPA-Rubrik (Doku-Luecke)
- **Prioritaet**: P2
- **Modus**: manuell (Dokumenten-Review)
- **Vorbedingung**: keine
- **Schritte**: `grep -n "^#\|^##" PLAN-SECURITY.md` (Ueberschriften-Liste extrahieren)
- **Erwartetes Ergebnis**: keine Ueberschrift enthaelt "Recht", "Consent", "TCPA", "Ofcom", "Compliance pro Land"
- **Verifikation**: `grep -niE "consent|TCPA|Ofcom|Recht.*Land" PLAN-SECURITY.md` -> erwartete Trefferzahl 0
- **Heute erwartbar**: rot im Sinne "Doku-Luecke bestaetigt" - PLAN-SECURITY.md deckt nur Budget/Reserve/Provisioning/Billing/Identity ab
- **Belegt durch**: PLAN-SECURITY.md Ueberschriften-Struktur (Stichprobe dieser Pruefung, Themen Budget/Reserve/Provisioning/Billing/Identity)

### LAW-24 - Disclosure bleibt bei EN-Realtime-Engine (bridge.js, VOICE_ENGINE=realtime) LLM-instruiert, nicht LLM-frei
- **Prioritaet**: P1
- **Modus**: manuell (Code-Review, da Realtime-Pfad nicht die Live-Default-Engine ist)
- **Vorbedingung**: `VOICE_ENGINE=realtime`, `call.language="en"`
- **Schritte**: `LOCALES.en.realtimeOpener.outbound(disclosure)` lesen und mit dem DE-Aequivalent vergleichen
- **Erwartetes Ergebnis**: EN-Opener zwingt das Modell per Prompt-Instruktion ("Your first sentence must be exactly: ...") zur EN-Disclosure - ANDERS als der Budget-Pfad (LOCALES-Ebene, kein LLM-freier Zwang); ein Modell-Fehlverhalten koennte den Satz hier theoretisch nicht wortgetreu wiedergeben (strukturell schwaechere Garantie als der Budget-Pfad)
- **Verifikation**: Code-Review `src/i18n/locales.js:196-198` (EN-realtimeOpener), kein automatisierter Test moeglich ohne echten OpenAI-Realtime-Call
- **Heute erwartbar**: unbekannt - strukturelles Risiko ist im Code sichtbar (Prompt-Instruktion statt deterministischer Say-Praefix), aber ob es in der Praxis zu Abweichungen fuehrt, ist ohne Live-Probe nicht pruefbar; da `realtime` heute NICHT die Live-Default-Engine ist (`budget` ist Default), ist die praktische Dringlichkeit niedriger als LAW-01/02/03
- **Belegt durch**: `src/i18n/locales.js:196-198` (EN-Realtime-Opener-Text); CLAUDE.md ("budget ... der heute live laufende Default")

### LAW-25 - Konsistenz-Check: `test/f1-i18n-locale.test.js` und `test/f1-p8-outbound-lang.test.js` decken zusammen keine US/EN-Sprachpraezedenz ab
- **Prioritaet**: P1
- **Modus**: offline (npm test, Luecken-Nachweis)
- **Vorbedingung**: keine
- **Schritte**: `test/f1-p8-outbound-lang.test.js` liest (bereits erfolgt) - Testfaelle nutzen ausschliesslich eine FR-Owner-Nummer (`OWNER_FR_NUMBER = "+33123456789"`) fuer die Praezedenz-Kette `settings.language -> number.language -> tenant.defaultLanguage -> "de"`
- **Erwartetes Ergebnis**: kein Testfall in `test/f1-p8-outbound-lang.test.js` verwendet `language: "en"` oder eine US-Nummer; die Praezedenzkette ist fuer EN nicht eigens durchgespielt (nur strukturell durch die FR-Variante mitgetestet, sprachneutral)
- **Verifikation**: `grep -n '"en"' test/f1-p8-outbound-lang.test.js` -> erwartete Trefferzahl 0 (Stand dieser Pruefung); bei Aenderung diesen Test um einen `numberLanguage: "en"`-Fall erweitern
- **Heute erwartbar**: rot im Sinne "Testluecke bestaetigt" (kein EN-Fall vorhanden), unabhaengig davon ist der Mechanismus selbst sprachagnostisch und daher mit hoher Wahrscheinlichkeit korrekt - das rot bezieht sich auf FEHLENDE Abdeckung, nicht auf einen vermuteten Bug
- **Belegt durch**: `test/f1-p8-outbound-lang.test.js:1-40` (nur FR-Nummer als Geo-Anker verwendet)
