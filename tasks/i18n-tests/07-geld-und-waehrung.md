# PAY - Geld: Waehrung, Preise, Steuern, Budget-Gates, Ist-Kosten

## Ist-Stand (belegt)

- Plan-Katalog (Starter 499 ct, Business 999 ct) ist HART in EUR definiert, fuer beide Tarife
  (`currency: "eur"`): src/plans.js:21,37. apps/web/src/lib/plans.js:12,26 ist eine physisch
  getrennte 1:1-Kopie (Deploy-Isolation, kein Import moeglich, siehe Kommentar
  src/plans.js:6-11) - Divergenz zwischen beiden Kopien ist ein roter Cross-Package-Test
  (test/plans-catalog.test.js:8-11).
- Der EUR-Preis ist test-gepinnt als bewusster "EUR-Cutover (Stripe live, 2026-07-03)"
  (test/plans-catalog.test.js:24-26) - byte-genau `assert.equal(plan.currency, "eur", ...)`.
- Die ENGLISCHE Marketing-Preisseite rendert `formatPlanPrice(plan.amountCents, plan.currency)`
  ohne jede Geo-/IP-/Locale-Waehrungswahl (apps/web/src/pages/preise.astro:12,33) - der
  Datei-Kommentar selbst sagt "EUR via formatPlanPrice, KEIN Preis-Literal hier"
  (apps/web/src/pages/preise.astro:2-3). `formatPlanPrice` kennt zwar ein USD-Symbol-Mapping
  (`{ eur: "€", usd: "$" }`, apps/web/src/lib/plans.js:39), es wird aber nie aktiviert,
  weil `currency` im Katalog fest `"eur"` ist.
- Stripe-Kundenwaehrung `paymentCurrency` ist per Default `"eur"` (src/config.js:362); die
  Telnyx-Providerwaehrung `providerCurrency` ist separat und per Default `"USD"`
  (src/config.js:369-373, Kommentar "USD und EUR duerfen sich auf dem Geld-Pfad nie
  vermischen"). Umrechnung ueber eine STATISCHE, manuell zu pflegende Konstante
  `providerToBucketRateMicro` (Default 920000 = 0,92 EUR/USD, "Stand 2026-07", ANNAHME,
  src/config.js:374-379).
- `MAX_BUDGET_EUR` -> `platformSpendCapCents` ist explizit EUR-benannt und ueber `eurToCents`
  gerundet (src/config.js:114,133-139); Env-Name zwingt operatorseitig EUR-Eingabe.
- Inlandstarif (`voiceTariffDomesticCents`, Default 20 ct/min) gilt NUR fuer Ziele mit Praefix
  `+49`/`+33`/`+44` (`VOICE_TARIFF_DOMESTIC_PREFIXES`, src/config.js:105); jedes andere Ziel -
  inkl. `+1` (USA) - faellt auf `voiceTariffDefaultCents` (Default 300 ct/min,
  src/config.js:459-465). `tariffCentsPerMin(to)` entscheidet AUSSCHLIESSLICH ueber die
  Vorwahl der GEWAEHLTEN Zielnummer, nicht ueber Heimatland/Sprache des Tenants
  (src/telephony/outbound-gates.js:139-148). Der Kommentar an derselben Stelle
  (src/config.js:102-104) sagt ausdruecklich: das Land-Gate wird "in Phase 4 '*' (weltweit)",
  der Inlandstarif bleibt aber unabhaengig davon auf diesen drei Vorwahlen stehen.
- `compute_reserve`-Gate: `reserveCents = tariffCentsPerMin(to) * ceil(maxDur/60)`
  (src/telephony/outbound-gates.js:664-669); `maxDur` faellt per `resolveMaxDurationS` auf
  `DEFAULT_CALL_DURATION_S=180` (src/store/defaults.js:252), hart gedeckelt auf
  `MAX_CALL_DURATION_CAP_S=300` (src/store/defaults.js:253, src/telephony/outbound-gates.js:161).
  Bei Default-Werten: Inland 20*3=60 ct Reserve, jedes Nicht-Inlandsziel 300*3=900 ct - Faktor 15.
- `planCapCents(slug, cfg) = includedMinutes * voiceCapRateCentsPerMin * numerator / denominator`
  (src/billing/plan-caps.js:22-29); Kopffreiheit-Bruch Starter 5/3, Business 5/4
  (src/billing/plan-caps.js:11-15). Test-gepinnt EXAKT in
  **test/plan-cap-derivation.test.js:82-84** (nicht in outbound-reserve-reconcile.test.js -
  Korrektur zum Recon-Befund, dort existiert keine planCapCents-Referenz, grep bestaetigt 0
  Treffer fuer "planCapCents|starter|business" in test/outbound-reserve-reconcile.test.js):
  `planCapCents("starter", {voiceCapRateCentsPerMin:6}) === 300`,
  `planCapCents("business", {...}) === 900`.
- `reserveExceedsBudget(s, tenantId, reserveCents, cfg)` prueft
  `spend.spent + reservationFor(s, tenantId) + reserveCents > effectiveCapCents(s, tenantId, cfg)`
  (src/store/state-ops.js:2039-2042, Funktionskopf bei Zeile 2039 - Korrektur zum Recon-Befund,
  der Zeile 2042 als Funktionsstart nannte). Rein `>` (strikt), Reserve exakt auf dem Cap ist
  ERLAUBT (test/outbound-reserve-reconcile.test.js:75-81, "Grenzfall T5").
- Rechnerische Konsequenz: ein Starter-Tenant (Cap 300 ct) kann bei Default-Konfiguration
  KEINEN einzigen Outbound-Call zu einem Nicht-Inlandsziel fuehren (Reserve 900 ct > Cap
  300 ct, immer, unabhaengig vom Verbrauch). Ein Business-Tenant (Cap 900 ct) kann GENAU
  EINEN fuehren, danach ist die komplette Decke reserviert bis der Cost-Truing-Sweep die
  Ueberreservierung korrigiert (`costTruingDelayMinutes` Default 30, src/config.js:397).
- Inbound-Calls werden NIE vom Tenant-Budget abgezogen: `reconcileOutboundVoiceBudget` prueft
  `call.direction !== "outbound"` und kehrt dann sofort zurueck
  (src/billing/metering.js:54-55, Kommentar Zeile 52 "Inbound byte-identisch (kein
  Budget-Abzug)"). ABER: `recordVoiceMinuteMeter` (der Stripe-Voice-Meter, NUR bei
  `PAYMENT_ENABLED`) hat KEINE Richtungspruefung und wird fuer JEDEN beendeten Call
  aufgerufen (src/telephony/call-finish.js:48, `if (config.billing.paymentEnabled)
  metering.recordVoiceMinuteMeter(call);` - ohne Direction-Filter). Es rechnet
  `costCents = minutes * tariffCentsPerMin(call.to)` (src/billing/metering.js:37-46) - bei
  einer vom Tenant gehaltenen US-DID (`call.to` = die eigene US-Nummer bei Inbound) also
  systematisch mit dem 15x-Tarif. Laut Kommentar geht `costCents` NICHT an Stripe, nur
  `quantity` (src/billing/stripe.js:181-184, "costCents ... geht NICHT an Stripe").
- Nummern-Setup-Kosten: `holdAmountForCountry(country, defaultHoldCents)`
  (src/telephony/provisioning-geo.js:62-75) hat einen MECHANISMUS fuer Land-spezifische
  Hold-Betraege (`entry.holdAmountCents`), aber `COUNTRY_SEARCH_PARAMS` (FR/GB/US,
  src/telephony/provisioning-geo.js:34-38) setzt AKTUELL fuer KEIN Land einen
  `holdAmountCents`-Wert - jedes Land, inkl. US, faellt also HEUTE auf denselben
  `config.billing.numberSetupFeeCents`-Default zurueck (Korrektur/Praezisierung zum
  Recon-Befund: die Land-Differenzierung fuer Suchparameter existiert, fuer den Preis
  bisher NICHT).
- Cost-Truing (src/billing/cost-truing.js) gleicht Reservierungen gegen reale Kosten ab,
  unabhaengig vom Zielland - Korrektur greift aber erst nach `costTruingDelayMinutes`
  (Default 30 min), nicht zum Zeitpunkt der Anruf-Anfrage.
- public/tenant.html (einziges verbliebenes Kunden-Dashboard) formatiert JEDEN Geldbetrag
  ueber `Intl.NumberFormat("de-DE", { style:"currency", ... })` (public/tenant.html:215) und
  jedes Datum ueber `toLocaleString("de-DE")` (public/tenant.html:319) bzw.
  `toLocaleDateString("de-DE")` (public/tenant.html:389) - hart codiert, unabhaengig von
  `settings.language` des Tenants.
- Budget-/Plan-Gate-Ablehnungstexte sind hartkodiertes Deutsch ohne Locale-Anbindung:
  `TENANT_UNREADABLE_DENIAL` (src/telephony/outbound-gates.js:105-106), Minuten-Gate-Text
  "Inkludierte Plan-Minuten aufgebraucht..." (src/telephony/outbound-gates.js:651-652),
  `PLATFORM_DENIAL` "Plattform-Notaus aktiv..." (src/telephony/outbound-gates.js:100) -
  im Unterschied zum sprachabhaengigen, aber fest verdrahteten Offenlegungssatz.
- In src/billing/stripe.js (vollstaendig gelesen) taucht in keinem der Aufrufe
  (`placeHold`, `captureHold`, `cancelHold`, `reportMeter`, `createCustomer`,
  `createSubscription` etc.) ein `automatic_tax`-, `billing_address_collection`-,
  `customer_update`- oder `tax_id_collection`-Parameter auf (grep bestaetigt 0 Treffer).
  `placeHold`/`createSubscription` nutzen `off_session: true`
  (src/billing/stripe.js:149,342) ohne erkennbaren 3DS-Redirect-Zweig.
- Der globale Notaus (`globalBudgetExceeded`/`platformSpendCapCents`,
  src/store/state-ops.js:2195-2198) ist EIN geteilter Topf ueber ALLE Tenants und Laender
  und wird von denselben Worst-Case-`reserveCents` gefuettert wie der Tenant-Cap
  (src/telephony/outbound-gates.js:609-698, `reserveOutcome` nutzt `ctx.reserveCents`).
- Kein Test im Repo kombiniert eine Nicht-DE/FR/GB-Zielnummer (z.B. `+1...`) mit
  `tariffCentsPerMin`/`planCapCents`/`effectiveCapCents`/`reserveExceedsBudget` (grep ueber
  alle zehn Fundstellen-Dateien bestaetigt: test/outbound-reserve-reconcile.test.js nutzt
  ausschliesslich rohe Cent-Zahlen ohne `to`-Bezug; test/metering-unit.test.js nutzt nur
  `to: "+491701234567"` (domestic) und generisches `+1`-Vorkommen in anderen Test-Dateien
  betrifft Number-Gate/Messaging, nie den Budget-Pfad).
- Laender-Gate: `allowedCountryCodes` Default `"+49,+33,+44"` (src/config.js:666) - `+1` ist
  per Default NICHT waehlbar, d.h. Gap 1/2 (Reserve-vs-Cap-Kollision) wird erst sichtbar,
  sobald der Betreiber `+1` in `ALLOWED_COUNTRY_CODES` aufnimmt.

## Luecken

| Luecke | Schaden | Beleg | Schwere |
|---|---|---|---|
| Starter-Tenant kann strukturell NIE einen Outbound-Call zu einem Nicht-Inlandsziel fuehren (Reserve 900 ct > Cap 300 ct, immer) | US-Kunde auf guenstigstem Tarif kann das Kernversprechen (autonome Anrufe) nie nutzen | src/telephony/outbound-gates.js:145-148,664-669; src/billing/plan-caps.js:22-29; src/store/state-ops.js:2039-2042 | S1 |
| Business-Tenant kann max. EINEN Nicht-Inlands-Call fuehren, danach komplette Decke gesperrt bis zu 30 min | Zahlender US-Kunde erlebt De-facto-DoS nach dem ersten Anruf | src/store/state-ops.js:2039-2042; src/config.js:397 | S1 |
| "Inland" = nur +49/+33/+44, unabhaengig vom Heimatland des Tenants | US-Anruf zu lokalem US-Geschaeft (Normalfall) wird wie Fern-Ausland behandelt | src/telephony/outbound-gates.js:139-148; src/config.js:105 | S1 |
| Englische Marketing-Preisseite zeigt EUR ohne Geo-/Waehrungsanpassung, Code-Kommentar bestaetigt das bewusst | US-Besucher sehen fremde Waehrung, FX-Fees bei Kartenabbuchung | apps/web/src/pages/preise.astro:2-3,12,33; test/plans-catalog.test.js:24-26 | S1 |
| tenant.html rendert JEDEN Betrag/JEDES Datum hart in de-DE-Notation | Englischsprachiger Kunde sieht verwirrende Zahlen-/Datumsformate auf eigener Abrechnungsseite | public/tenant.html:215,319,389 | S2 |
| Budget-/Plan-Gate-402-Texte sind hartkodiertes Deutsch | US-Tenant sieht bei Ablehnung (die ihn wegen Luecke 1/2 haeufig trifft) deutschen Fehlertext | src/telephony/outbound-gates.js:100,105-106,651-652 | S2 |
| Keine Stripe-Tax-Logik (kein automatic_tax/billing_address_collection/tax_id_collection) | VAT (EU/UK) und US Sales Tax koennen im Code nicht korrekt berechnet/ausgewiesen werden | src/billing/stripe.js (vollstaendig, 0 Tax-Parameter) | S2 |
| Globaler Lebenszeit-Topf wird von denselben 15x-ueberhoehten Nicht-Inlands-Reservierungen gespeist | US-Launch koennte den geteilten Topf ueberproportional erschoepfen und DE/FR/GB-Bestandskunden treffen | src/store/state-ops.js:2195-2198; src/telephony/outbound-gates.js:609-698 | S2 |
| Kein Test kombiniert Nicht-Inlandsziel mit Reserve-vs-Cap-Kollision | Defekt wuerde erst durch echte fehlschlagende US-Kundenanrufe entdeckt | grep-Ergebnis ueber test/ (0 Treffer) | S1 |
| Numbers-Setup-Hold hat einen Land-Mechanismus, aber KEIN Land nutzt ihn aktuell (alle auf Default) | Falls US-Telnyx-Setup-Kosten real vom DE-Default abweichen, driftet Hold vom realen Preis unbemerkt | src/telephony/provisioning-geo.js:34-38,62-75 | S2 |
| providerToBucketRateMicro ist eine statische, manuell gepflegte Konstante ohne eigenen Drift-Alarm | Wachsendes US-Volumen macht einen veralteten Kurs materiell relevanter | src/config.js:370-379 | S3 |
| off_session=true ohne erkennbaren 3DS-Redirect-Pfad bei placeHold/createSubscription | SCA-pflichtiges Kartenscheitern (haeufiger bei US/EU-Karten mit 3DS) hat keinen erkennbaren Retry-Zweig | src/billing/stripe.js:149,342 | S2 |

## Tests

### PAY-01 - Plan-Katalog bleibt EUR und Cross-Package-identisch (Regressionsschutz)
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: keine (reiner Unit-Test, kein .env noetig)
- **Schritte**:
  1. `node --test test/plans-catalog.test.js` ausfuehren
- **Erwartetes Ergebnis**: Alle Tests in der Datei gruen; insbesondere pinnt
  "jeder Plan: Ganzzahl-Cents > 0, eur, ..." `plan.currency === "eur"` fuer beide Slugs
- **Verifikation**: `node --test test/plans-catalog.test.js` -> exit code 0
- **Heute erwartbar**: gruen - der Test ist bestehend und deckungsgleich mit dem
  aktuellen Katalog-Code (src/plans.js:21,37)
- **Belegt durch**: test/plans-catalog.test.js:19-31; src/plans.js:16-49

### PAY-02 - Waehrungsentscheid dokumentieren: EUR-Cutover vs. "USD bindend"-Vorgabe klaeren
- **Prioritaet**: P0
- **Modus**: manuell (Auge/Ohr - Owner-Entscheidung, kein Code-Test moeglich)
- **Vorbedingung**: Zugriff auf Projekt-Historie/Owner
- **Schritte**:
  1. Owner fragen: ist der EUR-Cutover (test/plans-catalog.test.js:24-26, 2026-07-03) eine
     bewusste, DAUERHAFTE Entscheidung gegen die dokumentierte "EN-Marketing/USD,
     Starter $4.99"-Vorgabe (Web-Overhaul-Chain)?
  2. Falls NEIN: Ticket fuer USD-Rueckkehr auf preise.astro anlegen VOR US-Launch
  3. Falls JA: apps/web/src/pages/preise.astro:2-3-Kommentar und die "USD bindend"-Notiz
     in der Projekt-Historie explizit als ueberholt markieren
- **Erwartetes Ergebnis**: Eine dokumentierte, eindeutige Owner-Entscheidung existiert
  (kein Widerspruch mehr zwischen Code-Kommentar "EUR via formatPlanPrice" und
  Ziel "USD $4.99")
- **Verifikation**: manuelle Pruefung, kein Kommando
- **Heute erwartbar**: unbekannt - reine Owner-Entscheidung, aus dem Code nicht ableitbar
- **Belegt durch**: apps/web/src/pages/preise.astro:2-3,12,33; test/plans-catalog.test.js:24-26

### PAY-03 - Marketing-Preisseite zeigt EUR fuer JEDEN Besucher (kein Geo-Umschalter)
- **Prioritaet**: P0
- **Modus**: offline (Datei-Inspektion + node)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n "Astro.request\|Astro.clientAddress\|geo\|Country" apps/web/src/pages/preise.astro`
  2. `grep -n "formatPlanPrice" apps/web/src/pages/preise.astro`
- **Erwartetes Ergebnis**: Schritt 1 liefert 0 Treffer (keine Geo-/Request-basierte Logik in
  der SSG-Seite); Schritt 2 liefert genau 1 Treffer, Aufruf ohne Geo-Parameter
- **Verifikation**: `grep -c "Astro.request\|Astro.clientAddress" apps/web/src/pages/preise.astro`
  -> erwartet `0`
- **Heute erwartbar**: gruen (im Sinne "Befund bestaetigt sich") - die Seite ist zero-JS SSG
  ohne jede Request-Introspektion (apps/web/src/pages/preise.astro:1-4)
- **Belegt durch**: apps/web/src/pages/preise.astro:1-4,12,33

### PAY-04 - Starter-Tenant: Reserve fuer Nicht-Inlandsziel uebersteigt IMMER die Monatsdecke
- **Prioritaet**: P0
- **Modus**: offline (npm test, neuer Test - Erweiterung von test/plan-cap-derivation.test.js
  oder test/outbound-reserve-reconcile.test.js als Vorlage)
- **Vorbedingung**: keine (state-ops-Unit, kein Server/Netz)
- **Schritte**:
  1. `makeDefaultState()` erzeugen, Tenant-Subscription auf `planSlug: "starter"` setzen
     (`setTenantSubscription`, Muster test/plan-cap-derivation.test.js:98-103)
  2. `planCapCents("starter", { voiceCapRateCentsPerMin: 6 })` -> erwartet 300
  3. `reserveCents = tariffCentsPerMin("+15551234567")` (US-Nummer, kein +49/+33/+44-Praefix)
     `* Math.ceil(180/60)` -> mit Default `voiceTariffDefaultCents=300` ergibt das 900
  4. `reserveExceedsBudget(s, tenantId, 900, cfg)` aufrufen
- **Erwartetes Ergebnis**: `reserveExceedsBudget(...) === true` bei JEDEM Verbrauchsstand
  (auch bei 0 Ist-Verbrauch), weil 0 + 0 + 900 > 300
- **Verifikation**: `node --test test/<neuer-test>.test.js` -> Assertion
  `assert.equal(reserveExceedsBudget(s, TENANT_A, 900, cfg), true)`
- **Heute erwartbar**: rot fehlt (Test existiert nicht) - die zugrundeliegende Rechnung ist
  aus dem Code klar ableitbar und wuerde bei Ausfuehrung TRUE liefern (das Verhalten selbst
  ist also "wie erwartet defekt", der Test dazu fehlt aber komplett)
- **Belegt durch**: src/telephony/outbound-gates.js:139-148,664-669; src/billing/plan-caps.js:22-29;
  src/store/state-ops.js:2039-2042 (kein existierender Test kombiniert dies, grep bestaetigt 0 Treffer)

### PAY-05 - Business-Tenant: ein Nicht-Inlands-Call sperrt die komplette Decke fuer JEDEN weiteren Call
- **Prioritaet**: P0
- **Modus**: offline (npm test, neuer Test)
- **Vorbedingung**: keine (state-ops-Unit)
- **Schritte**:
  1. Tenant auf `planSlug: "business"` setzen -> `planCapCents` = 900
  2. Erste Reservierung: `reserveCents=900` (Nicht-Inlandsziel, s. PAY-04) erfolgreich buchen
     via `tryReserveOutboundBudget` (Muster test/outbound-reserve-reconcile.test.js) ODER
     `reservationFor`-Ledger direkt auf 900 setzen
  3. Zweite Anfrage: `reserveExceedsBudget(s, tenantId, 60, cfg)` (60 ct = Inlandsziel, kleine
     Reserve) pruefen
- **Erwartetes Ergebnis**: Schritt 3 liefert `true` (blockiert), OBWOHL es ein billiges
  Inlandsziel ist - die In-Flight-Reserve aus Schritt 2 allein (900) erreicht schon den Cap
- **Verifikation**: `node --test test/<neuer-test>.test.js` -> Assertion
  `assert.equal(reserveExceedsBudget(s, TENANT_A, 60, cfg), true)`
- **Heute erwartbar**: rot fehlt (Test existiert nicht); Code-Ableitung sagt `true` voraus
- **Belegt durch**: src/store/state-ops.js:2028-2042 (`reservationFor` addiert kumulativ,
  Kommentar Zeile 2030-2033 "kurz aufeinanderfolgende Calls koennen den Cap nicht mehr
  gemeinsam ueberschreiten")

### PAY-06 - Cost-Truing-Sweep befreit die ueberreservierte Decke nach der konfigurierten Verzoegerung
- **Prioritaet**: P1
- **Modus**: offline (npm test, ggf. Erweiterung test/cost-truing-booking.test.js)
- **Vorbedingung**: `COST_TRUING_DELAY_MINUTES` explizit gesetzt (z.B. auf 0 fuer sofortige
  Pruefbarkeit im Test) oder Zeit im Test simuliert
- **Schritte**:
  1. Business-Tenant mit voller In-Flight-Reserve (900 ct, s. PAY-05) simulieren
  2. Cost-Truing-Sweep-Funktion mit dem realen Ist-Wert (z.B. 90 ct, weil der Call nur
     30 s dauerte) aufrufen
  3. `reservationFor(s, tenantId)` danach pruefen
- **Erwartetes Ergebnis**: `reservationFor` sinkt von 900 auf den realen Wert, ein
  nachfolgender `reserveExceedsBudget`-Check mit kleiner Reserve wird wieder `false`
- **Verifikation**: `node --test test/cost-truing-booking.test.js`
- **Heute erwartbar**: unbekannt - Cost-Truing-Mechanik existiert und ist grob getestet,
  aber die exakte Verkettung "Business-Tenant voll reserviert -> Sweep -> wieder frei" ist
  nicht als expliziter Testfall verifiziert (Datei nicht im Detail gelesen)
- **Belegt durch**: src/billing/cost-truing.js; src/config.js:397 (Default 30 min)

### PAY-07 - tariffCentsPerMin behandelt jedes Nicht-+49/+33/+44-Ziel als Ausland, unabhaengig vom Tenant-Heimatland
- **Prioritaet**: P0
- **Modus**: offline (npm test, direkter Unit-Test der reinen Funktion)
- **Vorbedingung**: keine (`tariffCentsPerMin` ist eine reine Funktion ueber `defaultConfig`)
- **Schritte**:
  1. `tariffCentsPerMin("+15551234567")` (US) aufrufen
  2. `tariffCentsPerMin("+4917212345678")` (DE) aufrufen
  3. Beide Werte vergleichen
- **Erwartetes Ergebnis**: `tariffCentsPerMin("+1...") === 300` (Default),
  `tariffCentsPerMin("+49...") === 20` (Default) - IDENTISCH, egal ob der anrufende Tenant
  sein `defaultLanguage`/Heimatland auf `en`/`US` gesetzt hat (Funktion liest nur `to`,
  nie den Tenant)
- **Verifikation**: `node --test test/<neuer-test>.test.js` mit
  `assert.equal(tariffCentsPerMin("+15551234567"), 300)` und
  `assert.equal(tariffCentsPerMin("+4917212345678"), 20)`
- **Heute erwartbar**: gruen (im Sinne "Befund bestaetigt sich", Test existiert aber noch
  nicht als eigenstaendiger Fall - grep zeigt `tariffCentsPerMin` nur in
  test/metering-unit.test.js und test/cost-calibration.test.js, dort ausschliesslich mit
  domestic `to`-Werten)
- **Belegt durch**: src/telephony/outbound-gates.js:139-148,105 (config)

### PAY-08 - Inbound-Anruf zieht das Tenant-Budget nie ab (Richtungspruefung)
- **Prioritaet**: P1
- **Modus**: offline (npm test, bestehend)
- **Vorbedingung**: keine
- **Schritte**:
  1. `node --test test/metering-unit.test.js` ausfuehren (deckt Zeile 97
     `reconcileOutboundVoiceBudget(makeCall({ direction: "inbound" }))` ab)
- **Erwartetes Ergebnis**: Test gruen, `voiceCostCents`-Array bleibt leer bei
  `direction: "inbound"`
- **Verifikation**: `node --test test/metering-unit.test.js`
- **Heute erwartbar**: gruen - bestehender, gepflegter Test
- **Belegt durch**: test/metering-unit.test.js:97; src/billing/metering.js:54-55

### PAY-09 - recordVoiceMinuteMeter rechnet auch fuer INBOUND-Calls mit dem 15x-Auslandstarif, wenn call.to eine US-DID ist
- **Prioritaet**: P1
- **Modus**: offline (npm test, neuer Fall - Erweiterung von test/metering-unit.test.js)
- **Vorbedingung**: keine (Fake-Store-Muster wie test/metering-unit.test.js:17-36)
- **Schritte**:
  1. `makeCall({ direction: "inbound", to: "+15551234567", answeredAt: ..., endedAt: ... })`
     mit 1 Minute Dauer erzeugen
  2. `recordVoiceMinuteMeter(call)` aufrufen
  3. `usageEvents[0].costCents` pruefen
- **Erwartetes Ergebnis**: `costCents === 300` (1 Minute * `voiceTariffDefaultCents` Default
  300, NICHT der Inlandstarif 20), obwohl der Call inbound ist - `recordVoiceMinuteMeter`
  hat keine Richtungspruefung (Kontrast zu PAY-08/reconcileOutboundVoiceBudget)
- **Verifikation**: `node --test test/<neuer-fall>.test.js`
- **Heute erwartbar**: gruen (im Sinne "Befund bestaetigt sich") - der Code hat
  nachweislich keine Richtungspruefung in `recordVoiceMinuteMeter`
  (src/billing/metering.js:34-46), der Testfall selbst fehlt aber
- **Belegt durch**: src/billing/metering.js:34-46; src/telephony/call-finish.js:48
  (Aufruf ohne Direction-Filter)

### PAY-10 - costCents aus recordVoiceMinuteMeter geht NICHT an Stripe (nur quantity)
- **Prioritaet**: P2
- **Modus**: offline (Datei-Inspektion + npm test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n "payload\[value\]\|payload\[cost" src/billing/stripe.js`
  2. `node --test test/metering-unit.test.js` (deckt den Event-Shape ab)
- **Erwartetes Ergebnis**: Schritt 1 zeigt `payload[value]` gesetzt aus `quantity`
  (src/billing/stripe.js:183), KEIN `payload[cost...]`-Feld existiert
- **Verifikation**: `grep -c "payload\[cost" src/billing/stripe.js` -> erwartet `0`
- **Heute erwartbar**: gruen - bestaetigt durch Code-Kommentar
  "costCents ... geht NICHT an Stripe" (src/billing/stripe.js:181-184)
- **Belegt durch**: src/billing/stripe.js:180-184

### PAY-11 - tenant.html rendert Geldbetraege hart in de-DE, unabhaengig von settings.language
- **Prioritaet**: P1
- **Modus**: manuell (Auge/Ohr - Dashboard im Browser mit englischem Tenant oeffnen)
- **Vorbedingung**: Tenant mit `settings.language = "en"` (oder `tenant.defaultLanguage =
  "en"`), lokaler Server mit `SKIP_TWILIO_SIGNATURE_CHECK=true`
- **Schritte**:
  1. `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`
  2. Als englischsprachiger Tenant in public/tenant.html einloggen
  3. Rechnungsbetrag/Guthaben-Anzeige und ein Datum (z.B. `currentPeriodEnd`) inspizieren
- **Erwartetes Ergebnis**: Betrag erscheint als `4,99 €` (Komma-Dezimaltrenner) statt
  `$4.99`; Datum erscheint als `DD.MM.YYYY` statt `M/D/YYYY` - UNABHAENGIG von der
  Tenant-Sprache
- **Verifikation**: `grep -n "de-DE" public/tenant.html` -> erwartet mind. 3 Treffer (Zeilen
  215, 319, 389)
- **Heute erwartbar**: gruen (im Sinne "Befund bestaetigt sich") - Code hat keine
  Sprachverzweigung an diesen Stellen
- **Belegt durch**: public/tenant.html:208-216,316-319,389

### PAY-12 - Budget-Gate-402-Ablehnungstext ist hartkodiertes Deutsch (keine Locale-Anbindung)
- **Prioritaet**: P1
- **Modus**: offline (curl gegen lokalen Server, Muster README/CLAUDE.md "lokal testen")
- **Vorbedingung**: `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`; ein Tenant mit
  `settings.language="en"` UND Budget bereits erschoepft (`hard_cap_cents` sehr niedrig
  gesetzt)
- **Schritte**:
  1. `curl -X POST http://localhost:3999/api/calls -H "..." -d '{"to":"+491701234567"}'`
     (Tenant-Auth-Header des budget-erschoepften Tenants)
- **Erwartetes Ergebnis**: HTTP 402, Body `error` enthaelt exakt einen der hartkodierten
  deutschen Strings ("Dein Budget ist gesperrt..." oder "Inkludierte Plan-Minuten
  aufgebraucht...") - UNABHAENGIG davon, dass `settings.language="en"` gesetzt ist
- **Verifikation**: `curl ... | grep -c "Budget ist gesperrt\|Plan-Minuten aufgebraucht"`
  -> erwartet >= 1 (Beweis, dass Deutsch ausgeliefert wird trotz en-Tenant)
- **Heute erwartbar**: gruen (im Sinne "Befund bestaetigt sich") - die Strings sind
  Modul-Konstanten ohne Locale-Parameter
- **Belegt durch**: src/telephony/outbound-gates.js:100,105-106,651-652

### PAY-13 - allowedCountryCodes-Default schliesst +1 (USA) aus
- **Prioritaet**: P0
- **Modus**: offline (npm test / node)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES` NICHT gesetzt (Default)
- **Schritte**:
  1. `node -e "process.env.ALLOWED_COUNTRY_CODES=''; import('./src/config.js').then(m=>console.log(m.config.safety.allowedCountryCodes))"`
     (oder Aequivalent per bestehendem config-Test-Helper)
- **Erwartetes Ergebnis**: Array enthaelt `["+49","+33","+44"]`, `"+1"` NICHT enthalten
- **Verifikation**: `grep -n 'allowedCountryCodes:.*ALLOWED_COUNTRY_CODES' src/config.js`
  gefolgt von Pruefung des Default-Strings `"+49,+33,+44"`
- **Heute erwartbar**: gruen - Default-String enthaelt kein `+1`
- **Belegt durch**: src/config.js:666

### PAY-14 - Land-Gate + Budget-Gate-Interaktion: +1 wird schon VOR der Reserve blockiert, solange +1 nicht erlaubt ist
- **Prioritaet**: P0
- **Modus**: offline (npm test, Gate-Kette pruefen)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES` auf Default (kein +1)
- **Schritte**:
  1. Gate-Kette (`outbound-gates.js`) fuer `to="+15551234567"` durchlaufen, PRUEFEN welches
     Gate zuerst greift (Land-Gate vor `compute_reserve`/`reserve_budget`?)
  2. Reihenfolge der Gates in der Pipeline inspizieren (Land-Gate-Position vs.
     `compute_reserve`-Position)
- **Erwartetes Ergebnis**: Bei Default-Config wird der Call bereits durch das Land-Gate
  (403/400, Grund `land`) abgelehnt, BEVOR das Reserve-vs-Cap-Problem (PAY-04) je sichtbar
  wird - Gap 1/2 materialisiert sich ERST, wenn ein Betreiber `+1` in
  `ALLOWED_COUNTRY_CODES` aufnimmt
- **Verifikation**: `grep -n "name: \"country\"\|name: \"compute_reserve\"\|name: \"reserve_budget\"" src/telephony/outbound-gates.js`
  und Zeilenreihenfolge vergleichen
- **Heute erwartbar**: unbekannt - Gate-Reihenfolge nicht abschliessend verifiziert in
  dieser Session, muss vor Testerstellung durch vollstaendiges Lesen der Gate-Pipeline
  (outbound-gates.js Pipeline-Array) bestaetigt werden
- **Belegt durch**: src/telephony/outbound-gates.js (Pipeline-Struktur um Zeile 600-700,
  Gate-Namen "budget", "minutes", "compute_reserve", "reserve_budget" belegt; exakte
  Position des Land-Gates relativ dazu nicht in dieser Session verifiziert)

### PAY-15 - planCapCents wirft fail-closed bei unbekanntem Plan-Slug
- **Prioritaet**: P2
- **Modus**: offline (npm test, bestehend/erweiterbar)
- **Vorbedingung**: keine
- **Schritte**:
  1. `planCapCents("enterprise_us", { voiceCapRateCentsPerMin: 6 })` aufrufen (Slug, der
     NICHT im Katalog existiert - z.B. ein hypothetischer zukuenftiger US-spezifischer Plan)
- **Erwartetes Ergebnis**: Funktion wirft `Error` mit Text
  "planCapCents: unbekannter Plan-Slug 'enterprise_us' ..." - KEIN stiller Fallback-Wert
- **Verifikation**: `node -e "import('./src/billing/plan-caps.js').then(m => { try { m.planCapCents('enterprise_us', {voiceCapRateCentsPerMin:6}); console.log('FAIL: kein throw'); } catch(e) { console.log('OK:', e.message); } })"`
- **Heute erwartbar**: gruen - `if (!plan || !headroom) throw ...` deckt diesen Fall
  explizit ab
- **Belegt durch**: src/billing/plan-caps.js:24-26

### PAY-16 - Wird ein neuer Plan (z.B. "starter_us") eingefuehrt, ohne PLAN_CAP_HEADROOM-Eintrag, blockiert er sofort JEDEN Call (fail-closed statt fail-open)
- **Prioritaet**: P1
- **Modus**: offline (npm test, neuer Fall)
- **Vorbedingung**: keine
- **Schritte**:
  1. Hypothetisch: `PLAN_CATALOG` um einen Slug erweitern, der in `PLAN_CAP_HEADROOM`
     NICHT eingetragen ist (im Test simuliert, nicht im Produktcode)
  2. `planCapCents(neuerSlug, cfg)` aufrufen
- **Erwartetes Ergebnis**: Wurf statt stillem Fallback -> ein Deploy, das den neuen Plan
  registriert aber die Kopffreiheit vergisst, faellt beim ersten Call laut auf (kein
  US-Kunde bekommt einen kaputten/falschen Cap, sondern eine harte 500-artige Fehlermeldung)
- **Verifikation**: gleich PAY-15, mit einem zusaetzlichen Slug im Testszenario
- **Heute erwartbar**: gruen - dieselbe Fail-Closed-Klausel deckt jeden unbekannten Slug ab
- **Belegt durch**: src/billing/plan-caps.js:24-26 (Kommentar Zeile 20-21 "WIRFT bei einem
  UNBEKANNTEN Slug (fail-closed)")

### PAY-17 - Nummern-Setup-Hold ist fuer US aktuell IDENTISCH zum DE-Default (kein eigener Land-Preis konfiguriert)
- **Prioritaet**: P2
- **Modus**: offline (npm test / node)
- **Vorbedingung**: keine
- **Schritte**:
  1. `node -e "import('./src/telephony/provisioning-geo.js').then(m => console.log(m.holdAmountForCountry('US', 500), m.holdAmountForCountry('DE', 500)))"`
- **Erwartetes Ergebnis**: Beide Werte identisch (`500`), weil `COUNTRY_SEARCH_PARAMS.US`
  kein `holdAmountCents`-Feld hat
- **Verifikation**: exakter Vergleich der beiden geloggten Werte, erwartet Gleichheit
- **Heute erwartbar**: gruen - bestaetigt durch Code-Lesen (kein Land in der Tabelle hat
  aktuell `holdAmountCents` gesetzt)
- **Belegt durch**: src/telephony/provisioning-geo.js:34-38,68-70

### PAY-18 - Kein Stripe-Aufruf setzt automatic_tax oder billing_address_collection
- **Prioritaet**: P1
- **Modus**: offline (grep)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -c "automatic_tax\|billing_address_collection\|tax_id_collection\|customer_update" src/billing/stripe.js`
- **Erwartetes Ergebnis**: Ergebnis `0`
- **Verifikation**: exakt derselbe grep-Befehl, erwartete Ausgabe `0`
- **Heute erwartbar**: gruen - vollstaendig gelesen, kein Treffer
- **Belegt durch**: src/billing/stripe.js (komplett, 1-375)

### PAY-19 - off_session-Zahlung ohne 3DS-Redirect: SCA-Fehlschlag hat keinen Retry-Zweig
- **Prioritaet**: P1
- **Modus**: manuell (Stripe-Testkarte mit 3DS-Pflicht, TEST-MODE, kein Echtgeld)
- **Vorbedingung**: `PAYMENT_ENABLED=true`, Stripe TEST-Keys, eine Stripe-Testkarte, die
  `requires_action` (3DS) ausloest, als hinterlegte Zahlungsmethode
- **Schritte**:
  1. Checkout mit einer 3DS-Testkarte (z.B. Stripe-Doku-Testkarte fuer "authentication
     required") durchlaufen
  2. `placeHold` fuer diesen Kunden aufrufen (off_session)
- **Erwartetes Ergebnis**: Stripe lehnt mit einem `requires_action`/`authentication_required`
  Fehler ab; der Code hat KEINEN erkennbaren Pfad, der einen Redirect/Retry anstoesst ->
  `assertOk` wirft, der Call wird als fehlgeschlagen behandelt (402 o.ae.), OHNE dass der
  Kunde je die Chance zur Authentifizierung bekommt
- **Verifikation**: manuelle Pruefung des Fehlerpfads im Server-Log (`console.error`),
  kein automatisiertes Kommando (Netzaufruf zu Stripe noetig)
- **Heute erwartbar**: unbekannt - aus dem Code plausibel ableitbar (kein Redirect-Code
  gefunden), aber nicht live gegen echtes Stripe-TEST-Verhalten verifiziert in dieser Session
- **Belegt durch**: src/billing/stripe.js:149,342 (`off_session: true`); grep bestaetigt
  kein `requires_action`-Handling in der Datei

### PAY-20 - providerToBucketRateMicro ist eine reine Konstante ohne automatisierten Drift-Alarm
- **Prioritaet**: P2
- **Modus**: offline (grep + Datei-Inspektion)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n "providerToBucketRateMicro" src/*.js src/**/*.js`
  2. Pruefen, ob eine Cron/Sweep-Funktion existiert, die diesen Wert automatisch aktualisiert
- **Erwartetes Ergebnis**: Nur Lese-Zugriffe, kein Schreib-/Update-Pfad; Wert bleibt bis zum
  naechsten manuellen `.env`/Render-Dashboard-Edit unveraendert
- **Verifikation**: `grep -rn "providerToBucketRateMicro =" src/` (Zuweisung ausserhalb von
  config.js) -> erwartet 0 Treffer
- **Heute erwartbar**: gruen - Kommentar bestaetigt "vom Owner quartalsweise von Hand zu
  pflegen"
- **Belegt durch**: src/config.js:370-379

### PAY-21 - globaler Notaus wird von Nicht-Inlands-Reservierungen ueberproportional gefuettert
- **Prioritaet**: P1
- **Modus**: offline (npm test, neuer Fall - state-ops-Unit)
- **Vorbedingung**: keine
- **Schritte**:
  1. `makeDefaultState()`, `platformSpendCapCents` klein setzen (z.B. 1000 ct via Config-Fixture)
  2. Fuenf aufeinanderfolgende Nicht-Inlands-Reservierungen (je 900 ct, verschiedene
     Tenants) ueber `tryReserveOutboundBudget` buchen
  3. `globalBudgetExceeded(s, cfg)` nach der zweiten Reservierung pruefen
- **Erwartetes Ergebnis**: `globalBudgetExceeded === true` bereits nach der zweiten
  Reservierung (2*900=1800 > 1000), OBWOHL erst ein Bruchteil davon real ausgegeben wurde -
  ein sechster, domestic anrufender DE-Tenant (Reserve 60 ct) wird DANN ebenfalls
  `globalBudgetExceeded` ausgesetzt
- **Verifikation**: `node --test test/<neuer-test>.test.js`
- **Heute erwartbar**: rot fehlt (Test existiert nicht); Code-Ableitung sagt das Verhalten
  voraus (`globalSpendOrDeny` nutzt `gatePlatformUsageCents`, das laut Modul-Kommentar
  In-Flight-Reservierungen ueber ALLE Tenants summiert)
- **Belegt durch**: src/store/state-ops.js:2181-2198,2200-2210 (Reserve-Ledger-Kommentar
  "kurz aufeinanderfolgende Calls koennen den Cap nicht mehr gemeinsam ueberschreiten" gilt
  strukturell auch fuer den globalen Topf, da derselbe `ctx.reserveCents` verwendet wird)

### PAY-22 - Grenzfall: leere/unbekannte Zielvorwahl faellt auf den teuren Default-Tarif (fail-safe teuer, nicht fail-open billig)
- **Prioritaet**: P1
- **Modus**: offline (npm test, neuer Fall)
- **Vorbedingung**: keine
- **Schritte**:
  1. `tariffCentsPerMin("")` aufrufen (leerer String)
  2. `tariffCentsPerMin("+999")` aufrufen (unbekannte/erfundene Vorwahl)
- **Erwartetes Ergebnis**: Beide Aufrufe liefern `voiceTariffDefaultCents` (300, NICHT 20,
  NICHT 0/NaN) - `Array.some(p => to.startsWith(p))` liefert bei leerem/unbekanntem `to`
  `false`, also greift der `:`-Zweig (Default)
- **Verifikation**: `node -e "import('./src/telephony/outbound-gates.js').then(m => console.log(m.tariffCentsPerMin(''), m.tariffCentsPerMin('+999')))"`
  -> erwartet `300 300`
- **Heute erwartbar**: gruen - Ternary-Logik ist eindeutig, kein Sonderfall fuer leeren
  String noetig (String.startsWith auf leerem `to` liefert immer false fuer nicht-leere
  Praefixe)
- **Belegt durch**: src/telephony/outbound-gates.js:144-148

### PAY-23 - Grenzfall: Reserve exakt gleich dem verbleibenden Cap ist ERLAUBT (strikt >, nicht >=)
- **Prioritaet**: P2
- **Modus**: offline (npm test, bestehend)
- **Vorbedingung**: keine
- **Schritte**:
  1. `node --test test/outbound-reserve-reconcile.test.js` (deckt "Grenzfall T5" ab)
- **Erwartetes Ergebnis**: `reserveExceedsBudget(s, TENANT_A, 100, PRICES) === false` bei
  Cap=100 ct und 0 Verbrauch; `reserveExceedsBudget(s, TENANT_A, 101, ...) === true`
- **Verifikation**: `node --test test/outbound-reserve-reconcile.test.js`
- **Heute erwartbar**: gruen - bestehender, gepflegter Test
- **Belegt durch**: test/outbound-reserve-reconcile.test.js:75-81; src/store/state-ops.js:2039-2042

### PAY-24 - Plan-Downgrade auf Starter waehrend bestehender Nicht-Inlands-Reserve wirkt sofort verschaerfend
- **Prioritaet**: P1
- **Modus**: offline (npm test, neuer Fall, Muster test/plan-cap-derivation.test.js:111-127
  "Downgrade business->starter")
- **Vorbedingung**: keine
- **Schritte**:
  1. Tenant startet als `business` (Cap 900), reserviert 900 ct fuer einen laufenden
     Nicht-Inlands-Call
  2. Waehrend die Reserve noch offen ist, Downgrade auf `starter` (Cap 300) durchfuehren
     (`setTenantSubscription`)
  3. `budgetExceeded`/`reserveExceedsBudget` fuer den Tenant pruefen
- **Erwartetes Ergebnis**: Nach dem Downgrade ist der Tenant SOFORT `budgetExceeded===true`
  bzw. jede weitere Reserve schlaegt fehl (900 In-Flight > neue 300er-Decke) - analog zum
  bestehenden Downgrade-Test, aber mit einer In-Flight-RESERVE statt nur settled Usage
- **Verifikation**: `node --test test/<neuer-fall>.test.js`
- **Heute erwartbar**: unbekannt - der bestehende Downgrade-Test
  (test/plan-cap-derivation.test.js:111-127) prueft nur SETTLED Usage (400 ct Ist-Verbrauch),
  nicht die Interaktion mit einer offenen In-Flight-Reserve; ob `reserveExceedsBudget` den
  NEUEN Cap sofort sieht (kein gecachter Wert) ist aus dem Code plausibel aber nicht mit
  einer Reserve-Kombination getestet
- **Belegt durch**: test/plan-cap-derivation.test.js:111-127 (Vorlage, nur Usage);
  src/store/state-ops.js:2039-2042 (`effectiveCapCents` wird bei jedem Aufruf frisch gelesen)

### PAY-25 - Env-Doku-Kohaerenz: VOICE_TARIFF_DOMESTIC_PREFIXES ist in .env.example dokumentiert und deckt sich mit dem Code-Default
- **Prioritaet**: P2
- **Modus**: offline (npm test, bestehend/erweiterbar - Muster env-docs-spend-cap-coherence.test.js)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n "VOICE_TARIFF_DOMESTIC" .env.example`
  2. Mit `src/config.js:105` (`VOICE_TARIFF_DOMESTIC_PREFIXES = ["+49","+33","+44"]`)
     abgleichen
- **Erwartetes Ergebnis**: `.env.example` dokumentiert entweder denselben Default oder
  erklaert explizit, dass die Liste NICHT per Env konfigurierbar ist (Code zeigt: es gibt
  KEINEN `numEnv`-Aufruf fuer diese Konstante, sie ist eine feste Modul-Konstante, keine
  Env-Variable)
- **Verifikation**: `grep -c "VOICE_TARIFF_DOMESTIC_PREFIXES" .env.example` und
  `grep -c "VOICE_TARIFF_DOMESTIC_PREFIXES" src/config.js` vergleichen
- **Heute erwartbar**: unbekannt - .env.example nicht in dieser Session gelesen, ob die
  Nicht-Konfigurierbarkeit dieser Konstante dort dokumentiert ist bleibt offen
- **Belegt durch**: src/config.js:102-105 (Kommentar "BEWUSST eigenstaendig, NICHT an das
  Land-Gate gekoppelt")

### PAY-26 - Grosse-Zahl-Fuzzing: negative/NaN max_duration_s im Body kann die Reserve nicht senken
- **Prioritaet**: P1
- **Modus**: offline (npm test, neuer Fall - Muster S1-6 Wurzelfix-Kommentar)
- **Vorbedingung**: keine
- **Schritte**:
  1. `resolveMaxDurationS(-300, cfg)` aufrufen (negativer Body-Override)
  2. `resolveMaxDurationS("abc", cfg)` aufrufen (nicht-numerischer Body-Override)
  3. `resolveMaxDurationS(99999, cfg)` aufrufen (viel zu grosser Wert)
- **Erwartetes Ergebnis**: Fall 1/2 fallen auf `cfg.safety.maxCallDurationS` oder
  `DEFAULT_CALL_DURATION_S=180` zurueck (nie negativ/NaN); Fall 3 wird auf
  `MAX_CALL_DURATION_CAP_S=300` gekappt - IN KEINEM Fall kann eine manipulierte Anfrage
  eine NEGATIVE oder eine UNGEDECKELT hohe Reserve erzeugen
- **Verifikation**: `node --test test/<neuer-fall>.test.js` mit drei Assertions
  (`assert.equal(resolveMaxDurationS(-300, cfg) > 0, true)`,
  `assert.equal(resolveMaxDurationS(99999, cfg), 300)`)
- **Heute erwartbar**: gruen - der Code-Kommentar (src/telephony/outbound-gates.js:151-156)
  beschreibt exakt diesen Fix als "S1-6 Wurzelfix", die Funktion behandelt dies bereits;
  ein expliziter Testfall dafuer ist aber nicht sicher vorhanden (nicht in dieser Session
  in test/ gefunden)
- **Belegt durch**: src/telephony/outbound-gates.js:151-161

## Zusammenfassung Korrekturen zum Recon-Befund

- `planCapCents`-Pinning ("starter=300, business=900") liegt tatsaechlich in
  **test/plan-cap-derivation.test.js:82-84**, NICHT wie im Recon-JSON behauptet in
  test/outbound-reserve-reconcile.test.js:82-107 (dort existiert kein Bezug zu
  planCapCents/starter/business, grep bestaetigt 0 Treffer).
- `reserveExceedsBudget`-Funktionskopf liegt bei src/store/state-ops.js:2039, nicht 2042
  (2042 ist eine Zeile innerhalb des Funktionskoerpers).
- Der "TENANT_UNREADABLE_DENIAL"-Kommentarblock beginnt bei src/telephony/outbound-gates.js:105,
  nicht 106-107 (Konstante selbst bei 105-106).
- `holdAmountForCountry`/`COUNTRY_SEARCH_PARAMS` ist zwar ein Land-spezifischer MECHANISMUS
  (korrekt erkannt), aber AKTUELL setzt KEIN Land (auch nicht US) tatsaechlich einen
  abweichenden `holdAmountCents`-Wert - der Recon-Befund suggeriert eine bereits wirksame
  Differenzierung, die es im heutigen Datenstand nicht gibt (nur die Such-Parameter
  `telnyxCountryCode` sind differenziert, der Preis nicht).
