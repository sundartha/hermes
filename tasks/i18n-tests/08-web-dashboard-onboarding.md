# WEB - Web, Dashboard, Self-Service und Onboarding-Texte

## Ist-Stand (belegt)

- `public/tenant.html:2` ist fest `<html lang="de">`; jede sichtbare Zeichenkette (Buttons,
  Statustexte, Fehlermeldungen, Persona-Labels) ist ein deutsches Literal im HTML/JS, kein
  i18n-Mechanismus. Bestaetigt per Read.
- Ein zweites, englisches Self-Service-Dashboard existiert unter `apps/web` (`/app`):
  `apps/web/src/layouts/App.astro:14` ist `<html lang="en">` (per Read verifiziert, Recon-Beleg
  korrekt), Inseln unter `apps/web/src/components/app/*`.
- Welches Dashboard live ausgeliefert wird, haengt an `config.server.webDistDir`
  (`src/app.js:143-176`, exakt verifiziert: Zeile 143/144 = Landing-Redirect nur ohne
  `webDistDir`, Zeile 159-175 = statisches Serving + `/tenant.html`->`/app`-Redirect +
  SPA-Fallback nur MIT `webDistDir`). Ob das Flag live gesetzt ist, steht NICHT im Repo (Render-
  Dashboard-Wert) - siehe `openQuestions`.
- `src/self-service.js:29-32`: `GREETING_TEMPLATES` sind exakt 3 deutsche Saetze
  (`DEFAULT_GREETING` aus `src/store/defaults.js:320` + zwei weitere), keine EN/FR-Variante.
  `DEFAULT_LANGUAGE = "de"` (`src/store/defaults.js:331`).
- `src/routes/voice.js:237` loest `language` via `store.resolveCallLanguage`, Zeile 265 spricht
  `ctx.settings.greeting` woertlich (nur `{owner}`-Ersetzung), OHNE Ruecksicht auf `language`/
  `locale`. Zeile 278-279: Transkript + TeXML nutzen denselben woertlichen Text.
  `src/store/state-ops.js:648-651` (Praezedenz: `settings.language || numberRecord?.language ||
  tenant?.defaultLanguage || DEFAULT_LANGUAGE`) und `localeFor()` (`src/i18n/locales.js:283-286`,
  Fallback DE bei unbekanntem Key) sind fuer den GESPROCHENEN Satz irrelevant, weil `greeting`
  nie durch `locale` laeuft.
- `apps/web/src/components/app/SettingsIsland.astro`: rendert `state.greetingTemplates`
  (Server-Vorlagen, 1:1 deutsch) ungeuebersetzt in einem `<select>` (Zeile 100-117 laut Read).
  **Korrektur zum Recon-Befund**: `grep -rn "personaStyleIds\|agentStyle" apps/web/src/` liefert
  0 Treffer im GESAMTEN `apps/web`-Baum - das englische Dashboard liest `personaStyleIds`
  NICHT (nicht nur "ohne Dropdown", das Feature ist dort komplett unbekannt/ungebunden).
  Formulare senden dort insbesondere kein `agentStyle`-Feld.
- `src/i18n/locales.js:60`: `PERSONA_STYLE_IDS = ["warm-persoenlich", "formell-professionell"]`
  (deutsche Bindestrich-IDs). `public/tenant.html` (Zeile ~514-518 laut Read) leitet das Label
  per `id.replace(/-/g," ")` ab - "Warm persoenlich" statt Uebersetzung, obwohl
  `locales.js:73-82` bereits FR/EN-Ton-Klauseln fuer dieselben IDs enthaelt (nur fuer den
  System-Prompt, nicht fuers UI-Label).
- `src/self-service-routes.js:275,316,365,375,388` liefern rohen deutschen Klartext im
  `error`-Feld der JSON-Antwort: `"privateNumber ungueltig (E.164 erwartet, erlaubtes Land)"`,
  `"PUBLIC_URL fehlt"`, `"session_id ist Pflicht"`, `"Customer-Mismatch"` (zweimal).
- `src/web-auth.js`: `rejectCsrf()` (Zeile 115-117) sendet
  `"Ungueltige oder fehlende CSRF-State-Pruefung"` (400); Zeile 223 sendet
  `"Anmeldung fehlgeschlagen"` (500, `/auth/login`-Redirect-Fehler); Zeile 284 sendet dieselbe
  Zeichenkette (401, `/auth/callback`-Austausch-Fehler); `SESSION_EXPIRED_PAGE` (Zeile 31-35)
  ist `<html lang="de">` mit deutschem Fliesstext. Kein `Accept-Language`, kein `i18n`-Import in
  der Datei.
- `src/telephony/call-finish.js:57` (`"Anruf abgebrochen"` / `"Anruf nicht zustande gekommen"`)
  und Zeile 80-81 (`Anruf bei ${to}` / `Anruf von ${from}` als SMS-/Notification-Praefix,
  `"Neue Call Summary"` als Notification-Titel) sind hartkodierte deutsche Rahmentexte um die
  vermutlich sprachabhaengige KI-Zusammenfassung.
- `src/plans.js:21,37` UND `apps/web/src/lib/plans.js:13,29` sind `currency: "eur"` fuer beide
  Tarife, gepinnt durch `test/plans-catalog.test.js:24-27` (kommentiert als "EUR-Cutover, Stripe
  live, 2026-07-03"). `apps/web/src/lib/plans.js:39` (`CURRENCY_SYMBOLS = { eur: "€", usd: "$" }`)
  UND `formatPlanPrice()` (Zeile 44-48) unterstuetzen USD bereits korrekt (Punkt-Dezimaltrenner,
  Symbol vorangestellt) - nur die Katalog-Daten sind hart auf `"eur"` gesetzt, nicht der
  Formatierungs-Code. `apps/web/src/pages/preise.astro:33` ruft `formatPlanPrice(plan.amountCents,
  plan.currency)` auf (kein hartkodiertes `"€4.99"`-Literal, aber mit `plan.currency=="eur"` ist
  das Resultat gleichbedeutend `"€4.99"`).
- `public/tenant.html:215` formatiert Preise via `Intl.NumberFormat("de-DE", ...)`, Zeile 319/389
  Datum/Uhrzeit via `.toLocaleString("de-DE")` / `.toLocaleDateString("de-DE")` - unabhaengig von
  Tenant-Land/-Sprache. `test/bk1-plan-price-format.test.js:44-48` PINNT dieses Verhalten bereits
  explizit inkl. des Falls USD: `formatPlanPrice(499, "usd")` == `"4,99 $"` (Komma-Dezimaltrenner
  MIT Dollar-Symbol) - ein existierender, gruener Test, der den Defekt dokumentiert statt ihn zu
  verhindern.
- `apps/web/src/lib/api.js:332` (`CAL_LOCALE = "en-US"`) und `apps/web/src/lib/subscribe.js:34`
  (`DATE_LOCALE = "en-US"`) nutzen im Kontrast dazu konsequent `en-US`.
- Rechtstexte (`apps/web/src/pages/impressum.astro`, `agb.astro`, `datenschutz.astro`) sind
  `lang="de"`, Impressum ausdruecklich Platzhalter.
- Marketing-Seiten (`apps/web/src/layouts/Site.astro:19-26`) sind standardmaessig Englisch.
- `grep -rn "privateNumber\|private-number" apps/web/src public/tenant.html` liefert 0 Treffer
  (verifiziert) - kein UI-Weg fuer die private Rufnummer in beiden Dashboards, obwohl
  `src/self-service-routes.js` einen Setter/Reader dafuer besitzt.
- `src/routes/api-onboard.js:7-11` (Kommentar: "BEWUSST KEIN MCP-Tool ... hinter der
  bestehenden /api/*-Basic-Auth") und Zeile 85-102/135-168: `POST /api/onboard` ist
  Operator-only, fragt `country`/`privateNumber` ab und setzt `defaultLanguage` via
  `languageForCountry(country)` (Zeile 147, `setTenantGeo` Zeile 168).
- `src/web-auth.js:167-186` (`mintSession`/`upsertOnFirstLogin`): der ECHTE Browser-Login-Pfad
  fuer Self-Service-Tenants ruft `accounts.upsertOnFirstLogin({ sub, email })` OHNE `country`
  oder `language` - `tenant.country`/`tenant.defaultLanguage` bleiben nach dem ersten Login
  unbelegt (kein Aufruf von `setTenantGeo` in diesem Pfad).
- **NEUER, vom Recon nicht erfasster Befund**: `src/i18n/locales.js:268-274`
  (`LANGUAGE_FOR_COUNTRY = { DE:"de", AT:"de", CH:"de", FR:"fr", GB:"en", IE:"en" }`) enthaelt
  KEINEN Eintrag fuer `"US"`. `languageForCountry("US")` faellt daher via
  `locales.js:279` (`|| DEFAULT_LANGUAGE`) auf `"de"` zurueck - obwohl
  `src/telephony/provisioning-geo.js:37` `US` sehr wohl als Kauf-Land kennt
  (`COUNTRY_SEARCH_PARAMS.US = { telnyxCountryCode: "US" }`). `test/f1-geo-onboard.test.js`
  deckt DE/FR/GB explizit ab (Zeile 25,47,117), aber KEINEN `country=US`-Fall. Ein Onboarding mit
  `body.country=US` liefert also `json.language == "de"` statt `"en"` - ein Kern-USA-Blocker, der
  im Recon-Befund fehlt.

## Luecken

| Luecke | Schaden | Beleg | Schwere |
|---|---|---|---|
| `public/tenant.html` 100% Deutsch, kein i18n | US-Kunde sieht bei WEB_DIST_DIR=aus ein komplett fremdsprachiges Dashboard | `public/tenant.html:2` durchgaengig; `src/app.js:143-176` | S1 |
| Inbound-Greeting immer woertlich `settings.greeting`, alle Vorlagen deutsch | Erster gesprochener Satz ist deutsch, selbst bei `language=en` | `src/self-service.js:29-32`; `src/routes/voice.js:237,265,278-279` | S1 |
| `languageForCountry("US")` -> `"de"` (US fehlt in `LANGUAGE_FOR_COUNTRY`) | Jedes ueber `POST /api/onboard` mit `country=US` angelegte Tenant bekommt automatisch Deutsch als Default-Sprache | `src/i18n/locales.js:268-279`; `src/routes/api-onboard.js:147` | S1 |
| OIDC-Login-Fehlerpfade (`web-auth.js`) hartkodiert deutsch, ausserhalb `i18n` | US-Erstnutzer landet bei CSRF-/Session-/Auth-Fehlern auf unverstaendlicher deutscher Seite | `src/web-auth.js:31-36,115-117,223,284` | S1 |
| Post-Call-SMS/Notification-Rahmentexte hartkodiert deutsch | Englischsprachiger Tenant bekommt Deutsch/Englisch-Mischmasch-SMS | `src/telephony/call-finish.js:57,80-81` | S1 |
| Browser-Login (`upsertOnFirstLogin`) fragt weder Land noch Sprache ab | Self-Service-Tenant bleibt ohne `defaultLanguage`/`country`, faellt permanent auf DE zurueck | `src/web-auth.js:167-186` | S1 |
| Plan-Katalog hart `currency:"eur"` (Formatierungscode kann bereits USD) | US-Kunde sieht/zahlt Euro-Betraege auf sonst englischer Seite | `src/plans.js:21,37`; `apps/web/src/lib/plans.js:13,29,39`; `test/plans-catalog.test.js:24-27` | S2 |
| `public/tenant.html` Preise/Datum hart `Intl("de-DE")`, auch fuer `currency:"usd"` | Selbst nach Waehrungs-Fix bliebe Format falsch ("4,99 $" statt "$4.99") | `public/tenant.html:215,319,389`; `test/bk1-plan-price-format.test.js:44-48` | S2 |
| Kein UI fuer `privateNumber` in beiden Dashboards | Zusammenfassungs-SMS-ans-Handy-Feature fuer echte Self-Service-Kunden unerreichbar | grep 0 Treffer; `src/self-service-routes.js:266-280` | S2 |
| `apps/web`-Dashboard bindet `agentStyle`/`personaStyleIds` gar nicht (0 Codetreffer) | US-Kunde im englischen Dashboard kann Gespraechs-Ton gar nicht einstellen (Feature-Luecke, nicht nur Uebersetzungs-Luecke) | grep 0 Treffer `apps/web/src/`; Kontrast `public/tenant.html:504-521` | S2 |
| `public/tenant.html` Persona-Label naiv aus ID abgeleitet, nicht uebersetzt | Sichtbarer Deutsch-Leak selbst wo eine Uebersetzung bereits existiert | `src/i18n/locales.js:60,73-82`; `public/tenant.html` (Label-Funktion) | S3 |
| Rechtstexte nur Deutsch, Impressum Platzhalter | US-Besucher kann Rechtstexte nicht lesen; Impressum ohnehin nicht rechtsverbindlich fertig | `apps/web/src/pages/impressum.astro` (lang=de, Platzhalter) | S3 |
| `LOCALES`-Lookup case-sensitiv, `settings.language="EN"` faellt still auf DE | Grossschreibungs-Tippfehler/-Import fuehrt zu stillem Sprachwechsel ohne Fehler | `src/i18n/locales.js:283-286,95-96,168,217` | S3 |

## Tests

### WEB-01 - tenant.html liefert kein sprachabhaengiges html-lang-Attribut

- **Prioritaet**: P0
- **Modus**: offline (node --test / grep)
- **Vorbedingung**: keine (statische Datei-Pruefung, WEB_DIST_DIR irrelevant fuer diesen Test)
- **Schritte**:
  1. `grep -c '<html lang="de">' public/tenant.html`
  2. Pruefen, ob im gesamten File ein zweites, dynamisches `lang`-Attribut oder ein
     Templating-Mechanismus existiert (z.B. `data-i18n`, `{{lang}}`, `document.documentElement.lang =`)
- **Erwartetes Ergebnis**: genau 1 Treffer fuer `<html lang="de">`, 0 Treffer fuer jede Form von
  dynamischer lang-Zuweisung. Ein Test, der stattdessen verlangt, dass `lang` NICHT hartkodiert
  `"de"` ist (z.B. `assert.notEqual(htmlLangAttr, "de")`), schlaegt heute fehl.
- **Verifikation**:
  `grep -c '<html lang="de">' public/tenant.html` (erwartet `1`) UND
  `grep -c 'document.documentElement.lang\|data-i18n' public/tenant.html` (erwartet `0`)
- **Heute erwartbar**: rot (bezogen auf die Zielaussage "lang ist NICHT hart de"; die
  Ist-Zustand-Pruefung selbst - `1` Treffer fuer `de` - ist grün und bestaetigt die Luecke)
- **Belegt durch**: public/tenant.html:2

### WEB-02 - Live-Verifikation: welches Dashboard sieht ein echter US-Login heute

- **Prioritaet**: P0
- **Modus**: manuell (echter Browser-Login gegen den Live-Render-Service; KEIN Netzwerkaufruf
  durch diesen Katalog-Autor selbst, siehe Sperre)
- **Vorbedingung**: Zugriff auf den Live-Render-Service; WorkOS-Testaccount fuer einen
  Nicht-Owner-Tenant
- **Schritte**:
  1. Im Render-Dashboard den Wert von `WEB_DIST_DIR` fuer den aktiven Web-Service ablesen
     (NICHT aus `render.yaml` annehmen - Dashboard-Wert kann abweichen, siehe Memory
     `account-billing-strategy.md`)
  2. Als Nicht-Owner-Tenant einloggen (OIDC-Flow ueber `/auth/login`)
  3. Beobachten, ob nach Login `/app` (Englisch) oder `/tenant.html` (Deutsch) angezeigt wird,
     inkl. `<html lang>`-Attribut im gerenderten DOM
- **Erwartetes Ergebnis**: `<html lang="en">` und `/app`-URL, wenn `WEB_DIST_DIR` gesetzt ist;
  `<html lang="de">` und `/tenant.html`, wenn nicht gesetzt. Beides ist ein deterministisches,
  am DOM ablesbares Ergebnis.
- **Verifikation**: Browser-DevTools `document.documentElement.lang` + `location.pathname`
  nach Login-Redirect
- **Heute erwartbar**: unbekannt (Live-Env-Wert nicht aus dem Repo ablesbar, Zugriff auf
  Render-Dashboard/echten Login noetig - siehe openQuestions)
- **Belegt durch**: src/app.js:143-176; render.yaml:406-407 (deklariert, aber Live-Wert
  moeglicherweise abweichend)

### WEB-03 - WEB_DIST_DIR-Redirect /tenant.html -> /app erhaelt Query und liefert englische App-Shell

- **Prioritaet**: P1
- **Modus**: offline
- **Vorbedingung**: Server gestartet mit `WEB_DIST_DIR` auf einen validen `apps/web`-Build
  (bestehendes Test-Setup in `test/single-origin-serving.test.js`)
- **Schritte**:
  1. `node --test test/single-origin-serving.test.js` ausfuehren (bestehende Faelle:
     Zeile 72 `/tenant.html -> 302 /app`, Zeile 86 `/tenant.html?sub=ok -> 302 /app?sub=ok`,
     Zeile 101/127 SPA-Fallback)
  2. Ergaenzend pruefen: `apps/web/src/layouts/App.astro:14` enthaelt `<html lang="en">`
     (Build-Quelle der ausgelieferten `/app`-Shell)
- **Erwartetes Ergebnis**: alle bestehenden Faelle bestehen (302 mit erhaltenem Query-String,
  SPA-Fallback liefert `app/index.html`); `App.astro` Zeile 14 == `<html lang="en">`
- **Verifikation**: `node --test test/single-origin-serving.test.js` (erwartet 0 Fehlschlaege)
  + `grep -n '<html lang="en">' apps/web/src/layouts/App.astro` (erwartet 1 Treffer)
- **Heute erwartbar**: gruen (Mechanismus bereits implementiert und getestet, Redirect/Shell
  sind der korrekte Pfad fuer die englische Oberflaeche)
- **Belegt durch**: src/app.js:159-175; test/single-origin-serving.test.js:72,86,101,127;
  apps/web/src/layouts/App.astro:14

### WEB-04 - GREETING_TEMPLATES bieten keine englische Vorlage

- **Prioritaet**: P0
- **Modus**: offline
- **Vorbedingung**: keine
- **Schritte**:
  1. `import { GREETING_TEMPLATES } from "../src/self-service.js"`
  2. Pruefen, ob mindestens eine Vorlage NICHT die deutschen Signalwoerter ("Guten Tag",
     "Hallo", "Nachricht", "helfen") enthaelt, sondern englische Entsprechungen
- **Erwartetes Ergebnis**: mindestens 1 von `GREETING_TEMPLATES.length` Eintraegen ist englisch
  (Ziel-Assertion). Heute sind es 0 von 3.
- **Verifikation**: neuer Test `assert.ok(GREETING_TEMPLATES.some(t => /Hello|Hi there/i.test(t)))`
  gegen `src/self-service.js:29-32`
- **Heute erwartbar**: rot (alle 3 Vorlagen sind deutsche Literale, siehe DEFAULT_GREETING
  `src/store/defaults.js:320` + zwei weitere in self-service.js:30-32)
- **Belegt durch**: src/self-service.js:29-32; src/store/defaults.js:320-321

### WEB-05 - Inbound-Greeting ignoriert settings.language beim tatsaechlich gesprochenen Text

- **Prioritaet**: P0
- **Modus**: offline (curl gegen lokalen Server mit SKIP_TWILIO_SIGNATURE_CHECK)
- **Vorbedingung**: `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`; Test-Tenant mit
  `settings.language = "en"` UND `settings.greeting` unveraendert (Default = deutscher Text)
- **Schritte**:
  1. `curl -s -X POST http://localhost:3999/voice/incoming -d "To=<TestDID>&From=%2B1..." `
  2. TeXML-Antwort auf den `<Say>`-Inhalt der Begruessung pruefen
- **Erwartetes Ergebnis** (Zielaussage): der gesprochene Begruessungstext enthaelt keine
  deutschen Woerter, wenn `language=en` gesetzt ist (z.B. `"Guten Tag"` darf NICHT vorkommen)
- **Verifikation**: `curl ... | grep -c "Guten Tag"` erwartet `0`
- **Heute erwartbar**: rot (`ctx.settings.greeting` wird woertlich uebernommen, unabhaengig von
  `language`; der Default-Greeting-Text ist deutsch -> Treffer > 0)
- **Belegt durch**: src/routes/voice.js:237,265,278-279; src/self-service.js:29-32

### WEB-06 - apps/web SettingsIsland uebersetzt die Greeting-Vorlagen nicht

- **Prioritaet**: P1
- **Modus**: offline (Quelltext-Pruefung, kein Astro-Build noetig)
- **Vorbedingung**: keine
- **Schritte**:
  1. `apps/web/src/components/app/SettingsIsland.astro` lesen (Funktion, die
     `state.greetingTemplates` in `<option>`-Elemente rendert)
  2. Pruefen, ob eine Uebersetzungs-/Mapping-Funktion zwischen Server-Vorlage und
     angezeigtem Label existiert
- **Erwartetes Ergebnis** (Ziel): jede angezeigte `<option>` ist ein englischer Text, auch wenn
  `state.greetingTemplates` deutsche Server-Strings liefert
- **Verifikation**: `grep -n "greetingTemplates" apps/web/src/components/app/SettingsIsland.astro`
  gefolgt von Pruefung auf eine Uebersetzungsfunktion (z.B. `translateGreeting(`) - erwartet 0
  Treffer fuer eine solche Funktion
- **Heute erwartbar**: rot (Optionen werden per `s.greetingTemplates.map(...)` 1:1 als
  `<option value="...">...</option>` gerendert, kein Uebersetzungsschritt)
- **Belegt durch**: apps/web/src/components/app/SettingsIsland.astro; src/self-service-routes.js:205

### WEB-07 - apps/web bindet agentStyle/personaStyleIds ueberhaupt nicht (Feature-Luecke)

- **Prioritaet**: P1
- **Modus**: offline
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -rn "personaStyleIds\|agentStyle" apps/web/src/`
- **Erwartetes Ergebnis** (Ziel): mindestens 1 Treffer (Feature ist im englischen Dashboard
  gebunden)
- **Verifikation**: `grep -rn "personaStyleIds\|agentStyle" apps/web/src/ | wc -l`
- **Heute erwartbar**: rot (Kommando liefert `0` - verifiziert per Read+grep waehrend der
  Katalog-Erstellung; Korrektur zum Recon-Befund, der faelschlich "liest dieselben IDs, aber
  ohne Dropdown" behauptete - tatsaechlich ist gar kein Codepfad vorhanden)
- **Belegt durch**: apps/web/src/components/app/SettingsIsland.astro (kein Treffer);
  src/i18n/locales.js:60 (Enum existiert nur serverseitig)

### WEB-08 - Persona-Style-Label in tenant.html bleibt deutsch trotz vorhandener EN-Uebersetzung

- **Prioritaet**: P2
- **Modus**: offline
- **Vorbedingung**: keine
- **Schritte**:
  1. `styleLabel("warm-persoenlich")` aus `public/tenant.html` extrahieren (Funktion:
     `id.replace(/-/g," ").replace(/^./,(c)=>c.toUpperCase())`)
  2. Ergebnis mit der EN-Ton-Klausel aus `src/i18n/locales.js:81` (`"Use a warm, personal
     tone..."`) vergleichen
- **Erwartetes Ergebnis** (Ziel): fuer einen EN-Kontext liefert das Label einen englischen
  String wie `"Warm & personal"`, nicht die naive Bindestrich-Ableitung
- **Verifikation**: analog `test/bk1-plan-price-format.test.js` per `vm`-Extraktion aus
  `public/tenant.html`; `assert.equal(styleLabel("warm-persoenlich"), "Warm persoenlich")`
  bestaetigt HEUTE den Ist-Zustand (gruen als Doku-Pin); eine Ziel-Assertion auf einen
  englischen String schlaegt fehl
- **Heute erwartbar**: rot (bezogen auf die Zielaussage; die Ist-Zustand-Pin-Variante waere gruen)
- **Belegt durch**: public/tenant.html (styleLabel-Funktion); src/i18n/locales.js:60,73-82

### WEB-09 - Self-Service-API-Fehlertexte sind rohes Deutsch statt Code+lokalisierbarem Text

- **Prioritaet**: P0
- **Modus**: offline (curl/supertest gegen lokalen Server)
- **Vorbedingung**: `PORT=3999 npm start` mit Self-Service-Flag an; gueltige Session gegen
  `/api/self-service/private-number` mit ungueltigem E.164-Wert
- **Schritte**:
  1. `curl -s -X POST http://localhost:3999/api/self-service/private-number -H "Cookie: session=<valid>" -d '{"privateNumber":"abc"}'`
  2. JSON-Antwort auf das `error`-Feld pruefen
- **Erwartetes Ergebnis** (Ziel): `error`-Feld ist ein stabiler Code (z.B.
  `"invalid_private_number"`), kein deutscher Klartext
- **Verifikation**: `curl ... | jq .error` erwartet einen Code ohne deutsche Woerter
- **Heute erwartbar**: rot (Antwort ist wortwoertlich
  `"privateNumber ungueltig (E.164 erwartet, erlaubtes Land)"`)
- **Belegt durch**: src/self-service-routes.js:275

### WEB-10 - api-onboard.js PUBLIC_URL-Fehler ist deutscher Klartext

- **Prioritaet**: P2
- **Modus**: offline
- **Vorbedingung**: `PUBLIC_URL` env-Variable NICHT gesetzt; Server gestartet; Basic-Auth-Login
  als Operator
- **Schritte**:
  1. `curl -s -u owner:<pw> -X POST http://localhost:3999/api/onboard -d '{"firstName":"A"}'`
  2. Statuscode und `error`-Feld pruefen
- **Erwartetes Ergebnis**: Statuscode `500`; `error`-Feld heute `"PUBLIC_URL fehlt"` (deutsch,
  Operator-only-Flaeche, daher niedrigere Prioritaet als Kundenfehler)
- **Verifikation**: `curl -s -u owner:<pw> ... | jq -r .error` erwartet `"PUBLIC_URL fehlt"`
  (Ist-Zustand-Pin) - dieser Test dokumentiert die Luecke, blockiert den Launch nicht direkt
  (nur Operator sieht die Meldung)
- **Heute erwartbar**: gruen (Ist-Zustand-Pin bestaetigt den bekannten deutschen Text)
- **Belegt durch**: src/self-service-routes.js:316

### WEB-11 - CSRF-Fehlerantwort bei fehlgeschlagenem OIDC-State ist unuebersetztes Deutsch

- **Prioritaet**: P0
- **Modus**: offline (curl gegen lokalen Server)
- **Vorbedingung**: Server gestartet mit funktionierender OIDC-Konfiguration (Test-/Dummy-IdP
  reicht, siehe `test/web-auth.test.js`-Setup); Request an `/auth/callback` mit manipuliertem
  `state`-Query-Parameter (weicht vom signierten Cookie ab)
- **Schritte**:
  1. `curl -s -i "http://localhost:3999/auth/callback?state=falsch&code=x"` (ohne gueltiges
     `oauth_state`-Cookie oder mit abweichendem State)
  2. Statuscode + Body pruefen
- **Erwartetes Ergebnis** (Ziel): Statuscode `400`; Body ist ein sprachneutraler Code ODER
  zumindest englischer Text fuer Browser mit `Accept-Language: en`
- **Verifikation**: `curl -s "http://localhost:3999/auth/callback?state=x" | grep -c "Ungueltige"`
  erwartet `0` fuer die Zielaussage
- **Heute erwartbar**: rot (Body ist wortwoertlich
  `"Ungueltige oder fehlende CSRF-State-Pruefung"`, kein Accept-Language-Handling in der Datei)
- **Belegt durch**: src/web-auth.js:115-117,240,251,263

### WEB-12 - Anmeldung-fehlgeschlagen-Fehler (500 UND 401) sind deutscher Klartext

- **Prioritaet**: P0
- **Modus**: offline
- **Vorbedingung**: OIDC-`authorizeUrl` bzw. `exchange` so gemockt, dass sie werfen (siehe
  Mock-Pattern in `test/web-auth.test.js`)
- **Schritte**:
  1. `/auth/login` mit werfendem `oidc.authorizeUrl` aufrufen -> Statuscode + Body pruefen
     (erwartet Pfad `src/web-auth.js:223`)
  2. `/auth/callback` mit werfendem `oidc.exchange` aufrufen -> Statuscode + Body pruefen
     (erwartet Pfad `src/web-auth.js:284`)
- **Erwartetes Ergebnis** (Ziel): beide Antworten sind sprachneutral/englisch, kein
  `"Anmeldung fehlgeschlagen"`
- **Verifikation**: `assert.notEqual(res.text, "Anmeldung fehlgeschlagen")` fuer beide Pfade
- **Heute erwartbar**: rot (beide Stellen senden identisch `"Anmeldung fehlgeschlagen"`)
- **Belegt durch**: src/web-auth.js:223,284

### WEB-13 - SESSION_EXPIRED_PAGE ist lang="de" mit deutschem Fliesstext

- **Prioritaet**: P1
- **Modus**: offline
- **Vorbedingung**: zweiter (markierter) `/auth/callback`-Login-Versuch ohne Login-Cookie
  (Loop-Guard-Pfad, siehe `recoverLogin`/`isRetryState`)
- **Schritte**:
  1. `/auth/login?retry=1` -> `/auth/callback?state=...~retry` ohne Cookies aufrufen
  2. Statuscode + Body (`SESSION_EXPIRED_PAGE`) pruefen
- **Erwartetes Ergebnis** (Ziel): `<html lang="en">` und englischer Text ("Session expired" o.ae.)
- **Verifikation**: `curl ... | grep -c 'lang="de"'` erwartet `0` fuer die Zielaussage
- **Heute erwartbar**: rot (Konstante ist `<html lang="de">` mit "Sitzung abgelaufen" fest verdrahtet)
- **Belegt durch**: src/web-auth.js:31-36,124

### WEB-14 - Post-Call-SMS-Rahmentext ist sprachunabhaengig deutsch

- **Prioritaet**: P0
- **Modus**: offline
- **Vorbedingung**: Test-Call mit `language="en"` und `status="cancelled"` bzw. Call mit
  `direction="outbound"`/`"inbound"`
- **Schritte**:
  1. `finishCall(...)` (oder die konkrete Funktion in `src/telephony/call-finish.js`, die
     Zeile 57 und 80-81 nutzt) mit einem Call-Objekt aufrufen, dessen `language`/aufgeloeste
     Locale `"en"` ist
  2. Den erzeugten SMS-Text/Notification-Text auf deutsche Signalwoerter pruefen
- **Erwartetes Ergebnis** (Ziel): fuer `language="en"` enthaelt der SMS-Text KEIN "Anruf
  abgebrochen"/"Anruf bei"/"Anruf von"
- **Verifikation**: neuer/erweiterter Test in `test/f2-sms-summary-plan.test.js` (heute prueft
  die Datei laut Kopfzeile NUR `planSummarySms`, die Sende-Entscheidung, nicht den Text) oder
  neue Testdatei `test/f2-call-finish-sms-text.test.js`;
  `assert.ok(!smsText.includes("Anruf"))`
- **Heute erwartbar**: rot (Zeile 57/80-81 sind sprachunabhaengige Literale)
- **Belegt durch**: src/telephony/call-finish.js:57,80-81; test/f2-sms-summary-plan.test.js (deckt
  das NICHT ab, siehe Kommentarkopf Zeile 1-2)

### WEB-15 - Dashboard-Notification-Titel "Neue Call Summary" ist hartkodiert deutsch-englisch gemischt

- **Prioritaet**: P1
- **Modus**: offline
- **Vorbedingung**: wie WEB-14
- **Schritte**:
  1. `store.addNotification(...)`-Aufruf in `call-finish.js:81` beobachten (Titel-Argument)
- **Erwartetes Ergebnis** (Ziel): Notification-Titel ist sprachabhaengig (z.B. "New call
  summary" fuer `language=en`)
- **Verifikation**: `grep -n '"Neue Call Summary"' src/telephony/call-finish.js` erwartet 0
  Treffer nach einem Fix; heute 1 Treffer
- **Heute erwartbar**: rot (Titel ist an genau dieser Stelle hart verdrahtet, unabhaengig von
  jeder Sprachvariable)
- **Belegt durch**: src/telephony/call-finish.js:81

### WEB-16 - Englische Preisseite zeigt Euro statt Dollar

- **Prioritaet**: P1
- **Modus**: offline
- **Vorbedingung**: keine
- **Schritte**:
  1. `node --test test/plans-catalog.test.js` ausfuehren
  2. `grep -n 'currency: "eur"' apps/web/src/lib/plans.js`
  3. `formatPlanPrice(499, "eur")` aus `apps/web/src/lib/plans.js` gegen `formatPlanPrice(499,
     "usd")` vergleichen (beide Symbole sind in `CURRENCY_SYMBOLS` bereits definiert)
- **Erwartetes Ergebnis** (Ziel): `apps/web/src/lib/plans.js` UND `src/plans.js` haben
  `currency: "usd"` fuer US-Kunden (mind. bedingt/pro Tenant-Land), Preisseite zeigt `$4.99`
- **Verifikation**: `node --test test/plans-catalog.test.js` (heute PASST der Test, weil er
  `currency=="eur"` als SOLL definiert - ein neuer Test mit `currency=="usd"`-Erwartung fuer
  US-Kontext schlaegt fehl)
- **Heute erwartbar**: rot (bezogen auf die Zielaussage "US-Kunde sieht USD"; die Ist-Zustand-Pin
  `test/plans-catalog.test.js:24-27` selbst ist gruen und bestaetigt EUR als aktuell gueltig)
- **Belegt durch**: src/plans.js:19,29; apps/web/src/lib/plans.js:13,29,39;
  test/plans-catalog.test.js:24-27; apps/web/src/pages/preise.astro:33
- **Hinweis**: laut `openQuestions` im Recon ist unklar, ob EUR-fuer-alle eine bewusste,
  weiterhin gueltige Owner-Entscheidung (Cutover 2026-07-03) oder ein Nachzieh-Defekt ist -
  vor Fix-Arbeit klaeren, nicht nur testen.

### WEB-17 - tenant.html formatiert USD-Betraege weiterhin im de-DE-Format (Komma statt Punkt)

- **Prioritaet**: P1
- **Modus**: offline
- **Vorbedingung**: keine
- **Schritte**:
  1. `node --test test/bk1-plan-price-format.test.js` ausfuehren (bestehender Test, Zeile 44-48
     pinnt `formatPlanPrice(499, "usd") === "4,99 $"`)
  2. Neue Ziel-Assertion ergaenzen/pruefen: `formatPlanPrice(499, "usd")` sollte `"$4.99"`
     liefern (en-US-Format), nicht `"4,99 $"`
- **Erwartetes Ergebnis** (Ziel): `"$4.99"` fuer `formatPlanPrice(499, "usd")` in
  `public/tenant.html`
- **Verifikation**: `node --test test/bk1-plan-price-format.test.js` (bestehender Ist-Pin ist
  heute gruen); eine neue/geaenderte Assertion auf `"$4.99"` schlaegt heute fehl
- **Heute erwartbar**: rot (bezogen auf die Zielaussage; `Intl.NumberFormat("de-DE", ...)` ist
  fest in `public/tenant.html:215` verdrahtet und liefert nachweislich `"4,99 $"`, nicht
  `"$4.99"`)
- **Belegt durch**: public/tenant.html:215,319,389; test/bk1-plan-price-format.test.js:44-48

### WEB-18 - apps/web nutzt durchgaengig en-US fuer Datumsformatierung (Regressions-Baseline)

- **Prioritaet**: P2
- **Modus**: offline
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n 'DATE_LOCALE\|CAL_LOCALE' apps/web/src/lib/api.js apps/web/src/lib/subscribe.js`
- **Erwartetes Ergebnis**: beide Konstanten sind `"en-US"`
- **Verifikation**: `grep -c '"en-US"' apps/web/src/lib/api.js apps/web/src/lib/subscribe.js`
  erwartet je >=1
- **Heute erwartbar**: gruen (bereits korrekt implementiert, dieser Test verhindert eine
  kuenftige Regression zurueck auf de-DE)
- **Belegt durch**: apps/web/src/lib/api.js:332; apps/web/src/lib/subscribe.js:34

### WEB-19 - Keine UI fuer die private Rufnummer in beiden Dashboards

- **Prioritaet**: P1
- **Modus**: offline
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -rn "privateNumber\|private-number" apps/web/src public/tenant.html`
- **Erwartetes Ergebnis** (Ziel): mindestens 1 Treffer (Feld existiert im UI)
- **Verifikation**: `grep -rn "privateNumber\|private-number" apps/web/src public/tenant.html | wc -l`
- **Heute erwartbar**: rot (Kommando liefert `0`, waehrend Backend-Route existiert)
- **Belegt durch**: src/self-service-routes.js:266-280 (Backend vorhanden); grep 0 Treffer im
  UI-Code (waehrend der Katalog-Erstellung verifiziert)

### WEB-20 - POST /api/onboard ist NICHT ueber eine Self-Service-Session erreichbar

- **Prioritaet**: P0
- **Modus**: offline (curl)
- **Vorbedingung**: Server gestartet; gueltiges Self-Service-Session-Cookie (kein Basic-Auth-Header)
- **Schritte**:
  1. `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3999/api/onboard -H "Cookie: session=<valid>" -d '{"country":"US"}'`
- **Erwartetes Ergebnis**: Statuscode `401` (Basic-Auth-Gate fail-closed, Session-Cookie allein
  reicht nicht) - dokumentiert bewusst korrektes fail-closed-Verhalten, macht aber zugleich
  sichtbar, dass ein eingeloggter Self-Service-Tenant KEINEN Weg hat, sein Land/seine
  Sprache selbst zu setzen
- **Verifikation**: `curl -s -o /dev/null -w "%{http_code}" ...` erwartet `401`
- **Heute erwartbar**: gruen (Basic-Auth-Gate greift korrekt; die Sicherheitseigenschaft ist
  intakt, die fehlende Self-Service-Alternative ist die eigentliche Luecke, siehe WEB-21)
- **Belegt durch**: src/routes/api-onboard.js:7-11 (Kommentar "BEWUSST KEIN MCP-Tool")

### WEB-21 - Frischer Browser-Login setzt tenant.country/defaultLanguage NICHT

- **Prioritaet**: P0
- **Modus**: offline
- **Vorbedingung**: neuer WorkOS-Testaccount ohne vorherigen `/api/onboard`-Aufruf; `npm run
  check`/lokaler Store
- **Schritte**:
  1. `accounts.upsertOnFirstLogin({ sub: "test|neu", email: "a@b.com" })` isoliert aufrufen
     (Test-Setup analog `test/web-auth.test.js`)
  2. `store.load()` -> Tenant-Record fuer die erzeugte `tenantId` inspizieren
- **Erwartetes Ergebnis**: `tenant.country == null` UND `tenant.defaultLanguage == null` (bzw.
  `undefined`) nach dem ersten Login
- **Verifikation**: `assert.equal(tenant.country, null); assert.equal(tenant.defaultLanguage, null)`
- **Heute erwartbar**: gruen (bestaetigt die dokumentierte Luecke: `mintSession`/
  `upsertOnFirstLogin` in `src/web-auth.js:167-186` ruft `setTenantGeo` nicht auf)
- **Belegt durch**: src/web-auth.js:167-186 (kein `country`/`language`-Parameter,
  `setTenantGeo` wird in diesem Pfad nicht aufgerufen)

### WEB-22 - languageForCountry("US") liefert Deutsch statt Englisch

- **Prioritaet**: P0
- **Modus**: offline
- **Vorbedingung**: keine
- **Schritte**:
  1. `import { languageForCountry } from "../src/i18n/locales.js"`
  2. `languageForCountry("US")` aufrufen
- **Erwartetes Ergebnis** (Ziel): `"en"`
- **Verifikation**: `node -e 'import("./src/i18n/locales.js").then(m => console.log(m.languageForCountry("US")))'`
  erwartet `"en"`
- **Heute erwartbar**: rot (liefert `"de"`, weil `"US"` in `LANGUAGE_FOR_COUNTRY`
  (`src/i18n/locales.js:268-274`) fehlt und der Fallback `DEFAULT_LANGUAGE` greift)
- **Belegt durch**: src/i18n/locales.js:268-279

### WEB-23 - Onboard mit body.country=US liefert language=de statt en

- **Prioritaet**: P0
- **Modus**: offline
- **Vorbedingung**: wie bestehende Faelle in `test/f1-geo-onboard.test.js` (Zeile 25 FR, Zeile
  47 GB, Zeile 117 FORCE_NUMBER_COUNTRY=US-Kaufland-Fall - aber KEIN direkter
  `body.country=US`-Herkunftsland-Fall)
- **Schritte**:
  1. Server starten (Test-Helper aus `f1-geo-onboard.test.js` wiederverwenden)
  2. `POST /api/onboard` mit `{"country":"US", "firstName":"A","lastName":"B"}` (Basic-Auth)
  3. `json.language` und `json.country` in der Antwort pruefen; zusaetzlich
     `store.tenants.find(...).defaultLanguage` und `store.numbers.find(...).language`
- **Erwartetes Ergebnis** (Ziel): `json.language == "en"`, `tenant.defaultLanguage == "en"`,
  `number.language == "en"` (analog zum bestehenden GB-Fall Zeile 47-56)
- **Verifikation**: neuer Testfall in `test/f1-geo-onboard.test.js` nach dem Muster von Zeile 47
  (`"Onboard mit body.country=US -> en"`); `node --test test/f1-geo-onboard.test.js`
- **Heute erwartbar**: rot (liefert `"de"`, siehe WEB-22 - direkte Konsequenz derselben
  fehlenden Tabellenzeile)
- **Belegt durch**: src/routes/api-onboard.js:147,168; src/i18n/locales.js:268-274;
  test/f1-geo-onboard.test.js:25,47 (Muster, aber kein US-Fall)

### WEB-24 - Grossschreibung: settings.language="EN" faellt still auf Deutsch zurueck

- **Prioritaet**: P1
- **Modus**: offline
- **Vorbedingung**: keine
- **Schritte**:
  1. `localeFor("EN")` aufrufen (Gross-EN statt klein-en)
  2. Ergebnis mit `localeFor("en")` vergleichen
- **Erwartetes Ergebnis**: dokumentiert das aktuelle, bewusste Fail-Safe-Design (R7,
  `src/store/state-ops.js:642-651` Kommentar): `localeFor("EN")` liefert dasselbe wie
  `localeFor("de")` (Fallback), NICHT dasselbe wie `localeFor("en")` - das ist by-design
  robust gegen Crashes, aber ein Risiko fuer stille Sprachverwechslung bei externem
  Dateneingang (z.B. CRM-Import, das "EN" statt "en" liefert)
- **Verifikation**: `assert.notDeepEqual(localeFor("EN"), localeFor("en")); assert.deepEqual(localeFor("EN"), localeFor("de"))`
- **Heute erwartbar**: gruen (bestaetigt das dokumentierte Fail-Safe-Verhalten; Test dient als
  Warn-Dokumentation fuer Integratoren, kein Fix-Auftrag)
- **Belegt durch**: src/i18n/locales.js:95-96,168,217,283-286 (LOCALES-Keys sind exakt
  `de`/`fr`/`en`, `localeFor` macht keinen `.toLowerCase()`)

### WEB-25 - GB und IE mappen korrekt auf Englisch (Kontrast-Baseline zu WEB-22)

- **Prioritaet**: P2
- **Modus**: offline
- **Vorbedingung**: keine
- **Schritte**:
  1. `node --test test/f1-geo-onboard.test.js` ausfuehren (deckt GB->en bereits ab, Zeile 47-56)
  2. Ergaenzend `languageForCountry("IE")` direkt pruefen (aktuell nur indirekt/nicht ueber
     den Onboard-Endpunkt getestet)
- **Erwartetes Ergebnis**: `languageForCountry("GB") == "en"`, `languageForCountry("IE") == "en"`
- **Verifikation**: `node --test test/f1-geo-onboard.test.js` (bestehend, gruen) +
  `node -e 'import("./src/i18n/locales.js").then(m=>console.log(m.languageForCountry("IE")))'`
  erwartet `"en"`
- **Heute erwartbar**: gruen (beide Laender sind in `LANGUAGE_FOR_COUNTRY` korrekt hinterlegt;
  dient als Regressionsschutz und als Kontrast zum echten US-Defekt in WEB-22/23)
- **Belegt durch**: src/i18n/locales.js:268-274; test/f1-geo-onboard.test.js:47-56

### WEB-26 - Bestandstenant ohne defaultLanguage (Alt-Daten vor F1-Geo) bleibt dauerhaft Deutsch

- **Prioritaet**: P2
- **Modus**: offline
- **Vorbedingung**: Store-Fixture mit einem Tenant-Record OHNE `defaultLanguage`-Feld (simuliert
  einen vor F1-Geo angelegten Bestandstenant) und OHNE `numberRecord.language`
- **Schritte**:
  1. `resolveCallLanguage(s, { tenantId, numberRecord: null })` mit `settings.language`
     unbesetzt UND `tenant.defaultLanguage` unbesetzt aufrufen
- **Erwartetes Ergebnis**: `"de"` (dokumentiertes Fallback-Verhalten,
  `src/store/state-ops.js:648-651`)
- **Verifikation**: `assert.equal(resolveCallLanguage(s, {tenantId, numberRecord: null}), "de")`
- **Heute erwartbar**: gruen (bestaetigt das designte Fallback-Verhalten; macht aber explizit,
  dass ein Alt-Tenant OHNE Backfill niemals automatisch Englisch wird, selbst wenn seine
  Rufnummer/sein Land US ist - ein Migrationsrisiko fuer jede zukuenftige Backfill-Arbeit)
- **Belegt durch**: src/store/state-ops.js:648-651; src/store/defaults.js:331
  (`DEFAULT_LANGUAGE = "de"`)
