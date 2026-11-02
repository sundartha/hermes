# Fragerunden P-2643

## Runde 1
1. Issue anlegen? Empfehlung: ja. Antwort: ja, wie empfohlen. Angelegt als #2643.
2. Absicht wie im Entwurf (Betriebsmeldungen an den Better-Stack-Eingang, `alert-sms.js` bleibt die eine Stelle, Start verweigert ohne Eingang)? Empfehlung: ja. Antwort: ja, wie empfohlen.
3. Form des Eingangs: `POST` mit JSON `{ "incident": { "id", "status" }, "text" }` an `BETTERSTACK_ALERT_URL` (Geheimnis), Frist 5 Sekunden, ein Versuch je Aufruf? Empfehlung: ja. Antwort: ja, wie empfohlen.
4. Schlüssel der Vorfälle: Zustands-Anlässe mit Marker-Code, einmalige Anlässe mit Anlass plus Zeitstempel? Empfehlung: ja. Antwort: ja, wie empfohlen.
5. Zugestellt nur bei HTTP 2xx, sonst unzugestellt mit Wiederholung nach `OUTAGE_ALERT_RETRY_MS`, Aufrufer wirft nie? Empfehlung: ja. Antwort: ja, wie empfohlen.
6. Startprüfung: dieselben Bedingungen, Ziel ist der Eingang? Empfehlung: ja. Antwort: ja, wie empfohlen; der Pitch nennt als Bedingung vor dem Merge, dass Antonio die Variable in Render setzt (Staging und Produktion, H13), und die Abnahme läuft zuerst auf Staging.
7. Entfällt: Mailkanal der Ausfallmeldung, `mail-boot-probe.js`, Kanal-Selbsttest samt `OUTAGE_ALERT_SELF_TEST_INTERVAL_MS`, `PLATFORM_ALERT_SMS_TO`, `PLATFORM_ALERT_MAIL_TO`, SMS-Absenderauflösung und Bindung `alert_sms_sender`; bleibt: `alert-sms.js`, `mailerKonstruierbar`, Mail für Kündigung und Login? Empfehlung: ja. Antwort: ja, wie empfohlen.
8. Ohne Selbsttest bleibt das Risiko „falsche Adresse, niemand merkt es“: hinnehmen mit Probe auf Staging und B7? Empfehlung: ja. Antwort: ja, wie empfohlen (Eintrag im Premortem).
9. Design Doc: ja? Empfehlung: ja. Antwort: ja, wie empfohlen.
10. Konfigurationsort: Antwort: keine Ausnahme von der Regel in `steuerung/abhaengigkeiten.json`. Führt B9 eine neue Variable ein, kommt B9 nach KFZ, und der Wert gehört nach `src/konfiguration/`. Der Pitch nennt die Bedingung (Fallen).

## Vorher-Rot
- S1: heute geht die Ausfallmeldung an Brevo-Mail und Telnyx-SMS, nie an einen Eingang: `src/telephony/outage-report.js:42-52` (`sendeUeberBeideKanaele`).
- S2: heute sendet die Ausgabenwarnung eine SMS: `src/telephony/outbound-gates.js:350`.
- S3: heute sendet die Tarif-Abweichung eine SMS: `src/billing/cost-truing.js:490`.
- S4: heute sendet die TTS-Warnung eine SMS: `src/server.js:199`.
- S5: heute sendet das Stripe-Geldereignis eine SMS: `src/routes/stripe-webhook.js:44`.
- S6: heute sendet die Heilung eine SMS: `src/boot.js:634`.
- S7: heute startet der Dienst mit gesetztem `PLATFORM_ALERT_SMS_TO` und leerem Eingang (Exit-Code 0, kein Befund): `src/boot-guard.js:314`.
- S8: heute startet der Dienst mit `PAYMENT_ENABLED`=true und `PLATFORM_ALERT_SMS_TO` gesetzt, die Prüfung verlangt nur das SMS-Ziel: `src/boot-guard.js:314`, `:333-346`.
- S9: heute meldet der Start ohne `PLATFORM_ALERT_SMS_TO` eine Warnung und liest keine Adresse; die Prüfung auf `BETTERSTACK_ALERT_URL` fehlt: `src/boot-guard.js:344-350`. Ein Test, der den Wert gesetzt prüft, ist heute rot, weil die Variable nicht gelesen wird.
- S10: heute schließt die Rückkehr nur den Marker im Speicher und sendet nichts: `src/telephony/outage-report.js:53-64` (`markOnly`).
- S11, S12: heute gibt es keinen Eingang, also keinen Versuch und keine Wiederholung dorthin: `src/telephony/outage-report.js:42-52`.
- S13: heute schließt der Kosten-Befund nur den Marker und sendet nichts: `src/billing/cost-truing.js:64-76` (`closeCoverageBefunde`).

## Runde 2
1. Startprüfung als siebter Anlass mit Meldung? Empfehlung: nein, sie ist eine Verweigerung mit Exit-Code 1. Antwort: ja, wie empfohlen; der Pitch nennt die Berichtigung der Fertig-Zeile (siehe „Ergebnis“).
2. Schließen Kosten- und Preis-Befunde mit `resolved` und dem Marker-Code als Schlüssel? Empfehlung: ja. Antwort: ja, wie empfohlen (Szenario S13). Die Hold-Eskalation hat im Code keinen Schließweg und bleibt ohne `resolved`; das Design Doc hält das fest.

## Runde 3 (Premortem und Altfunktionen)
Der Premortem-Agent hat 14 Gründe gefunden. Jeder bekommt genau einen Ausgang; „hingenommen“ entscheidet der Nutzer.
1. Absender-Bindung (Grund 1): Mit der Bindung `alert_sms_sender` entfällt der Halt der Bootstrap-Nummer in `numberBusyReason`; Kündigung oder Löschung des Bootstrap-Mandanten gäbe die Nummer beim Anbieter frei. Neues Szenario B4 unter „Bleibt unverändert“ (Nummer bleibt in hold `platform_number_in_use`, kein Anbieter-DELETE); das Design Doc entscheidet, wie der Halt erhalten bleibt? Empfehlung: ja.
2. Rückkehr erst nach Zustellung (Grund 2): Der Marker wird erst geschlossen, wenn `resolved` mit 2xx angekommen ist; sonst wiederholt der nächste Takt. Neues Szenario S14. Empfehlung: ja.
3. Wiederholung für einmalige Anlässe (Grund 3): Die Ausgabenwarnung setzt ihren Monatsmarker erst nach Zustellung (neues Szenario S15); Stripe bleibt ohne Wiederholung, weil das Ereignis auch im Stripe-Dashboard steht (hingenommen). Empfehlung: ja.
4. Zwei Präfixe, zwei Vorfälle (Grund 4): Der Präfix steht im Schlüssel der Tarif-Abweichung (neues Szenario S3b). Empfehlung: ja.
5. Adresse nie im Log (Grund 5): Neues Szenario S16 (Netzfehler, Adresse nicht in der Ausgabe); `src/log-maske.js` kommt in „Geänderte Dateien“, damit die Maske `BETTERSTACK_ALERT_URL` kennt. Empfehlung: ja.
6. Start ohne Eingang auch bei `PLATFORM_SPEND_WARN_PERCENT`=0 (Grund 6): Neues Szenario S8b; bei `PAYMENT_ENABLED`=true oder aktiver Ausfall-Erkennung verweigert die Startprüfung ohne Eingang immer. Empfehlung: ja (so steht es in der Absicht).
7. Staging und Produktion mit getrenntem Eingang (Grund 7): Nicht-Ziel „Umgebungs-Präfix im Schlüssel“; die Bedingung „je Umgebung ein eigener Eingang“ kommt zu H13. Empfehlung: ja.
8. Selbsttest-Ersatz (Grund 8): Nicht-Ziel „Probe-POST beim Start oder Selbsttest“; bleibt wie in Runde 1 Frage 8 entschieden (Probe auf Staging, B7, B12). Empfehlung: ja.
9. HOLD-Eskalation (Grund 9): Neues Szenario S17 (`hold:platform_number_in_use:` nach `platformHoldEscalationMaxAgeMs`, ohne `resolved`). Empfehlung: ja.
10. Preis-Wächter (Grund 10): Neues Szenario S18 (Öffnen und Schließen mit Marker-Code). Empfehlung: ja.
11. S10 ersetzen (Grund 11): Erholt gilt nur bei null Fehlern im Fenster und mindestens einem angenommenen Anruf (`src/telephony/outage-detection.js:67-70`); S10 wird entsprechend umgeschrieben, die Schwellen bleiben. Empfehlung: ja.
12. S2 bis S6 mit „SMS-Ziel gesetzt, trotzdem keine SMS und keine Mail“ (Grund 12): Empfehlung: ja.
13. Mandanten-ID in Stripe-Meldungen (Grund 13, Recht): Die Stripe-Zeilen enthalten `tenant=<id>` (`src/billing/webhook.js:315`, `:357`) und gehen erstmals an Better Stack. Hinnehmen, weil pseudonym und ohne Nummer oder Mail; Voraussetzung vor Produktion: Auftragsverarbeitungsvertrag mit Better Stack. Der Satz unter „Kann warten“ wird berichtigt. Empfehlung: ja, hinnehmen.
14. Tarif-Abweichung nach Neustart (Grund 14): Entprellung nur im Speicher, nach einem Deploy ein neuer Vorfall; entspricht der heutigen SMS. Hinnehmen, eine dauerhafte Entprellung ist eine eigene Änderung. Empfehlung: ja, hinnehmen.
15. Altfunktionen: `karte` meldet Befunde in `src/telephony/outbound-gates.js:emitPlatformSpendWarning` (id-length, umschlossen von `makeOutboundGates` mit 428 Zeilen) und `src/billing/cost-truing.js:makeCostTruing` (325 Zeilen, umschließt `alertDrift`, Zeile 490). Empfehlung: das Design Doc behält die Aufrufer-Signatur von `sendBootstrapAlertSms` bei, damit `cost-truing.js`, `stripe-webhook.js`, `server.js` und `boot.js` unverändert bleiben und aus „Geänderte Dateien“ fallen; `emitPlatformSpendWarning` ruft `sendFailSoftAlertSms` mit eigenem Absender auf und muss sich ändern, dafür ein Umbau davor (`- Umbau: src/telephony/outbound-gates.js:emitPlatformSpendWarning`), und `src/telephony/call-finish.js:finishCall` (Beleg `:160`) steht als „nicht berührt“. Verlangt `plane` danach auch die Hüllfunktion (Exit 6), lege ich dir das gesondert vor. Empfehlung: ja.

Antworten Runde 3 (Betreuung): Punkte 1 bis 12, 14 und 15: ja, wie empfohlen. Punkt 13 (Rechtsfrage, Mandanten-ID erstmals an Better Stack): eingetragen wie empfohlen, im Pitch markiert „vorbehaltlich Antonio: AV-Vertrag mit Better Stack vor Produktion“; die Betreuung legt ihn Antonio vor, bei Nein wird die Mandanten-ID vor dem Bau aus den Zeilen genommen.

Neu aus Runde 3 (B4 ist ein „Bleibt unverändert“-Szenario und braucht keinen Beleg):
- S14: heute schließt die Rückkehr nur den Marker und sendet nichts, auch kein `resolved` mit späterer Wiederholung: `src/telephony/outage-report.js:53-64` (`markOnly`).
- S15: heute geht die Ausgabenwarnung als SMS und der Monatsmarker wird vor dem Senden gesetzt, an den Eingang geht nichts: `src/telephony/outbound-gates.js:350`, `src/store/state-ops.js:2447-2456`.
- S16: heute geht die Tarif-Abweichung als SMS, nie an den Eingang: `src/billing/cost-truing.js:490`.
- S17: heute maskiert die Log-Maske nur Namen auf `KEY`/`TOKEN`/`SECRET`/`PASSWORD`/`PASS`/`PWD`, `BETTERSTACK_ALERT_URL` bliebe unmaskiert: `src/log-maske.js:5`.
- S18: heute startet der Dienst mit `PAYMENT_ENABLED`=true, Warnschwelle 0 und ohne Ziel (nicht fatal): `src/boot-guard.js:340-348`.
- S19: heute geht die Hold-Eskalation per Mail und SMS: `src/telephony/outage-report.js:242-256` (`meldeHoldEskalation`), `:70-76`.
- S20: heute meldet der Preis-Wächter über `meldeVollBefund` per Mail und SMS und schließt Marker ohne Meldung: `src/billing/price-drift-watch.js:85-104`.
- S2 bis S6 (ergänzt um „SMS-Ziel gesetzt, keine SMS, keine Mail“) und S10 (umgeschrieben): die Belege S1 bis S6 und S10 oben gelten weiter.

Nachtrag nach Design Doc (Architekt):
- S12 (neu gefasst als Hold-Wiederholung): heute wird ein Fehlschlag der Hold-Eskalation nie wiederholt: `src/telephony/outage-report.js:242-256` (`:246`). Das alte S12 (Antwort innerhalb von 7 Sekunden) war heute schon grün, weil `/voice/status` vor der Verarbeitung mit 200 antwortet (`src/routes/voice.js:446`); es entfällt, sein Anliegen steht als B6.
- S21: heute merkt sich die Ausgabenwarnung den Monat nur im Speicher und warnt nach jedem Neustart erneut: `src/store/state-ops.js:2447-2456`, `src/store/json.js:238`.
- B5 und B6 sind „Bleibt unverändert“ (heute schon so) und brauchen keinen Beleg.

Nachtrag nach Sicherheitsprüfung und Gegenprüfung (S22 bis S25 sind Vorschläge zur Freigabe):
- S22: heute liest die Startprüfung `BETTERSTACK_ALERT_URL` nicht; mit gesetztem SMS-Ziel startet der Dienst mit Exit-Code 0: `src/boot-guard.js:314`.
- S23: dasselbe ohne aktive Zahlung und Ausfall-Erkennung: `src/boot-guard.js:314`, `:340-348` (nicht fatal).
- S24: heute wird die Adresse nicht gelesen, der Start läuft durch: `src/boot-guard.js:314`.
- S25: heute geht die Heilungsmeldung als SMS und der Start läuft weiter, kein Exit-Code 1: `src/boot.js:634`, `src/boot-guard.js:314`.

## Freigabe
Antworten (Betreuung): Punkte 1 bis 18 wie empfohlen; 8 bestätigt (B9 baut nach KFZ); 9, 10 und 15 als Bedingungen vor Produktion unter H13; 14 ja, kein Weg fehlt; 19: Antonio hat am 02.11. entschieden, die Mandanten-ID darf an Better Stack, Bedingung AV-Vertrag vor Produktion (der Vorbehalt im Pitch ist eine feste Bedingung). Freigabe: freigegeben (Betreuung für Antonio, 02.11.).

## Altfunktionen (nach Exit 6 von `plane`)
Antwort (Betreuung): 1 ja (Umbauten `emitPlatformSpendWarning`, `claimPlatformSpendWarning`, `alert-sms.js:onError`); 2 ja (`makeCostTruing` nicht berührt, Schlüssel einmaliger Anlässe aus `logTag`, Zeitstempel und Kurz-Hash der Meldezeile, S3 und S16 sowie Design Doc angepasst: IDs der Tarif-Abweichung beginnen mit "cost-truing:"); 3 ja (übrige als „nicht berührt“). Kommt der Umbau von `makeOutboundGates` später doch, wird er neu vorgelegt.
