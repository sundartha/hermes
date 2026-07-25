# LANG - Sprach-Aufloesungskette Ende zu Ende

Bereich: von der Registrierung (Web-Login/Onboard) bis zum tatsaechlich gesprochenen Satz im
Anruf (Inbound-Begruessung, Outbound-Offenlegung, TTS/STT-Locale). Fokus: funktioniert das
Produkt fuer einen Nutzer AUSSERHALB Deutschlands (primaer USA, danach UK/EU-Englisch)?

Stichprobenverifikation gegen den Recon-Befund (Korrekturen unten eingearbeitet):
- `LANGUAGE_FOR_COUNTRY`/`languageForCountry` liegen bei Zeile 268-280 (nicht 268-275/278-280
  wie im Recon behauptet - die Funktion beginnt eine Zeile frueher als angegeben, inhaltlich
  aber korrekt). `languageForCountry("US")` ist per Test in `f1-geo-port.test.js:61` exakt
  gepinnt.
- `resolveCallLanguage` liegt bei `state-ops.js:648-651` (Recon: 648-651, korrekt).
- `registerTenant`/`setTenantGeo` werden im gesamten `src/`-Baum ausschliesslich von
  `src/routes/api-onboard.js:161,168` aufgerufen (grep bestaetigt, sonst nur `pg.js`/`json.js`-
  Store-Fassaden und Tests) - Recon-Behauptung bestaetigt.
- `apps/web` ruft `/api/onboard` nirgends auf (grep 0 Treffer) - bestaetigt.
- `render.yaml:141-142` (`ALLOWED_COUNTRY_CODES=+49,+33,+44`), `render.yaml:160-161`
  (`PROVISIONING_COUNTRY=DE`), `render.yaml:175-176` (`FORCE_NUMBER_COUNTRY=US`, nicht
  175-177 wie im Recon - Block endet eine Zeile frueher) - inhaltlich bestaetigt.
- `src/mcp-tools.js:446-448`: der Kommentar "b.language wird serverseitig ... ignoriert" steht
  im Code, ABER die dem MCP-Client sichtbare `describe()`-Zeichenkette ("Gespraechssprache,
  Default 'de'.") sagt das NICHT - die Irrefuehrung betrifft nur den nach aussen sichtbaren
  Vertrag, nicht das interne Wissen der Entwickler. Praezisierung gegenueber dem Recon-Befund.
- `disclosureSentence()` (`src/claude.js:254-259`) und `openingText()` (`src/claude.js:273`)
  loesen die Sprache strikt ueber `localeFor(call.language)` auf - bestaetigt eine zusaetzliche,
  vom Recon nicht genannte Konsequenz: der feste Offenlegungssatz (Regel 2) selbst haengt an
  derselben kaputten Kette und würde bei einem falsch auf "de" haengenden US-Tenant auf
  Deutsch gesprochen (siehe LANG-07).

## Ist-Stand (belegt)

- Sprachtabelle: `LANGUAGE_FOR_COUNTRY` kennt nur DE/AT/CH->de, FR->fr, GB/IE->en; jedes
  andere Land (inkl. US/CA/AU/NZ) faellt in `languageForCountry()` auf `DEFAULT_LANGUAGE`
  ("de") zurueck. `src/i18n/locales.js:268-280`.
- Sprach-Praezedenz (EINE Stelle): `settings.language || numberRecord?.language ||
  tenant?.defaultLanguage || DEFAULT_LANGUAGE`. `src/store/state-ops.js:648-651`.
- Land-Praezedenz beim Onboard: `userCountry > proposedCountry (Geo-IP) > fallbackCountry >
  DEFAULT_COUNTRY ("DE")`. `src/geo/resolve.js:19-24`; Kauf-Land = `forceNumberCountry ||
  homeCountry`. `src/geo/resolve.js:33-35`.
- `registerTenant()`/`setTenantGeo()` (einzige Stelle, die `tenant.country`/
  `tenant.defaultLanguage` setzt) wird NUR von `POST /api/onboard` aufgerufen.
  `src/routes/api-onboard.js:161,168`; keine weiteren Call-Sites in `src/` (grep bestaetigt).
- Der reale Web-Login-Pfad (`wireWebLogin` -> `applyTenantIdentity`/
  `setTenantIdentityIfAbsent`) schreibt nur `firstName`/`lastName` set-if-absent, NIE
  `country`/`defaultLanguage`. `src/wiring/web-login.js:98,102,148`;
  `src/store/state-ops.js:1187` ff. (`setTenantGeo`) wird von dort nicht erreicht.
- `apps/web` ruft `/api/onboard` an keiner Stelle auf (grep: 0 Treffer); die Stripe-
  Subscribe-UI nutzt ausschliesslich `POST /api/self-service/subscribe`.
- Folge: `tenantGeo(s, tenantId)` liefert fuer jeden ueber den echten Flow angelegten
  Tenant `{country: null, defaultLanguage: null}`. `src/store/state-ops.js:1198-1200`
  (Feld liegt in unmittelbarer Naehe von `setTenantGeo`, `?? null`).
- Der Webhook-Kauf (`requestNumberForPaidTenant`) leitet `homeCountry` aus
  `tenantGeo(...).country || fallbackCountry` ab; `fallbackCountry` kommt aus
  `config.provisioning.provisioningCountry`, Default `"DE"`.
  `src/billing/provision-trigger.js:33-37`; `src/config.js` (Default via `render.yaml:161`).
- `render.yaml` kauft Nummern bewusst in den USA (`FORCE_NUMBER_COUNTRY=US`,
  `render.yaml:175-176`), laesst die Sprachableitung aber am DE-Fallback
  (`PROVISIONING_COUNTRY=DE`, `render.yaml:160-161`). `GEO_ENABLED` ist in `render.yaml`
  nicht gesetzt -> Code-Default `false` (`src/config.js:794`).
- Diese Kombination ist bewusst gebaut und gepinnt: US-DID, aber `number.language="de"`.
  `src/billing/provision-trigger.js:33-37` (`resolveNumberCountry`);
  `test/bk3-auto-provision.test.js:38-53`.
- `GREETING_TEMPLATES` (einzige per Self-Service waehlbare Inbound-Begruessung) sind alle
  drei Deutsch, inkl. `DEFAULT_GREETING`. `src/self-service.js:29-33`.
- `settings.greeting` wird im Inbound-Handler direkt verwendet, ohne Bezug zu
  `call.language`. `src/routes/voice.js:265,278-279`.
- `greetingDefault` je Sprache existiert im Locale-Bundle (DE/FR/EN,
  `src/i18n/locales.js:156,206,250`), hat aber ausserhalb von `locales.js` selbst und Tests
  keinen Konsumenten (grep bestaetigt) - toter Code.
- Tenant-Self-Service-Sprachwahl: Dropdown Automatic/de/fr/en,
  `apps/web/src/components/app/SettingsIsland.astro:58-61,122`; Katalog
  `apps/web/src/lib/api.js:459-464` (`SETTINGS_LANGUAGES`, `""` = "Automatic (by number)").
- `updateSettings()` validiert `language` strikt case-sensitiv gegen `SUPPORTED_LANGUAGES`
  (nur exakt `"de"|"fr"|"en"`); ein abweichender Wert wird via `continue` in der Schleife
  kommentarlos verworfen, `changed` bleibt ohne den Key. `src/store/state-ops.js:2498-2521`
  (`isOptionalEnumOverride` 2490-2493, `updateSettings` 2507-2524).
- MCP-Tool `place_call` hat ein `language`-Schema-Feld ("Default de"), das serverseitig
  ignoriert wird; die Sprache kommt ausschliesslich aus
  `store.resolveCallLanguage({tenantId, numberRecord})`. `src/mcp-tools.js:446-448`;
  `src/routes/api-calls.js:91`.
- Inbound und Outbound loesen die Sprache symmetrisch ueber dieselbe Funktion und denselben
  Geo-Anker (die eigene aktive Nummer des Tenants) auf, keine Call-Parameter-Override.
  Inbound: `src/routes/voice.js` (numberRecord aus `numberRecordByE164`); Outbound:
  `src/routes/api-calls.js:91`.
- Die Inbound-Ablehnung fuer eine unbekannte/nicht-aktive Zielnummer ist ein hart deutscher
  String ohne jeden Locale-Bezug (zu diesem Zeitpunkt ist noch kein Tenant aufgeloest).
  `src/routes/voice.js:231` (`"Diese Nummer ist nicht erreichbar. Auf Wiederhören."`).
- Persistenz-Schema: `tenant.country`/`tenant.default_language`, `settings.language`,
  `number.country`/`number.language` sind NULLABLE TEXT ohne DB-Default; `call.language` ist
  die einzige Spalte mit `NOT NULL DEFAULT 'de'`. `src/db/schema.sql:63-64,98,107-108,135,
  402-403`.
- Kein Backfill/Migration fuer `tenant.country`/`tenant.default_language`: `migrate()` ruft
  nur `backfillPeriodStart`, `rekeyProfilesToTenant`, `backfillAccountEmailCase`,
  `seedDefaults` auf. `src/db/migrate.js:160-166`.
- `ALLOWED_COUNTRY_CODES` ist per Default (`render.yaml:141-142` UND `src/config.js:666`)
  auf `+49,+33,+44` begrenzt - `+1` (US/CA) ist als Outbound-Wahlziel nicht erlaubt, geprueft
  in `countryGateAllowed()`. `src/telephony/outbound-gates.js:179-183,282-286` (Reason
  `"land"`, Statuscode 403).
- Der fest verdrahtete Offenlegungssatz (Regel 2) haengt an derselben Kette:
  `disclosureSentence(call)` ruft `localeFor(call.language).disclosure(name)` -
  `src/claude.js:254-259`; `openingText(call)` (LLM-freier Outbound-Erst-Turn) ebenso,
  `src/claude.js:264-278`.

## Luecken

| Luecke | Schaden | Beleg | Schwere |
| --- | --- | --- | --- |
| Realer Onboarding-Pfad (WorkOS-Login + Stripe-Subscribe) ruft `registerTenant`/`setTenantGeo` nie auf | Jeder echte Kunde (inkl. USA) bekommt einen Tenant ohne jede Geo-Info; Sprache faellt auf den Nummern-/Config-Fallback | `src/wiring/web-login.js:98,102,148`; `src/routes/api-onboard.js:161,168`; grep `/api/onboard` in `apps/web` -> 0 | S1 |
| `LANGUAGE_FOR_COUNTRY` kennt US/CA/AU/NZ nicht | Selbst korrekte Geo-Erkennung liefert fuer den erklaerten Hauptmarkt USA weiterhin Deutsch | `src/i18n/locales.js:268-280`; `test/f1-geo-port.test.js:61` | S1 |
| `render.yaml` kauft Nummern in den USA, laesst Sprach-Fallback aber bei DE | US-Kunde bekommt +1-DID mit deutsch sprechendem Agenten als Default-Erlebnis | `render.yaml:160-161,175-176`; `test/bk3-auto-provision.test.js:38-53` | S1 |
| Fest verdrahteter Offenlegungssatz (Regel 2) folgt `call.language`, das fuer jeden Web-Onboard-Tenant strukturell auf "de" haengen bleibt | Ein US-Empfaenger hoert bei Outbound-Calls zuerst einen deutschen Satz - Regel-2-Wortlaut korrekt, aber faktisch in falscher Sprache | `src/claude.js:254-259`; Kette aus obigen zwei Luecken | S1 |
| `ALLOWED_COUNTRY_CODES` schliesst `+1` per Default aus | Ein korrekt auf Englisch konfigurierter US-Tenant kann per Default keinen Outbound-Call zu einer US-Nummer starten | `render.yaml:141-142`; `src/config.js:666`; `src/telephony/outbound-gates.js:179-183` | S1 |
| `GREETING_TEMPLATES` ausschliesslich Deutsch | Der erste gesprochene Satz jedes Inbound-Anrufs bleibt Deutsch, unabhaengig von `language`-Einstellung | `src/self-service.js:29-33`; `src/routes/voice.js:265,278-279` | S2 |
| `greetingDefault` je Sprache im Locale-Bundle ist toter Code | EN/FR-Begruessungstexte existieren, wirken aber nie automatisch | `src/i18n/locales.js:156,206,250`; keine Konsumenten ausserhalb `locales.js`/Tests | S2 |
| Kein Backfill/Migration fuer `tenant.country`/`default_language` | Bestandstenants bleiben auch nach einem Onboarding-Fix dauerhaft auf dem DE-Fallback | `src/db/migrate.js:160-166` | S2 |
| Sprach-Dropdown zeigt fuer unset nur "Automatic (by number)" | US-Tenant hat keinen Hinweis, dass "automatisch" faktisch "Deutsch" bedeutet | `apps/web/src/components/app/SettingsIsland.astro:122`; `apps/web/src/lib/api.js:459-464` | S3 |
| `updateSettings()` validiert `language` case-sensitiv, verwirft z.B. `"EN"` still | Ein Client, der Grossbuchstaben sendet, sieht keinen Fehler, die Einstellung greift lautlos nicht | `src/store/state-ops.js:2490-2493,2507-2524` | S3 |
| Inbound-Ablehnung fuer unbekannte Zielnummer ist hart Deutsch | Anrufer einer fehlgeroutet/dekommissionierten US-DID hoert garantiert Deutsch als letztes Feedback | `src/routes/voice.js:231` | S3 |
| MCP `place_call.language` wird beworben, aber ignoriert (nur interner Code-Kommentar, nicht die client-sichtbare Beschreibung) | Ein MCP-Client koennte annehmen, er steuert die Sprache pro Anruf - strukturell unmoeglich | `src/mcp-tools.js:446-448`; `src/routes/api-calls.js:91` | S3 |

## Tests

### LANG-01 - LANGUAGE_FOR_COUNTRY kennt US/CA/AU/NZ nicht (Mapping-Luecke)
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: keine (reine Unit-Funktion, kein Server-Boot)
- **Schritte**:
  1. `import { languageForCountry, LANGUAGE_FOR_COUNTRY } from "../src/i18n/locales.js"`
  2. Assert: `Object.keys(LANGUAGE_FOR_COUNTRY)` enthaelt NICHT `"US"`, `"CA"`, `"AU"`, `"NZ"`
  3. Assert: `languageForCountry("US") === "de"`, `languageForCountry("CA") === "de"`
- **Erwartetes Ergebnis**: `Object.keys(LANGUAGE_FOR_COUNTRY)` ist exakt
  `["DE","AT","CH","FR","GB","IE"]`; `languageForCountry("US")` liefert `"de"`
- **Verifikation**: `node --test test/f1-geo-port.test.js` (Zeile 61 pinnt bereits
  `languageForCountry("US") === DEFAULT_LANGUAGE`; dieser Test macht die Luecke explizit
  sichtbar statt nur den Fallback zu pinnen - als neuer `test()`-Block in derselben Datei)
- **Heute erwartbar**: gruen (das ist der dokumentierte Ist-Zustand, kein Bug im engeren
  Sinn - der Test dokumentiert die Luecke als Launch-Blocker, nicht als Regressions-Fang)
- **Belegt durch**: src/i18n/locales.js:268-280; test/f1-geo-port.test.js:61

### LANG-02 - Web-Login-Pfad setzt tenant.country/defaultLanguage nie
- **Prioritaet**: P0
- **Modus**: offline (npm test, Server-Kindprozess)
- **Vorbedingung**: `SELF_SERVICE_ENABLED`/`MULTI_TENANT` wie in `web-login-wiring.test.js`
  ueblich; ein Tenant wird ausschliesslich ueber den Dev-Login-Pfad
  (`POST /auth/dev-login`, analog zu `web-login-wiring.test.js:152`) angelegt, NICHT ueber
  `POST /api/onboard`
- **Schritte**:
  1. Server mit `DEV_LOGIN_ENABLED=true` starten (Muster `startServer` aus `test/helpers.js`)
  2. `POST /auth/dev-login` mit einer neuen Subject-ID ausloesen (mintet Session ->
     `accounts.upsertOnFirstLogin` -> Tenant-Anlage)
  3. Store lesen (`srv.readStore()`), den neu angelegten Tenant per `tenantId` suchen
  4. Assert: `tenant.country === null` (oder `undefined`) UND `tenant.defaultLanguage ===
     null`
- **Erwartetes Ergebnis**: nach dem Login existiert der Tenant, aber `country` und
  `defaultLanguage` sind beide nicht gesetzt (kein `registerTenant`/`setTenantGeo`-Aufruf
  fand statt)
- **Verifikation**: neuer Test in `test/web-login-wiring.test.js` (Muster der bestehenden
  Tests dort, z.B. Zeile 152 fuer den Dev-Login-Aufruf)
- **Heute erwartbar**: gruen (bestaetigt genau die dokumentierte Luecke - kein Code-Pfad
  setzt diese Felder ausserhalb `api-onboard.js`)
- **Belegt durch**: src/wiring/web-login.js:98,102,148; src/routes/api-onboard.js:161,168

### LANG-03 - apps/web ruft POST /api/onboard nirgends auf
- **Prioritaet**: P0
- **Modus**: offline (grep, statischer Check)
- **Vorbedingung**: Arbeitskopie von `apps/web/` vorhanden
- **Schritte**:
  1. `grep -rn "/api/onboard" apps/web/src apps/web/public 2>/dev/null`
- **Erwartetes Ergebnis**: 0 Treffer
- **Verifikation**: `grep -rn "/api/onboard" apps/web | wc -l` liefert `0`
- **Heute erwartbar**: gruen (bestaetigt per grep in dieser Session)
- **Belegt durch**: apps/web/src/lib/subscribe.js (nur `/api/self-service/subscribe`,
  `/api/self-service/setup-checkout`); grep-Befund 0 Treffer fuer `/api/onboard`

### LANG-04 - tenantGeo() liefert {country:null, defaultLanguage:null} fuer nicht-onboardeten Tenant
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: `makeDefaultState()` + `registerTenant(s, tenantId, {})` OHNE
  anschliessenden `setTenantGeo`-Aufruf (das ist exakt der reale Web-Login-Zustand)
- **Schritte**:
  1. `const s = makeDefaultState(); registerTenant(s, "t_x", {});`
  2. `const geo = tenantGeo(s, "t_x");`
  3. Assert `geo.country === null` und `geo.defaultLanguage === null`
- **Erwartetes Ergebnis**: `{ country: null, defaultLanguage: null }`
- **Verifikation**: Erweiterung von `test/f1-geo-store.test.js` (dort existiert bereits
  Setup-Code fuer `registerTenant`/`tenantGeo`; ein Test ohne `setTenantGeo`-Aufruf fehlt)
- **Heute erwartbar**: gruen
- **Belegt durch**: src/store/state-ops.js:1187 ff. (setTenantGeo), Feld-Definition
  tenantGeo() unmittelbar danach (`?? null`)

### LANG-05 - render.yaml: FORCE_NUMBER_COUNTRY=US widerspricht PROVISIONING_COUNTRY=DE
- **Prioritaet**: P0
- **Modus**: offline (grep/YAML-Parse, kein Netz)
- **Vorbedingung**: `render.yaml` im Repo-Root
- **Schritte**:
  1. `grep -A1 "key: PROVISIONING_COUNTRY" render.yaml`
  2. `grep -A1 "key: FORCE_NUMBER_COUNTRY" render.yaml`
  3. `grep "key: GEO_ENABLED" render.yaml` (erwartet: kein Treffer)
- **Erwartetes Ergebnis**: `PROVISIONING_COUNTRY` = `"DE"`, `FORCE_NUMBER_COUNTRY` = `"US"`,
  `GEO_ENABLED` fehlt komplett (Code-Default `false`, `src/config.js:794`)
- **Verifikation**: `grep -c "value: \"DE\"" render.yaml` nach `PROVISIONING_COUNTRY`-Zeile
  manuell pruefen, oder ein kleines Node-Skript, das `render.yaml` einliest und beide
  Env-Werte extrahiert und gegeneinander assertet (`forceNumberCountry !== provisioningCountry
  && !geoEnabled` -> Warnung)
- **Heute erwartbar**: gruen (Konfigurationszustand ist so vorhanden, kein Crash - der Test
  dokumentiert die Inkonsistenz als bewussten Launch-Blocker, keine Code-Regression)
- **Belegt durch**: render.yaml:141-142,160-161,175-176; src/config.js:794

### LANG-06 - US-DID + de-Sprache bleibt gepinnt (Regressions-Schutz fuer die Entkopplung)
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: bestehender Test unveraendert lauffaehig
- **Schritte**:
  1. `node --test test/bk3-auto-provision.test.js`
- **Erwartetes Ergebnis**: Test "BK3 forceNumberCountry US ueberschreibt Kauf-Land, Sprache
  bleibt am Herkunftsland (DE)" gruen; `number.country === "US"`, `number.language === "de"`
- **Verifikation**: `node --test test/bk3-auto-provision.test.js`
- **Heute erwartbar**: gruen (bestehender, aktiver Test)
- **Belegt durch**: test/bk3-auto-provision.test.js:38-53; src/billing/provision-trigger.js:33-37

### LANG-07 - Offenlegungssatz (Regel 2) bleibt Deutsch fuer strukturell falsch aufgeloeste US-Tenants
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: ein `call`-Objekt mit `call.language === "de"` (der reale Default-Zustand
  eines Web-onboardeten US-Tenants gemaess LANG-02/LANG-04) UND `call.tenantId` zeigt auf
  einen Tenant mit `ownerName` gesetzt
- **Schritte**:
  1. `import { disclosureSentence, openingText } from "../src/claude.js"`
  2. `tenantContext`/Store so seeden, dass `resolveCallLanguage(...)` fuer diesen Tenant
     `"de"` liefert (kein `settings.language`, kein `number.language`, kein
     `tenant.defaultLanguage` gesetzt)
  3. `disclosureSentence({ tenantId, language: "de" })` aufrufen
- **Erwartetes Ergebnis**: der zurueckgegebene String ist der DEUTSCHE Offenlegungssatz aus
  `LOCALES.de.disclosure(name)` - NICHT Englisch, obwohl der Anruf an eine US-Nummer geht
- **Verifikation**: Erweiterung von `test/personal-assistant-characterization.test.js`
  (dort existiert bereits `disclosureSentence(call({ language: "en" }))` bei Zeile 376 -
  Gegenstueck mit `language: "de"` + Kommentar, dass dies der reale US-Default ist, fehlt)
- **Heute erwartbar**: gruen (bestaetigt die Kettenreaktion aus LANG-02, kein separater Bug
  in `disclosureSentence` selbst - die Funktion tut exakt das Dokumentierte)
- **Belegt durch**: src/claude.js:254-259,264-278

### LANG-08 - ALLOWED_COUNTRY_CODES blockiert Outbound-Ziele in die USA (+1) per Default
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: `config.safety.allowedCountryCodes` auf Default `["+49","+33","+44"]`
  (kein `ALLOWED_COUNTRY_CODES`-Env gesetzt, wie in `BASE_ENV`/`render.yaml`)
- **Schritte**:
  1. Outbound-Gate-Check gegen ein Ziel `to = "+12025550123"` (US-Nummer) ausloesen (analog
     `test/e164-trunk-zero-reject.test.js` oder direkt `countryGateAllowed`-Logik via
     `POST /api/calls`)
  2. Ergebnis pruefen
- **Erwartetes Ergebnis**: `status: 403`, `grund: "land"`, Message enthaelt
  `"ALLOWED_COUNTRY_CODES"` (exakter Text aus `src/telephony/outbound-gates.js:282-286`)
- **Verifikation**: neuer Test, Muster `test/outbound-reserve-gate.test.js`; Assertion auf
  `res.status === 403` und `body.grund === "land"` (Feldname `grund`, nicht `reason`, siehe
  Codebeleg)
- **Heute erwartbar**: gruen (Default-Konfiguration blockt US-Ziele deterministisch)
- **Belegt durch**: src/telephony/outbound-gates.js:179-183,282-286; render.yaml:141-142;
  src/config.js:666

### LANG-09 - languageForCountry ist case-insensitiv, aber fuer US unveraenderlich "de"
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `languageForCountry("us")`, `languageForCountry("Us")`, `languageForCountry("US")`
     aufrufen
- **Erwartetes Ergebnis**: alle drei liefern `"de"` (Gross-/Kleinschreibung aendert am
  Fallback nichts, da "US" ohnehin nicht in der Tabelle steht)
- **Verifikation**: Erweiterung `test/f1-geo-port.test.js` (Zeile 55-64 hat bereits
  Case-Insensitivitaets-Tests fuer "fr"/"gb"; "us" in Klein-/Mischschreibung fehlt)
- **Heute erwartbar**: gruen
- **Belegt durch**: src/i18n/locales.js:278-280; test/f1-geo-port.test.js:55-64

### LANG-10 - End-to-End Onboard mit country=US liefert dennoch language=de
- **Prioritaet**: P0
- **Modus**: offline (npm test, Server-Kindprozess)
- **Vorbedingung**: Server via `SKIP_TWILIO_SIGNATURE_CHECK=true`-Testmodus, kein
  `GEO_ENABLED`
- **Schritte**:
  1. `POST /api/onboard` mit `{ tenantId: "t_us", country: "US" }` (Muster
     `test/f1-geo-onboard.test.js:20-35`, dort fuer `country: "FR"`)
  2. Response + Store lesen
- **Erwartetes Ergebnis**: `res.status === 200`; `json.country === "US"`;
  `json.language === "de"` (NICHT "en" - LANGUAGE_FOR_COUNTRY kennt US nicht);
  `store.tenants.find(...).defaultLanguage === "de"`;
  `store.numbers.find(...).language === "de"`
- **Verifikation**: neuer Test in `test/f1-geo-onboard.test.js`, direktes Analogon zum
  bestehenden FR-Test (Zeile 20-35) und GB-Test (Zeile 39-52)
- **Heute erwartbar**: gruen (das ist der aktuelle, dokumentierte - und fuer den Zielmarkt
  falsche - Ist-Zustand)
- **Belegt durch**: src/i18n/locales.js:278-280; src/routes/api-onboard.js:145-149

### LANG-11 - GREETING_TEMPLATES enthaelt keine EN/FR-Vorlage
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `import { GREETING_TEMPLATES } from "../src/self-service.js"`
  2. Jeden Eintrag pruefen: enthaelt NUR deutsche Woerter/Phrasen (z.B. "Assistent", "Nachricht")
- **Erwartetes Ergebnis**: `GREETING_TEMPLATES.length === 3`; alle drei Eintraege sind
  deutsch (`/Assistent/i`, `/Nachricht|helfen/i` matched auf jeden Eintrag); kein Eintrag
  matched `/assistant|message|Hi,|Hello/i`
- **Verifikation**: neuer Test in einer neuen oder bestehenden Self-Service-Testdatei, z.B.
  `test/self-service-patch.test.js` erweitern
- **Heute erwartbar**: gruen (bestaetigt die Luecke)
- **Belegt durch**: src/self-service.js:29-33

### LANG-12 - settings.greeting wird unabhaengig von call.language gesprochen
- **Prioritaet**: P1
- **Modus**: offline (npm test, Server-Kindprozess, curl-Muster)
- **Vorbedingung**: Tenant mit `settings.language = "en"` UND `settings.greeting` = einer
  der (deutschen) `GREETING_TEMPLATES`-Eintraege; aktive Nummer mit `language` leer
- **Schritte**:
  1. Inbound-Call simulieren (`POST /voice/incoming` mit `SKIP_TWILIO_SIGNATURE_CHECK=true`,
     Muster `test/inbound-routing.test.js`)
  2. TwiML/TeXML-Antwort lesen
- **Erwartetes Ergebnis**: der gesprochene `<Say>`-Text ist der deutsche
  `settings.greeting`-String, OBWOHL `call.language === "en"` (aus `settings.language`
  aufgeloest) - Beweis, dass Begruessung und Sprachfeld entkoppelt sind
- **Verifikation**: neuer Test, Muster `test/inbound-routing.test.js:144-149` (dort wird
  bereits `call.language` aus `number.language` gepinnt) - hier zusaetzlich der TwiML-Text
  gegen den (deutschen) Greeting-String gepruefr
- **Heute erwartbar**: gruen
- **Belegt durch**: src/routes/voice.js:265,278-279

### LANG-13 - greetingDefault im Locale-Bundle ist toter Code
- **Prioritaet**: P2
- **Modus**: offline (grep)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -rn "greetingDefault" src/ --include="*.js" | grep -v "src/i18n/locales.js"`
- **Erwartetes Ergebnis**: 0 Treffer ausserhalb `src/i18n/locales.js`
- **Verifikation**: `grep -rln "greetingDefault" src/ | grep -v locales.js | wc -l` liefert `0`
- **Heute erwartbar**: gruen (bestaetigt per grep in dieser Session)
- **Belegt durch**: src/i18n/locales.js:156,206,250

### LANG-14 - Kein Backfill/Migration fuer tenant.country/default_language
- **Prioritaet**: P1
- **Modus**: offline (grep + npm test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n "await backfill\|await rekey\|await seedDefaults" src/db/migrate.js` (Zeile
     160-166, `migrate()`-Funktion)
  2. Pruefen, dass kein Aufruf `country`/`default_language`/`defaultLanguage` erwaehnt
  3. Ergaenzend: pglite-Test, der eine Tenant-Zeile OHNE country/default_language vor
     `migrate()` einfuegt und danach erneut liest
- **Erwartetes Ergebnis**: `migrate()` ruft ausschliesslich `backfillPeriodStart`,
  `rekeyProfilesToTenant`, `backfillAccountEmailCase`, `seedDefaults` auf; die Tenant-Zeile
  hat nach `migrate()` weiterhin `country IS NULL` und `default_language IS NULL`
- **Verifikation**: `grep -n "backfill" src/db/migrate.js` (erwartet: keine Zeile erwaehnt
  "geo"/"language"/"country"); neuer pglite-Test, Muster `test/f1-geo-store.test.js`
- **Heute erwartbar**: gruen
- **Belegt durch**: src/db/migrate.js:160-166

### LANG-15 - MCP place_call.language wird serverseitig ignoriert
- **Prioritaet**: P1
- **Modus**: offline (npm test, Server-Kindprozess)
- **Vorbedingung**: Owner-Nummer mit `number.language` gesetzt auf `"fr"` (oder ueber
  `settings.language` fixiert), analog `test/f1-p8-outbound-lang.test.js` Setup
- **Schritte**:
  1. `POST /api/calls` mit Body `{ to: TO, objective: "...", language: "en" }` absetzen
     (Muster `test/f1-p8-outbound-lang.test.js:37-43`, aber mit explizitem `language`-Feld
     im Body)
  2. `call.language` im Store lesen
- **Erwartetes Ergebnis**: `call.language === "fr"` (aus `number.language`/
  `resolveCallLanguage`), NICHT `"en"` - der Body-Parameter wird nachweislich ignoriert
- **Verifikation**: Erweiterung `test/f1-p8-outbound-lang.test.js` um einen Testfall mit
  explizitem, abweichendem `body.language`
- **Heute erwartbar**: gruen (Kommentar in `api-calls.js:91` bestaetigt das bewusste
  Ignorieren; MCP-Tool-Schema-Beschreibung in `mcp-tools.js:448` bleibt trotzdem irrefuehrend
  fuer den Client, s. LANG-11-Nachbarschaft in den Luecken)
- **Belegt durch**: src/mcp-tools.js:446-448; src/routes/api-calls.js:91

### LANG-16 - Inbound-Ablehnung fuer unbekannte Zielnummer ist hart Deutsch
- **Prioritaet**: P1
- **Modus**: offline (npm test, curl-Muster)
- **Vorbedingung**: `POST /voice/incoming` mit einer `To`-Nummer, die zu KEINER aktiven
  Nummer im Store gehoert
- **Schritte**:
  1. Server starten, `POST /voice/incoming` mit unbekanntem `To` absetzen
     (`SKIP_TWILIO_SIGNATURE_CHECK=true`)
  2. TwiML/TeXML-Antwort lesen
- **Erwartetes Ergebnis**: Antwort enthaelt exakt
  `"Diese Nummer ist nicht erreichbar. Auf Wiederhören."` gefolgt von Hangup - unabhaengig
  von jeglichem `Accept-Language`-Header oder Anrufer-Land
- **Verifikation**: neuer Test oder Erweiterung `test/voice-incoming-catch-path.test.js`
  (Datei existiert bereits laut Suite-Liste, behandelt vermutlich verwandte Catch-Pfade)
- **Heute erwartbar**: gruen (bestaetigt die dokumentierte Luecke)
- **Belegt durch**: src/routes/voice.js:224-232 (String bei Zeile 231)

### LANG-17 - resolveCallLanguage-Praezedenz vollstaendige Matrix (alle Falsy-Kombinationen)
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**: `resolveCallLanguage(s, {tenantId, numberRecord})` fuer alle 2^3
  Kombinationen aus `settings.language` gesetzt/ungesetzt, `numberRecord.language`
  gesetzt/ungesetzt, `tenant.defaultLanguage` gesetzt/ungesetzt pruefen (inkl. `""` als
  "ungesetzt"-Variante zusaetzlich zu `null`/`undefined`)
- **Erwartetes Ergebnis**: exakt die Praezedenz `settings.language || numberRecord?.language
  || tenant?.defaultLanguage || "de"`; `""` (leerer String) wird als falsy behandelt und
  faellt zur naechsten Stufe durch (kein Sonderfall)
- **Verifikation**: Erweiterung `test/f1-geo-store.test.js` um eine
  Tabellen-getriebene Testschleife ueber alle 8 Kombinationen
- **Heute erwartbar**: gruen (JS `||`-Verkettung ist eindeutig; Test dokumentiert/pinnt es)
- **Belegt durch**: src/store/state-ops.js:648-651

### LANG-18 - resolveCallLanguage mit falsch-case gespeichertem Sprachwert faellt via localeFor auf de zurueck
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: `numberRecord.language = "EN"` (Grossschreibung, kann NUR ausserhalb des
  validierten `updateSettings`-Pfads entstehen, z.B. via direktem DB-Zugriff/Altdaten/
  Migration-Fehler) direkt im Store-State gesetzt
- **Schritte**:
  1. `resolveCallLanguage(s, {tenantId, numberRecord: {language: "EN"}})` aufrufen ->
     liefert `"EN"` unveraendert (reine Praezedenz, kein Normalisieren)
  2. `localeFor("EN")` aufrufen (der nachgelagerte Resolver)
- **Erwartetes Ergebnis**: `resolveCallLanguage(...) === "EN"` (String wird 1:1
  durchgereicht); `localeFor("EN") === LOCALES.de` (Fail-Safe-Fallback, weil `LOCALES["EN"]`
  nicht existiert - nur `LOCALES.en` mit Kleinbuchstaben)
- **Verifikation**: Erweiterung `test/f1-i18n-locale.test.js` (dort ist der
  R7-Fail-Safe-Vertrag von `localeFor` bereits Thema)
- **Heute erwartbar**: gruen (JS-Objektzugriff ist case-sensitiv, `LOCALES` hat nur
  Kleinbuchstaben-Keys - bestaetigt einen weiteren, subtilen Stillen-Fallback-auf-Deutsch-Pfad)
- **Belegt durch**: src/i18n/locales.js:283-285 (localeFor); src/store/state-ops.js:648-651

### LANG-19 - updateSettings verwirft language="EN" (Grossschreibung) still, ohne Fehler
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: Tenant mit Default-Settings (`settings.language` ungesetzt)
- **Schritte**:
  1. `updateSettings(s, tenantId, { language: "EN" })` aufrufen
  2. Rueckgabewert + Store-Zustand pruefen
- **Erwartetes Ergebnis**: `changed` (Rueckgabe-Array) enthaelt NICHT `"language"`;
  `settingsFor(s, tenantId).language` bleibt unveraendert (weiterhin `null`/vorheriger
  Wert); kein Error/Exception wird geworfen
- **Verifikation**: neuer Test, z.B. Erweiterung `test/self-service-patch.test.js` oder
  einer Settings-fokussierten Testdatei; Assertion `assert.deepEqual(result.changed, [])`
- **Heute erwartbar**: gruen (bestaetigt den stillen No-Op als Ist-Zustand)
- **Belegt durch**: src/store/state-ops.js:2490-2493,2507-2524

### LANG-20 - "Automatic (by number)"-UI-Label verschleiert den faktischen DE-Fallback
- **Prioritaet**: P2
- **Modus**: manuell (Auge)
- **Vorbedingung**: `apps/web` Tenant-Dashboard im Browser geoeffnet, Tenant ohne
  `settings.language`-Override
- **Schritte**:
  1. Sprach-Dropdown im Tenant-Dashboard oeffnen
  2. Pruefen, ob irgendein Text/Tooltip erklaert, was "Automatic" fuer DIESEN Tenant
     konkret bedeutet (z.B. "currently: German")
- **Erwartetes Ergebnis**: Dropdown zeigt nur "Automatic (by number)" ohne Hinweis auf die
  faktisch aufgeloeste Sprache
- **Verifikation**: manuelle Pruefung `apps/web/src/components/app/SettingsIsland.astro:122`
  gegen `apps/web/src/lib/api.js:459-464` (Label-Katalog enthaelt keinen dynamischen Teil)
- **Heute erwartbar**: gruen (bestaetigt die UI-Luecke als Code-Fakt, kein Laufzeit-Test)
- **Belegt durch**: apps/web/src/components/app/SettingsIsland.astro:122;
  apps/web/src/lib/api.js:459-464

### LANG-21 - localeFor() Fail-Safe fuer unbekannte/leere/null Sprachcodes
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `localeFor("xx")`, `localeFor("")`, `localeFor(null)`, `localeFor(undefined)` aufrufen
- **Erwartetes Ergebnis**: alle vier liefern `LOCALES.de` (Referenzgleichheit oder
  inhaltliche Gleichheit mit `LOCALES[DEFAULT_LANGUAGE]`)
- **Verifikation**: Erweiterung `test/f1-i18n-locale.test.js`
- **Heute erwartbar**: gruen
- **Belegt durch**: src/i18n/locales.js:283-285

### LANG-22 - Onboard body.country="us" (Kleinschreibung) normalisiert zu US, Sprache bleibt de
- **Prioritaet**: P1
- **Modus**: offline (npm test, Server-Kindprozess)
- **Vorbedingung**: wie LANG-10
- **Schritte**:
  1. `POST /api/onboard` mit `{ tenantId: "t_us_lc", country: "us" }` (Kleinschreibung)
- **Erwartetes Ergebnis**: `json.country === "US"` (normalisiert via `normCountry()`,
  `src/geo/resolve.js:10-15`); `json.language === "de"` (identisch zu LANG-10, beweist dass
  die Normalisierung die Sprachluecke nicht zufaellig umgeht)
- **Verifikation**: Erweiterung `test/f1-geo-onboard.test.js` (Muster fuer Kleinschreibung
  bereits bei `country: "gb"` in Zeile 39 vorhanden - Analogon fuer "us" fehlt)
- **Heute erwartbar**: gruen
- **Belegt durch**: src/geo/resolve.js:10-15; src/i18n/locales.js:278-280

### LANG-23 - Onboard-Kritischer-Abschnitt bleibt bei parallelen Requests atomar (Nebenlaeufigkeit)
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: zwei parallele `POST /api/onboard`-Requests mit UNTERSCHIEDLICHEN
  `tenantId`, aber gleichzeitigem Timing (`Promise.all`)
- **Schritte**:
  1. `Promise.all([postJson(url, {tenantId:"t_a", country:"FR"}),
     postJson(url, {tenantId:"t_b", country:"GB"})])`
  2. Beide Responses + Store-Zustand pruefen
- **Erwartetes Ergebnis**: `t_a` hat `country="FR"/language="fr"`, `t_b` hat
  `country="GB"/language="en"` - KEINE Vermischung (kein Request "gewinnt" den Country-Wert
  des anderen), da `registerTenant`->`setTenantGeo`->`requestNumber`->`save` in einem
  `withStoreLock`-kritischen Abschnitt ohne fremdes `await` dazwischen laeuft
  (`src/routes/api-onboard.js:159-160` Kommentar)
- **Verifikation**: neuer Test in `test/f1-geo-onboard.test.js`, `Promise.all` statt
  sequenzieller Aufrufe
- **Heute erwartbar**: gruen (das ist der dokumentierte Zweck von `withStoreLock`)
- **Belegt durch**: src/routes/api-onboard.js:159-171 (Kommentar "kein fremdes await
  dazwischen")

### LANG-24 - Bestandstenant ohne Geo bleibt nach Onboarding-Fix auf DE stehen (kein rueckwirkender Effekt)
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: Tenant-Zeile mit `country=null, defaultLanguage=null` bereits im Store
  (simuliert einen VOR einem etwaigen Fix angelegten Bestandstenant), Nummer mit
  `number.language` ebenfalls `null`, kein `settings.language`
- **Schritte**:
  1. `resolveCallLanguage(s, {tenantId, numberRecord})` fuer diesen Bestandstenant aufrufen
- **Erwartetes Ergebnis**: liefert `"de"` (DEFAULT_LANGUAGE) - unveraendert, selbst wenn
  `LANGUAGE_FOR_COUNTRY` spaeter um "US" erweitert wuerde, weil `tenant.country` selbst nie
  nachgezogen wird (kein Backfill, siehe LANG-14)
- **Verifikation**: Erweiterung `test/f1-geo-store.test.js`; Kommentar im Test verweist
  explizit auf die fehlende Migration (LANG-14) als Ursache der Dauerhaftigkeit
- **Heute erwartbar**: gruen
- **Belegt durch**: src/db/migrate.js:160-166; src/store/state-ops.js:648-651

### LANG-25 - Live-Beweis: US-Empfaenger hoert bei Outbound-Call zuerst Deutsch (Regel-2-Verifikation am echten Anruf)
- **Prioritaet**: P0
- **Modus**: live (echter Anruf ueber eine reale DID, kostet Geld - NUR mit expliziter
  Freigabe des Owners ausfuehren)
- **Vorbedingung**: ein via Web+Stripe angelegter Test-Tenant (kein `/api/onboard`-Aufruf),
  `ALLOWED_COUNTRY_CODES` temporaer um `+1` erweitert (sonst blockt LANG-08 den Call vorher),
  `OUTBOUND_FROZEN=false`, gueltige US-Zielnummer im eigenen Besitz (kein Fremdanruf ohne
  Einwilligung)
- **Schritte**:
  1. Outbound-Call ueber MCP `place_call` oder `POST /api/calls` an die eigene US-Testnummer
     ausloesen
  2. Den ersten gesprochenen Satz abhoeren/mitschneiden
- **Erwartetes Ergebnis**: der erste Satz ist der DEUTSCHE Offenlegungssatz (Regel 2),
  NICHT Englisch - Bestaetigung der Kette aus LANG-02/LANG-07 am echten System
- **Verifikation**: manuelles Protokoll (Datum, Call-ID, Transkript-Auszug aus
  `get_transcript`/Dashboard); kein automatisiertes Kommando
- **Heute erwartbar**: rot erwartet im Sinne von "Produkt funktioniert nicht wie gewuenscht"
  - der Test soll GENAU DAS am echten System zeigen, ist also im Sinne von "Ist-Verhalten
  reproduziert sich live" erwartbar gruen (reproduzierbar), im Sinne von "Produkt ist fuer
  US-Launch bereit" aber ein Fail. Diese Doppeldeutigkeit ist beabsichtigt: der Test dient
  als Launch-Gate, nicht als Regressionstest.
- **Belegt durch**: src/claude.js:254-259,264-278; Kette LANG-02/LANG-04/LANG-07

### LANG-26 - Symmetrie-Beweis: Inbound und Outbound teilen exakt denselben Geo-Anker (keine Call-Parameter-Override moeglich)
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: eine Tenant-Nummer mit `number.language = "fr"`
- **Schritte**:
  1. Inbound-Call auf diese Nummer simulieren -> `call.language` lesen
  2. Outbound-Call ueber `POST /api/calls` mit derselben Absendernummer ausloesen (ohne
     `settings.language`-Override) -> `call.language` lesen
- **Erwartetes Ergebnis**: beide `call.language`-Werte sind identisch `"fr"` - dieselbe
  `resolveCallLanguage`-Funktion, derselbe `numberRecord`-Anker, kein struktureller
  Unterschied zwischen den Richtungen
- **Verifikation**: kombinierter Test aus `test/inbound-routing.test.js`-Muster (Zeile
  144-149) und `test/f1-p8-outbound-lang.test.js`-Muster in einer Datei
- **Heute erwartbar**: gruen
- **Belegt durch**: src/routes/voice.js (numberRecordByE164); src/routes/api-calls.js:91;
  src/telephony/outbound-gates.js:313-317 (ctx.numberRecord-Setzung fuer Outbound)
