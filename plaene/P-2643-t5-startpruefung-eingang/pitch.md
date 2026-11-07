# P-2643 Alarmziel tauschen: Betriebsmeldungen an Better Stack: Teil t5 startpruefung-eingang

Status: freigegeben
Issue: 2675
Teil von: P-2643-alarmziel-tauschen; nach: P-2643-t1-alarm-kern, P-2643-t2-meldeweg-zustand, P-2643-t4-ausgabenwarnung
Freigabe Betreuung 02.11. 19:4x: reine Nachführung veralteter Zeilenangaben nach SOZ, Inhalt unverändert
Freigabe Betreuung 02.11. 20:2x: Datei der Konfigurationsvariable nachgetragen (Rückmeldung design.md:148, Regel neue Variable nach src/konfiguration/)
Freigabe Betreuung 02.11. 21:2x: Hinweis zur Teilung im Kopf, kein Inhaltsabschnitt
Hinweis: T1 wird über S24 und die Startprüfung (src/boot.js, src/boot-guard.js) belegt; T1 gehört in denselben Teil wie S24.
Freigabe Betreuung 02.11. 22:0x: Kernänderung in t1-t1 ändert bestehende Tests aller Eingänge
Design Doc: ja, weil es mehr als einen ernsthaften Weg für das Schlüsselschema der Vorfälle und für den Umgang mit der Absender-Bindung `alert_sms_sender` gibt, die Entscheidung fünf Aufrufer und die Startprüfung trägt und sich nach dem Abschalten von SMS und Mail schwer zurücknehmen lässt.

## Absicht
Betriebsmeldungen von Hermes (Ausfall, Ausgabenwarnung, Kostenabgleich, TTS-Kontingent, Stripe, Start, Startprüfung) gehen an den Better-Stack-Eingang statt per SMS und Brevo-Mail; `alert-sms.js` bleibt die eine Stelle dafür. Nicht gewollt ist, dass ein Anlass verstummt, weil sein Aufrufer vergessen wurde, oder dass eine Meldung doppelt oder gar nicht ankommt. Im Zweifel meldet Hermes lieber einmal zu viel als gar nicht, und der Start wird verweigert, wenn kein Eingang gesetzt ist.

## Problem
Heute geht eine Betriebsmeldung von Hermes an zwei Wege, die abgeschafft werden: an eine SMS über Telnyx (`PLATFORM_ALERT_SMS_TO`, Absender aus der Bootstrap-Nummer) und bei der Ausfallmeldung zusätzlich an eine Mail über Brevo (`PLATFORM_ALERT_MAIL_TO`). Fällt ein Telefonie-Anbieter aus, sendet Hermes die Meldung über genau den Anbieter, der ausgefallen ist. Eine SMS oder Mail kann man nicht wieder schließen; ein Vorfall, der vorbei ist, bleibt ohne Gegenmeldung stehen. Der Dienst prüft beim Start, ob SMS-Ziel oder Mail-Ziel gesetzt sind, und führt beim Start eine Mail-Probe gegen Brevo aus.

## Ergebnis
Nach dieser Änderung erhält der Better-Stack-Eingang (im Test eine Attrappe) für jeden der sechs Anlässe, die heute senden (Ausfall, Ausgabenwarnung, Kostenabgleich, TTS-Kontingent, Stripe, Start), genau einen `POST` mit `incident.status` `alert`, schließt bei der Rückkehr eines Ausfalls den Vorfall mit `resolved`, und es geht weder eine SMS noch eine Mail an einen Betreiber. Dasselbe gilt für die Eskalation einer hängenden Rufnummern-Freigabe (S19) und den Preis-Wächter (S20), die heute über denselben Meldeweg laufen. Die Startprüfung verweigert den Start mit Exit-Code 1, wenn `BETTERSTACK_ALERT_URL` fehlt, wo sie heute SMS- oder Mail-Ziel verlangt; sie sendet selbst keine Meldung. Damit berichtigt dieser Pitch die Fertig-Zeile von B9 im Bauplan („sieben Anlässe erzeugen genau eine Meldung“) zu „sechs Anlässe erzeugen genau eine Meldung, die Startprüfung verweigert den Start“.

## Grobe Lösung
Der Betreiber sieht Meldungen als Vorfälle in Better Stack, nicht mehr als SMS auf dem Handy. Alle Aufrufer melden weiter an dieselbe Stelle, `alert-sms.js`; sie sendet jetzt ein JSON mit Vorfall-Schlüssel, Status und Meldezeile an die Adresse aus `BETTERSTACK_ALERT_URL`. Meldungen mit Rückkehr (Telefonie-Ausfall je Eimer, Kosten- und Preis-Befunde) tragen den bisherigen Marker-Code als Schlüssel; schließt Hermes den Marker, sendet es `resolved` mit demselben Schlüssel. Einmalige Anlässe (Ausgabenwarnung, Tarif-Drift, TTS-Kontingent, Stripe, Start) tragen Anlass plus Zeitstempel als Schlüssel, jede Meldung ist ein eigener Vorfall, den ein Mensch schließt. Als zugestellt gilt eine Meldung nur bei einer Antwort 2xx binnen 5 Sekunden; sonst bleibt sie unzugestellt, und die bestehende Wiederholung nach `OUTAGE_ALERT_RETRY_MS` greift. Die Mail-Probe beim Start, der Kanal-Selbsttest und der Brevo-Mailkanal der Ausfallmeldung entfallen, ebenso `PLATFORM_ALERT_SMS_TO`, `PLATFORM_ALERT_MAIL_TO` und die Absender-Bindung. Der Marker einer Rückkehr wird erst geschlossen, wenn der Eingang `resolved` mit 2xx angenommen hat; sonst wiederholt der nächste Takt. Die Ausgabenwarnung merkt sich ihren Monat erst nach der Zustellung. Der Schlüssel einmaliger Anlässe trägt neben Anlass und Zeitstempel einen Kurz-Hash der Meldezeile, damit zwei Tarif-Abweichungen im selben Lauf zwei Vorfälle ergeben. Die Eskalation einer hängenden Rufnummern-Freigabe (hold) meldet ebenfalls an den Eingang, ohne `resolved`; der Preis-Wächter öffnet und schließt Vorfälle mit dem Marker-Code. Die Bootstrap-Nummer behält ihren Halt gegen Freigabe beim Anbieter, auch ohne Absender-Bindung. Die Startprüfung verweigert den Start ohne Eingang immer, sobald Zahlung oder Ausfall-Erkennung aktiv ist. Die Entprellung und die Schwellen der Ausfall-Erkennung bleiben unverändert.

## Fallen
- Eine feste Alert ID würde bei einem noch offenen Vorfall jede weitere Meldung verschlucken (Better Stack dedupliziert über sie): Einmalige Anlässe bekommen einen Zeitstempel im Schlüssel.
- Die Ausfallmeldung läuft im Anrufende-Pfad (`src/telephony/call-finish.js:125`, `:160`) und wird dort abgewartet: Die Frist von 5 Sekunden begrenzt, wie lange das Anrufende dadurch warten kann; ein Fehlschlag wird nur geloggt.
- Die Adresse ist das Geheimnis (Better Stack beschreibt keine zweite Authentifizierung): Sie steht nie in Log, Audit, Antwort oder Fehlertext, auch nicht gekürzt.
- Meldezeilen können von außen beeinflusste Zeichen enthalten (Fehlergründe des Anbieters): Der Text wird in der Länge begrenzt und als Datenfeld gesendet, nie als Teil der Adresse oder des Schlüssels.
- Zeitgesteuerte Anlässe (Erholung des Ausfalls, Kostenabgleich) haben außer dem Takt keinen äußeren Eingang: Der Test verkürzt den Takt wie `test/ausfall-server-wiring.test.js`; der Kostenabgleich hat daneben den Betreiber-Eingang `POST /api/billing/cost-truing/sweep`.
- Die Startprüfung ist heute eine Prüfung, keine Meldung: Sie schreibt Befunde ins Log und verweigert den Start (`src/boot-guard.js:305-350`), sie sendet nichts. Der siebte Anlass ist deshalb eine Verweigerung, keine Meldung an den Eingang (ohne Eingang gäbe es auch keinen).
- Weil der Start ohne `BETTERSTACK_ALERT_URL` verweigert wird, muss Antonio die Variable in Render setzen (Staging und Produktion, H13), bevor dieser Stand ausgeliefert wird; die Abnahme läuft zuerst auf Staging.
- Die Maske für Log-Geheimnisse erkennt nur Namen mit den Endungen `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PASS`, `PWD` (`src/log-maske.js:5`): `BETTERSTACK_ALERT_URL` wird sonst nicht maskiert. Entscheidung: die Maske lernt diesen Namen; ein Netzfehler darf die Adresse nicht in die Ausgabe bringen (S17).
- Staging und Produktion brauchen je einen eigenen Better-Stack-Eingang, weil `incident.id` keine Umgebung trägt und ein `resolved` aus Staging sonst einen Produktionsvorfall schließen würde: Bedingung zu H13 für Antonio, kein Umgebungs-Präfix im Schlüssel.
- Die Stripe-Meldungszeilen enthalten `tenant=<id>` (`src/billing/webhook.js:190`, `:268`) und gehen damit erstmals an einen Dritten. Entschieden (Antonio, 02.11.): die Mandanten-ID darf an Better Stack, unter der festen Bedingung eines Auftragsverarbeitungsvertrags mit Better Stack vor Produktion.
- Die Bootstrap-Nummer hängt heute an der Absender-Bindung `alert_sms_sender` (`src/store/zustand/nummern.js:121-126`, `:166-174`): Fällt die Bindung weg, muss der Halt gegen die Freigabe beim Anbieter erhalten bleiben (B4); das Design Doc entscheidet den Weg.
- Einmalige Anlässe haben keinen Marker und damit keine Wiederholung. Die Ausgabenwarnung setzt ihren Monatsmarker heute vor dem Senden (`src/store/state-ops.js:1623-1632`): Sie setzt ihn künftig erst nach der Zustellung (S15). Das Stripe-Ereignis bleibt ohne Wiederholung (hingenommen, steht im Stripe-Dashboard).
- Eine neue Variable verlangt nach der Regel in `steuerung/abhaengigkeiten.json` den Stand nach KFZ: B9 kommt nach KFZ, und der Wert gehört nach `src/konfiguration/` statt in `src/config.js`.

## Geänderte Dateien
- `src/telephony/alert-sms.js`
- `src/telephony/outage-report.js`
- `src/mail-boot-probe.js`
- `src/boot-guard.js`
- `src/boot.js`
- `src/telephony/outbound-gates.js`
- `src/billing/cost-truing.js`
- `src/billing/price-drift-watch.js`
- `src/brevo-mail.js`
- `src/log-maske.js`
- `src/store/state-ops.js`
- `src/store/begriffe-nummern-vergabe.js`
- `tools/bausteine.json`
- `eslint-suppressions.json`
- `src/config.js`
- `src/konfiguration/betterstack-alarm.js`
- `.env.example`
- `render.yaml`
- `test/alert-sms.test.js`
- `test/abrechnung/stripe-webhook.test.js`
- `test/cost-truing-observe.test.js`
- `test/mail-boot-probe.test.js`
- `test/ausfall-meldeweg.test.js`
- `test/ausfall-boot-guard.test.js`
- `test/gap-07-alert-channel-fatal.test.js`

## Altfunktionen
- Umbau: `src/telephony/outbound-gates.js:emitPlatformSpendWarning`
- Umbau: `src/store/state-ops.js:claimPlatformSpendWarning`
- Umbau: `src/telephony/alert-sms.js:onError`
- nicht berührt: `src/billing/cost-truing.js:makeCostTruing`, weil `alertDrift` und alle Aufrufer von `sendBootstrapAlertSms` unverändert bleiben und die Änderung in `alert-sms.js` und `closeCoverageBefunde` liegt.
- nicht berührt: `src/billing/webhook.js:applyStripeWebhook`, weil die Mandanten-ID in den Zeilen bleibt (entschieden) und die Funktion nur als Beleg steht.
- nicht berührt: `src/routes/voice.js:makeVoiceRoutes`, weil sie nur als Beleg für die Antwort vor der Verarbeitung steht.
- nicht berührt: `src/routes/voice.js:anonym ab Zeile 445`, weil sie nur als Beleg für die Antwort vor der Verarbeitung steht.
- nicht berührt: `src/telephony/call-termination.js:terminateAndBillCall`, weil sie nur als Beleg für die Abrechnung vor der Meldung steht.
- nicht berührt: `src/telephony/call-termination.js:anonym ab Zeile 14`, weil sie nur als Beleg für die Abrechnung vor der Meldung steht.
- nicht berührt: `src/telephony/outbound-gates.js:warningDetail`, weil sie nur als Beleg für den Inhalt der Warnzeile steht.
- nicht berührt: `src/telephony/outbound-gates.js:claimSpendWarning`, weil sie nur `claimPlatformSpendWarning` aufruft und die Änderung dort liegt.
- nicht berührt: `src/telephony/outbound-gates.js:run`, weil sie `emitPlatformSpendWarning` unverändert aufruft.
- nicht berührt: `src/telephony/outbound-gates.js:makeOutboundGates`, weil die Änderung in der verschachtelten Funktion `emitPlatformSpendWarning` liegt, die vorher lintfrei umgebaut wird.
- nicht berührt: `src/telephony/call-finish.js:finishCall`, weil die Ausfallmeldung dort über `reportFailedCall` läuft und die Änderung in `outage-report.js` liegt.
- nicht berührt: `src/boot-guard.js:guardedBoot`, weil die Änderung in den Befund-Funktionen für den Alarmweg liegt (`alertChannelFindings`, `kostenAlarmFindings`, `betreiberAlarmKanaele`), nicht im Start-Rahmen.
- nicht berührt: `src/telephony/alert-sms.js:sendFailSoftAlertSms`, weil die Funktion mit dem SMS-Weg entfällt (siehe Löschen) und die neue Funktion sie vollständig ersetzt.
- nicht berührt: `src/mail-boot-probe.js:probeMailBoot`, weil die Funktion mit der Datei entfällt (siehe Löschen).

## Löschen
- `src/mail-boot-probe.js:probeMailBoot`
- `src/telephony/alert-sms.js:sendFailSoftAlertSms`
- `src/telephony/alert-sms.js:platformAlertSender`
- `src/telephony/alert-sms.js:resolveBootstrapAlertSender`
- `src/telephony/outage-report.js:runAlertChannelSelfTest`
- `src/boot-guard.js:platformAlertSenderFindings`
- `src/brevo-mail.js:verifyBrevoAccount`

## Anforderungen

### Regel R1: Jeder Anlass, der heute eine Meldung sendet, erzeugt genau eine Meldung an den Better-Stack-Eingang und sonst nichts.

### Regel R2: Die Startprüfung verlangt den Eingang und kein SMS- oder Mail-Ziel mehr.

#### Szenario S7: Start ohne Eingang bei aktiver Ausfall-Erkennung
Gegeben `ELEVENLABS_OUTBOUND_ENABLED`=true, `OUTAGE_ALERT_WINDOW_MS`=3600000, `BETTERSTACK_ALERT_URL` leer und `PLATFORM_ALERT_SMS_TO` gesetzt
Wenn der Dienst startet
Dann endet der Prozess mit Exit-Code 1
Und die Ausgabe nennt "BETTERSTACK_ALERT_URL"

#### Szenario S8: Start ohne Eingang bei aktiver Ausgabenwarnung
Gegeben `PAYMENT_ENABLED`=true, `PLATFORM_SPEND_WARN_PERCENT`=80 und `BETTERSTACK_ALERT_URL` leer
Wenn der Dienst startet
Dann endet der Prozess mit Exit-Code 1
Und die Ausgabe nennt "BETTERSTACK_ALERT_URL"

#### Szenario S9: Start mit Eingang
Gegeben `BETTERSTACK_ALERT_URL` gesetzt und `PLATFORM_ALERT_SMS_TO` leer
Wenn der Dienst startet
Dann antwortet `GET /healthz` mit `200`
Und die Ausgabe enthält die Adresse nicht

#### Szenario S18: Start ohne Eingang bei aktiver Zahlung ohne Warnschwelle
Gegeben `PAYMENT_ENABLED`=true, `PLATFORM_SPEND_WARN_PERCENT`=0, `ELEVENLABS_OUTBOUND_ENABLED`=false und `BETTERSTACK_ALERT_URL` leer
Wenn der Dienst startet
Dann endet der Prozess mit Exit-Code 1
Und die Ausgabe nennt "BETTERSTACK_ALERT_URL"

#### Szenario S22: Start mit unverschlüsselter Adresse im Hosting
Gegeben `RENDER_EXTERNAL_URL` ist gesetzt, `PAYMENT_ENABLED`=true und `BETTERSTACK_ALERT_URL` ist "http://erfundenes-geheimnis-0001.example/hook"
Wenn der Dienst startet
Dann endet der Prozess mit Exit-Code 1
Und die Ausgabe nennt "BETTERSTACK_ALERT_URL" und enthält "erfundenes-geheimnis-0001" nicht

#### Szenario S23: Unverschlüsselte Adresse zählt auch ohne aktive Zahlung und Ausfall-Erkennung
Gegeben `RENDER_EXTERNAL_URL` ist gesetzt, `PAYMENT_ENABLED`=false, `ELEVENLABS_OUTBOUND_ENABLED`=false, `OUTAGE_ALERT_WINDOW_MS`=0 und `BETTERSTACK_ALERT_URL` ist "http://erfundenes-geheimnis-0002.example/hook"
Wenn der Dienst startet
Dann endet der Prozess mit Exit-Code 1
Und die Ausgabe nennt "BETTERSTACK_ALERT_URL" und enthält "erfundenes-geheimnis-0002" nicht

#### Szenario S24: Nicht lesbare Adresse im Hosting
Gegeben `RENDER_EXTERNAL_URL` ist gesetzt, `PAYMENT_ENABLED`=true und `BETTERSTACK_ALERT_URL` ist "https://erfundenes-geheimnis-0003.example:99999/hook"
Wenn der Dienst startet
Dann endet der Prozess mit Exit-Code 1
Und die Ausgabe nennt "BETTERSTACK_ALERT_URL" und enthält "erfundenes-geheimnis-0003" nicht

#### Szenario S25: Keine Heilungsmeldung an eine abgelehnte Adresse
Gegeben `RENDER_EXTERNAL_URL` ist gesetzt, der Speicher ist leer, `BOOTSTRAP_E164` ist gesetzt und `BETTERSTACK_ALERT_URL` zeigt als "http://…" auf die Attrappe
Wenn der Dienst startet
Dann endet der Prozess mit Exit-Code 1
Und die Attrappe erhält keine Anfrage

### Regel R3: Kehrt ein gemeldeter Ausfall zurück, schließt Hermes den Vorfall.

### Regel R4: Ein Fehlschlag des Eingangs stört keinen Anruf, und eine nicht zugestellte Meldung wird wiederholt.

## Bleibt unverändert

## Nicht-Ziele
- Nicht Teil dieser Änderung: der Herzschlag (B7), weil er einen eigenen Eingang und einen eigenen Takt hat.
- Nicht Teil dieser Änderung: Alarmregeln, Dashboard und Anleitungen in Better Stack (B12, B13), weil sie Konfiguration beim Anbieter sind, kein Hermes-Code.
- Nicht Teil dieser Änderung: eine zweite Zustellung per SMS oder Mail als Rückfall, weil die Entscheidung vom 31.10. beide Wege als Alarmweg abschafft.
- Nicht Teil dieser Änderung: die Mail für Kündigung und Login, weil sie keine Betriebsmeldung ist.
- Nicht Teil dieser Änderung: ein Umgebungs-Präfix im Schlüssel, weil jede Umgebung einen eigenen Eingang bekommt (Bedingung zu H13).
- Nicht Teil dieser Änderung: ein Probe-POST beim Start oder ein Selbsttest als Ersatz für den Kanal-Selbsttest, weil die Startprüfung nichts sendet; den Nachweis liefern die Probe auf Staging, der Herzschlag (B7) und die Regeln in Better Stack (B12).
- Nicht Teil dieser Änderung: eine Wiederholung für das Stripe-Ereignis, die Warnung zum TTS-Kontingent und die Meldung der Heilung, weil sie einmalig sind, Audit und Log sie festhalten und das Stripe-Ereignis im Stripe-Dashboard steht.
- Nicht Teil dieser Änderung: eine dauerhafte Entprellung der Tarif-Abweichung über Neustarts, weil sie heute wie die SMS nur im Speicher liegt; nach einem Neustart öffnet ein bestehender Befund einen neuen Vorfall (hingenommen).
- Nicht Teil dieser Änderung: die Schwellen, die Entprellung und die Erkennung der Ausfall-Eimer, weil nur das Ziel getauscht wird.

## Neue Begriffe
- `BETTERSTACK_ALERT_URL`: Adresse des Better-Stack-Eingangs; ein Geheimnis, leer verweigert den Start unter den Bedingungen aus S7 und S8.
- `incident.id`: Schlüssel eines Vorfalls im gesendeten JSON; bei Zustands-Anlässen der Marker-Code, bei einmaligen Anlässen Anlass, Zeitstempel und Kurz-Hash der Meldezeile.
- `incident.status`: "alert" öffnet, "resolved" schließt den Vorfall.

## Offene Fragen

### Vor dem Bau zu klären
keine

Bedingungen vor Produktion (Antonio, H13): (1) Auftragsverarbeitungsvertrag mit Better Stack; (2) auf Staging gesendet alert, resolved, alert unter einer ID ergibt zwei Vorfälle (ein `alert` nach `resolved` öffnet neu, `resolved` für eine unbekannte ID bleibt wirkungslos, Erfolg heißt 2xx); (3) Integrationsregeln in Better Stack eingerichtet (Alert ID aus `incident.id`, öffnen bei "alert", auflösen bei "resolved"); (4) Zugang zur Integration und zu den Render-Variablen auf den Betreiber beschränkt, Klärung ob die Adresse neu erzeugt werden kann; (5) je Umgebung ein eigener Eingang; (6) keine öffentliche Statusseite für die Integration, Weiterleitungen nur an den Betreiber. Entschieden (Betreuung, Freigabe): Meldezeile höchstens 1000 Zeichen; die Startbedingung zählt auch die Ausfall-Erkennung für eingehende ElevenLabs-Anrufe (`INBOUND_OUTAGE_ALERT_WINDOW_MS`); B9 baut nach KFZ.

Entschieden (Betreuung, Runde 2): Die Startprüfung ist eine Verweigerung mit Exit-Code 1 und sendet keinen siebten Aufruf an den Eingang. Die Fertig-Zeile von B9 im Bauplan („sieben Anlässe erzeugen genau eine Meldung“) wird berichtigt zu „sechs Anlässe erzeugen genau eine Meldung, die Startprüfung verweigert den Start“. Schließungen von Kosten- und Preis-Befunden senden ein `resolved` mit dem Marker-Code als Schlüssel (S13).

### Kann warten
- Soll die Meldezeile künftig auch den Mandanten nennen? Heute steht er nur in den Stripe-Zeilen (`tenant=<id>`), nicht in den übrigen.

## Premortem
| Nr. | Grund | Ausgang |
|---|---|---|
| 1 | Die Absender-Bindung `alert_sms_sender` entfällt; damit verliert die Bootstrap-Nummer den Halt aus `numberBusyReason`, und eine Kündigung oder Löschung des Bootstrap-Mandanten gäbe sie beim Anbieter frei. | Neues Szenario B4; Falle zur Bindung |
| 2 | Der Marker einer Rückkehr wird vor der Zustellung von `resolved` geschlossen; bei Fehlschlag bleibt der Vorfall offen und der nächste Ausfall wird in den alten Vorfall verschluckt. | Neues Szenario S14 |
| 3 | Einmalige Anlässe haben keine Wiederholung; die Ausgabenwarnung setzt den Monatsmarker vor dem Senden, ein einziger Fehlschlag verstummt sie für den Monat. | Neues Szenario S15 (Stripe: Nicht-Ziel, hingenommen) |
| 4 | Zwei abweichende Präfixe im selben Sweep teilen sich denselben Zeitstempel und damit denselben Schlüssel; Better Stack verschluckt den zweiten. | Neues Szenario S16 |
| 5 | Die Log-Maske kennt `BETTERSTACK_ALERT_URL` nicht; ein Netzfehler könnte die Adresse in die Ausgabe bringen. | Neues Szenario S17; `src/log-maske.js` in „Geänderte Dateien“ |
| 6 | Die Startprüfung verweigert nur bei aktiver Ausgabenwarnung oder Ausfall-Erkennung; mit `PAYMENT_ENABLED`=true und Warnschwelle 0 startet der Dienst ohne Eingang. | Neues Szenario S18 |
| 7 | Staging und Produktion am selben Eingang: ein `resolved` aus Staging schließt einen Produktionsvorfall. | Nicht-Ziel „Umgebungs-Präfix“; Bedingung zu H13 (eigener Eingang je Umgebung) |
| 8 | Ohne Selbsttest bleibt eine falsche Adresse unbemerkt (jeder `POST` mit 404). | Nicht-Ziel „Probe-POST oder Selbsttest“; hingenommen: Probe auf Staging, B7, B12 (Runde 1, Frage 8) |
| 9 | Die Eskalation einer hängenden Rufnummern-Freigabe läuft über `meldeBetreiberAlarm`, hat aber kein Szenario und könnte beim Umbau verstummen. | Neues Szenario S19 |
| 10 | Der Preis-Wächter öffnet und schließt Vorfälle ohne Szenario; ohne `resolved` geht die nächste Abweichung im offenen Vorfall unter. | Neues Szenario S20 |
| 11 | S10 verlangte „unter der Schwelle“, `beurteileAusfall` gibt aber erst bei null Fehlern und einem angenommenen Anruf frei (`src/telephony/outage-detection.js:67-70`). | S10 umgeschrieben |
| 12 | Nur S1 prüfte „keine SMS, keine Mail“; ein stehengebliebener SMS-Weg (etwa in `outbound-gates.js`) bliebe unbemerkt. | S2 bis S6 um „SMS-Ziel gesetzt, keine SMS, keine Mail“ ergänzt |
| 13 | Die Stripe-Zeilen enthalten `tenant=<id>` und gehen erstmals an Better Stack. | hingenommen (Antonio, 02.11.): die Mandanten-ID darf an Better Stack, feste Bedingung: Auftragsverarbeitungsvertrag vor Produktion |
| 14 | Die Entprellung der Tarif-Abweichung liegt nur im Speicher; nach jedem Neustart öffnet ein bestehender Befund einen neuen Vorfall. | hingenommen: wie heute bei der SMS; Nicht-Ziel „dauerhafte Entprellung“ |
