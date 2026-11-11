# P-2655 Anbieter-Messung: Design Doc

Status: freigegeben
Pitch: plaene/P-2655-anbieter-messung/pitch.md
Entscheidung: Die Hülle wird einmal dort angelegt, wo die Anbieterobjekte entstehen oder registriert werden (Telnyx-Tabelle in `registry.js`, Export von `stripeBilling`, Erzeugung von Brevo-Mailer, OIDC-Client und WorkOS-Verwaltung in `web-login.js`). Sie ersetzt nur die Methoden einer festen Vorgangsliste und ordnet das Ergebnis allein nach dem Fehlernamen und einem Status- oder Codefeld am Fehlerobjekt ein. Wo dieses Feld heute fehlt, wird es an der Stelle gesetzt, an der der Fehler geworfen wird; aus Text wird nie gelesen.

## Zur Freigabe
1. Die Hülle sitzt an den vier Erzeugungsstellen, misst je Methodenaufruf und liest den Status nur aus `providerStatus`, `providerCode` (Telnyx), `code` (Brevo) und `name`. Umkehrbar. Empfehlung: ja, weil nur so die Funktionen mit Lint-Befunden unberührt bleiben und jeder Vorgang genau einmal zählt (R1).
2. Rückmeldung an den Pitch: Unter „Geänderte Dateien“ fehlen drei Dateien. `src/telephony/adapters/telnyx/numbers.js` (nur `searchNumbers`), `messaging.js` und `config-read.js` müssen den Status am Fehler mitgeben; sonst kann S2 nicht grün werden. Umkehrbar. Empfehlung: aufnehmen.
3. Rückmeldung an den Pitch: `src/anbieter-messung.js` direkt unter `src/` lässt die Bausteinprüfung scheitern. Empfehlung: Die Datei gehört in einen Ordner von `basis`, also `src/utils/` oder neben das Messmodul aus B3; der Testordner folgt dem gewählten Ort.
4. Offene Frage: Darf der Charakterisierungstest DID-08 angepasst werden, damit auch der Nummernkauf den HTTP-Status trägt? Empfehlung: nein, jetzt nicht. Ein 429 beim Kauf zählt nur dann als `429`, wenn Telnyx den Code `10011` mitschickt, sonst als `fehler`.
5. Vorgeschlagenes Nicht-Ziel: WorkOS-429 als eigenes Ergebnis. Ein 429 von WorkOS zählt als `fehler`, weil die WorkOS-Fehler den Status nur im Text tragen und die Wurfstellen in `exchange` und `deleteUser` liegen.
6. Ungeprüfte Annahme: B3 erfasst Messwerte synchron im Speicher und exportiert getrennt davon im Intervall. Wenn das nicht stimmt, wartet ein Anbieteraufruf auf den Collector (PM11).
7. Ungeprüfte Annahme: Eine abgelaufene Frist aus B4 zeigt sich als Fehler mit dem Namen `TimeoutError`. Wenn das nicht stimmt, zählt eine Zeitüberschreitung als `fehler`.
8. Vorschläge für den Pitch: S7 und S4 korrigieren, einen Eintrag unter „Fallen“ streichen, B10 und die Szenarien S9 und S10 aufnehmen (siehe letzter Abschnitt).

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| Vorhandene Hilfe: keine Messhülle und kein Exporter. `metrics.js` loggt nur LLM-Aufrufe und Gesprächsrunden. | `src/metrics.js:17-74` | – |
| Alle Telnyx-Netzaufrufe laufen über vier Objekte, die nur `registry.js` importiert und in der Tabelle `ADAPTERS` einträgt. Ist `FAKE_ORIGINATE` gesetzt, liefert `voiceControl()` ein Objekt ohne Netzaufruf. | `src/telephony/registry.js:1-6`, `:29-40`, `:63-66`; Suche nach Importen von `adapters/telnyx/(voice\|numbers\|messaging\|config-read)` in `src/`: nur `registry.js` und eine Konstante in `boot.js:43` | – |
| `assertTelnyxOk` setzt `providerStatus` nur mit `attachStatus` und `providerCode` aus `errors[].code`. Den Status tragen Sprachsteuerung, Kostenabruf und `releaseNumber`, nicht aber `searchNumbers`, `orderNumber`, `sendSms` und `findPhoneNumber`. | `src/telephony/adapters/telnyx/errors.js:34-43`; `voice.js:68`, `:100`, `:117`, `:342`; `numbers.js:25`, `:55`, `:70`, `:83`; `messaging.js:19`; `config-read.js:12` | – |
| Zwei Tests halten fest, dass Fehler ohne `attachStatus` keinen `providerStatus` tragen, einer davon für den Nummernkauf (DID-08). | `test/telnyx-errors.test.js:18-34`, `test/telnyx-numbers.test.js:248-259` | – |
| Telnyx meldet eine Drosselung mit HTTP 429. Den Code `10011` nennt die Doku nur als Beispiel. | https://developers.telnyx.com/docs/development/api-fundamentals/reliability/rate-limiting.md, https://developers.telnyx.com/api/errors/10011 | – |
| `assignCostRecords` ist synchron. `fetchCostRecordPool` und `fetchMonthlyInvoiceTotal` fangen Fehler selbst ab und geben ohne Schlüssel einen Fehlerwert zurück. | `src/telephony/adapters/telnyx/voice.js:373-424` | – |
| Stripe-Fehler tragen den Status nur im Text. Alle Würfe laufen über `assertOk` und `classifiedError`; `captureHold` gibt bei „schon eingezogen“ normal zurück. | `src/billing/stripe.js:47-53`, `:87-103`, `:133-144` | – |
| Stripe meldet Drosselung mit 429 und dem Kopf `Stripe-Rate-Limited-Reason`; ein 429 ohne diesen Kopf kann eine Sperrzeitüberschreitung sein (`lock_timeout`). | https://docs.stripe.com/rate-limits | – |
| Brevo wirft mit `err.code = "http_<Status>"` und drosselt mit 429. | `src/brevo-mail.js:23-27`; https://developers.brevo.com/docs/api-limits | – |
| Der Brevo-Mailer entsteht nur in `selectMailer` und nur mit gesetztem Brevo-Schlüssel, sonst SMTP. `server.js` und `web-login.js` rufen `selectMailer` auf. | `src/wiring/web-login.js:67-74`, `:117`; `src/server.js:25`, `:81` | – |
| WorkOS-Fehler tragen den Status nur im Text. Von den Methoden des OIDC-Clients ruft nur `exchange` das Netz. `deleteUser` behandelt 404 als Erfolg. | `src/web-auth.js:227-282`; `src/workos-management.js:7-23`; WorkOS drosselt mit 429: https://workos.com/docs/reference/rate-limits | – |
| OIDC-Client und WorkOS-Verwaltung entstehen nur in `wireWebLogin`. | `src/wiring/web-login.js:101`, `:114-116` | – |
| `place_call` antwortet 502 mit dem Status im Text, wenn der Fehler von `originateCall` `providerStatus` trägt, sonst 500. | `src/routes/api-calls.js:359-376` | – |
| `findPhoneNumber` liegt im Outbound-Gate (ANI-Nachprüfung, eigene 4-s-Frist per `setTimeout`). | `src/server.js:64`, `:74`; `src/telephony/ani-ownership-recheck.js:3-30` | – |
| `POST /api/onboard` antwortet `queued` vor der Nummernsuche. Scheitert der Kauf, setzt der Lauf die Nummer auf `failed` und storniert den Hold. | `src/routes/api-onboard.js:101-114`; `src/onboarding.js:59-66`, `:133-147` | – |
| Die Newsletter-Route fängt Mailfehler ab. `POST /api/billing/setup-checkout` steht hinter `internalOnly`. | `src/self-service-routes.js:293-306`; `src/routes/api-billing.js:44` | – |
| Jede Datei unter `src/` gehört zu genau einem Baustein. `basis` (Metriken) hat den Ordner `src/utils/` und darf von allen genutzt werden. | `tools/bausteine.json:39-55`; `tools/abhaengigkeiten/bausteine.mjs:63-73` | – |
| Jeder `fetch` im Produktcode braucht `signal: AbortSignal.timeout(…)`. Die Hülle fügt keinen `fetch` hinzu. | `tools/eslint-rules/anfrage-mit-frist.js:6-7`, `:107-123` | – |
| Render startet mit `npm start` und hat keinen Pre-Deploy-Schritt. | `render.yaml:8` | – |
| Eine abgelaufene `AbortSignal.timeout`-Frist zeigt sich als `DOMException` mit dem Namen `TimeoutError`. | https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static | – |
| B3: Das Messmodul in `basis` stellt einen Zähler und ein Histogramm mit Labels aus einer festen Liste bereit (höchstens 8 Grenzen), erfasst synchron im Speicher und exportiert per OTLP im Intervall (60 s). Ohne Adresse exportiert es nicht, und Tests haben einen In-Memory-Exporter. | ungeprüft (nicht gemergt); Bauplan `fertigstellen/SRV/bauplan-server-architektur.md:81-84`; OTel-SDK: Reader sammelt im eigenen Intervall, https://opentelemetry.io/docs/specs/otel/metrics/sdk/; prüfen durch: Planung nach Merge von B3 | Name und Aufruf ändern sich nur in der Hülle. Wartet das Erfassen auf den Export, gilt PM11. |
| B3 lässt die Labels `anbieter`, `vorgang` und `ergebnis` in seiner festen Liste zu und hat ein Serienbudget, in das die Zahl unten passt. | ungeprüft; prüfen durch: Planung nach Merge von B3 | Die Liste von B3 muss erweitert werden, oder die Vorgangsliste wird gröber. |
| B4: Jeder Aufruf der gemessenen Methoden hat eine Frist, auch `orderNumber`, `originateCall`, Stripe und WorkOS. Läuft sie ab, wirft der Aufruf mit dem Namen `TimeoutError` (`AbortSignal.timeout`, auch in `AbortSignal.any`). | ungeprüft; Bauplan `…/bauplan-server-architektur.md:86-89`; heute ohne Frist: `numbers.js:69`, `voice.js:334-341`, `stripe.js:127`, `web-auth.js:246`, `workos-management.js:8`; prüfen durch: Planung nach Merge von B4 | Ein hängender Aufruf zählt erst, wenn er endet. Ein Abbruch mit `AbortError` zählt als `fehler`. |

## Was die Wahl bestimmt
- S2 und S8: 429 wird nur aus dem Statusfeld oder dem Telnyx-Code erkannt. Die Hülle muss den Status also am Fehlerobjekt finden.
- R1 und B9: Jeder Vorgang zählt genau einmal, auch wenn `orderNumber` intern bis zu 8 weitere Anfragen stellt (`numbers.js:17-33`), und der Fehler bleibt unverändert.
- B4, B5, B6 und B8: Nur Methoden aus der Liste werden gemessen. Alle anderen bleiben dieselbe Funktion, `assignCostRecords` bleibt also synchron.
- B7: Nur der Brevo-Zweig von `selectMailer` wird gemessen.
- B1, B2 und der Weg von `place_call`: Rückgabewert und Fehlerobjekt bleiben dieselben, denn `api-calls.js` liest `providerStatus`. Eine scheiternde Messung erreicht den Aufrufer nie.
- Randbedingung: `orderNumber`, `deleteUser` und `exchange` bleiben unberührt. Beleg: Pitch, „Fallen“.
- Randbedingung: keine Datei direkt unter `src/`, kein neuer `fetch`. Belege: Bausteinprüfung und Regel `anfrage-mit-frist` (siehe oben).

## Lösung
Neu ist ein kleines Modul in `basis` (Ort siehe Zur Freigabe, Punkt 3) mit drei Teilen:
- die Vorgangsliste: je Anbieter die Methodennamen und ihr `vorgang`;
- die Ergebnisliste: `ok`, `fehler`, `zeitueberschreitung`, `429`, `kanalgrenze`;
- eine Funktion, die zu einem Anbieter und einem Objekt eine flache Kopie liefert, in der nur die gelisteten Methoden ersetzt sind. Alle anderen Eigenschaften sind dieselben Funktionen. Die Kopie ist nicht eingefroren.

Eine ersetzte Methode ruft das Original mit denselben Argumenten. Bei Erfolg zählt sie `ok` und gibt denselben Wert zurück. Bei einem Fehler ordnet sie ihn ein und wirft dasselbe Fehlerobjekt weiter. Zähler und Histogramm erfasst sie in einem eigenen Fang, ohne zu warten. Scheitert das Erfassen, schreibt sie eine Logzeile nur mit `anbieter` und `vorgang`.

Die Einordnung prüft in dieser Reihenfolge:
1. Heißt der Fehler `TimeoutError`, ist das Ergebnis `zeitueberschreitung`.
2. Meldet der Statusleser des Anbieters 429, ist das Ergebnis `429`:
   - Telnyx: `providerStatus` ist 429 oder `providerCode` ist `"10011"`;
   - Stripe: `providerStatus` ist 429;
   - Brevo: `code` ist `"http_429"`;
   - WorkOS: kein Statusleser.
3. Sonst ist das Ergebnis `fehler`.

Die Fehlermeldung wird nie gelesen. `kanalgrenze` setzt B5 nicht.

Angebunden wird die Hülle an diesen Stellen:
- `src/telephony/registry.js`: Die Einträge für `VOICE_CONTROL`, `MESSAGING`, `NUMBER_PROVISIONING` und `PROVIDER_CONFIG_READ` werden beim Laden des Moduls einmal umhüllt. `WEBHOOK_EVENTS`, `VOICE_RENDERER` und das Objekt für `FAKE_ORIGINATE` bleiben ohne Hülle.
- `src/billing/stripe.js`: Der Export `stripeBilling` ist das umhüllte Objekt. `assertOk` und `classifiedError` setzen zusätzlich `providerStatus` auf den HTTP-Status; die Fehlermeldung bleibt gleich.
- `src/wiring/web-login.js`: `selectMailer` umhüllt nur das Ergebnis des Brevo-Zweigs. `wireWebLogin` umhüllt `oidc` und `workosManagement` nach dem Erzeugen.
- `numbers.js`, `messaging.js` und `config-read.js`: `searchNumbers`, `sendSms` und `findPhoneNumber` geben `attachStatus: true` an `assertTelnyxOk`. `orderNumber` und `resolveNumberId` bleiben unverändert, wegen DID-08.

Vorgangsliste (28 Vorgänge):
- Telnyx (9):
  - `originateCall` → `anruf-starten`
  - `endCall` → `anruf-beenden`
  - `endCallViaCallControl` → `anruf-beenden-callcontrol`
  - `redirectCall` → `anruf-umleiten`
  - `sendSms` → `sms-senden`
  - `searchNumbers` → `nummern-suchen`
  - `orderNumber` → `nummer-kaufen`
  - `releaseNumber` → `nummer-freigeben`
  - `findPhoneNumber` → `nummer-nachschlagen`
- Brevo (1): `sendMail` → `mail-senden`
- Stripe (15):
  - `placeHold` → `hold-setzen`
  - `captureHold` → `hold-einziehen`
  - `cancelHold` → `hold-stornieren`
  - `reportMeter` → `verbrauch-melden`
  - `createCustomer` → `kunde-anlegen`
  - `createSetupCheckoutSession` → `checkout-karte-anlegen`
  - `getCheckoutSessionResult` → `checkout-karte-lesen`
  - `createSubscriptionCheckoutSession` → `checkout-abo-anlegen`
  - `getSubscriptionCheckoutResult` → `checkout-abo-lesen`
  - `retrievePaymentMethodType` → `zahlungsmittel-lesen`
  - `retrievePriceAmount` → `preis-lesen`
  - `createSubscription` → `abo-anlegen`
  - `retrieveSubscription` → `abo-lesen`
  - `scheduleCancellation` → `kuendigung-vormerken`
  - `unscheduleCancellation` → `kuendigung-zuruecknehmen`
- WorkOS (3):
  - `exchange` → `anmeldung-tauschen`
  - `deleteUser` → `nutzer-loeschen`
  - `userExists` → `nutzer-pruefen`

Serien:
- Zähler: höchstens 28 × 4 = 112 Labelkombinationen, solange `kanalgrenze` ungesetzt ist; mit K3 höchstens 140.
- Histogramm: 28 Labelkombinationen mit je höchstens 8 Grenzen. Als einzelne Prometheus-Reihen gezählt sind das 28 × 11 = 308 (9 Buckets, Summe, Anzahl).
- Zusammen höchstens 420 Reihen, in OTLP-Datenpunkten 140.

Ablauf S2:
1. Der Provisionierungslauf holt `numberProvisioning(TELNYX)` und erhält das umhüllte Objekt.
2. Die Hülle startet die Zeitmessung und ruft `searchNumbers`.
3. Telnyx antwortet 429. `assertTelnyxOk` wirft mit `providerStatus` 429.
4. Die Hülle zählt `telnyx`/`nummern-suchen`/`429`, erfasst die Dauer und wirft dasselbe Fehlerobjekt weiter.
5. `findPurchasableNumber` setzt die Nummer auf `failed`, wie bisher.

Zuordnung:
- S1, S2, S6, S7 und S8 → Telnyx-Tabelle in `registry.js`, Statusleser Telnyx und `attachStatus` in `searchNumbers`
- S3 → `selectMailer` und Name `TimeoutError`
- S4 → Export von `stripeBilling`
- S5 → `oidc` in `wireWebLogin`
- R3 und S7 → Labels nur aus der Vorgangs- und Ergebnisliste
- B1, B2 und B9 → dasselbe Fehlerobjekt und der eigene Fang beim Erfassen
- B3 → Exportschalter von B3
- B4 → `WEBHOOK_EVENTS` ohne Hülle
- B5 und B8 → Kostenmethoden nicht in der Liste, dieselbe Funktion
- B6 → `authorizeUrl` nicht in der Liste
- B7 → nur der Brevo-Zweig

### Werkzeugvertrag
Kein Werkzeug ist neu oder geändert, und kein von außen sichtbares Verhalten bestehender Werkzeuge ändert sich. Bei `place_call` bleiben Status 502 bzw. 500 und der Fehlertext gleich, weil das Fehlerobjekt von `originateCall` unverändert weiterläuft (`src/routes/api-calls.js:359-376`). Angesehen: `docs/mcp-vertrag.json`, `src/routes/api-calls.js`.

## Fehlerfälle
| Aufruf oder Ereignis | Fehler oder Zeitüberschreitung | doppelt oder andere Reihenfolge | Wiederholung: wo, womit | was der Aufrufer sieht |
|---|---|---|---|---|
| Telnyx, 9 Vorgänge | HTTP-Fehler: `429` bei Status 429 oder Code `10011`, sonst `fehler`. B4-Frist abgelaufen: `zeitueberschreitung`. `orderNumber` mit 429 ohne `10011`: `fehler`. | Jeder Methodenaufruf zählt einmal. Das Nachfragen in `orderNumber` (`resolveNumberId`) ist ein Teil desselben Vorgangs, und die Dauer schließt es ein. | keine in der Hülle; bestehende Schleifen bleiben, wo sie sind | dasselbe Ergebnis oder dasselbe Fehlerobjekt; `place_call` weiter 502 bzw. 500 |
| Telnyx ohne `TELNYX_API_KEY` | Die gemessene Methode wirft vor dem Netz und zählt `fehler`, weil der Vorgang wirklich scheitert. Die Kostenabrufe sind nicht gemessen (B8). | – | keine | unverändert |
| Telnyx `findPhoneNumber` im Outbound-Gate | Das Gate bricht nach eigener Frist ab (`ani-ownership-recheck.js:5-21`). Die Hülle zählt erst, wenn der Telnyx-Aufruf selbst endet. | – | keine | Gate-Entscheidung unverändert |
| Stripe, 15 Vorgänge | Status 429: `429`, auch bei `lock_timeout` (siehe Nachteile). Andere Status: `fehler`. Ein Fehler nach einer 2xx-Antwort, etwa „kein payment_method“, zählt ebenfalls `fehler`. Bei „schon eingezogen“ endet `captureHold` mit `ok`. | Die Heilung bei veraltetem Kunden ruft `createSetupCheckoutSession` ein zweites Mal und zählt zweimal, weil es zwei Aufrufe sind. | keine in der Hülle; Idempotency-Key bleibt in `stripe.js` | dieselbe Fehlerklasse und Meldung; neu nur das Feld `providerStatus` |
| Brevo `mail-senden` | `http_429`: `429`. Andere: `fehler`. `TimeoutError`: `zeitueberschreitung`. | – | keine | unverändert, die Route fängt Mailfehler ab |
| WorkOS, 3 Vorgänge | 429: `fehler` (Zur Freigabe, Punkt 5). Frist nach B4: `zeitueberschreitung`. `deleteUser` mit 404 endet normal: `ok`. | – | keine | unverändert |
| Abbruch durch den Aufrufer (`AbortError`) | `fehler` | – | keine | unverändert |
| Erfassen im Messmodul wirft (B2) | Wird gefangen; eine Logzeile mit `anbieter` und `vorgang`, kein Fehlertext | – | keine | unverändert |
| OTLP-Export langsam oder Collector hängt | Die Hülle erfasst nur im Speicher; der Export läuft getrennt im Intervall von B3 (Annahme) | – | Wiederholungen des Exports regelt B3 | unverändert |

## Verworfene Wege
- Messung am einzelnen `fetch` je Aufrufstelle, mit einer Messfunktion, die `vorgang` als Argument bekommt. Vorteil: Sie sieht den HTTP-Status direkt und braucht kein Statusfeld am Fehler. Verworfen, weil:
  - sie die Rümpfe von `orderNumber`, `deleteUser` und `exchange` ändert (Randbedingung);
  - sie bei `orderNumber` bis zu 9 Anfragen statt eines Vorgangs zählt (R1);
  - sie das erwartete 404 von `deleteUser` als `fehler` zählt.
- Automatische Messung aller `fetch`-Aufrufe (OpenTelemetry-Instrumentierung von undici). Vorteil: kein Eingriff in die Adapter. Verworfen, weil:
  - `vorgang` dann nur aus Adresse oder Pfad käme, was Fragerunde 1, Punkt 2 ausschließt;
  - sie Kostenabrufe, Start-Probe und JWKS mitzählt (Nicht-Ziele);
  - sie ein neues Paket mit Freigabe braucht.
- 429 aus der Fehlermeldung lesen (`HTTP 429` steht in allen Meldungen). Vorteil: kein Eingriff in die Adapter. Verworfen wegen S8.

## Nachteile
- Die Einordnung hängt an Fehlerfeldern, die die Adapter setzen. Wirft eine neue Telnyx-Methode ohne `attachStatus` oder ändert `brevo-mail.js` das Format von `code`, zählt ein 429 still als `fehler`. Der Lesecode für vier Fehlerformate liegt in `basis`.
- Ein 429 beim Nummernkauf ohne Code `10011` und jeder 429 von WorkOS zählen als `fehler`.
- Stripe-429 umfasst auch Sperrzeitüberschreitungen (`lock_timeout`), die keine Drosselung sind.
- Gemessen wird der Vorgang, nicht die Anfrage. Ein Fehler vor dem Netz (fehlender Schlüssel) oder nach einer 2xx-Antwort zählt als `fehler`, und die Dauer von `nummer-kaufen` schließt das Nachfragen ein.

## Übergang, Rückweg und Betrieb
- Für heutige Kunden und fremde Agenten: Sie sehen nichts anders. Antworten, Fehlertexte und Werkzeuge bleiben gleich. Neu ist nur das Feld `providerStatus` an Stripe- und an drei Telnyx-Fehlern; kein Aufrufer liest es dort heute (Suche nach `providerStatus` in `src/`).
- Daten: keine Datenänderung.
- Rückweg: Rollback über den Deploy-Weg, weil weder Daten noch Werkzeugvertrag sich ändern. Die Änderung bringt keine Umgebungsvariable. Abschalten lässt sich der Export über den Schalter von B3 (keine OTLP-Adresse); das Erfassen im Speicher bleibt dann.
- Laufende Anrufe beim Ausliefern oder Zurückrollen: nicht berührt, weil die Hülle keinen Zustand außer den Messwerten im Prozess hält.
- Woran man im Betrieb sieht, dass es nicht funktioniert: Es fehlen Reihen `hermes_anbieter_aufrufe_total`, obwohl Anrufe und Anmeldungen laufen, oder im Log steht die Zeile der Hülle zum gescheiterten Erfassen.
- Laufende Kosten: unverändert bei den Anbietern, weil kein zusätzlicher Aufruf entsteht. Beim Empfänger der Messwerte kommen höchstens 420 Reihen hinzu; was das kostet, ist Teil des Serienbudgets aus B3.

## Offene Fragen und Rückmeldungen an den Pitch
- Rückmeldung: Unter „Geänderte Dateien“ fehlen `src/telephony/adapters/telnyx/numbers.js` (nur `searchNumbers`), `messaging.js` und `config-read.js` (Zur Freigabe, Punkt 2).
- Rückmeldung: `src/anbieter-messung.js` muss in einen Ordner von `basis` (Zur Freigabe, Punkt 3).
- Rückmeldung: Den letzten Eintrag unter „Fallen“ (`fetchMonthlyInvoiceTotal` mit `ok: false`) streichen. Die Methode ist laut Nicht-Zielen ungemessen, und keine gemessene Methode meldet einen Fehler als Rückgabewert.
- Rückmeldung zu S7: Die Und-Zeile widerspricht dem Histogramm, das nur `anbieter` und `vorgang` trägt. Vorschlag: „Und die Label-Namen von `hermes_anbieter_aufrufe_total` sind genau `anbieter`, `vorgang` und `ergebnis`, die von `hermes_anbieter_dauer_ms` genau `anbieter` und `vorgang`.“
- Rückmeldung zu S4: `POST /api/billing/setup-checkout` steht hinter `internalOnly`, ist also der MCP-Weg und kein Kundenweg. Vorschlag: „Wenn der Agent des Kunden über den MCP-Weg `POST /api/billing/setup-checkout` aufruft“ oder die Route `POST /api/self-service/billing/setup-checkout`.
- Darf DID-08 (`test/telnyx-numbers.test.js:248-259`) angepasst werden, damit `orderNumber` den Status trägt? Empfehlung: nein, jetzt nicht. Ein Kauf-429 zählt über den Code `10011`, und die Frage geht an die Betreuung, wenn DID-08 ohnehin geändert wird.
- Welche Histogrammgrenzen gelten? Empfehlung: die Grenzen aus B3 übernehmen. Die Planung prüft nach dem Merge von B3 und B4, ob die größte Grenze die längste Frist abdeckt; sonst landen alle Zeitüberschreitungen im letzten Bucket.
- Passen 420 Reihen bzw. 140 Datenpunkte in das Serienbudget aus B3? Empfehlung: Die Planung prüft das nach dem Merge von B3. Passt es nicht, werden die Stripe-Vorgänge zusammengelegt, nicht die Ergebnisse.
- Vorgeschlagenes Nicht-Ziel: das Ergebnis `429` für WorkOS. Sein Status steht nur im Text, und die Wurfstellen liegen in `exchange` und `deleteUser`, die unberührt bleiben. Ein WorkOS-429 zählt als `fehler`.
- Vorgeschlagenes Szenario B10: Die Ablehnung eines Anrufs bleibt gleich
  Gegeben die Telnyx-Attrappe beantwortet den Anrufstart mit 403
  Wenn der Agent des Kunden mit `place_call` einen Anruf auslöst
  Dann ist die Antwort ein Fehler mit HTTP 502 und dem Text „Provider hat den Anruf abgelehnt (HTTP 403). Account-/Nummern-Konfiguration pruefen.“ wie vor dieser Änderung
- Vorgeschlagenes Szenario S9: Stripe drosselt
  Gegeben die Stripe-Attrappe beantwortet das Anlegen der Karten-Checkout-Sitzung mit 429
  Wenn der Agent des Kunden über `POST /api/billing/setup-checkout` die Kartenhinterlegung startet
  Dann enthält der Messwert-Export den Zähler `hermes_anbieter_aufrufe_total` mit `anbieter="stripe"`, `vorgang="checkout-karte-anlegen"`, `ergebnis="429"` und dem Wert 1
- Vorgeschlagenes Szenario S10: Nummernkauf mit Telnyx-Drosselcode
  Gegeben die Telnyx-Attrappe beantwortet die Nummernbestellung mit 429 und dem Fehlercode `10011`
  Wenn der Betreiber über `POST /api/onboard` die Einrichtung startet und der Provisionierungslauf abgearbeitet ist
  Dann enthält der Messwert-Export den Zähler `hermes_anbieter_aufrufe_total` mit `anbieter="telnyx"`, `vorgang="nummer-kaufen"`, `ergebnis="429"` und dem Wert 1
