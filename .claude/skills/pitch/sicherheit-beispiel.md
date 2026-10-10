# P-001 Eigene Nummer bestätigen: Sicherheitsprüfung

Status: fertig
Grundlage: pitch.md, design.md, Code-Stand 4f2c9e1

## Zur Freigabe
1. Die schwersten Angriffswege: T1 (Anruf ohne Hinweis an einen Fremden), T2 (SMS auf unsere Kosten an fremde Nummern). Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden:
   1. T3: hinnehmen vorgeschlagen, weil Hermes nicht erfährt, wenn ein Mobilfunkanbieter eine Nummer neu vergibt (PM4 im Pitch). Empfehlung: hinnehmen.
   2. G1: Fehlversuche zählen je Kunde über 24 Stunden statt je Nummer (zweites Szenario zu T1). Empfehlung: ja.
   3. Neue Grenze: höchstens 3 Codes je Kunde in 60 Minuten (Szenario zu T2). Empfehlung: ja.

## 1. Woran arbeiten wir
### Umfang
Zwei Routen zum Hinterlegen und Bestätigen der eigenen Nummer, ein SMS-Versand über Telnyx und die Entscheidung über den Hinweis für Fremde bei `place_call` (design.md, Lösung).
### Beteiligte
- Kunde: angemeldet, kann eine beliebige Nummer hinterlegen und Codes senden.
- Agent des Kunden: ruft `place_call` mit dem Token des Kunden auf.
- Inhaber der hinterlegten Nummer: bekommt die SMS, ist nicht unbedingt der Kunde.
- Angerufener: hört den Hinweis oder nicht.
- Telnyx: verschickt die SMS und meldet den Zustellstatus.
### Eingänge und Grenzen
- `POST /api/self-service/private-number`: von außen nach Hermes, angemeldet. Beleg: `src/routes/selfservice.ts`. Angriffswege: T2
- `POST /api/self-service/private-number/confirm`: neu, von außen nach Hermes, angemeldet. Beleg: design.md, Lösung. Angriffswege: T1
- Zustellstatus von Telnyx: von Telnyx nach Hermes, signiert. Beleg: `src/telnyx/webhooks.ts`. Angriffswege: keiner, weil der Zustellstatus nur protokolliert wird (design.md, Fehlerfälle)
### Werte
- Der Hinweis für Fremde: Er schützt Angerufene, die nicht wissen, wer anruft.
- SMS-Guthaben: Jede SMS kostet Geld.
- Die eigene Nummer des Kunden: personenbezogen.
### Wem wir was glauben
- Telnyx: Eine SMS an eine Nummer erreicht deren heutigen Inhaber; wenn nicht, bestätigt jemand eine fremde Nummer.
### Nicht-Ziele
keine

## 2. Angriffswege
### T1: Ein angemeldeter Kunde errät den Code für eine fremde Nummer und lässt sie ohne Hinweis anrufen
Wer: angemeldeter Kunde
Weg: hinterlegt eine fremde Nummer, sendet geratene sechsstellige Codes an die Route zum Bestätigen (design.md, Lösung, Schritt 2), ruft nach Erfolg mit `place_call` an
Schaden: Ein Fremder wird ohne den Hinweis angerufen.
Ausgang: verhindern, weil die Grenze für Fehlversuche das Raten praktisch ausschließt
Szenario: S6 im Pitch, dazu nach der Gegenprüfung (G1):
Gegeben ein angemeldeter Kunde hat in den letzten 24 Stunden 5 falsche Codes gesendet, für verschiedene oder neu hinterlegte Nummern
Wenn er über `POST /api/self-service/private-number/confirm` den richtigen Code für "+4915100000006" sendet
Dann enthält die Antwort den Fehler `zu_viele_versuche` und den Status `unbestaetigt`

### T2: Ein Kunde lässt Hermes viele SMS an fremde Nummern schicken
Wer: angemeldeter Kunde, auch mit einem neuen Konto
Weg: hinterlegt nacheinander viele Nummern; jedes Hinterlegen löst eine SMS aus (design.md, Lösung, Schritt 1)
Schaden: SMS-Kosten für uns und unerwünschte SMS für die Inhaber
Ausgang: verhindern, weil die neue Route sonst je Hinterlegen eine SMS ohne Grenze je Kunde auslöst
Szenario:
Gegeben ein angemeldeter Kunde hat in den letzten 60 Minuten 3 Codes angefordert
Wenn er über `POST /api/self-service/private-number` die Nummer "+4915100000004" hinterlegt
Dann enthält die Antwort den Fehler `zu_viele_codes`, und "+4915100000004" erhält keine SMS

### T3: Der neue Inhaber einer neu vergebenen Nummer wird ohne Hinweis angerufen
Wer: kein Angreifer; ein Mobilfunkanbieter vergibt eine bestätigte Nummer neu
Weg: siehe PM4 im Pitch
Schaden: Ein Fremder wird ohne den Hinweis angerufen.
Ausgang: hinnehmen (Vorschlag), weil Hermes keine Quelle für neu vergebene Nummern hat und der Kunde seine Nummer selbst ändern kann

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1 | trifft zu → T1, T3 |
| H2, H3 | trifft zu → T2 |
| H4 | trifft nicht zu, weil Code und Status nur in der Zeile des angemeldeten Kunden liegen (design.md, Lösung) |
| H5 bis H7, H9, H11, H14 | trifft nicht zu, weil die Änderung weder Tokens, Gesprächsinhalte, eingehende Anrufe, ausgehende Webhooks noch neue Pakete berührt |
| H8 | trifft zu → T1; die KI-Kennzeichnung bleibt im ersten Satz (S4), entfallen darf nur der Hinweis für Fremde. Punkt für die rechtliche Prüfung: Reicht die Kennzeichnung allein bei Anrufen an die eigene Nummer? |
| H10 | trifft nicht zu, weil der Zustellstatus nur protokolliert wird und nichts auslöst (design.md, Fehlerfälle) |
| H12 | trifft nicht zu, weil keine Stimme und keine Worte verarbeitet werden; die Nummer des Kunden war schon gespeichert |
| H13 | trifft nicht zu, weil der bestehende Telnyx-Schlüssel genutzt wird |
| H15 | siehe „Wem wir was glauben“ |
| STRIDE an der Route zum Bestätigen | Elevation of Privilege → T1; Spoofing, Tampering, Repudiation, Information Disclosure und Denial of Service ohne konkreten Weg, weil die Route nur den Status des angemeldeten Kunden ändert, den Code nicht zurückgibt und keine SMS auslöst |
| LINDDUN für die angerufene Person | trifft zu → T2 (unerwünschte SMS an den Inhaber einer fremden Nummer) |

## 4. Offene Fragen
- Angenommen: Code und SMS-Text werden nirgends geloggt. Ändert: T1. Prüfen durch: in `src/routes/selfservice.ts` und `src/telnyx/sms.ts` nachsehen, was geloggt wird.

## 5. Vorschlag für docs/sicherheitsgrenzen.md
Neuer Eingang `POST /api/self-service/private-number/confirm`: angemeldet, ändert nur den Status der eigenen Nummer.

## 6. Gegenprüfung
| Nr. | Art | Bezug | Befund mit Beleg | Übernommen als |
|---|---|---|---|---|
| G1 | Schutz umgangen | T1 | Die 5 Fehlversuche zählen je Nummer. Hinterlegt der Kunde dieselbe Nummer neu, bekommt er einen neuen Code und neue Versuche (S7; design.md, Lösung, Schritt 1). | zweites Szenario zu T1; Zur Freigabe, Punkt 3.2 |
| G2 | widerlegt | – | Vermutung, die Route zum Bestätigen sei ohne Anmeldung erreichbar: widerlegt, weil `src/routes/selfservice.ts` die Anmeldung vor allen Routen dieser Gruppe prüft. | nicht übernommen |
