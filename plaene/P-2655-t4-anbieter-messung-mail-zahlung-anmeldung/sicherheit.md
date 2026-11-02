# P-2655 Anbieter-Messung: Sicherheitsprüfung

Status: freigegeben
Grundlage: pitch.md, design.md, Code-Stand ebeecfe

## Zur Freigabe
1. Die schwersten Angriffswege: T1 (eine scheiternde Messung löst einen zweiten echten Anruf oder eine zweite SMS aus oder meldet einen gestarteten Anruf als gescheitert), T2 (eine hängende Messung hält das Auflegen durch Kostendecke und `cancel_call` auf, und der Anruf wird nicht abgerechnet), T4 (Nummern, E-Mails oder Fehlertexte gelangen über Labels zum Empfänger der Messwerte). Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden (Antwort der Betreuung 02.11.: alle vier angenommen, wie empfohlen):
   1. T5: übertragen an B12/B13 (Alarme und Dashboards) vorgeschlagen, weil Kunden und anonyme Besucher die Fehlerzähler mit ganz normaler Nutzung erhöhen können und erst ein Alarm daraus einen Schaden macht. Empfehlung: übertragen.
   2. T2: „verhindern“ statt „hingenommen“ (PM11 im Pitch). Das Szenario zu T2 lässt sich schon vor B3 herstellen, weil es das Erfassen im Test nachbildet, so wie B2 im Pitch. Empfehlung: ja, Szenario in den Pitch aufnehmen.
   3. T1: neues Szenario über `place_call` zusätzlich zu B2. B2 kann einen doppelten Aufruf nicht sehen, weil `POST /api/onboard` vor der Nummernsuche antwortet. Empfehlung: ja.
   4. Neue Zeilen für `docs/sicherheitsgrenzen.md` (Abschnitt 5). Empfehlung: ja.

## 1. Woran arbeiten wir
### Umfang
Eine neue Hülle umschließt 28 Methoden der Anbieterobjekte von Telnyx, Brevo, Stripe und WorkOS (design.md, Lösung, Vorgangsliste). Sie liegt damit in jedem kostenpflichtigen Anbieteraufruf: Anrufstart, Auflegen, Umleiten, SMS, Nummernkauf und -freigabe, Stripe-Hold, -Einzug, -Storno, Verbrauchsmeldung sowie Tausch des Anmeldecodes. Angehängt wird sie in `src/telephony/registry.js:29-40` (Tabelle `ADAPTERS`), beim Export von `stripeBilling` (`src/billing/stripe.js:107`) und in `src/wiring/web-login.js:67-74`, `:101`, `:114-116`. Die Messwerte gehen über das Messmodul aus B3 an einen Empfänger außerhalb von Hermes (design.md, Ausgangslage, B3-Zeile, ungeprüft). Neu am Fehlerobjekt ist das Feld `providerStatus`, bei Stripe (`assertOk`, `classifiedError`) und bei `searchNumbers`, `sendSms` und `findPhoneNumber` (design.md, Lösung). Keine neue Route, kein neues Werkzeug, kein neuer Anbieteraufruf.
### Beteiligte
- Kunde: angemeldet im Browser. Löst über Self-Service-Routen Stripe- und Brevo-Aufrufe aus (`src/wiring/web-login.js:164-178`).
- Agent des Kunden: ruft über `/mcp` und `internalOnly` `place_call` und `cancel_call` auf, das führt zu `originateCall` und `endCall` (`src/routes/api-calls.js:344-352`, `:417-434`).
- Angerufener: nimmt ab oder legt auf. Seine Ereignisse kommen als Telnyx-Webhooks an `/voice` und werden nicht gemessen (Pitch, B4).
- Anrufer bei eingehenden Anrufen: löst über Telnyx `redirectCall` und `endCallViaCallControl` aus (`src/server.js:162-166`, `src/telephony/call-termination.js:23-28`).
- Anonymer Besucher: kann `/auth/login` und `/auth/callback` aufrufen, das führt zu `exchange` (`src/web-auth.js:136-171`).
- Anbieter (Telnyx, Brevo, Stripe, WorkOS): liefern Statuscode und Fehlercode, aus denen die Hülle das Ergebnis liest.
- Empfänger der Messwerte: erhält Zähler und Dauer (B3, angenommen: ein OTLP-Collector, ggf. bei einem Dritten).
- Betreiber: sieht Messwerte und Logs.
### Eingänge und Grenzen
- `place_call` (`POST /api/calls`): vom Agenten des Kunden über die Gates zum Anbieter. Die Hülle sitzt hinter allen Gates, direkt vor `originateCall` (`src/routes/api-calls.js:344`), und nur im Telnyx-Weg; bei eingeschaltetem ElevenLabs-Ausgang startet ElevenLabs den Anruf (`:338-341`). Angriffswege: T1, T3
- `cancel_call` (`POST /api/calls/:id/cancel`) sowie Höchstdauer- und Kostendecken-Wächter: Hermes zum Anbieter über `endCall` / `endCallViaCallControl` (`src/routes/api-calls.js:423-434`, `src/telephony/call-lifecycle.js:85-126`). Angriffswege: T2
- `/voice/*` (Telnyx-Webhooks), eingehende Anrufe: Webhook-Auswertung bleibt ohne Hülle (design.md, Lösung, `WEBHOOK_EVENTS`); Umleiten und Auflegen eingehender Anrufe laufen durch die Hülle (`src/server.js:162-166`). Angriffswege: T2
- `POST /api/onboard`, `/api/onboard/retry`, `/webhooks/stripe` und Zeitgeber (Freigabe, Vertragsende, Stripe-Abgleich): Hermes zu Telnyx und Stripe (`src/wiring/web-login.js:107-123`, `:181-191`). Angriffswege: T1, T3
- Self-Service-Routen für Abrechnung und Newsletter, `POST /api/billing/setup-checkout`: Kunde bzw. MCP-Weg zu Stripe und Brevo (`src/wiring/web-login.js:164-178`; design.md, Ausgangslage). Angriffswege: T3, T5
- `GET /auth/callback`: anonymer Besucher zu WorkOS `exchange`, nach Prüfung von `state`, Nonce-Cookie und `code_verifier` (`src/web-auth.js:136-156`). Angriffswege: T5
- Antworten der Anbieter in die Hülle: Status und Fehlercode werden nur verglichen, nie als Label übernommen (design.md, Lösung, Einordnung). Angriffswege: keiner, weil ein Anbieter nur zwischen fünf festen Ergebnissen wählen kann.
- Neu: Messwerte von Hermes zum Empfänger (B3). Grenze von Hermes nach außen. Beleg: design.md, Ausgangslage, B3-Zeile (angenommen). Angriffswege: T4
### Werte
- Kostenpflichtige Anbieteraufrufe (Anruf, SMS, Nummer, Hold): Jeder zusätzliche oder unerkannte Aufruf kostet uns oder den Kunden Geld und kann einen Menschen erreichen.
- Wirksamkeit der Kostendecke und von `cancel_call`: Beide hängen am Auflegen und an der Abrechnung danach (`src/telephony/call-termination.js:3-16`).
- Telefonnummern, E-Mail-Adressen, Kennungen und Fehlertexte der Anbieter: personenbezogen bzw. vertraulich; Telnyx-Fehlertexte enthalten Anbieter-Details (`src/telephony/adapters/telnyx/errors.js:20-29`).
- Aussagekraft der Anbieter-Messwerte: Betreiber treffen darauf Entscheidungen, später auch Alarme (B12/B13).
### Wem wir was glauben
- Messmodul aus B3: wir glauben, dass Erfassen synchron im Speicher geschieht und nie auf den Export wartet (design.md, Zur Freigabe, Punkt 6); wenn nicht, gilt T2 auch bei korrekt gebauter Hülle.
- Empfänger der Messwerte: wir glauben, dass er nur Zähler und Dauer mit den festen Labels erhält und keine Exemplare oder Ressourcenattribute mit Inhalt; wenn nicht, gilt T4 über einen Weg, den diese Änderung nicht sieht.
- Anbieter: wir glauben ihren Statuscodes für die Einordnung; ist das falsch, stimmt nur der Messwert nicht, kein Aufruf ändert sich.
### Nicht-Ziele
- Diese Änderung schützt nicht gegen hängende Anbieteraufrufe ohne Frist (heute `originateCall`, Stripe, WorkOS), weil die Fristen B4 sind.
- Diese Änderung schützt nicht den Transport und die Speicherung der Messwerte beim Empfänger, weil das B3 ist.
- Diese Änderung schützt nicht gegen Fehlalarme, weil Alarme B12/B13 sind (siehe T5).

## 2. Angriffswege
### T5: Kunden und anonyme Besucher erhöhen mit normaler Nutzung die Fehlerzähler eines Anbieters
Wer: anonymer Besucher (`/auth/callback`), angemeldeter Kunde (Kartenhinterlegung, Abo)
Weg: Jeder Tausch eines ungültigen Anmeldecodes zählt als `workos`/`anmeldung-tauschen`/`fehler`, gleich wie eine WorkOS-Störung (design.md, Fehlerfälle, WorkOS-Zeile; `src/web-auth.js:155-171`). Eine abgelehnte Karte zählt als `stripe`/`fehler` (design.md, Fehlerfälle, Stripe-Zeile). Die Einordnung unterscheidet keine vom Aufrufer verursachten 4xx von Störungen beim Anbieter.
Schaden: Die Fehlerquote eines Anbieters lässt sich von außen anheben. Heute beobachtet nur der Betreiber die Werte, also gibt es bis zu den Alarmen nur einen falschen Eindruck. Mit Alarmen kann das zu Fehlalarmen führen oder dazu, dass Alarme abgestumpft werden.
Ausgang: übertragen an B12/B13 (Vorschlag), weil der Schaden erst mit Alarmen entsteht und die Zähler hier bewusst grob sind (Pitch, Absicht: „im Zweifel weniger genau“)

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1 | trifft zu → T1 (zweiter Anruf ohne zweite Bestätigung); die Bestätigung in der Hermes-Karte selbst wird nicht berührt, die Hülle sitzt hinter ihr |
| H2 | trifft zu → T1 (doppelte Anrufe und SMS, die nicht gegen Stundenlimit und Kostendecke laufen). Telnyx-Profile und -Verbindungen werden nicht berührt (`src/telephony/registry.js` wählt nur nach Anbieter) |
| H3 | trifft zu → T2 (Anruf läuft nach Abbruch weiter und wird nicht gebucht), T1 |
| H4 | trifft nicht zu, weil die Messwerte keine Mandanten-Kennung tragen (Pitch, R3) und keine Route sie an Kunden ausgibt (keine Metrik-Route in `src/`; `src/metrics.js` loggt nur) |
| H5 | trifft nicht zu, weil die Hülle keine Tokens annimmt oder weiterreicht; Schlüssel lesen die Adapter selbst aus der Konfiguration, nicht aus den Argumenten (`src/billing/stripe.js:34-41`, `src/telephony/adapters/telnyx/messaging.js:9-15`) |
| H6, H7, H12 | trifft nicht zu, weil keine Gesprächsinhalte, Stimme oder Transkripte durch die Hülle laufen; ElevenLabs und LLM sind nicht gemessen (Pitch, Nicht-Ziele) |
| H8 | trifft nicht zu, weil der Offenlegungssatz in `/voice/outbound` bzw. `src/elevenlabs/convai.js` entsteht und beides nicht berührt wird; auch ein doppelter Anruf aus T1 liefe über denselben Weg. Kein Punkt für die rechtliche Prüfung |
| H9 | trifft nicht zu, weil die Hülle der Nummer eines eingehenden Anrufs nichts glaubt und nicht zurückruft |
| H10 | trifft nicht zu, weil Signaturprüfung und Webhook-Auswertung ohne Hülle bleiben (`src/telephony/registry.js:87-93`; design.md, Lösung, `WEBHOOK_EVENTS`; Pitch, B4) |
| H11 | trifft nicht zu, weil die Hülle an keine von Kunden genannte Adresse sendet; die Adresse des Empfängers der Messwerte stammt aus der Konfiguration (B3, angenommen) |
| H13 | trifft nicht zu, weil die Änderung keinen Schlüssel braucht; Zugangsdaten für den Export bringt B3 |
| H14 | trifft nicht zu, weil kein neues Paket und kein neuer Anbieter dazukommt (design.md, Verworfene Wege: automatische Instrumentierung verworfen); das Messpaket bringt B3 |
| H15 | trifft zu → T5 (Einordnung glaubt dem Statuscode, auch wenn ihn der Aufrufer verursacht hat); sonst siehe „Wem wir was glauben“. Das neue `providerStatus` an Stripe-, `searchNumbers`-, `sendSms`- und `findPhoneNumber`-Fehlern ändert keine Entscheidung, weil kein Aufrufer es dort liest (Suche nach `providerStatus` in `src/`: nur `api-calls.js` für `originateCall`, `release-reconcile.js` für `releaseNumber`, ElevenLabs- und LLM-Stellen; das ANI-Gate fängt jeden Fehler gleich, `src/telephony/outbound-gates.js:107-111`) |
| STRIDE an der Hülle vor den Anbieteraufrufen | Tampering → T1, T3; Denial of Service → T2. Spoofing, Repudiation und Elevation of Privilege ohne konkreten Weg, weil die Hülle hinter allen Gates und Anmeldungen sitzt, keinen neuen Eingang hat und Audits nicht berührt; Information Disclosure siehe nächste Zeile |
| STRIDE am neuen Export zum Empfänger der Messwerte | Information Disclosure → T4; Tampering an der Aussagekraft → T5. Spoofing, Repudiation, Denial of Service und Elevation of Privilege gehören zum Transport (B3); die Serienzahl ist durch feste Listen begrenzt (design.md, Serien), Angreifer können keine neuen Reihen erzeugen |
| LINDDUN für die angerufene Person | Identifizierbarkeit und Offenlegung → T4 (Zielnummer als Label, verhindert durch S7). Verknüpfbarkeit trifft nicht zu, weil ohne Nummer und Mandant der Zeitpunkt eines `anruf-starten` niemanden bestimmt. Unwissenheit und Nichteinhaltung treffen nicht zu, weil keine neue Verarbeitung von Daten des Angerufenen entsteht |

## 4. Offene Fragen
- Angenommen: Das Erfassen in B3 ist synchron und wartet nie auf den Export. Ändert: T2 (wenn nicht, hilft auch eine korrekte Hülle nicht). Prüfen durch: Planung nach Merge von B3, Erfassen-Funktion des Messmoduls lesen.
- Angenommen: Der Export von B3 schickt keine Exemplare und keine Ressourcenattribute mit Inhalt, und B3 öffnet keine Route, die Messwerte ohne Anmeldung ausgibt. Ändert: T4. Prüfen durch: B3-Code nach Merge, `src/route-policy.js` und Exporter-Einstellungen lesen.
- Angenommen: Telnyx wertet den Idempotency-Key bei der Nummernbestellung aus (`src/telephony/adapters/telnyx/numbers.js:66`), sodass ein doppelter `orderNumber` keine zweite Nummer kauft. Ändert: den Schaden in T1 für den Nummernkauf. Prüfen durch: Telnyx-Doku zu `number_orders`.

## 5. Vorschlag für docs/sicherheitsgrenzen.md
- Neue Grenze und Katalogzeile: Messwerte verlassen Hermes nur mit Namen und Labels aus festen Listen im Code. Angriff: Nummern, E-Mails, Kennungen oder Fehlertexte gelangen über Messwerte zum Empfänger. Mechanismus: Vorgangs- und Ergebnisliste in `src/utils/anbieter-messung.js`. Negativtest: S7 des Pitches mit der Kennung der neuen Zeile.
- Neue Katalogzeile: Die Messung verändert keinen kostenpflichtigen Anbieteraufruf. Angriff: Eine scheiternde oder hängende Messung löst einen Anruf doppelt aus oder hält das Auflegen auf. Mechanismus: Hülle ruft das Original genau einmal, fängt das Erfassen ab und wartet nie darauf. Negativtests: die Szenarien zu T1 und T2.
- Angriffsfläche: keine neue Zeile, weil keine Route, kein Webhook und kein Werkzeug dazukommt.

## 6. Gegenprüfung

Geprüft durch den Agenten angreifer (Code-Stand ebeecfe):

| Nr. | Art | Bezug | Befund | Eintrag |
|---|---|---|---|---|
| 1 | Szenario prüft nicht | T2 | Das Szenario prüfte nur den Erfolgszweig des Auflegens; scheitert das Auflegen und wartet die Hülle im Fehlerzweig auf das Erfassen, läuft `bill()` nie. | zusätzliches Szenario B14 |
| 2 | Szenario prüft nicht | T1, T3 | Ein werfendes Erfassen wurde nur mit 200-Antworten geprüft; im Fehlerzweig würde die Hülle den Anbieterfehler ersetzen. | zusätzliches Szenario B12 |
| 3 | widerlegt (teilweise) | T1 | Der Anruf läuft nicht ohne Höchstdauer (`TimeLimit` geht beim Start an Telnyx); „doppelte SMS“ trifft nicht zu, kein Aufrufer wiederholt `sendSms`. | Schaden in T1 umformuliert, Ausgang „verhindern“ bleibt |
| 4 | Szenario prüft nicht | T4 | In S7 bekam keine umhüllte Methode Nummer oder E-Mail als Argument; die E-Mail-Prüfung konnte nie rot werden. | S7 auf `place_call` mit Zielnummer umgeschrieben, E-Mail-Klausel gestrichen |

Kein neuer Angriffsweg und kein belegter Befund im bestehenden Code.
