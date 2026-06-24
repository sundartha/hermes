# Phase P6 (f1-p6) - Geo-Quelle bei Registrierung + Persistenz country/language

## Status

GATE = PASS (dualer Review: Safety + Clean-Code, beide PASS, keine Blocker).
Tests gruen: 819/819. Fix-Runden: 0. NICHT committet (Lead committed).

Umgesetzt: Geo-Quelle bei der Registrierung (maxmind lokal, hinter Flag) plus
Persistenz von `country`/`language` in `tenant` UND im `number`-Request -
voll funktional und mit dem netzfreien Stub testbar.

## Umgesetzte Dateien + Kernentscheidungen

### Geo-Port (DIP, analog `src/telephony/ports.js`)
- `src/geo/ports.js` - JSDoc-Vertrag `GeoLookup(ip) -> {country}|null`. IP verlaesst den Prozess nie.
- `src/geo/stub.js` - netzfreier In-Memory-Adapter (`makeStubGeoLookup` ueber ip->country-Tabelle)
  + `nullGeoLookup` (Default bei GEO_ENABLED=aus, loest nie auf).
- `src/geo/maxmind.js` - maxmind-Adapter: Verdrahtung steht, aber FAIL-SAFE `null`
  (kein echter mmdb-Reader-Dep eingebaut -> Dep-Regel gewahrt). Folge-Ticket im Kopf-Kommentar.
- `src/geo/registry.js` - config-getriebener fail-closed Dispatch
  (geoEnabled aus -> `nullGeoLookup`; an -> maxmind).
- `src/geo/resolve.js` - reine, config-freie Helfer `normCountry` (strikt ISO-2)
  + `resolveOnboardCountry` (Praezedenz User > IP > config > DEFAULT). Eigenes Modul,
  weil `server.js` beim Import `app.listen()`t -> sonst nicht unit-testbar.

### i18n
- `src/i18n/locales.js` - `LANGUAGE_FOR_COUNTRY` (frozen) + `languageForCountry()`:
  zentrale, einzige country->language-Quelle an der i18n-Quelle, generisch
  (1 Eintrag pro Sprache), unbekannt -> `de` (R7).

### Config
- `src/config.js` - `geoEnabled` (GEO_ENABLED, Default `false`) + `geoDbPath` (GEO_DB_PATH).
- `.env.example` - beide dokumentiert.

### Onboard-Wiring (`src/server.js`, `/api/onboard`)
- IP via `req.ip` (proxy-aware, vorhandenes `trust proxy 1`).
- `proposedCountry` NUR bei `geoEnabled` (server.js:969).
- `country = resolveOnboardCountry(...)`: User-Override > IP-Vorschlag > `provisioningCountry` > DE (server.js:970).
- `language = languageForCountry(country)`.
- `setTenantGeo` + `requestNumber(country/language)` im bestehenden kritischen Abschnitt
  (Idempotenz-/Provisioning-Pfad UNANGETASTET).
- Response additiv um `country`/`language` erweitert.

### Tests
- `test/helpers.js` - BASE_ENV: GEO_ENABLED/GEO_DB_PATH neutral/fail-closed gesetzt
  (Lehre test-base-env-drift).
- `test/f1-geo-port.test.js` - 19 Faelle (Stub/Null/maxmind-Adapter, `languageForCountry`
  DE/AT/CH->de, FR->fr, GB/IE->en, unbekannt->de; `normCountry` strikt ISO-2;
  `resolveOnboardCountry`-Praezedenz inkl. R4-Override).
- `test/f1-geo-onboard.test.js` - 5 Spawn-Faelle (body.country=FR -> FR/fr auf tenant UND number;
  GB->en; Fallback DE/de byte-identisch; ungueltiges country fail-safe ignoriert;
  PROVISIONING_COUNTRY-Fallback-Stufe).

## Bewusste Abweichungen

1. **maxmind echter mmdb-Reader NICHT eingebaut** (Dep-Regel hart): Adapter fail-safe `null`
   hinter `geoEnabled`+Asset; als Smoke-Gate/Folge-Ticket in `src/geo/maxmind.js` + config-Kommentar
   vermerkt. Onboard-Kern voll via Stub testbar (Spec erlaubt das).
2. **country->language-Tabelle in `i18n/locales.js`** statt state-ops (state-ops bleibt config-frei;
   i18n-Quelle ist der richtige Ort).
3. **Doc-Drift**: Doc nannte `onboarding.js` (requestNumber-Pfad) - FALSCH. `requestNumber` lebt in
   `state-ops.js` und nahm `country`/`language` bereits aus P1; `onboarding.js` NICHT angefasst (=P7).
   Setter/Schema (`setTenantGeo`, Number-Geo, pg-Flush) waren P1 erledigt -> P6 ergaenzt nur die Aufrufer-Args.
4. **Pure-Helper in eigenes Modul** `src/geo/resolve.js` statt inline in `server.js`
   (server.js `listen()`t beim Import).
5. **Response additiv** um `country`/`language` erweitert (nicht im Doc; kein Secret, hilft Smoke).
6. **pg-Persistenz im Onboard-Spawn-Test nicht erneut gefahren** (Spawn-pg braucht echtes
   Postgres/DATABASE_URL; pglite ist in-process). Dieselben Felder sind in `f1-geo-store.test.js`
   per pglite-Roundtrip abgedeckt (R12 ueber die Suite erfuellt).

## Invarianten (bestaetigt)

- **DE byte-identisch**: GEO_ENABLED Default `false` -> Null-Adapter -> country=DE/language=de
  exakt wie zuvor; ohne `body.country` keine Verhaltensaenderung. Neue Response-Felder rein additiv.
  Regressionsgate gruen.
- **fail-closed**: GEO_ENABLED aus -> nullGeoLookup; maxmind ohne Asset -> null -> Fallback DE.
  Provisioning bleibt fail-closed Dry-Run.
- **Praezedenz**: User-Wahl (autoritativ, R4) > IP-Geo-Vorschlag (nur bei geoEnabled) >
  `config.provisioningCountry` > DEFAULT_COUNTRY. Unbekanntes Land -> de (R7, kein stilles EN/Crash).
  Sprache ueber EINE Quelle (`languageForCountry`/`LANGUAGE_FOR_COUNTRY`, frozen).
- **IP verlaesst den Server nie** (lokaler Adapter; `req.ip` rein lokal an `geoLookup`, kein HTTP-Geo).
  Gespoofte IP kann nichts Autoritatives setzen (bei Override ueberstimmt, sonst nur Vorschlag,
  bei geoEnabled=false ignoriert).
- **Offenlegung unberuehrt** und weiter hart verdrahtet (`disclosureSentence` immer vorangestellt;
  Sprache waehlt nur kuratierte DE/FR/EN-Locale, macht Offenlegung weder abschaltbar noch frei waehlbar).
- **Safety-/Kosten-/Idempotenz-Gates unangetastet** (`withStoreLock` kritischer Abschnitt,
  Caps in `requestNumber`).
- **Durchreichung vollstaendig**: `setTenantGeo` (tenant.country/defaultLanguage) UND `requestNumber`
  (number.country/language) -> `resolveCallLanguage`-Praezedenz
  settings.language -> number.language -> tenant.defaultLanguage -> de bedient.
- Keine neue npm-Dep (package.json/lock unveraendert). Keine Secrets geleakt.
  Kommentare deutsch ohne Umlaute. `node --check` gruen fuer alle geaenderten Dateien.

## Test-Ergebnis

`npm test`: **819/819 gruen** (json-Default + pglite-Backend in der Suite).
geo-Tests 19/19 gruen, alle `node --check` OK.
Pre-existing nicht-blockierende `npm run check`-Fehler (fehlende TWILIO-Creds + keine geseedete
Owner-Nummer im lokalen Store) sind umgebungsbedingt und beruehren P6 NICHT.

## Review-Verdikte

### Safety/Verhalten - PASS (keine Blocker)
DE byte-identisch (Default + Test bewiesen); Praezedenz korrekt (server.js:969/970);
gespoofte IP nicht autoritativ; language ueber eine frozen Quelle (unbekannt->de);
Geo-Port sauber als DIP; keine neue npm-Dep; maxmind fail-safe null hinter Flag;
IP verlaesst Prozess nie; Offenlegung hart verdrahtet; Gates unangetastet;
BASE_ENV fail-closed nachgezogen; keine Secrets.
- S3 (nicht blockierend): kein separater Onboard-Sprach-Override - language wird NUR aus dem Land
  abgeleitet; bei spaeterer body.language-Erweiterung beachten (Folge-Ticket).
- S3 (Folge-Ticket): maxmind heute fail-safe null ohne echten Reader -> GEO_ENABLED=true bringt
  aktuell KEINEN realen Vorschlag (immer null -> DE); Smoke-Gate fuer echten Reader dokumentiert.

### Clean-Code - PASS (keine S1/S2)
DIP analog telephony; Onboard-Wiring funktional + Stub-testbar; IP lokal; DE byte-identisch;
keine Magic Numbers, kein toter/auskommentierter Code, keine abgeschalteten Checks, keine Duplizierung;
Verschachtelung <=1; Onboard-Handler 92 Zeilen (<100); BASE_ENV korrekt; Kommentare deutsch ohne Umlaute.
- S4 (optional): `LANGUAGE_FOR_COUNTRY` koennte spaeter nach config wandern (heute YAGNI).
- S3 (optional): server.js:969 Flag-Gate + Lookup in einer Zeile - benannter Zwischenschritt waere klarer.
- S3 (optional, bestaetigt sauber): modul-globaler `geoLookup` (server.js:950) vertikal nah am Handler.

## Offene Punkte / Smoke-Gates

1. **GEO_ENABLED NICHT faelschlich produktiv setzen**: maxmind-Adapter ist heute fail-safe null
   ohne echten mmdb-Reader -> liefert real immer null -> DE. Echter Geo-Vorschlag braucht
   ein Folge-Ticket (ggf. Owner-genehmigter Dep + GeoLite2-Asset + Reader). Smoke-Gate im
   Adapter-Kommentar dokumentiert.
2. **Onboard-Sprach-Override** existiert nicht (language nur aus Land) - bewusst; bei Bedarf
   Folge-Ticket (body.language-Validierung mitdenken).
3. pg-Persistenz der Geo-Felder ueber Onboard-Spawn nicht erneut gefahren (Spawn-pg braucht echtes
   Postgres); via `f1-geo-store.test.js`/pglite abgedeckt. Echter pg-Smoke offen.
4. Commit durch den Lead (P6 nicht committet).
