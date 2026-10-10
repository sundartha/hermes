# P-001 Eigene Nummer bestätigen

Status: fertig
Design Doc: ja, weil offen ist, wo der Bestätigungsstatus liegt und wie die Freischaltliste wegfällt, ohne dass heute freigeschaltete Kunden plötzlich den Hinweis für Fremde hören.

## Problem
Eine Malermeisterin lässt Hermes tagsüber Termine mit ihren Kunden vereinbaren und sich abends auf ihrem eigenen Handy anrufen, um die Ergebnisse zu hören. Jeder dieser Anrufe beginnt mit dem langen Hinweis, der für fremde Angerufene gedacht ist, weil Hermes nicht weiß, ob die hinterlegte Nummer wirklich ihr gehört. Die Ausnahme vom Hinweis ist heute nur für einzeln freigeschaltete Konten an, denn jeder angemeldete Kunde kann eine fremde Nummer als seine eigene eintragen.

## Ergebnis
Nach dieser Änderung kann jeder Kunde seine eigene Nummer mit einem Code bestätigen, und Anrufe von Hermes an diese bestätigte Nummer beginnen mit der KI-Kennzeichnung statt mit dem Hinweis für Fremde.

## Grobe Lösung
Trägt ein Kunde seine eigene Nummer ein, schickt Hermes eine SMS mit einem sechsstelligen Code an diese Nummer. Gibt der Kunde den Code innerhalb von 10 Minuten ein, gilt die Nummer als bestätigt. Erst dann entfällt bei Anrufen an diese Nummer der Hinweis für Fremde. Trägt der Kunde eine andere Nummer ein, ist sie wieder unbestätigt. Die Freischaltliste für einzelne Konten fällt weg.

## Fallen
- Heute freigeschaltete Konten würden mit dem Wegfall der Liste sofort den Hinweis für Fremde hören: Wie der Übergang läuft, entscheidet das Design Doc.

## Anforderungen

### Regel R1: Eine eigene Nummer gilt erst als bestätigt, wenn der Kunde den Code innerhalb von 10 Minuten richtig eingibt.

#### Szenario S1: Code wird verschickt
Gegeben ein angemeldeter Kunde ohne hinterlegte eigene Nummer
Wenn er über `POST /api/self-service/private-number` die Nummer "+4915100000001" hinterlegt
Dann erhält "+4915100000001" innerhalb von 30 Sekunden eine SMS mit einem sechsstelligen Code
Und die Antwort enthält den Status `unbestaetigt`

#### Szenario S2: Richtiger Code bestätigt die Nummer
Gegeben ein Kunde hat "+4915100000001" vor 5 Minuten hinterlegt und den Code "482913" erhalten
Wenn er über `POST /api/self-service/private-number/confirm` den Code "482913" sendet
Dann enthält die Antwort den Status `bestaetigt`

#### Szenario S3: Abgelaufener Code
Gegeben ein Kunde hat "+4915100000001" vor 11 Minuten hinterlegt und den Code "482913" erhalten
Wenn er über `POST /api/self-service/private-number/confirm` den Code "482913" sendet
Dann enthält die Antwort den Fehler `code_abgelaufen`
Und die Antwort enthält den Status `unbestaetigt`

#### Szenario S6: Zu viele falsche Codes
Gegeben ein Kunde hat für "+4915100000001" 5 falsche Codes gesendet
Wenn er über `POST /api/self-service/private-number/confirm` den richtigen Code "482913" sendet
Dann enthält die Antwort den Fehler `zu_viele_versuche`
Und die Antwort enthält den Status `unbestaetigt`

#### Szenario S7: Neue Nummer ist wieder unbestätigt
Gegeben die eigene Nummer "+4915100000001" eines Kunden hat den Status `bestaetigt`
Wenn er über `POST /api/self-service/private-number` die Nummer "+4915100000003" hinterlegt
Dann enthält die Antwort den Status `unbestaetigt`

### Regel R2: Nur Anrufe an eine bestätigte eigene Nummer beginnen ohne den Hinweis für Fremde.

#### Szenario S4: Anruf an die bestätigte eigene Nummer
Gegeben die eigene Nummer "+4915100000001" eines Kunden hat den Status `bestaetigt`
Wenn sein Agent mit `place_call` die Nummer "+4915100000001" anruft
Dann ist der erste Satz im Transkript aus `get_call_result` die KI-Kennzeichnung aus `LOCALES.de`

#### Szenario S5: Anruf an eine unbestätigte eigene Nummer
Gegeben die eigene Nummer "+4915100000001" eines Kunden hat den Status `unbestaetigt`
Wenn sein Agent mit `place_call` die Nummer "+4915100000001" anruft
Dann ist der erste Satz im Transkript aus `get_call_result` der Text aus `LOCALES.de.disclosure`

## Bleibt unverändert

### Szenario B1: Anruf an eine fremde Nummer
Gegeben ein Kunde mit der bestätigten eigenen Nummer "+4915100000001"
Wenn sein Agent mit `place_call` die Nummer "+4930000000002" anruft
Dann ist der erste Satz im Transkript aus `get_call_result` der Text aus `LOCALES.de.disclosure`

## Nicht-Ziele
- Nicht Teil dieser Änderung: Bestätigung über einen Anruf statt einer SMS, weil Hermes SMS schon über Telnyx verschickt und ein Anruf pro Bestätigung mehr kostet.
- Nicht Teil dieser Änderung: eine zweite eigene Nummer pro Kunde, weil heute jeder Kunde genau eine eigene Nummer hinterlegt.

## Neue Begriffe
- `POST /api/self-service/private-number/confirm`: nimmt den Code für die eigene Nummer entgegen.
- `unbestaetigt`, `bestaetigt`: Status der eigenen Nummer.
- `code_abgelaufen`: Fehler, wenn der Code älter als 10 Minuten ist.
- `zu_viele_versuche`: Fehler nach 5 falschen Codes für dieselbe Nummer.

## Offene Fragen

### Vor dem Bau zu klären
keine

### Kann warten
- Soll der Kunde nach einer Sperre wegen zu vieler Versuche einen neuen Code anfordern können?

## Premortem
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil manche Mobilfunkanbieter SMS von unbekannten Absendern aussortieren, kommt der Code bei einem Teil der Kunden nicht an, und diese Kunden können ihre Nummer gar nicht bestätigen, obwohl sie ihnen gehört. | hingenommen: Telnyx meldet den Zustellstatus; über eine Bestätigung per Anruf entscheiden wir, wenn die Zahlen es zeigen. |
| PM2 | Weil ein sechsstelliger Code ohne Grenze durchprobiert werden kann, errät jemand den Code für eine fremde Nummer, und Hermes ruft einen Fremden ohne den Hinweis an. | S6 |
| PM3 | Weil eine alte Bestätigung weiter gelten könnte, nachdem der Kunde in Hermes eine neue Nummer eingetragen hat, bekommt der Inhaber der neuen Nummer Anrufe ohne den Hinweis. | S7 |
| PM4 | Weil ein Mobilfunkanbieter eine bestätigte Nummer neu vergibt, ohne dass der Kunde sie in Hermes ändert, bekommt der neue Inhaber Anrufe ohne den Hinweis. | hingenommen: Hermes hat keine Quelle für neu vergebene Nummern; der Kunde kann seine Nummer jederzeit ändern. |
