# P-2643 Alarmziel tauschen: Sicherheitsprüfung

Status: freigegeben
Freigabe Betreuung 02.11. 19:4x: reine Nachführung veralteter Zeilenangaben nach SOZ, Inhalt unverändert
Grundlage: pitch.md, design.md, Code-Stand ebeecfe

## Zur Freigabe
1. Die schwersten Angriffswege: T2 (wer die Adresse kennt, öffnet und schließt Betriebsvorfälle, auch echte), T1 (die Adresse gelangt in die Ausgabe des Dienstes), T4 (Meldezeilen sind bei Better Stack für mehr Menschen sichtbar als heute die SMS). Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden:
   1. T2: übertragen an Antonio (Betrieb, H13) vorgeschlagen, weil Better Stack außer der Adresse keine zweite Prüfung beschreibt und Hermes nichts dagegen tun kann. Angenommen (Betreuung, Freigabe): übertragen als Bedingung vor Produktion unter H13. Empfehlung: übertragen; Zugang zur Integration und zu den Render-Variablen auf den Betreiber beschränken und klären, ob und wie die Adresse neu erzeugt werden kann (Offene Fragen).
   2. T4: übertragen an Antonio (Einrichtung in Better Stack, B12/H13) vorgeschlagen, weil Sichtbarkeit und Weiterleitung der Vorfälle in Better Stack eingestellt werden, nicht in Hermes. Angenommen (Betreuung, Freigabe): übertragen als Bedingung vor Produktion unter H13. Empfehlung: übertragen; die Integration hängt an keiner öffentlichen Statusseite, Weiterleitungen gehen nur an den Betreiber.
   3. T5: übertragen an Antonio (H13) vorgeschlagen, wie schon im Pitch (Falle „Staging und Produktion“, Premortem 7). Angenommen (Betreuung, Freigabe): übertragen als Bedingung vor Produktion unter H13 (je Umgebung ein eigener Eingang). Empfehlung: übertragen.
   4. Neue Grenze zu T3: Im Hosting startet Hermes nur mit einer `BETTERSTACK_ALERT_URL`, die mit `https://` beginnt und lesbar ist; die Meldung nennt den Namen, nie den Wert. Neues Szenario zu T3 in den Pitch. Angenommen (Betreuung, Freigabe): S22 bis S25. Empfehlung: ja.
   5. Neues Szenario zu T1 in den Pitch (nicht lesbare Adresse, Ausgabe ohne Wert und Pfad), weil S17 vermutlich auch ohne Schutz grün wäre (Offene Fragen). Angenommen (Betreuung, Freigabe): S24; S17 bleibt als Prüfung „kein Absturz bei Netzfehler“. Empfehlung: ja.

## 1. Woran arbeiten wir
### Umfang
Alle Betriebsmeldungen gehen künftig als `POST` mit JSON an eine Adresse aus `BETTERSTACK_ALERT_URL`, statt als SMS über Telnyx und Mail über Brevo (pitch.md, Grobe Lösung; design.md, Lösung). Neu ist damit ein ausgehender Datenfluss an einen neuen Anbieter und ein neues Geheimnis, das selbst eine Adresse ist. Zustands-Anlässe schließen ihre Vorfälle mit `resolved` (design.md, Lösung, `schliesseBefund`). Die Startprüfung verlangt die Variable statt SMS- oder Mail-Ziel (pitch.md, R2). Die Absender-Bindung `alert_sms_sender` wird durch eine Halte-Bindung ohne Mandant ersetzt (design.md, Bootstrap-Halt). Kein Werkzeug, keine Route und kein Webhook ist neu (design.md, Werkzeugvertrag).
### Beteiligte
- Kunde: angemeldet, löst über `place_call` Anrufe aus und kann damit die Ausgabenwarnung und Ausfallzählungen beeinflussen (`src/telephony/outbound-gates.js:333-357`, `src/telephony/outage-detection.js:24-42`); sieht keine Betriebsmeldungen.
- Agent des Kunden: ruft `place_call` mit dem Token des Kunden; Rechte wie der Kunde, sonst nichts Neues.
- Angerufener: kommt in keiner Meldezeile vor (siehe LINDDUN).
- Anrufer bei eingehenden Anrufen: unangemeldet; seine Anrufe zählen für die Ausfall-Klasse eingehender ElevenLabs-Anrufe (`src/telephony/outage-report.js:149-150`).
- Telnyx: liefert Fehlergründe, aus denen der Eimer-Schlüssel entsteht (`src/telephony/failure-reason.js:6-16`, `:81-96`).
- Stripe: liefert signierte Ereignisse, deren Typ in der Meldezeile steht (`src/routes/stripe-webhook.js:23-47`, `src/billing/webhook.js:357`).
- Better Stack (neu): nimmt Meldungen an, öffnet und schließt Vorfälle nach Regeln, die in der Integration eingerichtet sind (design.md, Ausgangslage, Zeilen zu Better Stack).
- Betreiber (Antonio): setzt die Variable in Render, richtet die Integration ein, sieht die Vorfälle.
- Wer die Ausgabe des Dienstes liest (Render-Log und alles, wohin es kopiert wird): sieht Logzeilen, aber nicht zwingend die Umgebungsvariablen (angenommen).
### Eingänge und Grenzen
- Hermes nach Better Stack (neu, ausgehend, `POST` an die Adresse aus der Konfiguration): Grenze zu einem neuen Anbieter, Schutz allein durch die Geheimhaltung der Adresse. Beleg: design.md, Lösung; https://betterstack.com/docs/uptime/incoming-webhooks/ beschreibt keine weitere Prüfung. Angriffswege: T2, T3, T4, T5
- Dienstausgabe (stdout, stderr) nach Render-Log (geändert, weil ein neues Geheimnis im Prozess liegt): Beleg: `src/process-guards.js:7-27`, `src/log-maske.js:5-21`. Angriffswege: T1
- Render-Konfiguration nach Startprüfung (geändert): Beleg: `src/config.js:1096-1109`, `src/boot-guard.js:305-349`. Angriffswege: T3, T5
- `place_call` nach Ausgabenwarnung (geändert): Beleg: `src/telephony/outbound-gates.js:324-357`. Angriffswege: keiner, weil die Meldung fire-and-forget bleibt (pitch.md, B3), Schlüssel und Zeile nur Monat und Summe tragen (`src/telephony/outbound-gates.js:35`) und der Kunde von der Meldung nichts zurückbekommt (design.md, Werkzeugvertrag).
- Telnyx `/voice/status` nach Anrufende nach Ausfallmeldung (geändert): Beleg: `src/routes/voice.js:445-446`, `src/telephony/call-finish.js:146-162`. Angriffswege: keiner, weil der Eimer-Schlüssel nur aus festen Wörtern und Zahlen entsteht (`src/telephony/failure-reason.js:71-72`, `:81-96`; freier Text nur unter dem Basiswort `failed`, das keinen Ausfall auslöst, `:13` und `src/telephony/outage-report.js:145-147`), Abrechnung und Freigabe der Reserve vor dem Warten auf die Meldung laufen (`src/telephony/call-finish.js:150-156`) und die Wartezeit auf 5 s begrenzt ist (pitch.md, Fallen).
- Stripe `/webhooks/stripe` nach Meldung (geändert): Beleg: `src/routes/stripe-webhook.js:23-48`. Angriffswege: keiner neu, weil die Signatur vor allem anderen geprüft wird (`:23-32`) und die Meldung die Antwort an Stripe nicht aufhält (`:43-48`, design.md); der Inhalt der Zeile siehe T4.
- Betreiber-Route `POST /api/billing/cost-truing/sweep` (Wirkung geändert): Beleg: `docs/sicherheitsgrenzen.md`, Angriffsfläche (SG-03). Angriffswege: keiner, weil nur der Betreiber sie erreicht und B6 das Hängen begrenzt.
- Eingehende Anrufer nach Ausfallmeldung der eingehenden Klasse: Beleg: `src/telephony/outage-report.js:149-150`. Angriffswege: keiner neu, weil die Klasse am Brückenzustand hängt, nicht an der Nummer des Anrufers, und die Meldung künftig keine SMS mehr kostet.
- Takte (Erholung, Hold-Eskalation, Preis-Wächter): kein äußerer Eingang. Angriffswege: keiner, weil nur Zustand im Speicher und Antworten von Stripe (signiert abgefragt) sie bewegen (`src/billing/price-drift-watch.js:52-72`).
- Halte-Bindung der Bootstrap-Nummer (Speicher nach Freigabe beim Anbieter, geändert): Beleg: `src/store/zustand/nummern.js:121-126`, `:166-174`, `src/db/migrations/0001_ausgang.sql:834-835`. Angriffswege: keiner, weil `numberBusyReason` jede Bindung ohne Mandant gegen jeden hält, der Datenbank-Riegel den Zweck nicht auswertet und B4 im Pitch den Halt prüft.
### Werte
- Die Adresse des Eingangs: wer sie kennt, spricht als Hermes zu Better Stack.
- Die Wahrnehmung des Betreibers: Ausfall-, Kosten- und Preisvorfälle sind sein einziger Weg, Missbrauch und Ausfälle rechtzeitig zu sehen; nach der Änderung gibt es keinen zweiten Kanal (pitch.md, Nicht-Ziele).
- Inhalt der Meldezeilen: Mandanten-IDs in Stripe-Zeilen (`src/billing/webhook.js:315`, `:357`), Plattform-Ausgaben (`src/telephony/outbound-gates.js:35`), Tarife und Preise (`src/billing/cost-calibration.js:107-115`, `src/billing/price-drift-watch.js:27-29`).
### Wem wir was glauben
- Better Stack: wir glauben, dass nur 2xx Annahme heißt, ein `alert` nach `resolved` unter derselben ID einen neuen Vorfall öffnet und `resolved` für eine unbekannte ID nichts bewirkt (design.md, Ausgangslage, drei ungeprüfte Annahmen); wenn nicht, verstummen Meldungen oder Hermes wiederholt endlos. Neu hier: wir glauben, dass Vorfälle nur der Betreiber sieht (angenommen); wenn nicht, siehe T4.
- Telnyx und Stripe: keine neue Vertrauensannahme; Fehlergründe und Ereignistypen landen schon heute in SMS und Mail.
- Kunde und Agent des Kunden: keine neue Vertrauensannahme, weil sie den Inhalt der Meldungen nicht bestimmen (siehe Eingänge).
### Nicht-Ziele
- Diese Änderung schützt nicht gegen Better Stack selbst, weil der Anbieter die Meldungen lesen muss; dafür steht der Auftragsverarbeitungsvertrag im Pitch (Fallen).
- Diese Änderung schützt nicht gegen einen Ausfall von Better Stack, weil der Pitch keinen zweiten Kanal will (pitch.md, Nicht-Ziele).
- Diese Änderung schützt nicht gegen jemanden mit Zugriff auf die Render-Umgebung, weil dort ohnehin alle Schlüssel liegen.

## 2. Angriffswege
### T1: Wer die Ausgabe des Dienstes liest, erfährt die Adresse des Eingangs
Wer: jemand mit Lesezugriff auf das Render-Log oder auf kopierte Logauszüge, ohne Zugriff auf die Umgebungsvariablen (angenommen)
Weg: Ein Fehler beim Senden an den Eingang trägt die Adresse in seinem Text, wenn sie nicht lesbar ist (angenommen, Verhalten von `fetch` in Node; Offene Fragen). Wird er mit `err.message` oder als nicht gefangene Ablehnung mit Stack geschrieben (`src/process-guards.js:7-14`), steht die Adresse in der Ausgabe. Die Log-Maske kennt heute nur Namen auf KEY, TOKEN, SECRET, PASSWORD, PASS, PWD (`src/log-maske.js:5`), `BETTERSTACK_ALERT_URL` fiele durch.
Schaden: Die Adresse ist der einzige Schutz des Eingangs; wer sie hat, hat T2.
Ausgang: verhindern, weil die Adresse sonst bei jedem Fehlschlag in die Ausgabe kommen kann und der Pitch das ausschließt (Fallen).
Szenario: S11 und S17 im Pitch, dazu:
Gegeben der Dienst läuft außerhalb des Hostings, `BETTERSTACK_ALERT_URL` ist auf einen nicht lesbaren Wert ohne Schema mit dem erfundenen Pfadteil "erfundenes-geheimnis-0001" gesetzt, und ein erster `place_call` ist mit dem Fehlergrund `not-placed:invite-403` beendet
Wenn ein zweiter `place_call` mit demselben Fehlergrund beendet wird
Dann antwortet `place_call` ohne Fehler, und die Ausgabe des Dienstes enthält weder den Wert noch "erfundenes-geheimnis-0001"

### T2: Wer die Adresse kennt, öffnet und schließt Betriebsvorfälle wie Hermes
Wer: jeder, der die Adresse erfahren hat (über T1, über den Zugang zu Better Stack oder Render, über eine Kopie außerhalb dieser Systeme)
Weg: Better Stack beschreibt für den Eingang keine Prüfung außer der Adresse (design.md, Ausgangslage, Zeile „Better Stack beschreibt nicht“; https://betterstack.com/docs/uptime/incoming-webhooks/). Die Schlüssel der Zustands-Anlässe sind feste Codes und stehen im öffentlichen Repo (`src/telephony/outage-report.js:227`, `src/billing/price-drift-watch.js:16`, pitch.md, S1). Neu ist `resolved` (design.md, Lösung): Ein Vorfall kann damit auch von außen geschlossen werden.
Schaden: Ein echter Ausfall oder Kosten-Befund erscheint dem Betreiber als gelöst, bis Hermes nach der Entprellung erneut meldet (Stunden, `src/config.js:518-521`); oder der Betreiber bekommt Fehlalarme und gewöhnt sich ab, sie ernst zu nehmen. Hermes selbst merkt nichts, sein Marker bleibt offen (design.md, Nachteile, dritter Punkt).
Ausgang: übertragen an Antonio (Betrieb, H13) (Vorschlag), weil Hermes dem Anbieter keine zweite Prüfung abverlangen kann. Offen bleibt: Die Adresse ist der einzige Schutz des Eingangs.

### T4: Meldezeilen sind bei Better Stack für mehr Menschen sichtbar als heute die SMS an den Betreiber
Wer: jeder, dem Better Stack einen Vorfall zeigt oder weiterleitet: Mitglieder des Better-Stack-Teams, Empfänger von Weiterleitungen, Besucher einer Statusseite, falls die Integration daran hängt (angenommen)
Weg: Heute gehen die Zeilen an eine Nummer und eine Mail-Adresse des Betreibers (`src/telephony/alert-sms.js:32-40`, `src/telephony/outage-report.js:20-30`). Künftig liegen sie bei Better Stack (design.md, Datenfluss für die Sicherheitsprüfung); wer sie dort sieht, bestimmt die Einrichtung der Integration, nicht Hermes.
Schaden: Mandanten-IDs zusammen mit Zahlungsereignissen wie Rückbuchungen (`src/billing/webhook.js:357`), die Plattform-Ausgaben eines Monats (`src/telephony/outbound-gates.js:35`) und Preise und Tarife werden für Menschen außerhalb des Betriebs lesbar.
Ausgang: übertragen an Antonio (Einrichtung in Better Stack, B12/H13) (Vorschlag), weil die Sichtbarkeit in Better Stack eingestellt wird. Offen bleibt: Hermes kann nicht prüfen, wer die Vorfälle sieht.

### T5: Ein gemeinsamer Eingang für Staging und Produktion lässt Staging Produktionsvorfälle schließen
Wer: kein Angreifer; eine Fehleinrichtung bei der Vergabe der Variable
Weg: siehe pitch.md, Fallen („Staging und Produktion brauchen je einen eigenen Better-Stack-Eingang“) und Premortem 7
Schaden: Ein echter Produktionsvorfall erscheint als gelöst; die Folgen wie bei T2.
Ausgang: übertragen an Antonio (H13) (Vorschlag), weil der Pitch das als Bedingung zur Einrichtung festhält und Hermes die Umgebung des Eingangs nicht erkennen kann.

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1, H6, H7, H8 | trifft nicht zu, weil die Änderung keinen Anruf auslöst, weder Gespräch noch Telefon-Agent berührt und die Offenlegung nicht anfasst; sie entfernt SMS-Wege (pitch.md, Löschen) |
| H2, H3 | trifft nicht zu, weil die Gates von `place_call` unverändert bleiben (design.md, Werkzeugvertrag), SMS als Alarmweg wegfällt (`src/telephony/alert-sms.js:19-40`, `src/telephony/outbound-gates.js:350`) und Aufrufe an Better Stack durch Reservierung, Entprellung und die bestehenden Auslöser begrenzt sind (`src/telephony/outage-report.js:88-103`, `src/billing/cost-truing.js:301-306`); Better Stack berechnet keine Vorfälle einzeln (design.md, Ausgangslage). Die Ausgabenwarnung warnt nach einem Neustart im selben Monat nicht noch einmal (design.md, Zur Freigabe 2); die harte Plattformgrenze bleibt davon unberührt |
| H4 | trifft nicht zu, weil kein Kunde Meldungen, Schlüssel oder Marker sieht; die Marker sind global ohne Mandant (`src/db/migrations/0001_ausgang.sql:848-849`) |
| H5 | trifft nicht zu, weil keine Tokens angenommen oder weitergereicht werden |
| H9 | trifft nicht zu, weil die eingehende Ausfall-Klasse am Brückenzustand hängt, nicht an der Nummer (`src/telephony/outage-report.js:149-150`), und nichts zurückgerufen wird |
| H10 | trifft nicht zu, weil kein eingehender Webhook neu ist; Stripe wird wie bisher zuerst geprüft (`src/routes/stripe-webhook.js:23-32`), doppelte Ereignisse nach einem Neustart erzeugen einen zweiten Vorfall wie heute eine zweite SMS, ohne Wirkung auf Geld (design.md, Fehlerfälle) |
| H11 | trifft zu → T3; die Adresse kommt aus der Betreiber-Konfiguration, nie vom Kunden, und Text oder Schlüssel werden nie Teil der Adresse (pitch.md, Fallen) |
| H12 | trifft nicht zu, weil weder Stimme noch Worte eines Angerufenen verarbeitet werden und keine Meldezeile Daten eines Angerufenen trägt (siehe LINDDUN) |
| H13 | trifft zu → T1, T2, T3, T5 |
| H14 | trifft zu → T2, T4 (neuer Anbieter Better Stack); kein neues Paket (design.md, Lösung, `AbortSignal.timeout` mit eingebautem `fetch`, angenommen) |
| H15 | siehe „Wem wir was glauben“; für Telnyx und Stripe nichts Neues |
| STRIDE an der Grenze Hermes nach Better Stack | Spoofing → T2 (fremder spricht als Hermes), T3 (fremdes Ziel bei unverschlüsselter Adresse); Tampering → T3, der Inhalt selbst kommt aus festen Codes und Zahlen (siehe Eingänge); Information Disclosure → T1, T4; Repudiation ohne Weg, weil jeder Versuch mit Anlass, Schlüssel und Status geloggt und im Audit steht (design.md, Lösung); Denial of Service ohne neuen Weg, weil die Frist von 5 s jedes Warten begrenzt (B6) und ein Ausfall von Better Stack ein Nicht-Ziel ist; Elevation of Privilege ohne Weg, weil Hermes von der Antwort nur den Status auswertet (design.md, Lösung) |
| STRIDE an der Startprüfung | Tampering und Spoofing → T3, T5; übrige ohne Weg, weil nur der Betreiber die Konfiguration setzt |
| STRIDE an der Dienstausgabe | Information Disclosure → T1; übrige ohne Weg, weil sich an Schreibweg und Empfängern der Ausgabe nichts ändert |
| LINDDUN für die angerufene Person | trifft nicht zu, weil keine Meldezeile Nummer, Name oder Gesprächsinhalt eines Angerufenen trägt: Ausfallzeilen nur Codes und Zählungen (`src/telephony/outage-detection.js:80-87`), Hold-Zeilen Zählungen und interne Nummern-IDs (`src/telephony/outage-report.js:226-240`), Tarifzeilen Präfixe aus der Konfiguration und Zählungen (`src/billing/cost-calibration.js:107-115`, `:260-267`), Stripe-Zeilen Ereignistyp und Mandanten-ID (`src/billing/webhook.js:315`, `:357`). Die Mandanten-ID betrifft den Kunden, nicht den Angerufenen; dafür steht der Vorbehalt zum Auftragsverarbeitungsvertrag im Pitch |

## 4. Offene Fragen
- Angenommen: Ein Netzfehler von `fetch` an einen Port ohne Listener nennt Host und Port, aber nicht den Pfad; dann ist S17 auch ohne Maske und ohne Logregel grün. Ändert: Szenario zu T1. Prüfen durch: S17 einmal gegen eine Fassung laufen lassen, die `err.message` schreibt und die Maske nicht kennt.
- Angenommen: Eine nicht lesbare Adresse lässt `fetch` mit einem Fehler ablehnen, der die Adresse im Text trägt. Ändert: Szenario zu T1. Prüfen durch: das neue Szenario zu T1 ohne Schutz laufen lassen; bleibt es grün, braucht es einen anderen Weg in die Ausgabe.
- Angenommen: Better Stack zeigt Vorfälle der Integration nur dem Team und nicht auf einer Statusseite. Ändert: T4. Prüfen durch: Einstellungen der Integration und der Statusseiten bei der Einrichtung (H13, B12).
- Unbekannt: Lässt sich die Adresse des Eingangs neu erzeugen, ohne die Integration neu anzulegen? Ändert: T2. Prüfen durch: Oberfläche von Better Stack oder Anfrage an den Anbieter (design.md nennt die Kontaktadresse).

## 5. Vorschlag für docs/sicherheitsgrenzen.md
- Neue Grenze (ausgehend): Betriebsmeldungen an Better Stack. Die Adresse ist ein Geheimnis, kommt nur aus der Konfiguration, ist im Hosting nur mit https zulässig (T3), steht nie in Ausgabe, Audit oder Antwort (T1) und wird nur aus `src/telephony/alert-sms.js` angesprochen; von der Antwort wertet Hermes nur den Status aus.
- Ergänzung zu SG-13: Die Log-Maske kennt `BETTERSTACK_ALERT_URL` mit vollem Wert und Pfad.
- Ergänzung zu SG-14: Neben der Aussteller-Adresse ist auch `BETTERSTACK_ALERT_URL` im Hosting nur per https zulässig.
- Neue Vertrauensannahme: Vorfälle in Better Stack sieht nur der Betreiber (T4).
Die Angriffsfläche ändert sich nicht, weil keine Route, kein Webhook und kein Werkzeug neu ist.

## 6. Gegenprüfung
| Nr. | Art | Bezug | Befund mit Beleg | Vorschlag |
|---|---|---|---|---|
| 1 | Schutz umgangen (bedingt) | T3, Grenze „nur https im Hosting“ | Die Prüfung läuft in `assertBootGates` (`src/boot.js:331`), nach `await healBootstrapStore(...)` (`src/boot.js:722-726`); die Heilung sendet fire-and-forget über `sendBootstrapAlertSms` (`src/boot.js:639-646`). Ein `POST` an eine `http://`-Adresse wäre gestartet, bevor Exit 1 greift; heute geht nur deshalb kein Byte hinaus, weil zwischen `:722` und `:334` kein I/O liegt. | Adresse vor der Heilung prüfen oder Heilungsmeldung nach `assertBootGates` senden; neues Szenario S25 im Pitch |
| 2 | Szenario prüft nicht | T3 („lesbar“), T1 im Hosting | Ein Wert mit `https://`, aber ungültigem Port besteht eine reine Präfix-Prüfung und lässt `fetch` mit „Failed to parse URL from <Eingabe>“ scheitern (Node 22, `package.json:68-69`). | Neues Szenario S24 im Pitch |
| 3 | Szenario prüft nicht | T3 (Bedingung) | `alertChannelFindings` ist eine Kette bedingter Zweige (`src/boot-guard.js:305-349`); eine https-Prüfung im selben bedingten Zweig ließe Zahlung aus und Ausfall-Erkennung aus mit `http://` starten, obwohl TTS (`src/server.js:199`), Heilung (`src/boot.js:639`), Hold-Eskalation und eingehende Ausfall-Klasse (`src/config.js:119`) senden. | Neues Szenario S23 im Pitch |
| 4 | Szenario prüft nicht | T1 (S17) | Bei einem Port ohne Listener nennt `fetch` in Node 22 nur Host und Port, nicht den Pfad; S17 wäre auch ohne Maske grün. | S17 bleibt als Prüfung „kein Absturz bei Netzfehler“; als Beleg zu T1 trägt S24 (Nutzer entscheidet über Streichen oder Umschreiben von S17) |
