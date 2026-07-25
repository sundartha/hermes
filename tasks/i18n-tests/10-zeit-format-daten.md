# FMT - Zeitzonen, Formate, Kalender und Datenmodell

Verifikations-Hinweis: Die Belege des Recon-Befunds wurden stichprobenartig gegen den
echten Code geprueft (claude.js, mcp-tools.js, locales.js, defaults.js, state-ops.js,
self-service-routes.js, api-onboard.js, call-finish.js, plans.js, schema.sql,
tenant.html, outbound-gates.js, config.js). Alle geprueften Behauptungen stimmen mit dem
Code ueberein, mit einer kleinen Korrektur: `resolveCallLanguage` (Sprach-Praezedenz)
liegt in src/store/state-ops.js:648-651 (nicht 642-651 wie im Recon-Befund angegeben -
Off-by-Zeilen, inhaltlich identisch). Alle anderen Stichproben (7 von 7 weitere) waren
exakt.

## Ist-Stand (belegt)

- Kein Zeitzonen-Feld im Datenmodell (Tenant/Settings/Number), weder JSON- noch
  Postgres-Backend. src/db/schema.sql:13-135 (tenant/settings-Spalten), grep
  `timezone|timeZone|Zeitzone` src/ ohne Treffer.
- Der `now`-Wert im System-Prompt laeuft ueber `new Date().toLocaleString(loc.dateLocale, {...})`
  OHNE `timeZone`-Option, also in der Server-Prozess-Zeitzone. src/claude.js:43.
- `LOCALES[lang].dateLocale` steuert NUR das Formatierungs-Gebietsschema (Monatsname,
  Reihenfolge, 12h/24h), nicht die Zeitzone. src/i18n/locales.js:98 (de-DE), 170 (fr-FR
  laut Recon, ungeprueft), 219 (en-GB).
- Englisch nutzt durchgehend `en-GB` als `dateLocale` UND `sttLocale`, kein `en-US`-Profil.
  src/i18n/locales.js:219-220. Gepinnt in test/f1-i18n-locale.test.js:50,53.
- `LANGUAGE_FOR_COUNTRY` enthaelt DE/AT/CH/FR/GB/IE, aber KEIN `US`. Ein unbekanntes Land
  faellt via `languageForCountry()` auf `DEFAULT_LANGUAGE` ("de") zurueck.
  src/i18n/locales.js:268-280.
- `src/mcp-tools.js:48-55` definiert einen ZWEITEN, hart auf `"de-DE"` verdrahteten
  Datumsformatierer `fmt()`, unabhaengig von locales.js/dateLocale. Er speist
  `list_calls`-`startedAt` (mcp-tools.js:267) UND `get_calendar`-`start`/`end`
  (mcp-tools.js:293), sowohl im Text- als auch im structuredContent-Pfad
  (pickCall/pickCalendarEntry).
- `src/ui/widget-i18n.js:1-18` lokalisiert nur UI-Chrome/Labels nach Browser-Locale des
  Betrachters, NICHT die Datumswerte selbst - die kommen bereits fertig-`de-DE`-formatiert
  aus `fmt()` in `structuredContent`. `src/ui/widgets/calendar.html:40` bindet
  `data-mcp-row="title,start,end"` direkt an diese Strings.
- Die private Summary-SMS-Nummer wird ueber `countryAllowed(e164, allowedCodes = ["+49"])`
  validiert (src/store/defaults.js:541). Sowohl `src/self-service-routes.js:270`
  (`store.setPrivateNumber(tenant, privateNumber)`) als auch
  `src/routes/api-onboard.js:125` (`normalizePrivateNumber(privateNumber)`) rufen OHNE ein
  drittes/zweites `allowedCountryCodes`-Argument auf -> es greift IMMER der Default `["+49"]`,
  unabhaengig vom Tenant-Land oder `ALLOWED_COUNTRY_CODES`. Bewusst getestet/gepinnt in
  test/f2-self-service-private-number.test.js:158-165 ("(c) gesperrter Laendercode (+1) ->
  400, Toll-Fraud-Gate H1").
- Notification-/SMS-Wrapper-Texte in `finishCall` sind hart Deutsch/Englisch gemischt
  verdrahtet, NICHT ueber `localeFor(call.language)` aufgeloest:
  src/telephony/call-finish.js:57 ("Anruf abgebrochen"/"Anruf nicht zustande gekommen"),
  Zeile 80 ("Anruf bei ${call.to}"/"Anruf von ${call.from}"), Zeile 81 ("Neue Call
  Summary"), Zeile 95 (SMS-Body-Suffix `"Action Items:"`). Nur `result.summary` selbst
  kommt sprachabhaengig vom LLM.
- `calendar_event` speichert `starts_at TEXT`/`ends_at TEXT` als reine ISO-Strings,
  bewusst OHNE TZ-Cast ("bitidentisch", src/db/schema.sql:260-266). Sortierung ueber
  `getCalendar()`/`localeCompare` (src/store/state-ops.js:600-606) ist bei UTC-Z-Suffix
  lexikografisch korrekt, es gibt aber keine Verknuepfung eines Termins mit einer
  Zeitzone.
- Periodische Budget-/TTS-Zyklusachsen sind BEWUSST auf UTC-Kalendermonat verankert
  (`getUTCFullYear`/`getUTCMonth`, src/store/state-ops.js:1646-1650), dokumentierter
  Schutz gegen json/pg-Drift bei Offset-Strings - das ist der einzige Teil des Systems,
  der Zeitzonen-Drift bereits sauber behandelt.
- E.164-Regex akzeptiert NANP-Nummern (+1 + 10 Ziffern) korrekt.
  src/store/defaults.js:477 (`/^\+[1-9]\d{6,14}$/`). `TRUNK_ZERO_COUNTRY_CODES` ist
  bewusst auf `["+49", "+33", "+44"]` begrenzt (src/store/defaults.js:486) - NANP kennt
  keine Trunk-Null-Konvention, kein Bug fuer US-Nummern.
- `homeCountryCode()` liefert fuer einen reinen US-Tenant (nur +1-Kandidaten) `null`
  (src/store/defaults.js:506-516), `normalizeDialTarget()` laesst eine mit "0"
  beginnende Eingabe dann unveraendert (src/store/defaults.js:525-532, Kommentar "kein
  ableitbares Heimatland -> unveraendert"). Das nachgelagerte E.164-Gate lehnt mit 400 ab.
  Bereits abgedeckt (Praedikat-Ebene) in
  test/dial-target-normalization.test.js:123-133 ("kein ableitbares Heimatland (US-DID,
  keine privateNumber) -> 400 statt raten").
- Es gibt KEIN Zeitfenster-/Ruhezeiten-Gate fuer Outbound-Calls. Das "Stundenlimit"
  (`config.safety.maxCallsPerHour`, src/telephony/outbound-gates.js:189-298) ist ein
  reines Rate-Limit pro gleitender Stunde ueber ALLE Anrufe, keine Tageszeit-Pruefung.
  `grep -rn "getHours()\|getUTCHours()" src/` liefert 0 Treffer im gesamten Baum.
- Plan-Katalog `src/plans.js:21,37` und die Web-Spiegelkopie
  `apps/web/src/lib/plans.js:13,29` tragen fuer beide Plaene `currency: "eur"`, trotz
  englischer Feature-Texte. Gepinnt in test/plans-catalog.test.js:29
  (`assert.equal(plan.currency, "eur", ...)`).
- `PAYMENT_CURRENCY` ist ein einziger globaler Config-Wert (Default `"eur"`,
  src/config.js:362), keine Tenant-/Land-abhaengige Waehrungswahl.
  .env.example:231 (`PAYMENT_CURRENCY=eur`).
- `public/tenant.html` (das einzige verbliebene Self-Service-Dashboard) ist komplett
  Deutsch hartcodiert (`<html lang="de">`, public/tenant.html:2) und formatiert
  Preis/Datum IMMER mit fest `"de-DE"`: `Intl.NumberFormat("de-DE", ...)`
  (public/tenant.html:215), `toLocaleString("de-DE")` (public/tenant.html:319),
  `toLocaleDateString("de-DE")` fuer das Abo-Verlaengerungsdatum
  (public/tenant.html:389) - unabhaengig von Tenant-Sprache/Browser-Locale.
- `firstNameOf()` ist eine reine `split(/\s+/)[0]`-Operation (src/store/state-ops.js:792)
  ohne Sonderbehandlung fuer CJK-Namen ohne Leerzeichen (liefert dann den ganzen String
  als "Vorname"). Kein Test mit nicht-lateinischen Namen im Repo.
- `escapeXml()` in src/telephony/adapters/telnyx/render.js:29 escaped nur `& < > " '`,
  laesst Nicht-ASCII (Umlaute/Akzente/CJK) unveraendert durch (UTF-8-Dokument). Kein
  dedizierter CJK-Test im Rendering-Pfad.
- Der Demo-Kalender (`BOOTSTRAP_TENANT_ID`-Seed) rechnet Termine ueber
  `nextWeekday()`/`new Date().setDate/setHours()` (lokale Server-Zeitzone), dann
  `toISOString()`. src/store/defaults.js:308-315, nur fuer den Owner-/Bootstrap-Tenant
  relevant (defaults.js:390-392).

## Luecken

| Luecke | Schaden | Beleg | Schwere |
|---|---|---|---|
| Kein Tenant-Zeitzonen-Feld; `now` im Systemprompt laeuft in Server-Zeitzone statt Anrufer-/Tenant-Zeitzone | Agent kann bei US-Anrufern (bis zu 8-10h Offset) den falschen Wochentag/Datum nennen -> Falschbuchungen bei "morgen 9 Uhr" | src/claude.js:43, kein timezone-Feld in src/store/defaults.js/src/db/schema.sql | S1 |
| `mcp-tools.js` `fmt()` ist hart `"de-DE"` verdrahtet statt `localeFor(sprache)`, speist Text UND structuredContent von `list_calls`/`get_calendar` | JEDER claude.ai-Nutzer weltweit sieht Anruf-/Kalenderzeiten im deutschen Format - bricht "englisches Widget" fuer den zentralen Datenwert Zeit | src/mcp-tools.js:48-55,267,293 | S1 |
| Private Summary-SMS-Nummer faktisch auf `+49` beschraenkt (Self-Service UND Onboarding rufen Setter ohne `allowedCountryCodes`-Argument) | US/FR/GB-Tenants koennen "Zusammenfassung per SMS" nie nutzen, UI kommuniziert das nicht (nur generisches 400) | src/self-service-routes.js:270, src/routes/api-onboard.js:125, src/store/defaults.js:541 | S1 |
| `LANGUAGE_FOR_COUNTRY` ohne `US`-Eintrag | US-Onboarding faellt ohne manuelle Sprachwahl auf Deutsch, obwohl primaere Zielgruppe | src/i18n/locales.js:268-280 | S1 |
| `dateLocale`/`sttLocale` fuer Englisch ist `en-GB`, kein `en-US`-Profil | STT-Erkennungsqualitaet fuer US-Akzente und Datumsdarstellung koennen von US-Erwartung abweichen | src/i18n/locales.js:219-220 | S2 |
| `tenant.html` komplett Deutsch hartcodiert inkl. aller Datums-/Waehrungsformate | Jeder nicht-deutschsprachige Self-Service-Nutzer landet auf unverstaendlicher Oberflaeche | public/tenant.html:2,215,319,389 | S1 |
| Notification-/SMS-Wrapper-Texte in `call-finish.js` hart Deutsch, nicht `localeFor(call.language)`-abhaengig | US-Tenant bekommt deutsche Praefixe um einen englischen Summary-Satz -> inkonsistent/unprofessionell | src/telephony/call-finish.js:57,80,81,95 | S2 |
| Preis-/Waehrungs-Diskrepanz: Code `eur` (plans.js + Web-Spiegel + PAYMENT_CURRENCY), dokumentierte Entscheidung verlangt USD fuer US-Markt | US-Kunden werden in EUR abgerechnet (Fremdwaehrungsgebuehr/Kursrisiko) statt USD wie beworben | src/plans.js:21,37, apps/web/src/lib/plans.js:13,29, src/config.js:362, .env.example:231 | S1 |
| Kein Ortszeit-/Ruhezeiten-Gate fuer Outbound-Calls; ohne Zeitzonen-Modell technisch nicht sauber baubar | TCPA-aehnliches Rechtsrisiko fuer US-Outbound-Anrufe kann strukturell nicht durchgesetzt werden | src/telephony/outbound-gates.js:189-298 (nur Rate-Limit), 0 Treffer `getHours()`/`getUTCHours()` in src/ | S2 |
| `calendar_event` ohne Zeitzonen-Verankerung (reiner ISO-String, "bitidentisch") | Falls das Produkt spaeter automatisches Buchen erlaubt, fehlt die Datengrundlage fuer korrekte Terminverankerung bei internationaler Owner/Anrufer-Kombination | src/db/schema.sql:260-266, src/store/state-ops.js:600-606 | S3 |
| Keine Tests fuer CJK/nicht-lateinische Namen im gesamten Namens-/Rendering-Pfad | Ungemessen, ob `firstNameOf`/`escapeXml`/Disclosure-Satz mit z.B. japanischen Namen korrekt durchlaufen | src/store/state-ops.js:792, src/telephony/adapters/telnyx/render.js:29, keine CJK-Testtreffer in test/ | S3 |

## Tests

### FMT-01 - now-Zeitstempel im Systemprompt traegt keine timeZone-Option
- **Prioritaet**: P0
- **Modus**: offline (node)
- **Vorbedingung**: keine (reiner Quellcode-Vertrag, kein Server noetig)
- **Schritte**:
  1. `grep -n "toLocaleString" src/claude.js`
  2. Pruefe den Optionen-Block der Zeile mit `now:` auf einen `timeZone`-Key.
- **Erwartetes Ergebnis**: Der Optionen-Block (Zeilen 43-50) enthaelt KEINEN `timeZone`-Key.
  `now` wird also in `Intl.DateTimeFormat().resolvedOptions().timeZone` (Server-Prozess-TZ)
  berechnet, nicht tenant-/anruferbezogen.
- **Verifikation**: `sed -n '40,52p' src/claude.js | grep -c timeZone` -> erwartet `0`.
- **Heute erwartbar**: rot (im Sinne von: die Luecke ist vorhanden) - der Code hat aktuell
  keine timeZone-Option, das ist der dokumentierte Ist-Zustand.
- **Belegt durch**: src/claude.js:43-50

### FMT-02 - US-Anrufer: now-Tagesname weicht bei spaeter Ortszeit vom UTC-Tag ab (Simulation)
- **Prioritaet**: P0
- **Modus**: manuell (Datum/Uhrzeit-Simulation, kein echter Anruf)
- **Vorbedingung**: lokale Shell mit `TZ`-Override moeglich (kein Server-Deploy noetig)
- **Schritte**:
  1. `TZ=America/Los_Angeles node -e "console.log(new Date().toLocaleString('en-GB',{weekday:'long',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))"` zu einem
     Zeitpunkt kurz nach 22:00 UTC ausfuehren (dann ist es in LA noch der Vortag).
  2. Denselben Befehl mit `TZ=UTC` (bzw. der tatsaechlichen Render-Server-TZ) ausfuehren.
  3. Wochentag/Datum der beiden Ausgaben vergleichen.
- **Erwartetes Ergebnis**: Die beiden Ausgaben unterscheiden sich im Wochentag/Datum um
  genau 1 Tag in der Zeitspanne UTC 22:00-24:00 (PST) bzw. UTC 21:00-24:00 (PDT) - das
  demonstriert konkret den in FMT-01 belegten Root-Cause am Beispiel Los Angeles.
- **Verifikation**: manueller Diff der beiden Terminal-Ausgaben.
- **Heute erwartbar**: rot (Abweichung tritt nachweisbar auf) - reine Konsequenz aus
  FMT-01, kein Zufall.
- **Belegt durch**: src/claude.js:43-50 (Root-Cause), Simulation demonstriert die Wirkung

### FMT-03 - mcp-tools fmt() ist hart "de-DE" verdrahtet, nicht sprachabhaengig
- **Prioritaet**: P0
- **Modus**: offline (node/grep)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n 'toLocaleString("de-DE"' src/mcp-tools.js`
  2. `grep -n "localeFor\|dateLocale" src/mcp-tools.js`
- **Erwartetes Ergebnis**: Zeile 49 traegt das Literal `"de-DE"`. Der zweite grep liefert 0
  Treffer - `mcp-tools.js` importiert `localeFor`/`dateLocale` nirgends.
- **Verifikation**: `grep -c "localeFor\|dateLocale" src/mcp-tools.js` -> erwartet `0`.
- **Heute erwartbar**: rot - der Formatierer ist nachweislich sprachunabhaengig hart auf
  Deutsch verdrahtet.
- **Belegt durch**: src/mcp-tools.js:48-55

### FMT-04 - list_calls: startedAt kommt im deutschen Format, auch fuer einen EN-Tenant
- **Prioritaet**: P0
- **Modus**: offline (curl gegen lokal gestarteten Server, `SKIP_TWILIO_SIGNATURE_CHECK=true`)
- **Vorbedingung**: Server lokal mit `PORT=3999`, ein Tenant mit `language: "en"`/
  `defaultLanguage: "en"`, mindestens ein abgeschlossener Call mit bekanntem `startedAt`
  (z.B. `"2026-07-22T14:05:00.000Z"`).
- **Schritte**:
  1. Server starten: `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`
  2. `list_calls` ueber `/mcp` fuer den EN-Tenant aufrufen (oder `mcp-tools.js` direkt mit
     Node importieren und `pickCall()` auf ein Fixture mit bekanntem ISO-Datum anwenden).
  3. `startedAt` im Ergebnis mit dem erwarteten en-GB-Format (`Wed, 22/07, 14:05` o.ae.)
     vergleichen.
- **Erwartetes Ergebnis**: `startedAt` ist im deutschen Format (`Mi., 22.07., 16:05` -
  Berlin-Sommerzeit UTC+2), NICHT im erwarteten en-GB/en-US-Format des Tenants.
- **Verifikation**: `node -e "import('./src/mcp-tools.js').then(async m=>{})"` -
  praktikabler: neuer/erweiterter Test in test/mcp-ui-widget-i18n.test.js oder ein neues
  `test/mcp-tools-fmt-locale.test.js`, das `pickCall`/`pickCalendarEntry` (falls exportiert)
  oder den vollen `list_calls`-Handler mit einem EN-Tenant-Fixture aufruft und
  `startedAt` NICHT gegen ein `de-DE`-Pattern matchen laesst.
- **Heute erwartbar**: rot - `fmt()` ignoriert die Tenant-/Call-Sprache komplett (FMT-03).
- **Belegt durch**: src/mcp-tools.js:48-55,267

### FMT-05 - get_calendar: start/end kommen im deutschen Format, auch fuer einen EN-Tenant
- **Prioritaet**: P0
- **Modus**: offline (analog FMT-04)
- **Vorbedingung**: wie FMT-04, aber mit einem Kalendereintrag statt einem Call.
- **Schritte**: analog FMT-04, `get_calendar` statt `list_calls`, Pruefung auf
  `pickCalendarEntry()`/`fmt(e.start)`, `fmt(e.end)`.
- **Erwartetes Ergebnis**: `start`/`end` sind `de-DE`-formatiert, unabhaengig vom
  Tenant/Call-Locale.
- **Verifikation**: neuer/erweiterter Offline-Test, der `get_calendar` fuer einen
  EN-Tenant aufruft und pruef, dass die zurueckgegebenen Strings NICHT dem
  en-GB-Muster (`Mon, DD/MM, HH:mm`) entsprechen, sondern dem de-Muster (`Mo., DD.MM.,
  HH:mm`).
- **Heute erwartbar**: rot - identischer Root-Cause wie FMT-04.
- **Belegt durch**: src/mcp-tools.js:48-55,293

### FMT-06 - Widget calendar.html bindet den fmt()-String direkt (keine Client-Neuformatierung)
- **Prioritaet**: P1
- **Modus**: offline (grep/Datei-Inspektion)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n 'data-mcp-row' src/ui/widgets/calendar.html`
  2. `grep -n "toLocaleString\|Date(" src/ui/widgets/calendar.html src/ui/widget-i18n.js`
- **Erwartetes Ergebnis**: `data-mcp-row="title,start,end"` bindet die vom Server
  gelieferten Strings 1:1 in die Karte; `widget-i18n.js`/`calendar.html` enthalten
  KEINE eigene Datums-Reformatierung, die den de-DE-String client-seitig korrigieren
  wuerde.
- **Verifikation**: `grep -c "toLocaleString\|new Date(" src/ui/widgets/calendar.html` ->
  erwartet `0`.
- **Heute erwartbar**: gruen (im Sinne "Befund bestaetigt") - die Abwesenheit einer
  Korrektur-Logik ist selbst der Beleg fuer die Luecke aus FMT-04/05.
- **Belegt durch**: src/ui/widgets/calendar.html:40, src/ui/widget-i18n.js:1-18

### FMT-07 - US-Onboarding ohne manuelle Sprachwahl faellt auf Deutsch zurueck
- **Prioritaet**: P0
- **Modus**: offline (node:test)
- **Vorbedingung**: keine (reine Funktionspruefung `languageForCountry`)
- **Schritte**:
  1. `import { languageForCountry } from "../src/i18n/locales.js"`
  2. `languageForCountry("US")` aufrufen.
- **Erwartetes Ergebnis**: Rueckgabewert ist `"de"` (DEFAULT_LANGUAGE), NICHT `"en"`.
- **Verifikation**: neuer Testfall in test/f1-i18n-locale.test.js (Erweiterung, kein neues
  File noetig) oder eigenstaendig:
  `node -e 'import("./src/i18n/locales.js").then(m=>console.log(m.languageForCountry("US")))'`
  -> erwartet Ausgabe `de`.
- **Heute erwartbar**: rot - `LANGUAGE_FOR_COUNTRY` hat nachweislich keinen `US`-Key
  (src/i18n/locales.js:268-274).
- **Belegt durch**: src/i18n/locales.js:268-280

### FMT-08 - US-Onboarding End-to-End: country=US ohne language-Override -> defaultLanguage de
- **Prioritaet**: P0
- **Modus**: offline (curl/node:test gegen lokalen Server)
- **Vorbedingung**: Server lokal, `POST /api/onboard` mit `{ country: "US" }`, KEIN
  `language`-Feld im Request.
- **Schritte**:
  1. Server lokal starten (`PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`).
  2. `POST /api/onboard` mit Body `{ "country": "US", ... }` (Pflichtfelder aus
     test/onboarding-route.test.js uebernehmen) aufrufen.
  3. Angelegten Tenant lesen (`GET /api/state` oder Store direkt).
- **Erwartetes Ergebnis**: `tenant.defaultLanguage === "de"`, `tenant.country === "US"`.
  Der Agent spricht also Deutsch mit einem US-Tenant, der nie explizit eine Sprache
  gewaehlt hat.
- **Verifikation**: Erweiterung von test/f1-geo-onboard.test.js um einen US-Fall (analog
  zu den dort bereits vorhandenen Praezedenz-Tests fuer country/defaultLanguage), oder
  `node --test test/f1-geo-onboard.test.js` nach Erweiterung.
- **Heute erwartbar**: rot - folgt direkt aus FMT-07 und der dokumentierten Praezedenz in
  src/geo/resolve.js.
- **Belegt durch**: src/i18n/locales.js:268-280, src/geo/resolve.js (Praezedenzkette)

### FMT-09 - en-GB statt en-US: dateLocale/sttLocale gepinnt, kein US-Profil
- **Prioritaet**: P1
- **Modus**: offline (node:test, bestehender Test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `node --test test/f1-i18n-locale.test.js`
- **Erwartetes Ergebnis**: Der bestehende Test besteht GRUEN und pinnt exakt
  `LOCALES.en.dateLocale === "en-GB"` und `LOCALES.en.sttLocale === "en-GB"` -
  das ist der Beweis, dass es aktuell KEIN separates `en-US`-Profil gibt (waere eines
  vorhanden, muesste dieser Test fehlschlagen oder differenzieren).
- **Verifikation**: `node --test test/f1-i18n-locale.test.js` -> alle Assertions gruen,
  `grep -c "en-US" src/i18n/locales.js` -> erwartet `0`.
- **Heute erwartbar**: gruen (Test besteht) - bestaetigt aber die Luecke (Konzept-Test,
  kein Bug-Test): das Bestehen dieses Tests IST der Beleg fuer "keine US-Variante".
- **Belegt durch**: src/i18n/locales.js:219-220, test/f1-i18n-locale.test.js:50,53

### FMT-10 - Private Summary-Nummer: US-Tenant kann +1-Nummer nicht hinterlegen (Self-Service)
- **Prioritaet**: P0
- **Modus**: offline (node:test, bestehender Test als Beleg)
- **Vorbedingung**: keine
- **Schritte**:
  1. `node --test test/f2-self-service-private-number.test.js`
- **Erwartetes Ergebnis**: Testfall "(c) gesperrter Laendercode (+1) -> 400" besteht
  GRUEN - `PATCH`/Setter fuer `privateNumber = "+12025550123"` liefert HTTP 400, der
  alte Wert bleibt unveraendert (`null`).
- **Verifikation**: `node --test test/f2-self-service-private-number.test.js` -> exit 0,
  0 Fehlschlaege.
- **Heute erwartbar**: gruen (Test besteht) - bestaetigt die Luecke als GEWOLLTES,
  gepinntes Verhalten (kein Bug im Test selbst, aber ein Produktdefekt fuer die
  Zielgruppe).
- **Belegt durch**: src/store/defaults.js:541, test/f2-self-service-private-number.test.js:158-165

### FMT-11 - Private Summary-Nummer: US-Land-Tenant bekommt beim Onboarding trotzdem nur +49-Gate
- **Prioritaet**: P0
- **Modus**: offline (node:test/curl)
- **Vorbedingung**: `POST /api/onboard` mit `country: "US"` UND `privateNumber:
  "+12025550123"` im selben Request.
- **Schritte**:
  1. Server lokal starten.
  2. `POST /api/onboard` mit obigem Body.
  3. Statuscode und Fehlermeldung pruefen.
- **Erwartetes Ergebnis**: HTTP 400 trotz `country: "US"` - `normalizePrivateNumber()`
  wird ohne 2. Argument (`allowedCountryCodes`) aufgerufen, das Land des Onboarding-
  Requests fliesst NICHT in das Laendergate der privaten Nummer ein.
- **Verifikation**: Erweiterung von test/onboarding-route.test.js um einen Fall
  "country=US + privateNumber=+1... -> 400 trotz passendem Land", oder manueller curl:
  `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3999/api/onboard -H
  "Content-Type: application/json" -d '{"country":"US","privateNumber":"+12025550123", ...}'`
  -> erwartet `400`.
- **Heute erwartbar**: rot - src/routes/api-onboard.js:125 ruft nachweislich ohne 2.
  Argument auf.
- **Belegt durch**: src/routes/api-onboard.js:125, src/store/defaults.js:541

### FMT-12 - call-finish Notification-Texte sind hart Deutsch (cancelled/failed)
- **Prioritaet**: P1
- **Modus**: offline (node:test/curl gegen lokalen Server, EN-Tenant)
- **Vorbedingung**: EN-Tenant, ein Outbound-Call, der ohne Transkript/als `cancelled`
  endet (z.B. `cancel_call` sofort nach Start).
- **Schritte**:
  1. Outbound-Call fuer EN-Tenant starten und sofort abbrechen (`cancel_call`/Timeout).
  2. `store.notifications` bzw. `GET /api/state` fuer diesen Tenant lesen.
- **Erwartetes Ergebnis**: Notification-Titel ist `"Anruf abgebrochen"` (Deutsch),
  NICHT `"Call cancelled"` o.ae. - unabhaengig von `call.language === "en"`.
- **Verifikation**: `grep -n '"Anruf abgebrochen"\|"Anruf nicht zustande gekommen"'
  src/telephony/call-finish.js` -> 1 Treffer je String, kein `localeFor`/`LOCALES`-Import
  in der Datei (`grep -c "localeFor" src/telephony/call-finish.js` -> erwartet `0`).
- **Heute erwartbar**: rot - die Strings sind Literale ohne Sprachverzweigung.
- **Belegt durch**: src/telephony/call-finish.js:57

### FMT-13 - call-finish Summary-Notification und SMS-Praefix sind hart Deutsch
- **Prioritaet**: P1
- **Modus**: offline (node:test/curl, EN-Tenant mit abgeschlossenem Call + Summary)
- **Vorbedingung**: EN-Tenant, Call mit Transkript, `summarizeCall` liefert ein
  englisches `summary`.
- **Schritte**:
  1. Kompletten Call-Zyklus fuer EN-Tenant durchlaufen (Fixture/Test-Setup wie in
     test/f2-sms-summary-plan.test.js).
  2. Notification-Titel und SMS-Body pruefen.
- **Erwartetes Ergebnis**: Notification-Titel ist `"Neue Call Summary"` (Deutsch), der
  `who`-Praefix ist `"Anruf bei ${to}"`/`"Anruf von ${from}"` (Deutsch), NUR der
  eigentliche `result.summary`-Satz ist Englisch. Die SMS traegt bei Action-Items den
  Literal-String `"Action Items:"` (Englisches Label mitten in einer sonst deutsch
  gerahmten Nachricht).
- **Verifikation**: `grep -n '"Anruf bei\|Anruf von\|Neue Call Summary\|Action Items:"'
  src/telephony/call-finish.js` -> 4 Treffer, alle ohne Sprachverzweigung.
- **Heute erwartbar**: rot.
- **Belegt durch**: src/telephony/call-finish.js:80,81,95

### FMT-14 - tenant.html ist lang="de" ohne Locale-Erkennung
- **Prioritaet**: P1
- **Modus**: offline (grep) + manuell (Browser mit `Accept-Language: en-US`)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n '<html lang=' public/tenant.html`
  2. Manuell: `public/tenant.html` im Browser mit US-Sprachprofil oeffnen, sichtbare
     Strings pruefen ("Meldungen", "Kein aktives Abo" o.ae.).
- **Erwartetes Ergebnis**: `<html lang="de">` fest, keine JS-Logik, die auf
  `navigator.language` reagiert (`grep -c "navigator.language" public/tenant.html`
  erwartet `0`). Sichtbare Strings bleiben Deutsch unabhaengig vom Browser.
- **Verifikation**: `grep -n '<html lang=' public/tenant.html` -> exakt `lang="de"`.
- **Heute erwartbar**: rot.
- **Belegt durch**: public/tenant.html:2

### FMT-15 - tenant.html formatiert Preis/Datum immer als de-DE
- **Prioritaet**: P1
- **Modus**: offline (grep) + manuell (Sichtpruefung im Browser)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n '"de-DE"' public/tenant.html`
  2. Manuell: Dashboard mit einem Test-Abo oeffnen, Preisanzeige und
     Abo-Verlaengerungsdatum pruefen (z.B. "4,99 €" statt "€4.99"/"$4.99", Datum
     "22.07.2026" statt "22 Jul 2026"/"07/22/2026").
- **Erwartetes Ergebnis**: Alle 3 Fundstellen (`formatPlanPrice`, `formatNotificationTime`,
  Abo-Verlaengerung) nutzen `"de-DE"` fest verdrahtet, unabhaengig von Tenant-Sprache
  oder Waehrung.
- **Verifikation**: `grep -c '"de-DE"' public/tenant.html` -> erwartet `3` (Zeilen 215,
  319, 389).
- **Heute erwartbar**: rot.
- **Belegt durch**: public/tenant.html:215,319,389

### FMT-16 - Plan-Katalog traegt EUR statt der dokumentierten USD-Entscheidung
- **Prioritaet**: P0
- **Modus**: offline (node:test, bestehender Test als Beleg)
- **Vorbedingung**: keine
- **Schritte**:
  1. `node --test test/plans-catalog.test.js`
- **Erwartetes Ergebnis**: Test besteht GRUEN und pinnt `plan.currency === "eur"` fuer
  beide Plaene (starter/business) UND die Uebereinstimmung mit
  `apps/web/src/lib/plans.js`.
- **Verifikation**: `node --test test/plans-catalog.test.js` -> exit 0;
  `grep -n 'currency' src/plans.js apps/web/src/lib/plans.js` -> alle 4 Treffer `"eur"`.
- **Heute erwartbar**: gruen (Test besteht, bestaetigt aber die Geld-Luecke: Code ist
  konsistent EUR, aber die dokumentierte Produktentscheidung ist USD - Diskrepanz liegt
  zwischen Code und Owner-Entscheidung, nicht im Test selbst).
- **Belegt durch**: src/plans.js:21,37, apps/web/src/lib/plans.js:13,29, test/plans-catalog.test.js:29

### FMT-17 - PAYMENT_CURRENCY ist ein einziger globaler Wert ohne Land-/Tenant-Bezug
- **Prioritaet**: P1
- **Modus**: offline (grep)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n "paymentCurrency" src/config.js`
  2. `grep -rn "paymentCurrency" src/ | grep -v "config.js\|config-namespaces"` auf
     Tenant-/Land-Parametrisierung pruefen.
- **Erwartetes Ergebnis**: `paymentCurrency` wird ausschliesslich aus `process.env.PAYMENT_CURRENCY`
  gelesen (Default `"eur"`), OHNE einen Tenant- oder `country`-Parameter in der
  Signatur/im Aufrufkontext.
- **Verifikation**: `grep -c "paymentCurrency.*tenant\|paymentCurrency.*country" src/` ->
  erwartet `0`.
- **Heute erwartbar**: rot (im Sinne "Luecke bestaetigt").
- **Belegt durch**: src/config.js:362, .env.example:231

### FMT-18 - Kein getHours/getUTCHours-basiertes Ruhezeiten-Gate im gesamten Repo
- **Prioritaet**: P1
- **Modus**: offline (grep)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -rn "getHours()\|getUTCHours()" src/`
- **Erwartetes Ergebnis**: 0 Treffer.
- **Verifikation**: `grep -rln "getHours()\|getUTCHours()" src/ | wc -l` -> erwartet `0`.
- **Heute erwartbar**: gruen (Grep liefert erwartungsgemaess 0 Treffer - das IST der
  Beleg fuer die Luecke).
- **Belegt durch**: src/telephony/outbound-gates.js:189-298 (nur Stundenlimit-Zaehler,
  keine Uhrzeitpruefung)

### FMT-19 - Stundenlimit ist Rate-Limit, keine Tageszeit-Pruefung (Abgrenzung zu FMT-18)
- **Prioritaet**: P2
- **Modus**: offline (node:test, bestehende Outbound-Gate-Tests)
- **Vorbedingung**: `config.safety.maxCallsPerHour` klein setzen (z.B. 1) fuer den Test
- **Schritte**:
  1. Zwei Outbound-Calls fuer denselben Tenant innerhalb derselben gleitenden Stunde
     ausloesen (unabhaengig von der Uhrzeit - auch um 03:00 Nachts moeglich).
  2. Pruefen, dass der zweite Call mit `grund: "stunde"`/"Stundenlimit" abgelehnt wird,
     NICHT wegen der Uhrzeit.
- **Erwartetes Ergebnis**: Der erste Call um z.B. 03:00 UTC geht durch (kein Tageszeit-
  Gate verhindert ihn), der zweite scheitert NUR am Zaehler, nicht an der Uhrzeit -
  bestaetigt, dass "Stundenlimit" != "Ruhezeiten".
- **Verifikation**: bestehender/erweiterter Test in Nachbarschaft der Outbound-Gate-Suite
  (`grep -rl "maxCallsPerHour" test/` fuer den passenden Testfile, z.B.
  `test/outbound-gates*.test.js` falls vorhanden - Existenz vorher mit
  `ls test/ | grep -i outbound-gate` pruefen).
- **Heute erwartbar**: unbekannt - haengt davon ab, ob eine passende Testdatei bereits
  existiert; falls nicht, ist das Verhalten nur aus dem Code (FMT-18-Beleg) ableitbar,
  nicht per bestehendem Testlauf verifiziert.
- **Belegt durch**: src/telephony/outbound-gates.js:189-298

### FMT-20 - E.164 akzeptiert NANP-Nummern (+1 + 10 Ziffern) korrekt
- **Prioritaet**: P2
- **Modus**: offline (node:test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `import { E164 } from "../src/store/defaults.js"`
  2. `E164.test("+12025550123")` pruefen.
- **Erwartetes Ergebnis**: `true` - eine US-Nummer mit Landesvorwahl + 10 Ziffern (11
  Gesamtziffern) ist ein gueltiges E.164-Format nach dem bestehenden Regex.
- **Verifikation**: `node -e 'import("./src/store/defaults.js").then(m=>console.log(m.E164.test("+12025550123")))'`
  -> erwartet `true`. Ggf. Erweiterung von test/e164-trunk-zero-reject.test.js um einen
  positiven NANP-Fall.
- **Heute erwartbar**: gruen - kein Bug, reine Regressions-Absicherung.
- **Belegt durch**: src/store/defaults.js:477

### FMT-21 - TRUNK_ZERO_COUNTRY_CODES betrifft +1 nicht (kein False-Positive fuer US)
- **Prioritaet**: P2
- **Modus**: offline (node:test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `import { hasTrunkZeroAfterCountryCode } from "../src/store/defaults.js"`
  2. `hasTrunkZeroAfterCountryCode("+10202555123")` (hypothetische US-Nummer mit
     fuehrender 0 nach Landesvorwahl) aufrufen.
- **Erwartetes Ergebnis**: `false` - `+1` steht nicht in `TRUNK_ZERO_COUNTRY_CODES`,
  eine US-Nummer wird NIE als Trunk-0-Verstoss abgelehnt (unabhaengig davon, ob eine
  solche Nummer in NANP ueberhaupt vorkommt).
- **Verifikation**: Erweiterung von test/e164-trunk-zero-reject.test.js um einen
  US-Kontrollfall, oder direkter node-Aufruf wie oben.
- **Heute erwartbar**: gruen - bestaetigt korrektes, bewusstes Scoping.
- **Belegt durch**: src/store/defaults.js:486

### FMT-22 - homeCountryCode() liefert fuer reinen US-Tenant null (kein Heimatland ableitbar)
- **Prioritaet**: P1
- **Modus**: offline (node:test, bestehender Test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `node --test test/dial-target-normalization.test.js`
- **Erwartetes Ergebnis**: Test "kein ableitbares Heimatland (US-DID, keine
  privateNumber) -> 400 statt raten" (Zeile 123) besteht GRUEN - ein Tenant mit
  ausschliesslich +1-Kandidatennummern bekommt bei einer mit "0" beginnenden Eingabe
  KEINE Umformung, sondern ein 400 vom nachgelagerten Gate.
- **Verifikation**: `node --test test/dial-target-normalization.test.js` -> exit 0.
- **Heute erwartbar**: gruen - bereits bestehender, bestandener Test; bestaetigt
  "ablehnen statt raten" als korrektes (wenn auch fuer US-Nutzer unbequemes) Verhalten.
- **Belegt durch**: src/store/defaults.js:506-516,525-532, test/dial-target-normalization.test.js:123-133

### FMT-23 - firstNameOf() mit CJK-Namen ohne Leerzeichen liefert den ganzen String
- **Prioritaet**: P2
- **Modus**: offline (node:test)
- **Vorbedingung**: keine (Funktion ist aktuell nicht exportiert - Test braucht ggf.
  Export-Erweiterung oder Pruefung ueber den Aufrufer `firstName`)
- **Schritte**:
  1. `grep -n "^function firstNameOf\|export.*firstNameOf" src/store/state-ops.js`
     pruefen, ob die Funktion exportiert ist.
  2. Falls nicht exportiert: ueber den oeffentlichen Aufrufer testen (Tenant mit
     `firstName: undefined`, `owner.fullName/effectiveOwner: "田中太郎"`, pruefen, was
     `tenant.firstName` liefert).
  3. Falls exportiert: `firstNameOf("田中太郎")` direkt aufrufen.
- **Erwartetes Ergebnis**: Rueckgabe ist der volle String `"田中太郎"` (kein Leerzeichen
  zum Splitten vorhanden), nicht ein isolierter "Vorname".
- **Verifikation**: neuer Test `test/fmt-cjk-name.test.js` (oder Erweiterung eines
  bestehenden Name-Tests), der diesen Fall exemplarisch als "technisch unproblematisch,
  aber ungetestet" dokumentiert.
- **Heute erwartbar**: unbekannt - reine JS-String-Operation legt kein Fehlverhalten
  nahe, aber es existiert aktuell KEIN Test, der das beweist (Luecke ist die Abwesenheit
  der Absicherung, nicht ein bekannter Bug).
- **Belegt durch**: src/store/state-ops.js:792, grep nach CJK-Tests in test/ ohne Treffer

### FMT-24 - escapeXml() laesst CJK-Zeichen im TeXML-Dokument unveraendert durch
- **Prioritaet**: P2
- **Modus**: offline (node:test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `import { renderSay } from "../src/telephony/adapters/telnyx/render.js"` (oder die
     passende exportierte Render-Funktion, die `escapeXml` intern nutzt - exakten
     Funktionsnamen vorher mit `grep -n "^export function" src/telephony/adapters/telnyx/render.js`
     pruefen).
  2. Text mit CJK-Zeichen (z.B. `"田中様、お電話ありがとうございます"`) durch den Say-
     Renderpfad schicken.
- **Erwartetes Ergebnis**: Das CJK-Zeichen erscheint byte-identisch im erzeugten
  `<Say>`-Element, keine Escape-Sequenz/Mojibake/Exception.
- **Verifikation**: neuer Test analog zu bestehenden Render-Tests (z.B. Struktur wie in
  Tests, die `escapeXml` fuer Umlaute pruefen - `grep -rl "escapeXml" test/` fuer ein
  Vorbild), der einen CJK-String durch den Renderpfad schickt und den Output prueft.
- **Heute erwartbar**: unbekannt - Code-Inspektion (nur Standard-XML-Escapes, UTF-8-
  Dokument) legt kein Problem nahe, aber unverifiziert mangels Test.
- **Belegt durch**: src/telephony/adapters/telnyx/render.js:29

### FMT-25 - localeFor() faellt bei unbekannter/leerer/null Sprache fail-safe auf de zurueck
- **Prioritaet**: P1
- **Modus**: offline (node:test, bestehender Test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `node --test test/f1-i18n-locale.test.js`
  2. Zusaetzlich pruefen: `localeFor("xx")`, `localeFor(null)`, `localeFor(undefined)`,
     `localeFor("")` liefern alle `LOCALES.de`.
- **Erwartetes Ergebnis**: Alle 4 Faelle liefern das DE-Bundle (Objektidentitaet mit
  `LOCALES.de`), kein Crash, kein stiller EN-Fallback.
- **Verifikation**: `node --test test/f1-i18n-locale.test.js`, ggf. Erweiterung um die
  4 Randfaelle falls nicht bereits abgedeckt (`grep -n "localeFor(" test/f1-i18n-locale.test.js`
  vorher pruefen).
- **Heute erwartbar**: gruen - `localeFor()` nutzt nachweislich `LOCALES[language] ||
  LOCALES[DEFAULT_LANGUAGE]` (src/i18n/locales.js:279 Umgebung), ein Falsy-Wert greift
  den `||`-Fallback.
- **Belegt durch**: src/i18n/locales.js (localeFor-Implementierung, unmittelbar nach
  languageForCountry)

### FMT-26 - languageForCountry() ist case-insensitiv, faellt aber fuer "us" (klein) ebenfalls auf de zurueck
- **Prioritaet**: P2
- **Modus**: offline (node:test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `languageForCountry("us")` (Kleinschreibung) UND `languageForCountry("Us")`
     (gemischt) aufrufen.
- **Erwartetes Ergebnis**: Beide liefern `"de"` (durch `.toUpperCase()`-Normalisierung
  intern konsistent mit `languageForCountry("US")`, s. FMT-07) - kein Case-abhaengiges
  Sonderverhalten, aber die Grund-Luecke (fehlender US-Eintrag) bleibt bestehen.
- **Verifikation**: kleine Ergaenzung in test/f1-i18n-locale.test.js oder Ad-hoc-Node-Call.
- **Heute erwartbar**: gruen (Case-Normalisierung funktioniert), aber die zugrunde
  liegende Luecke (FMT-07) bleibt unabhaengig davon rot.
- **Belegt durch**: src/i18n/locales.js:279 (`.toUpperCase()`)

### FMT-27 - Mitigation-Pfad: number.language="en" explizit gesetzt uebersteuert tenant.defaultLanguage="de" fuer US-Nummer
- **Prioritaet**: P1
- **Modus**: offline (node:test, bestehender Test als Beleg)
- **Vorbedingung**: keine
- **Schritte**:
  1. `node --test test/f1-p8-outbound-lang.test.js`
- **Erwartetes Ergebnis**: Test besteht GRUEN und bestaetigt die Praezedenz
  `settings.language || number.language || tenant.defaultLanguage || DEFAULT_LANGUAGE`
  (src/store/state-ops.js:648-651) - ein Operator kann also die FMT-07/FMT-08-Luecke
  manuell umgehen, indem er `number.language` beim Nummernkauf explizit auf `"en"`
  setzt, OHNE auf einen automatischen US-Mechanismus angewiesen zu sein.
- **Verifikation**: `node --test test/f1-p8-outbound-lang.test.js` -> exit 0.
- **Heute erwartbar**: gruen - bestehender, bestandener Test; wichtig als Beleg, dass
  ein manueller Workaround fuer FMT-07/08 existiert (kein Totalausfall, aber kein
  automatischer Schutz).
- **Belegt durch**: src/store/state-ops.js:648-651, test/f1-p8-outbound-lang.test.js

### FMT-28 - Kein Zeitzonen-Feld im Datenmodell (JSON- und Postgres-Schema)
- **Prioritaet**: P0
- **Modus**: offline (grep)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -rn "timezone\|timeZone\|Zeitzone" src/store/defaults.js src/db/schema.sql`
- **Erwartetes Ergebnis**: 0 Treffer in beiden Dateien.
- **Verifikation**: `grep -rc "timezone\|timeZone" src/store/defaults.js src/db/schema.sql`
  -> beide `0`.
- **Heute erwartbar**: gruen (Grep bestaetigt erwartungsgemaess 0 Treffer - das IST der
  Beleg fuer die zentrale Luecke dieser gesamten Dimension).
- **Belegt durch**: src/store/defaults.js (kein timezone-Feld), src/db/schema.sql:13-135

### FMT-29 - Demo-Kalender (Bootstrap-Tenant) rechnet in Server-Lokalzeit, nicht UTC/Tenant-TZ
- **Prioritaet**: P2
- **Modus**: offline (node, TZ-Vergleich)
- **Vorbedingung**: keine
- **Schritte**:
  1. `TZ=Europe/Berlin node -e 'import("./src/store/defaults.js").then(m=>{})'` -
     praktikabler: `grep -n "setHours\|setDate" src/store/defaults.js` um die Zeilen zu
     bestaetigen, dann `TZ=America/Los_Angeles node --eval` denselben `nextWeekday`-
     Code mit fixem `daysAhead`/`hour` unter zwei verschiedenen `TZ`-Werten ausfuehren
     und die `toISOString()`-Ausgabe vergleichen.
- **Erwartetes Ergebnis**: Die UTC-Ausgabe von `nextWeekday(daysAhead, hour)` unterscheidet
  sich zwischen `TZ=Europe/Berlin` und `TZ=America/Los_Angeles` um die TZ-Differenz (z.B.
  9 Stunden PDT/CEST) - der Demo-Termin "9 Uhr" ist also 9 Uhr SERVERZEIT, nicht 9 Uhr
  UTC oder 9 Uhr Tenant-Zeit.
- **Verifikation**: manueller node-Vergleich der beiden `TZ`-Laeufe, Differenz der
  `toISOString()`-Stunden pruefen.
- **Heute erwartbar**: rot (im Sinne "Abhaengigkeit von Server-TZ bestaetigt") - direkte
  Konsequenz aus der Nutzung von `setHours()` (lokale Zeit) statt `setUTCHours()`.
- **Belegt durch**: src/store/defaults.js:308-315,390-392

### FMT-30 - Spend-Monat-Achse bleibt UTC-verankert (Regressionsschutz, Positivbeispiel)
- **Prioritaet**: P2
- **Modus**: offline (grep, dokumentierender Test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n "getUTCFullYear\|getUTCMonth" src/store/state-ops.js`
- **Erwartetes Ergebnis**: `yearMonthKey()`/`spendMonthKeyOf()` nutzen `getUTCFullYear()`/
  `getUTCMonth()`, NICHT die lokalen Pendants - dieser Teil des Systems hat den
  Zeitzonen-Drift bereits bewusst geloest und dient als Vorbild fuer eine spaetere
  Fixierung von FMT-01/FMT-29.
- **Verifikation**: `grep -c "getFullYear()\|getMonth()" src/store/state-ops.js` (ohne
  UTC-Praefix) im unmittelbaren Umfeld von `yearMonthKey` -> erwartet `0` in dieser
  Funktion (Kontrollprobe: falsche/lokale Variante darf dort nicht vorkommen).
- **Heute erwartbar**: gruen - bewusst korrektes Bestandsverhalten, kein Regressions-
  risiko ohne Code-Aenderung.
- **Belegt durch**: src/store/state-ops.js:1646-1650

### FMT-31 - calendar_event-Sortierung ist bei UTC-Z-Suffix lexikografisch korrekt (Grenzfall gemischte Offsets)
- **Prioritaet**: P2
- **Modus**: offline (node:test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `import { addCalendarEvent, getCalendar } from "../src/store/state-ops.js"` (oder
     Store-Fassade nutzen).
  2. Zwei Events mit ISO-Strings anlegen, davon eines mit `Z`-Suffix (UTC) und eines mit
     explizitem Offset (`+02:00`), die chronologisch in umgekehrter lexikografischer
     Reihenfolge liegen (z.B. `"2026-08-01T23:00:00+02:00"` = 21:00 UTC vs.
     `"2026-08-01T22:00:00Z"` = 22:00 UTC - lexikografisch erscheint der Offset-String
     VOR dem Z-String, obwohl er chronologisch SPAETER ist).
  3. `getCalendar()` aufrufen und die Reihenfolge pruefen.
- **Erwartetes Ergebnis**: Die Sortierung liefert die lexikografische (String-)
  Reihenfolge, NICHT die chronologische - bei gemischten Offset-Formaten (Z vs. +HH:MM)
  kann `localeCompare` die falsche Reihenfolge liefern. Das ist ein bisher unbewiesener
  Edge Case des dokumentierten "bitidentisch"-Ansatzes.
- **Verifikation**: neuer Test `test/fmt-calendar-sort-mixed-offset.test.js`, der genau
  dieses Gemisch prueft und explizit feststellt, ob die Reihenfolge chronologisch oder
  lexikografisch ist.
- **Heute erwartbar**: unbekannt - der Store persistiert laut Kommentar "bitidentisch"
  ISO-Strings, es ist nicht verifiziert, ob alle Schreibpfade konsistent `Z`-Suffix
  erzwingen (falls ja, ist der Fall irrelevant; falls nicht, ist es ein stiller
  Sortierbug bei internationalen/Offset-tragenden Terminen).
- **Belegt durch**: src/db/schema.sql:260-266, src/store/state-ops.js:600-606

### FMT-32 - Notification-/SMS-Praefixe bleiben deutsch auch bei call.language="fr" (nicht nur EN betroffen)
- **Prioritaet**: P2
- **Modus**: offline (grep, Abgrenzungspruefung zu FMT-12/13)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n "call.language\|localeFor" src/telephony/call-finish.js`
- **Erwartetes Ergebnis**: 0 Treffer - die Datei liest `call.language` an KEINER Stelle,
  die Luecke aus FMT-12/13 betrifft also nicht nur Englisch, sondern auch Franzoesisch
  (jede Nicht-Deutsch-Sprache ist betroffen, die Luecke ist keine EN-Spezialitaet).
- **Verifikation**: `grep -c "call.language\|localeFor" src/telephony/call-finish.js` ->
  erwartet `0`.
- **Heute erwartbar**: rot (Luecke bestaetigt, sprachuebergreifend).
- **Belegt durch**: src/telephony/call-finish.js (gesamte Datei, kein language-Zugriff)

## Zusammenfassung Deckung

- Alle 8 `gaps` aus dem Recon-Befund sind abgedeckt: Zeitzonen-Feld (FMT-01/02/28/29),
  mcp-tools fmt() (FMT-03/04/05/06), Private-Nummer-Laendergate (FMT-10/11), fehlender
  US-Sprach-Mapping-Eintrag (FMT-07/08), call-finish-Texte (FMT-12/13/32),
  tenant.html (FMT-14/15), Preis/Waehrung (FMT-16/17), Ruhezeiten-Gate (FMT-18/19),
  Kalender-Zeitzonen-Verankerung (FMT-31), CJK-Namen (FMT-23/24).
- Alle 7 `usHazards` sind abgedeckt: now-Zeitzone (FMT-01/02), US-Sprachfallback
  (FMT-07/08), en-GB statt en-US (FMT-09), private Summary-Nummer fuer US (FMT-10/11),
  mcp-Zeitstempel-Format (FMT-03/04/05), tenant.html-Sprache (FMT-14/15),
  EUR-Preise (FMT-16/17), fehlendes Ruhezeiten-Gate (FMT-18).
- Zusaetzliche Edge Cases ueber den Recon-Befund hinaus: null/leer/unbekannte Sprache
  (FMT-25), Gross-/Kleinschreibung Laendercode (FMT-26), Mitigation-/Workaround-Pfad
  (FMT-27), NANP-Positivfall (FMT-20/21), gemischte Zeitzonen-Offsets in der
  Kalender-Sortierung (FMT-31), sprachuebergreifende Abgrenzung DE-only-Texte
  (FMT-32).
