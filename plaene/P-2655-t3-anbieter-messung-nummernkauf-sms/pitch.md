# P-2655 Anbieter-Messung: Teil t3 anbieter-messung-nummernkauf-sms

Status: freigegeben
Issue: 2682
Teil von: P-2655-anbieter-messung; nach: P-2655-t2-anbieter-messung-anrufsteuerung
Design Doc: ja (kurz), weil offen ist, an welcher Stelle die Hülle um die Anbieterobjekte hängt und wie sie einen Fehler als 429 oder Zeitüberschreitung erkennt, obwohl Telnyx, Stripe, Brevo und WorkOS Fehler unterschiedlich melden; B3 und B4 sind noch nicht gemergt, ihre Schnittstellen stehen im Design Doc als Annahmen.

## Absicht
Hermes misst je Anbieter (Telnyx, Brevo, Stripe, WorkOS) und Vorgang die Dauer und das Ergebnis jedes Aufrufs: ok, Fehler, Zeitüberschreitung oder 429; der Wert Kanalgrenze steht bereit und wird erst mit K3 gesetzt. Die Messung hängt als Hülle am Anbieteraufruf und ändert weder Antwort noch Fehler noch Frist des Aufrufs. Nicht gewollt ist ein Messwert mit Inhalt oder ID, also keine Telefonnummer, Anruf-ID, Kunden-Kennung, E-Mail oder Fehlertext in Namen oder Labels, und keine Messung, die nur für einen Anbieter eingebaut wird. Im Zweifel wird ein Aufruf weniger genau eingeordnet statt ein Label mit Personenbezug zuzulassen.

## Problem
Ein Kunde meldet abends, dass er sich nicht anmelden kann, oder Telnyx antwortet beim Nummernkauf seit Stunden mit 429. Wer Hermes betreibt, sieht davon heute nichts, solange niemand eine Logzeile sucht: Es gibt keinen Messwert dafür, wie oft ein Anbieter in der letzten Stunde ok, einen Fehler, 429 oder keine Antwort innerhalb der Frist geliefert hat und wie lange die Antworten dauerten. `src/metrics.js` kennt nur den LLM-Aufruf und die Gesprächsrunde.

## Ergebnis
Nach dieser Änderung liefert Hermes zu jedem Aufruf an Telnyx, Brevo, Stripe und WorkOS einen Zählerstand nach `anbieter`, `vorgang` und `ergebnis` sowie die Dauer nach `anbieter` und `vorgang`, ohne dass in einem Namen oder Label eine Nummer, E-Mail, ID oder ein Fehlertext vorkommt.

## Grobe Lösung
Für Kunden und Angerufene ändert sich nichts. Jeder Aufruf an einen der vier Anbieter läuft durch eine gemeinsame Hülle, die Start und Ende des Aufrufs misst, das Ergebnis aus Statuscode und Fehlerart einordnet und es als Zähler und Dauer an die Messgrundlage aus B3 meldet. Der `vorgang` kommt aus einer festen Liste im Code, ein Wert je Aufrufstelle. Die Hülle gibt Antwort oder Fehler unverändert weiter und läuft nach der Frist aus B4; scheitert die Messung selbst, läuft der Aufruf trotzdem durch. Der Wert `kanalgrenze` steht in der festen Ergebnisliste, gesetzt wird er erst mit K3.

## Fallen
- Die Anbieter melden Fehler verschieden (Telnyx `providerStatus` nur mit `attachStatus`, Brevo `err.code` als `http_<Status>`, Stripe nur im Text, `AbortSignal.timeout` als `TimeoutError`): Das Design Doc legt fest, wie die Hülle je Anbieter 429 und Zeitüberschreitung erkennt, ohne Antworttext oder Fehlermeldung als Label zu verwenden.
- Funktionen mit Lint-Befunden (`numbers.js:orderNumber`, `workos-management.js:deleteUser`, `web-auth.js:exchange`) liegen mitten in den gemessenen Aufrufen: Die Hülle wird dort angelegt, wo das Anbieterobjekt entsteht, nicht in den Methoden; so bleiben diese Funktionen unberührt.
- Viele Serien: Zähler `anbieter` × `vorgang` × `ergebnis` und Histogramm `anbieter` × `vorgang` mit höchstens 8 Grenzen müssen in das Serienbudget aus B3 passen: Das Design Doc zählt die Serien.
- B3 und B4 sind noch nicht gemergt: Namen des Messmoduls, Fristen und Fehlerart der Zeitüberschreitung sind Annahmen im Design Doc; der Bau startet erst nach dem Merge beider, danach prüft die Planung die Annahmen gegen den echten Stand.
- Die Hülle misst nur Methoden aus der Vorgangsliste, nie das ganze Objekt: Sonst zählen Webhook-Auswertung, Direktiven und URL-Bau als Telnyx-Erfolg und verdecken die Fehlerquote. Sie ändert Rückgabeart und Zeitpunkt nicht: Eine synchrone Methode (`assignCostRecords`) bleibt synchron und wird nicht gemessen.
- Fehlt bei einem Anbieter nach B4 eine Frist (heute haben Stripe und WorkOS keine), zählt ein hängender Aufruf nicht als `zeitueberschreitung`: Die Planung prüft nach dem Merge von B4, dass alle vier Anbieter eine haben.
- Die Hülle wartet nie auf die Messung, weder auf den Export noch auf das Erfassen: Sonst verzögert ein hängender Collector Anbieteraufrufe, auch das Auflegen, und die Abrechnung nach dem Auflegen bleibt aus. B13 und B14 bilden das Erfassen im Test nach; ob B3 selbst synchron erfasst, prüft die Planung nach dem Merge.
- Die Einordnung als 429 liest nur Statuscode oder Fehlercode, nie den Text: Telnyx-Fehlertexte enthalten Details des Anbieters. Das sichert S8.
- Die Antwort von `POST /api/onboard` hängt nicht vom Telnyx-Ergebnis ab (Antwort `queued` vor der Suche, `src/routes/api-onboard.js:104-114`): Die Szenarien warten deshalb auf den abgearbeiteten Provisionierungslauf.
- Telnyx setzt `providerStatus` nur mit `attachStatus`: `searchNumbers`, `sendSms` und `findPhoneNumber` müssen den Status am Fehler mitgeben, sonst wird S2 nie grün. `orderNumber` bleibt unverändert (Charakterisierungstest DID-08 hält fest, dass der Fehler dort keinen Status trägt): Ein 429 beim Nummernkauf zählt nur dann als `429`, wenn Telnyx den Code `10011` mitschickt, sonst als `fehler`.
- Stripe-Fehler tragen den Status heute nur im Text: `assertOk` und `classifiedError` setzen zusätzlich `providerStatus`, die Fehlermeldung bleibt gleich. Ein Stripe-429 umfasst auch Sperrzeitüberschreitungen (`lock_timeout`).
- Das Messmodul ist ein Baustein der Gruppe `basis` und liegt unter `src/utils/`: Eine Datei direkt unter `src/` lässt die Bausteinprüfung scheitern.
- `messaging.js`, `config-read.js` und `registry.js` gehören zum Anrufbereich: Die Änderung dort darf nur Umformungen aus `tools/vorbereitung/katalog.json` enthalten, alles andere an diesen Stellen bleibt unverändert.

## Geänderte Dateien
- `src/utils/anbieter-messung.js`
- `src/telephony/registry.js`
- `src/telephony/adapters/telnyx/numbers.js`
- `src/telephony/adapters/telnyx/messaging.js`
- `src/telephony/adapters/telnyx/config-read.js`
- `src/billing/stripe.js`
- `src/wiring/web-login.js`
- `test/utils/anbieter-aufrufe-werden-gemessen.test.js`

## Altfunktionen
- nicht berührt: `src/telephony/registry.js:originateCall`, weil die Messung am Tabelleneintrag für `PORT.VOICE_CONTROL` und die weiteren Telnyx-Ports hängt, nicht in dieser Funktion
- nicht berührt: `src/telephony/adapters/telnyx/numbers.js:orderNumber`, weil die Messung am Tabelleneintrag für `PORT.NUMBER_PROVISIONING` hängt und DID-08 den Fehler dort unverändert hält
- nicht berührt: `src/workos-management.js:deleteUser`, weil die Messung am Erzeugen der WorkOS-Verwaltung in `wireWebLogin` hängt, nicht in dieser Funktion
- nicht berührt: `src/web-auth.js:exchange`, weil die Messung am OIDC-Client in `wireWebLogin` hängt, nicht in dieser Funktion
- nicht berührt: `src/wiring/web-login.js:anonym ab Zeile 150`, weil die Messung am Erzeugen von Mailer, OIDC-Client und WorkOS-Verwaltung hängt, nicht in dieser Funktion
- nicht berührt: `src/routes/api-calls.js:makeCallRoutes`, weil Beleg: `place_call` und `cancel_call` bleiben unverändert, die Messung hängt an der Telnyx-Tabelle in `registry.js`
- nicht berührt: `src/routes/api-calls.js:anonym ab Zeile 233`, weil Beleg für den Fehlerzweig von `place_call` (502/500), den die Messung unverändert lässt; die Messung hängt an der Telnyx-Tabelle in `registry.js`
- nicht berührt: `src/routes/api-calls.js:onHangUpError`, weil Beleg für den Auflegeweg von `cancel_call`; die Messung hängt an der Telnyx-Tabelle in `registry.js`
- nicht berührt: `src/self-service-routes.js:anonym ab Zeile 269`, weil Beleg für die Newsletter-Route, die Mailfehler abfängt; die Messung hängt am Brevo-Mailer in `web-login.js`
- nicht berührt: `src/self-service-routes.js:makeSelfServiceRoutes`, weil Beleg für Newsletter- und Abrechnungsrouten; die Messung hängt an den Erzeugungsstellen der Anbieterobjekte
- nicht berührt: `src/telephony/adapters/telnyx/errors.js:anonym ab Zeile 21`, weil Beleg für die Fehlertexte von Telnyx; `assertTelnyxOk` bleibt unverändert, die Messung liest den Text nie
- nicht berührt: `src/telephony/adapters/telnyx/voice.js:anonym ab Zeile 417`, weil Beleg für die Kostenabrufe, die nicht gemessen werden
- nicht berührt: `src/telephony/adapters/telnyx/voice.js:assignCostRecords`, weil Beleg: die Methode ist synchron und steht nicht in der Vorgangsliste
- nicht berührt: `src/telephony/call-finish.js:finishCall`, weil Beleg für SMS und Verbrauchsbuchung; die Messung hängt an der Telnyx-Tabelle in `registry.js`
- nicht berührt: `src/telephony/call-termination.js:anonym ab Zeile 14`, weil Beleg für die Abrechnung nach dem Auflegen (B13, B14); die Funktion bleibt unverändert
- nicht berührt: `src/telephony/call-termination.js:terminateAndBillCall`, weil Beleg für die Abrechnung nach dem Auflegen (B13, B14); die Funktion bleibt unverändert
- nicht berührt: `src/telephony/registry.js:renderDirectives`, weil Beleg für den Eintrag `VOICE_RENDERER`, der ohne Hülle bleibt
- nicht berührt: `src/web-auth.js:anonym ab Zeile 136`, weil Beleg für `GET /auth/callback`; die Messung hängt am OIDC-Client in `wireWebLogin`

## Anforderungen

### Regel R1: Jeder Aufruf an einen der vier Anbieter wird genau einmal nach `anbieter`, `vorgang` und `ergebnis` gezählt.

#### Szenario S10: Nummernkauf mit Telnyx-Drosselcode
Gegeben die Telnyx-Attrappe beantwortet die Nummernbestellung mit 429 und dem Fehlercode `10011`
Wenn der Betreiber über `POST /api/onboard` die Einrichtung startet und der Provisionierungslauf abgearbeitet ist
Dann enthält der Messwert-Export den Zähler `hermes_anbieter_aufrufe_total` mit `anbieter="telnyx"`, `vorgang="nummer-kaufen"`, `ergebnis="429"` und dem Wert 1

### Regel R2: Die Dauer jedes Aufrufs wird nach `anbieter` und `vorgang` gemessen.

### Regel R3: Kein Messwert trägt Inhalt oder ID.

## Bleibt unverändert

### Szenario B9: Ein fehlgeschlagener Nummernkauf storniert den Setup-Hold wie bisher
Gegeben ein Tenant mit Karte und die Telnyx-Attrappe beantwortet die Nummernbestellung mit 500
Wenn der Betreiber über `POST /api/onboard` die Einrichtung startet und der Provisionierungslauf abgearbeitet ist
Dann steht die Nummer auf `failed`, der Job auf `FAILED` mit derselben Fehlermeldung wie vor dieser Änderung, und der gestellte Setup-Hold ist storniert

## Nicht-Ziele
- Nicht Teil dieser Änderung: das Setzen des Ergebnisses `kanalgrenze`, weil keine HTTP-Antwort der Anbieter es heute eindeutig zeigt und die Erkennung Paket K3 ist; der Wert steht in der Ergebnisliste bereit (Antwort der Betreuung 02.11.).
- Nicht Teil dieser Änderung: die Messung von ElevenLabs, von LLM-Anbietern und von Exa, weil ElevenLabs mit K3 kommt (`convai.js` trägt die Offenlegungsprüfung) und der LLM-Aufruf schon `metrics.llmCall` hat.
- Nicht Teil dieser Änderung: die Messung des JWKS-Abrufs in `src/auth.js`, weil die Datei die Bearer-Prüfung des MCP-Pfads trägt (CLAUDE.md Regel 3) und eine Messung dort keinen Wert für die Anbieterübersicht hat.
- Nicht Teil dieser Änderung: die Start-Probe `verifyBrevoAccount` in `src/mail-boot-probe.js`, weil sie kein Kundenvorgang ist.
- Nicht Teil dieser Änderung: die Kostenabrufe `fetchCostRecordPool` und `fetchMonthlyInvoiceTotal` von Telnyx, weil sie einen 429 intern abfangen und wiederholen und die Hülle am Objekt den Status nie sieht; `voice.js` steht nicht in den geänderten Dateien.
- Nicht Teil dieser Änderung: Methoden ohne Netzaufruf (Webhook-Auswertung, Direktiven, `authorizeUrl`, `sessionLogoutUrl`, `assignCostRecords`) und der SMTP-Versand, weil sie keinen Anbieteraufruf sind; gemessen wird nur, was in der Vorgangsliste steht.
- Nicht Teil dieser Änderung: das Ergebnis `429` für WorkOS, weil WorkOS-Fehler den Status nur im Text tragen und die Wurfstellen in `exchange` und `deleteUser` unberührt bleiben; ein WorkOS-429 zählt als `fehler`. Ebenso zählt ein Telnyx-429 beim Nummernkauf ohne Code `10011` als `fehler`, weil DID-08 unverändert bleibt.
- Nicht Teil dieser Änderung: Alarme und Dashboards auf den Messwerten, weil sie B12 und B13 sind.
- Nicht Teil dieser Änderung: neue Fristen oder Wiederholungen, weil sie B4 sind.

## Neue Begriffe
- `hermes_anbieter_aufrufe_total`: Zähler je Aufruf an einen Anbieter, Labels `anbieter`, `vorgang`, `ergebnis`.
- `hermes_anbieter_dauer_ms`: Histogramm der Aufrufdauer in Millisekunden, Labels `anbieter`, `vorgang`, höchstens 8 Grenzen.
- `anbieter`: `telnyx`, `brevo`, `stripe`, `workos`.
- `vorgang`: feste Liste im Code, ein Wert je Aufrufstelle, im Pitch genutzt `nummern-suchen`, `mail-senden`, `checkout-karte-anlegen`, `anmeldung-tauschen`; die volle Liste legt das Design Doc fest.
- `ergebnis`: `ok`, `fehler`, `zeitueberschreitung`, `429`, `kanalgrenze` (gesetzt erst mit K3).

## Offene Fragen

### Vor dem Bau zu klären
keine

### Kann warten
- Welche Namen und Pfade das Messmodul aus B3 am Ende hat; das prüft die Planung nach dem Merge von B3 und B4.

## Premortem
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil die Hülle am ganzen Telnyx-Objekt hängt, zählen Webhook-Auswertung und Direktiven als Telnyx-Erfolg, und die Folge ist, dass die Fehlerquote von Tausenden Schein-Erfolgen verdeckt wird. | B4 |
| PM2 | Weil eine Hülle jede Methode asynchron umschließt, wird das synchrone `assignCostRecords` zur Promise, und die Folge ist, dass die Kostenabrechnung Ist-Kosten verliert und die Kostendecke nur mit Schätzwerten rechnet. | B5 |
| PM3 | Weil die Hülle am OIDC-Client hängt, zählt `GET /auth/login` als WorkOS-Erfolg, und die Folge ist, dass eine WorkOS-Störung bei etwa 50 % ok unsichtbar bleibt. | B6 |
| PM4 | Weil Telnyx-Methoden ohne Schlüssel einen Fehlerwert zurückgeben, zählt jeder Kostenabruf als Telnyx-Fehler, obwohl nichts an Telnyx ging, und die Folge ist die Suche nach einer Störung, die es nicht gibt. | B8 |
| PM5 | Weil die Kostenabrufe einen 429 intern abfangen, sieht die Hülle den Status nie, und die Folge ist, dass die Drosselung der Kostenbelege nicht als Grenze erscheint. | Nicht-Ziel: Kostenabrufe von Telnyx |
| PM6 | Weil die Hülle den Status aus dem Fehlertext liest, wird ein 500 mit „429“ im Text als 429 gezählt, und die Folge ist ein falscher Drosselungsalarm. | S8 |
| PM7 | Weil `POST /api/onboard` vor dem Telnyx-Aufruf antwortet, bleiben B1 und B2 auch grün, wenn die Hülle den Fehler von `orderNumber` verändert, und die Folge ist ein Hold, der auf der Karte stehen bleibt. | B9 |
| PM8 | Weil die Hülle am Mailer-Erzeuger hängt, zählt ein SMTP-Versand als Brevo, und die Folge ist die Suche beim falschen Anbieter. | B7 |
| PM9 | Weil Stripe und WorkOS heute keine Frist haben und B4 sie dort nicht setzt, bleibt ein hängender Aufruf ungezählt, und die Folge ist, dass die Anmelde-Störung unsichtbar bleibt. | hingenommen: B4 setzt die Fristen für alle vier Anbieter; die Planung prüft das nach dem Merge von B4 (Eintrag unter „Fallen“) |
| PM10 | Weil der Test eine 20-ms-Frist verlangt, baut der Bau einen Schalter für die Frist ein, und die Folge ist eine geänderte Frist im Betrieb. | S3 umgeschrieben auf einen Fehler `TimeoutError` der Attrappe |
| PM11 | Weil die Hülle auf das Erfassen wartet, verzögert ein hängender Collector jeden Anbieteraufruf, auch das Auflegen, und die Folge ist ein Anruf, der länger läuft als erlaubt. | B13, B14 (Nachbildung des Erfassens im Test, schon vor B3 herstellbar; Antwort auf T2 der Sicherheitsprüfung) |
