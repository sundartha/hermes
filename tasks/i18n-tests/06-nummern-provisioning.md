# DID - Nummern-Provisioning und DID-Lebenszyklus pro Land

## Ist-Stand (belegt)

- **Suchparameter-Tabelle nur FR/GB/US**: `COUNTRY_SEARCH_PARAMS` enthaelt ausschliesslich Eintraege
  fuer `FR`, `GB`, `US`. Jedes andere Land (inkl. `DE` und real vorkommende Laender wie CA/IE/AU/CH/
  AT/ES/IT) faellt in `searchParamsForCountry` auf den globalen config-Fallback zurueck:
  `countryCode = config.provisioning.provisioningCountry` (Default `"DE"`),
  `connectionId = config.telephony.telnyxConnectionId`.
  Beleg: `src/telephony/provisioning-geo.js:34-38,45-60`.
- **Kein Land setzt `phoneNumberType`**: `entry.phoneNumberType` wird fuer FR/GB/US nicht gepflegt ->
  der Adapter laesst `filter[phone_number_type]` in der Telnyx-Suche komplett weg.
  Beleg: `src/telephony/provisioning-geo.js:30-38,58`; `src/telephony/adapters/telnyx/numbers.js:73`.
- **Hold-Betrag laenderunabhaengig**: `holdAmountForCountry` liefert fuer FR/GB/US denselben
  `config.billing.numberSetupFeeCents`-Default, weil keiner der drei Eintraege `holdAmountCents`
  setzt. Beleg: `src/telephony/provisioning-geo.js:69-77` + Kommentar Z.13-19.
- **`LANGUAGE_FOR_COUNTRY` kennt kein `US`**: nur `DE/AT/CH -> de`, `FR -> fr`, `GB/IE -> en`.
  `languageForCountry("US")` faellt auf `DEFAULT_LANGUAGE = "de"` zurueck.
  Beleg: `src/i18n/locales.js:268-280`; `DEFAULT_LANGUAGE = "de"` in `src/store/defaults.js:331`.
- **Zwei Onboarding-Einstiegspunkte leiten Sprache IMMER aus dem Land ab, kein Client-Override**:
  `POST /api/onboard` ruft `languageForCountry(country)` auf (`src/routes/api-onboard.js:147`) und
  persistiert `number.language`/`tenant.defaultLanguage` daraus (Z.168,172-173). Der
  Webhook-Aktivierungs-Trigger `requestNumberForPaidTenant` tut dasselbe fuer das Herkunftsland
  (`src/billing/provision-trigger.js:36-45`). Kein `language`-Feld im Request-Body vorgesehen.
- **Kauf-Land vs. Herkunftsland entkoppelt, aber `forceNumberCountry` ist global**:
  `resolveNumberCountry(homeCountry, forceNumberCountry) = forceNumberCountry || homeCountry`
  (`src/geo/resolve.js:35-37`), gespeist aus der EINEN Env-Variable `FORCE_NUMBER_COUNTRY`
  (`src/config.js:780-787`) - kein pro-Tenant-Wert, wirkt sofort auf ALLE Tenants.
- **`provisioningCountry`-Fallback ist `"DE"`** (DE-only-Launch-Entscheidung, `src/config.js:778-779`).
  Ein Land ohne Tabelleneintrag sucht real bei Telnyx eine DE-Nummer, obwohl `number.country` selbst
  den echten Wert traegt (`src/telephony/provisioning-geo.js:49-54`).
- **Telnyx-`orderNumber`-Body ist minimal**: `{ phone_numbers: [{ phone_number }], connection_id }` -
  kein `bundle_id`/Regulatory-Feld. `assertTelnyxOk` wird mit `INCLUDE_TELNYX_DETAIL` (nur
  `includeDetail`, OHNE `attachStatus`) aufgerufen -> ein Fehlschlag hat keinen strukturierten
  `err.providerStatus`, landet generisch im Catch von `provisionNumber`.
  Beleg: `src/telephony/adapters/telnyx/numbers.js:85-95`; `src/onboarding.js:72-89`.
- **Fehlgeschlagener Kauf -> `failed`, kein Self-Service-Retry**: Dashboard zeigt
  `"Einrichtung fehlgeschlagen."` (deutscher Hartcode, `public/tenant.html:2` `lang="de"`, Z.343),
  aber `POST /api/onboard/retry` liegt unter der globalen `/api/*`-Basic-Auth (Owner), NICHT unter
  `/api/self-service/*` - `src/self-service-routes.js` enthaelt keine Retry-Route (grep-Beleg unten).
  Beleg: `src/routes/api-onboard.js:243-263` (kein `webAuthMw`); `src/store/state-ops.js:1330-1332`
  (Statuskommentar `FAILED`); `test/p2-onboard-retry.test.js:116` (401 ohne Basic-Auth bestaetigt).
- **`maxNumbersPerTenant`-Default `1`**: harte 1-Nummer-Regel in `requestNumber`.
  Beleg: `src/config.js:697-701`; `src/store/state-ops.js:1269-1270` (bzw. aktuelle Zeilen
  1255-1285 im gelesenen Ausschnitt, Cap-Checks direkt vor dem Anlegen des Number-Records).
- **Drei unabhaengige Doppelkauf-Schloesser**: Queue-`idempotencyKey`-Dedup (memory-Queue),
  Zustandscheck `status===REQUESTED` im Job-Handler, Telnyx-`Idempotency-Key`-Header
  (number-id-gebunden) bei `orderNumber`.
  Beleg: `src/queue/adapters/memory/queue.js:14-16`; `src/worker/provisioning.js:19-22`;
  `src/onboarding.js:68-70,84`; `src/telephony/adapters/telnyx/numbers.js:85-86`.
- **DID-Freigabe bei Kuendigung ist per Default Observe-Only**: `RELEASE_GRACE_DAYS=0` ->
  `runReleaseReconcile` gibt bei `graceMs===0` NIE frei, loggt nur Kandidaten
  (`src/release-reconcile.js:114-122`); nur `provider==='telnyx'` ist automatisiert freigebbar.
  Beleg: `src/config.js:724-732`.
- **Art.-17-Erase ist grace-frei und telnyx-only**: `releaseTenantNumbersOnErase` gibt aktive
  Telnyx-Nummern des geloeschten Tenants sofort frei, ueber denselben `performNumberRelease`-Kern
  wie die Grace-Reconcile, idempotent ueber den active-Filter.
  Beleg: `src/release-reconcile.js:133-155`; `src/store/state-ops.js:1489-1496` (referenziert).
- **Hold- und Capture-Betrag heute immer identisch**: derselbe `holdAmountCents`-Wert geht an
  `placeHold` und `captureHold` (`src/onboarding.js:58-63,93-96`). Der in `provisioning-geo.js`
  dokumentierte Capture-Mismatch-Schutz (R3) ist Code-Geruest, keine reale Differenzierung, weil
  kein Land einen abweichenden Tarif hinterlegt hat.
- **Waehrungen sind global, nicht land-/kundenabhaengig**: `paymentCurrency` Default `"eur"`
  (`src/config.js:362`), `providerCurrency` Default `"USD"` (`src/config.js:369`). Die
  Marketing-Website (`apps/web`, laut Projektwissen) zeigt USD-Preise - ob `PAYMENT_CURRENCY` im
  Live-Render-Env auf `"usd"` gesetzt ist, ist aus dem Repo NICHT pruefbar (offene Frage).
- **`PROVISIONING_ENABLED` Default `false`**: Dry-Run, kein echter Kauf, gedeckelt durch
  `maxNumbers`/`maxNumbersPerTenant`. Beleg: `src/config.js:702-709`.
- **Boot-Sweep-Reconciler ebenfalls Observe-Only per Default**: `PROVISIONING_REDRIVE_MAX_AGE_MS=0`
  -> haengende `requested+queued`-Jobs werden nur geloggt, nicht automatisch nachgekauft.
  Beleg: `src/config.js:710-723`; existierende Tests `test/prov01-boot-reconcile.test.js:217,242`.
- **`resolveCallLanguage` liest PERSISTIERTE Felder, keine Live-Ableitung**: Praezedenz
  `settings.language || number.language || tenant.defaultLanguage || DEFAULT_LANGUAGE`, reine
  Lesefunktion ohne Neuberechnung aus `tenant.country`.
  Beleg: `src/store/state-ops.js:640-652`.
- **Korrektur am Recon-Befund**: Die Behauptung "kein Test mit `country=US` direkt" fuer
  `f1-provisioning-geo.test.js` ist zu praezisieren - `searchParamsForCountry` WIRD dort fuer `US`
  getestet (`test/f1-provisioning-geo.test.js:95`, `US -> +1-Suche`), nur die SPRACHE (`US ->
  language`) wird nirgends assertiert. Dieser Katalog uebernimmt daher die praezisere Formulierung
  (Sprach-Luecke, nicht Land-Suchparameter-Luecke) - siehe DID-15 in der Testtabelle.

## Luecken

| Luecke | Schaden | Beleg | Schwere |
| --- | --- | --- | --- |
| `languageForCountry("US")` liefert `"de"` (US fehlt in `LANGUAGE_FOR_COUNTRY`) | Ein zahlender US-Kunde bekommt ohne manuelles Nachjustieren einen deutschsprachigen Agenten - direkter Bruch des Kernziels | `src/i18n/locales.js:268-280` | S1 |
| Jedes Land ausserhalb {FR,GB,US} kauft real eine DE-Nummer, `number.country` traegt trotzdem den echten Wert | Kanadische/australische/etc. Kunden bekommen eine deutsche Vorwahl ohne sichtbaren Fehler | `src/telephony/provisioning-geo.js:45-60` | S1 |
| Kein Self-Service-Retry nach fehlgeschlagenem Kauf (`/api/onboard/retry` ist Owner-only) | Jeder fehlgeschlagene internationale Kauf braucht manuellen Owner-Eingriff - blockiert Skalierung | `src/routes/api-onboard.js:243-263`; `src/self-service-routes.js` (keine Retry-Route) | S1 |
| Kein `bundle_id`/Regulatory-Feld im Order-Body, Fehler landen generisch (kein `providerStatus`) | Diagnose eines regulatorischen Ablehnungsgrunds ist manuell und langsam, Kunde bleibt ohne Nummer | `src/telephony/adapters/telnyx/numbers.js:85-95` | S2 |
| `phone_number_type` wird fuer kein Land (auch nicht US) gesetzt | Unvorhersehbare Toll-Free- statt Ortsnetznummer moeglich, nicht steuerbar/getestet | `src/telephony/provisioning-geo.js:30-38,58` | S2 |
| `FORCE_NUMBER_COUNTRY` ist global, nicht pro-Tenant | Ein Testschalter fuer "US testen" wuerde versehentlich ALLE Tenants (auch DE-Bestand) umleiten | `src/config.js:780-787`; `src/geo/resolve.js:35-37` | S2 |
| `holdAmountForCountry` liefert fuer alle Laender denselben Betrag | Der Capture-Mismatch-Schutz (R3) ist reines Geruest; realer Telnyx-Laenderpreis wird nicht erfasst | `src/telephony/provisioning-geo.js:13-19,34-38,69-77` | S2 |
| `paymentCurrency`-Default `"eur"`, Website wirbt USD | Falls Live-Env den Default nicht ueberschreibt: US-Kunden sehen/zahlen EUR-Betraege statt beworbener USD-Preise (Preisangabe-Risiko) | `src/config.js:362` (Live-Env ungeprueft) | S2 |
| Kein Test deckt reale Laender CA/IE/AU/CH/AT/ES/IT auf den DE-Fallback ab | Regressions-Sicherheit fehlt fuer genau die Laender, die real den Fallback treffen | `test/f1-provisioning-geo.test.js` (nur ZZ/leer/null/undefined) | S2 |
| `test/bk3-auto-provision.test.js:28-35` prueft bei `fallbackCountry=US` nur `number.country`, nicht `number.language` | Falsche Sicherheit: der Test suggeriert "US ist getestet", der kritischste Teil (Sprache) wird nie geprueft | `test/bk3-auto-provision.test.js:28-35` | S1 |
| `RELEASE_GRACE_DAYS=0` + globaler `maxNumbers`-Cap kann durch Karteileichen neue Anmeldungen blockieren | Beim US-Launch (mehr Neuanmeldungen erwartet) kann ein durch verwaiste Nummern erschoepfter Cap zahlende Kunden abweisen | `src/config.js:691-696,724-732`; `src/release-reconcile.js:111-122` | S3 |
| Dashboard-Fehlertext bei `numberStatus=failed` ist hart auf Deutsch codiert (`lang="de"`) | Ein US-/UK-Kunde saehe (sollte das Dashboard je uebersetzt werden) im Fehlerfall trotzdem den deutschen String, plus keine Handlungsoption | `public/tenant.html:2,343` | S2 |

## Tests

### DID-01 - languageForCountry("US") liefert "en" statt "de"
- **Prioritaet**: P0
- **Modus**: offline (node)
- **Vorbedingung**: keine Env-Variablen noetig, reiner Funktionsaufruf gegen `src/i18n/locales.js`
- **Schritte**:
  1. `LANGUAGE_FOR_COUNTRY` importieren bzw. `languageForCountry("US")` aufrufen.
  2. Ergebnis mit `"en"` vergleichen (Launch-Anforderung: US-Kunden sprechen Englisch).
- **Erwartetes Ergebnis**: `languageForCountry("US") === "en"`
- **Verifikation**:
  `node -e "import('./src/i18n/locales.js').then(m=>{const r=m.languageForCountry('US'); if(r!=='en') throw new Error('FAIL languageForCountry(US)='+r); console.log('OK')})"`
- **Heute erwartbar**: rot - `US` fehlt in `LANGUAGE_FOR_COUNTRY`, Fallback liefert `"de"`.
- **Belegt durch**: `src/i18n/locales.js:268-280`

### DID-02 - POST /api/onboard mit country=US persistiert englische Sprache
- **Prioritaet**: P0
- **Modus**: offline (Server-Spawn wie bestehende `f1-geo-onboard`-Tests)
- **Vorbedingung**: Server mit `GEO_ENABLED` aus (Default), `PROVISIONING_ENABLED=false` (Dry-Run)
- **Schritte**:
  1. `startServer` mit den Basis-Env-Werten aus `test/f1-geo-onboard.test.js` starten.
  2. `POST /api/onboard` mit `{ tenantId, country: "US" }` senden.
  3. Response-JSON `language` sowie den persistierten Tenant/Number-Record (`store.load()` oder
     `/api/state` als Owner) auf `tenant.defaultLanguage` und `number.language` pruefen.
- **Erwartetes Ergebnis**: `response.language === "en"` UND `tenant.defaultLanguage === "en"` UND
  `number.language === "en"`
- **Verifikation**: neuer `test("Onboard mit body.country=US -> en", ...)`-Block in
  `test/f1-geo-onboard.test.js` (Vorbild: bestehender FR/GB-Test Z.25-62), danach
  `node --test test/f1-geo-onboard.test.js`
- **Heute erwartbar**: rot - `languageForCountry("US")` liefert `"de"` (`src/routes/api-onboard.js:147`).
- **Belegt durch**: `src/routes/api-onboard.js:141-152,168,172-173`; `src/i18n/locales.js:268-280`

### DID-03 - Webhook-Aktivierungspfad (BK3) setzt fuer US-Herkunft englische Sprache
- **Prioritaet**: P0
- **Modus**: offline (node:test, reine Funktionslogik ohne Server-Spawn)
- **Vorbedingung**: `makeDefaultState()`, Tenant registriert und per `setTenantGeo` auf
  `country: "US"` gesetzt (oder `fallbackCountry: "US"` ohne Tenant-Geo)
- **Schritte**:
  1. `requestNumberForPaidTenant(s, { tenantId, fallbackCountry: "US", maxNumbers, maxNumbersPerTenant })`
     aufrufen (bzw. mit vorab per `setTenantGeo` gesetztem `country: "US"`).
  2. `r.number.language` pruefen.
- **Erwartetes Ergebnis**: `r.number.language === "en"`
- **Verifikation**: bestehenden Test `test/bk3-auto-provision.test.js:28-35`
  (`"BK3 fallbackCountry US ..."`) um die Assertion `assert.equal(r.number.language, "en")` erweitern,
  danach `node --test test/bk3-auto-provision.test.js`
- **Heute erwartbar**: rot - `languageForCountry(homeCountry)` mit `homeCountry="US"` liefert `"de"`.
- **Belegt durch**: `src/billing/provision-trigger.js:36-45`; `test/bk3-auto-provision.test.js:28-35`
  (bestehender Test prueft NUR `number.country`, die Sprach-Assertion fehlt - genau diese Luecke)

### DID-04 - languageForCountry ist case-insensitiv, auch fuer den kuenftigen US-Eintrag
- **Prioritaet**: P1
- **Modus**: offline (node)
- **Vorbedingung**: keine
- **Schritte**:
  1. `languageForCountry("us")`, `languageForCountry("Us")`, `languageForCountry("US")` aufrufen.
  2. Alle drei Ergebnisse vergleichen.
- **Erwartetes Ergebnis**: alle drei Aufrufe liefern denselben Wert `"en"` (konsistent mit DID-01,
  analog zum bestehenden case-insensitiv-Test fuer `searchParamsForCountry`,
  `test/f1-provisioning-geo.test.js:89`)
- **Verifikation**:
  `node -e "import('./src/i18n/locales.js').then(m=>{const a=m.languageForCountry('us'),b=m.languageForCountry('Us'),c=m.languageForCountry('US'); if(a!=='en'||b!=='en'||c!=='en') throw new Error('FAIL '+a+' '+b+' '+c); console.log('OK')})"`
- **Heute erwartbar**: rot - alle drei liefern `"de"` (US fehlt in der Tabelle, DID-01).
- **Belegt durch**: `src/i18n/locales.js:278-280`

### DID-05 - Reale Nicht-Tabellen-Laender (CA/IE/AU/CH/AT/ES/IT) kaufen unmarkiert eine DE-Nummer
- **Prioritaet**: P1
- **Modus**: offline (node:test, erweitert `test/f1-provisioning-geo.test.js`)
- **Vorbedingung**: `config.provisioning.provisioningCountry` auf Default `"DE"` (keine Env-Ueberschreibung)
- **Schritte**:
  1. Fuer jedes Land aus `["CA","IE","AU","CH","AT","ES","IT"]` `searchParamsForCountry(land)`
     aufrufen.
  2. `result.countryCode` gegen das jeweilige Land vergleichen.
- **Erwartetes Ergebnis**: `result.countryCode !== "DE"` fuer jedes der sieben Laender (das Land
  bekommt entweder eine eigene Suche oder wird zumindest NICHT still auf DE abgebildet)
- **Verifikation**: neuer `test("searchParamsForCountry: reale Laender CA/IE/AU/CH/AT/ES/IT
  fallen NICHT still auf DE", ...)` in `test/f1-provisioning-geo.test.js`
  (Schleife ueber die 7 Laender, `assert.notEqual(searchParamsForCountry(c).countryCode, "DE")`),
  danach `node --test test/f1-provisioning-geo.test.js`
- **Heute erwartbar**: rot - fuer alle 7 Laender liefert `searchParamsForCountry` aktuell
  `countryCode: "DE"` (config-Fallback).
- **Belegt durch**: `src/telephony/provisioning-geo.js:45-60`

### DID-06 - Kein Self-Service-Retry fuer fehlgeschlagenen Nummernkauf
- **Prioritaet**: P1
- **Modus**: offline (grep, statisch)
- **Vorbedingung**: keine
- **Schritte**:
  1. `src/self-service-routes.js` nach einer Retry-Route fuer Nummern durchsuchen
     (`router.post`/`router.get` mit `retry` im Pfad, ausserhalb von `stripeCustomerRetryDelayMs`).
- **Erwartetes Ergebnis**: mindestens eine `/api/self-service/...retry...`-Route existiert, HINTER
  `webAuthMw` (Tenant-Session), NICHT hinter der globalen Owner-Basic-Auth
- **Verifikation**:
  `grep -nE 'router\.(post|get)\(.*retry' src/self-service-routes.js | wc -l` - erwartet `>= 1`
- **Heute erwartbar**: rot - der Befehl liefert `0` (der einzige Treffer fuer `"retry"` in der Datei
  ist `retryDelayMs` fuer den Stripe-Customer-Fetch, keine Route).
- **Belegt durch**: `src/self-service-routes.js` (grep-Beleg, keine Retry-Route);
  `src/routes/api-onboard.js:243-263` (Retry existiert NUR Owner-gated)

### DID-07 - /api/onboard/retry bleibt Owner-only, auch von aussen (Regressions-Pin)
- **Prioritaet**: P0
- **Modus**: offline (node:test, Server-Spawn)
- **Vorbedingung**: wie `test/p2-onboard-retry.test.js` (OAuth-IdP, `DASHBOARD_PASSWORD` gesetzt)
- **Schritte**:
  1. `POST /api/onboard/retry` mit gesetztem `X-Forwarded-For` (simuliert externe IP, kein
     trusted-localhost) OHNE Basic-Auth-Header senden.
- **Erwartetes Ergebnis**: HTTP `401`
- **Verifikation**: `node --test test/p2-onboard-retry.test.js` (Test `(d) proxied ohne
  Basic-Auth -> 401`, Z.116)
- **Heute erwartbar**: gruen - der Test existiert bereits und ist Teil der Suite.
- **Belegt durch**: `test/p2-onboard-retry.test.js:116`; `src/routes/api-onboard.js:243-263`

### DID-08 - Telnyx-Order-Body und -Fehlerpfad ohne Regulatory-Differenzierung
- **Prioritaet**: P1
- **Modus**: offline (node:test, erweitert `test/telnyx-numbers.test.js`)
- **Vorbedingung**: Fake-Fetch wie im bestehenden `orderNumber`-Test (Z.59)
- **Schritte**:
  1. `orderNumber({ e164, connectionId, idempotencyKey })` gegen einen Fake-Fetch aufrufen, der den
     gesendeten Body mitschneidet.
  2. `Object.keys(body)` pruefen.
  3. Zusaetzlich einen Fake-Fetch mit HTTP `422` (Telnyx-Regulatory-Ablehnung) simulieren und den
     geworfenen Error auf `providerStatus` pruefen.
- **Erwartetes Ergebnis**: `Object.keys(body)` ist genau `["phone_numbers", "connection_id"]` (kein
  `bundle_id`/Regulatory-Feld) UND der bei 422 geworfene Error hat `err.providerStatus === undefined`
  (keine strukturierte Differenzierung moeglich)
- **Verifikation**: neue Assertions im bestehenden `orderNumber`-Testblock
  `test/telnyx-numbers.test.js:59` bzw. neuer Test analog zu Z.163-189 (402-Pattern, hier fuer 422),
  danach `node --test test/telnyx-numbers.test.js`
- **Heute erwartbar**: gruen - dokumentiert das aktuelle (luecken-behaftete) Verhalten exakt so, wie
  es im Code steht; die Luecke besteht darin, dass dieses Verhalten NICHT ausreicht, nicht darin,
  dass der Test heute fehlschlaegt.
- **Belegt durch**: `src/telephony/adapters/telnyx/numbers.js:85-95` (`INCLUDE_TELNYX_DETAIL` ohne
  `attachStatus`, im Unterschied zu `releaseNumber` Z.105)

### DID-09 - phone_number_type wird fuer US (und alle Laender) nie gesetzt
- **Prioritaet**: P1
- **Modus**: offline (node:test)
- **Vorbedingung**: `COUNTRY_SEARCH_PARAMS` im Ist-Zustand (kein Land setzt `phoneNumberType`)
- **Schritte**:
  1. `searchParamsForCountry("US")` aufrufen, `result.type` pruefen.
  2. `telnyxNumberProvisioning.searchNumbers({ countryCode: "US" })` gegen einen Fake-Fetch
     aufrufen, die aufgerufene URL/Query mitschneiden.
- **Erwartetes Ergebnis**: `result.type` ist ein definierter Wert (z.B. `"local"`), NICHT
  `undefined`, UND die Query enthaelt `filter[phone_number_type]=local`
- **Verifikation**: neuer Test in `test/f1-provisioning-geo.test.js` (analog Z.95, US-Suchparameter)
  kombiniert mit `test/telnyx-numbers.test.js:38` (URL-Assertion), danach
  `node --test test/f1-provisioning-geo.test.js test/telnyx-numbers.test.js`
- **Heute erwartbar**: rot - `entry.phoneNumberType` ist fuer `US` nicht gesetzt, `result.type` ist
  `undefined`, die Query enthaelt kein `filter[phone_number_type]`.
- **Belegt durch**: `src/telephony/provisioning-geo.js:34-38,58`; `src/telephony/adapters/telnyx/numbers.js:73`

### DID-10 - FORCE_NUMBER_COUNTRY wirkt global auf ALLE Tenants gleichzeitig
- **Prioritaet**: P1
- **Modus**: offline (node:test, Server-Spawn)
- **Vorbedingung**: `FORCE_NUMBER_COUNTRY=US` gesetzt
- **Schritte**:
  1. Zwei Tenants onboarden: einen mit `body.country=DE`, einen mit `body.country=FR`.
  2. Beide `number.country`-Werte pruefen.
- **Erwartetes Ergebnis**: BEIDE Tenants bekommen `number.country === "US"` (der Schalter
  unterscheidet nicht zwischen Tenants) - dies ist ein Regressions-Pin fuer den bekannten Footgun,
  KEIN Fix-Erwartungstest
- **Verifikation**: neuer Test in `test/f1-geo-onboard.test.js` (Vorbild Z.117,
  `"FORCE_NUMBER_COUNTRY=US"`), mit zwei Tenants statt einem, danach
  `node --test test/f1-geo-onboard.test.js`
- **Heute erwartbar**: gruen - `resolveNumberCountry` ignoriert bewusst den Tenant und liefert
  immer `forceNumberCountry`, wenn gesetzt.
- **Belegt durch**: `src/config.js:780-787`; `src/geo/resolve.js:35-37`

### DID-11 - holdAmountForCountry liefert fuer US/FR/GB/DE identischen Betrag
- **Prioritaet**: P2
- **Modus**: offline (node:test, erweitert `test/f1-provisioning-geo.test.js`)
- **Vorbedingung**: keine
- **Schritte**:
  1. `holdAmountForCountry("US", 500)`, `holdAmountForCountry("FR", 500)`,
     `holdAmountForCountry("GB", 500)`, `holdAmountForCountry("DE", 500)` aufrufen.
- **Erwartetes Ergebnis**: alle vier Aufrufe liefern `500` (Default, kein Land hat einen eigenen
  Tarif) - Regressions-Pin fuer den dokumentierten Capture-Mismatch-Schutz als reines Geruest
- **Verifikation**: bestehende Tests `test/f1-provisioning-geo.test.js:105,109,114` um den
  expliziten `US`-Fall erweitern, danach `node --test test/f1-provisioning-geo.test.js`
- **Heute erwartbar**: gruen - keiner der drei Eintraege setzt `holdAmountCents`.
- **Belegt durch**: `src/telephony/provisioning-geo.js:34-38,69-77`

### DID-12 - PAYMENT_CURRENCY Default ist "eur" (Code-Ebene)
- **Prioritaet**: P0
- **Modus**: offline (node)
- **Vorbedingung**: `PAYMENT_CURRENCY` NICHT gesetzt
- **Schritte**:
  1. Config ohne `PAYMENT_CURRENCY` laden, `config.billing.paymentCurrency` lesen.
- **Erwartetes Ergebnis**: `config.billing.paymentCurrency === "eur"`
- **Verifikation**:
  `PAYMENT_CURRENCY= node -e "import('./src/config.js').then(m=>{if(m.config.billing.paymentCurrency!=='eur') throw new Error('FAIL'); console.log('OK')})"`
  (mit den uebrigen fuer den Boot noetigen Minimal-Env-Variablen aus `test/helpers.js` `BASE_ENV`)
- **Heute erwartbar**: gruen - `src/config.js:362` setzt exakt diesen Default.
- **Belegt durch**: `src/config.js:362`

### DID-13 - Live-Render-Env: ist PAYMENT_CURRENCY tatsaechlich auf "usd" gesetzt?
- **Prioritaet**: P0
- **Modus**: manuell (Render-Dashboard, kein Code-Zugriff moeglich)
- **Vorbedingung**: Zugriff auf das Render-Dashboard des Live-Services
- **Schritte**:
  1. Render-Dashboard oeffnen, Environment-Variablen des `hermes`-Web-Service pruefen.
  2. Nach `PAYMENT_CURRENCY` suchen.
- **Erwartetes Ergebnis**: `PAYMENT_CURRENCY=usd` ist explizit gesetzt (sonst zahlen US-Kunden
  EUR-denominierte Betraege, obwohl die Website USD-Preise bewirbt)
- **Verifikation**: manuelle Sichtpruefung im Render-Dashboard; kein automatisiertes Kommando
  moeglich (dieser Agent hat keinen Netz-/Render-Zugriff)
- **Heute erwartbar**: unbekannt - aus dem Repo nicht pruefbar (offene Frage im Recon-Befund).
- **Belegt durch**: `src/config.js:362` (Code-Default); kein Zugriff auf Render-Env

### DID-14 - PROVISIONING_ENABLED Default false schuetzt JEDEN internationalen Kauf
- **Prioritaet**: P0
- **Modus**: offline (node)
- **Vorbedingung**: `PROVISIONING_ENABLED` NICHT gesetzt
- **Schritte**:
  1. Config ohne `PROVISIONING_ENABLED` laden, `config.provisioning.provisioningEnabled` lesen.
- **Erwartetes Ergebnis**: `config.provisioning.provisioningEnabled === false`
- **Verifikation**: bestehende Abdeckung durch `test/f1-geo-onboard.test.js` (Dry-Run-Antworten
  `"provisioning": "disabled"`) und `test/bk3-auto-provision.test.js:18-25`; zusaetzlich
  `node --test test/number-lifecycle.test.js` (Cap-/Request-Pfad im Dry-Run)
- **Heute erwartbar**: gruen - `src/config.js:707-709` setzt `fallback: false`.
- **Belegt durch**: `src/config.js:702-709`

### DID-15 - bk3-Bestandstest fuer US deckt nur das Land, nicht die Sprache (Test-Luecke selbst)
- **Prioritaet**: P1
- **Modus**: offline (Code-Review-Verifikation, kein neuer Testlauf noetig)
- **Vorbedingung**: keine
- **Schritte**:
  1. `test/bk3-auto-provision.test.js:28-35` lesen (`"BK3 fallbackCountry US (keine Tenant-Geo)
     -> Nummer mit country US"`).
  2. Pruefen, ob eine Assertion auf `r.number.language` existiert.
- **Erwartetes Ergebnis**: der bestehende Test enthaelt KEINE `r.number.language`-Assertion (bis
  DID-03 umgesetzt ist) - dieser Test dokumentiert die Test-Luecke selbst als Nachweis, dass
  "US ist getestet" fuer die Sprache eine Fehlannahme waere
- **Verifikation**: `grep -n "number.language" test/bk3-auto-provision.test.js` - erwartete
  Trefferzahl VOR Umsetzung von DID-03: `0` (im betroffenen Testblock Z.28-35)
- **Heute erwartbar**: gruen - der Grep liefert exakt 0 Treffer im relevanten Testblock, was den
  in DID-03 beschriebenen Sachverhalt bestaetigt.
- **Belegt durch**: `test/bk3-auto-provision.test.js:28-35`

### DID-16 - Bestandsdaten-Migration: persistierte Sprache aendert sich nicht rueckwirkend
- **Prioritaet**: P1
- **Modus**: offline (node:test)
- **Vorbedingung**: ein Tenant mit `country: "US"`, `defaultLanguage: "de"` und eine Nummer mit
  `language: "de"` (simuliert einen VOR einem kuenftigen DID-01-Fix onboardeten US-Tenant)
- **Schritte**:
  1. `makeDefaultState()` + `registerTenant` + `setTenantGeo(s, tenantId, { country: "US",
     defaultLanguage: "de" })` aufrufen (simuliert Alt-Zustand).
  2. `requestNumber(s, { tenantId, country: "US", language: "de", ... })` aufrufen (Alt-Nummer mit
     `language: "de"`).
  3. `resolveCallLanguage(s, { tenantId, numberRecord })` aufrufen.
- **Erwartetes Ergebnis**: `resolveCallLanguage(...) === "de"` - OBWOHL `tenant.country === "US"`,
  weil die Funktion die PERSISTIERTEN Felder liest, nicht `tenant.country` live neu ableitet. Wird
  `LANGUAGE_FOR_COUNTRY` spaeter um `US -> en` erweitert (DID-01), bleiben so onboardete
  Bestandstenants stumm auf Deutsch haengen, bis ein separater Migrations-/Backfill-Schritt laeuft
- **Verifikation**: neuer Test in `test/f1-i18n-locale.test.js` oder `test/number-lifecycle.test.js`,
  danach `node --test test/f1-i18n-locale.test.js` (oder Zieldatei)
- **Heute erwartbar**: gruen - `resolveCallLanguage` verhaelt sich exakt so und dokumentiert damit
  die kuenftige Migrations-Luecke, bevor DID-01 umgesetzt wird.
- **Belegt durch**: `src/store/state-ops.js:640-652`

### DID-17 - RELEASE_GRACE_DAYS=0 + knapper maxNumbers-Cap blockiert neuen Signup
- **Prioritaet**: P2
- **Modus**: offline (node:test)
- **Vorbedingung**: `maxNumbers=1`, ein suspendierter Tenant A mit einer `active`-Telnyx-Nummer,
  `RELEASE_GRACE_DAYS=0` (Default)
- **Schritte**:
  1. Zustand mit Tenant A (suspendiert, aktive Telnyx-Nummer) und `maxNumbers=1` aufbauen.
  2. `runReleaseReconcile({ ..., graceMs: 0 })` ausfuehren.
  3. Fuer einen NEUEN Tenant B `requestNumber` aufrufen.
- **Erwartetes Ergebnis**: `runReleaseReconcile` gibt `{ released: 0, observed: >=1 }` zurueck (Tenant
  A's Nummer bleibt belegt) UND Tenant B's `requestNumber` schlaegt mit
  `reason === GLOBAL_CAP_REASON` fehl, OBWOHL Tenant A den Service nicht mehr nutzt
- **Verifikation**: neuer kombinierter Test (bestehende Bausteine: `test/tenant-prolif-d-reconcile.test.js:160`
  fuer den Observe-Only-Teil, `test/number-lifecycle.test.js:109` fuer den Cap-Teil), danach
  `node --test test/tenant-prolif-d-reconcile.test.js test/number-lifecycle.test.js`
- **Heute erwartbar**: gruen - beide Einzelmechanismen sind bereits so implementiert und getestet;
  dieser Test dokumentiert nur ihre Kombination als reales Skalierungsrisiko.
- **Belegt durch**: `src/config.js:691-696,724-732`; `src/release-reconcile.js:111-122`

### DID-18 - Fehlermeldung "Einrichtung fehlgeschlagen." ist hart auf Deutsch codiert
- **Prioritaet**: P1
- **Modus**: manuell (Sichtpruefung) + offline (grep als deterministischer Teilbeleg)
- **Vorbedingung**: keine
- **Schritte**:
  1. `public/tenant.html` auf `<html lang=...>` und die Funktion `agentNumberText` pruefen.
  2. Manuell: Tenant-Dashboard mit einer Nummer im Status `failed` aufrufen (z.B. lokal mit
     praepariertem Store-Zustand), Sprache des angezeigten Texts pruefen.
- **Erwartetes Ergebnis**: der Text passt sich an `tenant.defaultLanguage`/`settings.language` an
  (z.B. `"Setup failed."` fuer einen US-Tenant) statt hart `"Einrichtung fehlgeschlagen."` zu zeigen
- **Verifikation**: `grep -n 'lang="de"' public/tenant.html` (erwartet `1` Treffer, Z.2) UND
  `grep -n "Einrichtung fehlgeschlagen" public/tenant.html` (erwartet `1` Treffer, Z.343) als
  deterministischer Beleg fuer den Ist-Zustand; die Uebersetzung selbst nur manuell pruefbar
- **Heute erwartbar**: gruen (fuer die grep-Assertion, die den Ist-Zustand belegt) - der deutsche
  Text ist tatsaechlich hart codiert; funktional bedeutet das rot fuer das Launch-Ziel
  "englisches Dashboard fuer US-Kunden"
- **Belegt durch**: `public/tenant.html:2,338-345`

### DID-19 - Telnyx-Idempotency-Key ist number-id-gebunden, keine Land-Kollision bei Parallelitaet
- **Prioritaet**: P2
- **Modus**: offline (node:test)
- **Vorbedingung**: zwei Tenants aus unterschiedlichen Laendern (z.B. `US` und `FR`) werden
  gleichzeitig provisioniert (zwei parallele `requestNumber` + Drain-Laeufe)
- **Schritte**:
  1. Zwei `requested`-Nummern mit unterschiedlichem `country` anlegen.
  2. Beide ueber den Worker/Drain-Pfad gleichzeitig (`Promise.all`) provisionieren lassen (Fake-Provisioner
     zeichnet die verwendeten `Idempotency-Key`-Header auf).
- **Erwartetes Ergebnis**: die beiden verwendeten Idempotency-Keys sind unterschiedlich (an die
  jeweilige `numberId` gebunden), UND es entsteht GENAU EIN Kauf pro Nummer (kein Cross-Land-Leck)
- **Verifikation**: Vorbild `test/f1-provisioning-geo.test.js:149` (R1, zweimal drainen -> ein Kauf)
  auf zwei parallele Nummern unterschiedlichen Landes erweitert, danach
  `node --test test/f1-provisioning-geo.test.js`
- **Heute erwartbar**: gruen - der Idempotency-Key wird pro `numberId` erzeugt
  (`src/onboarding.js:68-70,84`), das Land spielt fuer die Schluessel-Eindeutigkeit keine Rolle.
- **Belegt durch**: `src/onboarding.js:68-70,84`; `src/telephony/adapters/telnyx/numbers.js:85-86`

### DID-20 - FORCE_NUMBER_COUNTRY nur Leerzeichen faellt sauber auf das Herkunftsland zurueck
- **Prioritaet**: P2
- **Modus**: offline (node)
- **Vorbedingung**: `FORCE_NUMBER_COUNTRY="   "` (nur Whitespace)
- **Schritte**:
  1. Config mit `FORCE_NUMBER_COUNTRY="   "` laden, `config.provisioning.forceNumberCountry` lesen.
  2. `resolveNumberCountry("DE", config.provisioning.forceNumberCountry)` aufrufen.
- **Erwartetes Ergebnis**: `config.provisioning.forceNumberCountry === ""` (getrimmt, kein
  Whitespace-String) UND `resolveNumberCountry("DE", "") === "DE"` (kein leerer Kauf-Land-String
  gewinnt gegen das Herkunftsland)
- **Verifikation**:
  `FORCE_NUMBER_COUNTRY="   " node -e "import('./src/config.js').then(m=>{if(m.config.provisioning.forceNumberCountry!=='') throw new Error('FAIL trim'); console.log('OK')})"`
  (mit den fuer den Boot noetigen Minimal-Env-Variablen), ergaenzt um einen
  `resolveNumberCountry`-Unit-Test in `test/f1-geo-port.test.js` oder `test/f1-geo-store.test.js`
- **Heute erwartbar**: gruen - `.trim().toUpperCase()` in `src/config.js:787` normalisiert
  Whitespace-only zu `""`, `resolveNumberCountry` behandelt einen leeren String als falsy (`||`).
- **Belegt durch**: `src/config.js:787`; `src/geo/resolve.js:35-37`
