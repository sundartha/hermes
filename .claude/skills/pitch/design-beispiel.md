# P-001 Eigene Nummer bestätigen: Design Doc

Status: fertig
Pitch: plaene/P-001-eigene-nummer/pitch.md
Entscheidung: Der Bestätigungsstatus liegt an der hinterlegten Nummer des Kunden, und die Freischaltliste bleibt bestehen, bis die heute freigeschalteten Konten ihre Nummer bestätigt haben.

## Zur Freigabe
1. Status, Prüfwert des Codes, Ablaufzeit und Fehlversuche liegen in neuen Spalten an der hinterlegten Nummer, nicht in einer eigenen Tabelle. Umkehrbar. Empfehlung: ja, weil jeder Kunde genau eine eigene Nummer hat (Nicht-Ziel im Pitch).
2. Rückfrage an den Pitch: Die Freischaltliste fällt nicht mit dieser Änderung weg, sondern mit einer eigenen späteren Änderung, wenn die freigeschalteten Konten bestätigt haben. Umkehrbar. Empfehlung: ja, weil diese Kunden sonst am Tag der Auslieferung beim Anruf an ihre eigene Nummer wieder den Hinweis für Fremde hören.
3. Offene Frage: Wie viele Konten stehen heute in `HINWEIS_AUSNAHMEN`? Empfehlung: Der Nutzer sieht in der Render-Umgebung nach; die Antwort entscheidet, wann die spätere Änderung kommt.
4. Ungeprüfte Annahme: SMS von unserer Absendernummer kommen bei deutschen Mobilfunkanbietern an. Wenn nicht: Kunden können ihre Nummer nicht bestätigen (im Pitch als PM1 hingenommen).
5. Vorschläge für den Pitch: Szenario S8 „SMS kann nicht gesendet werden“, Szenario B2 „Freigeschaltetes Konto ruft seine unbestätigte Nummer an“ und eine Ergänzung von S5.

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| Die eigene Nummer liegt in der Spalte `private_number` der Kundentabelle. | `src/db/schema.ts` | – |
| Ob der Hinweis entfällt, entscheidet beim Anruf nur `istAusgenommen()`, heute anhand der Umgebungsvariable `HINWEIS_AUSNAHMEN`. | `src/anrufe/hinweis.ts` | – |
| Hermes verschickt SMS bereits über Telnyx. | `src/telnyx/sms.ts` | – |
| Telnyx-Webhooks können gleichzeitig, doppelt, verspätet oder in anderer Reihenfolge kommen. | https://developers.telnyx.com/docs/development/api-fundamentals/webhooks/receiving-webhooks | – |
| Render führt Migrationen als Pre-Deploy-Befehl aus; der alte Stand läuft dabei weiter. | `render.yaml`; https://render.com/docs/deploys | – |
| SMS von unserer Absendernummer werden in Deutschland zugestellt. | ungeprüft; prüfen durch: Zustellstatus der ersten 50 Codes | Kunden können nicht bestätigen |

## Was die Wahl bestimmt
- S2 und S3: Der Code gilt 10 Minuten; der Zeitpunkt muss an der Nummer gespeichert sein.
- S6: Die Fehlversuche zählen je Nummer.
- S4, S5 und B1: Ob der Hinweis entfällt, darf beim Anruf nur an einer Stelle entschieden werden.
- Randbedingung: Heute sind einzelne Konten über `HINWEIS_AUSNAHMEN` freigeschaltet. Beleg: `src/anrufe/hinweis.ts`; wie viele, ist ungeprüft (Zur Freigabe, Punkt 3).

## Lösung
Die Kundentabelle bekommt vier neue Spalten an der eigenen Nummer: Status, Prüfwert des Codes, Ablaufzeit und Zahl der Fehlversuche.

Ablauf:
1. Hinterlegt der Kunde eine Nummer, setzt die Route den Status auf `unbestaetigt`, erzeugt einen Code, speichert nur seinen Prüfwert und die Ablaufzeit und schickt die SMS über das bestehende Telnyx-Modul.
2. Die neue Route zum Bestätigen vergleicht den Code. Bei Erfolg setzt sie den Status auf `bestaetigt`; sonst zählt sie den Fehlversuch.
3. `istAusgenommen()` gibt beim Anruf genau dann „ja“, wenn die angerufene Nummer die eigene Nummer des Kunden ist und diese entweder bestätigt ist oder das Konto noch in `HINWEIS_AUSNAHMEN` steht.

Nur diese Funktion entscheidet über den Hinweis; sie bleibt die einzige Stelle.

Zuordnung: S1, S7 → Route zum Hinterlegen; S2, S3, S6 → Route zum Bestätigen; S4, S5, B1 → `istAusgenommen()`

### Werkzeugvertrag
Werkzeug `place_call` (Verhalten geändert, Vertrag unverändert)
- Für heutige Nutzer ändert sich: Bei Anrufen an die bestätigte eigene Nummer ist der erste Satz im Transkript aus `get_call_result` die KI-Kennzeichnung statt des Hinweises für Fremde (S4). Eingaben, Felder, Beschreibung und Fehlertexte bleiben gleich. Angesehen: `docs/mcp-vertrag.json`.

## Fehlerfälle
| Aufruf oder Ereignis | Fehler oder Zeitüberschreitung | doppelt oder andere Reihenfolge | Wiederholung: wo, womit | was der Aufrufer sieht |
|---|---|---|---|---|
| Telnyx: SMS senden | Fehler: Status bleibt `unbestaetigt`, kein gültiger Code. Zeitüberschreitung: Der Code bleibt gültig, weil die SMS trotzdem angekommen sein kann. | Doppeltes Hinterlegen erzeugt einen neuen Code; der alte wird ungültig. | keine automatische Wiederholung, weil sonst eine zweite SMS auf unsere Kosten geht | bei Fehler `sms_nicht_gesendet` (vorgeschlagenes S8), bei Zeitüberschreitung Status `unbestaetigt` wie bei Erfolg |
| Telnyx: Zustellstatus der SMS | wird nur protokolliert | doppelt oder vertauscht ohne Folge, weil er nichts auslöst | – | nichts |
| Route zum Bestätigen | Datenbankfehler: Status unverändert | Zweimal derselbe richtige Code: bleibt `bestaetigt`. | – | Status in der Antwort |

## Verworfene Wege
- Eigene Tabelle für Bestätigungen: hält den Verlauf aller Versuche fest. Verworfen, weil jeder Kunde genau eine Nummer hat und `istAusgenommen()` bei jedem Anruf eine zusätzliche Abfrage bräuchte.
- Freischaltliste sofort entfernen, wie in der groben Lösung des Pitches: einfacher, eine Stelle weniger. Verworfen, weil die freigeschalteten Kunden ab der Auslieferung den Hinweis für Fremde hören, bis sie bestätigt haben.

## Nachteile
- Jeder Code kostet eine SMS; Kosten je SMS laut Telnyx-Preisliste ungeprüft.
- Bis die spätere Änderung die Liste entfernt, gibt es zwei Gründe für die Ausnahme.

## Übergang, Rückweg und Betrieb
- Für heutige Kunden und fremde Agenten: Kunden in der Freischaltliste merken nichts; alle anderen hören beim Anruf an ihre eigene Nummer den Hinweis weiter, bis sie bestätigt haben.
- Daten: vier neue Spalten, alle leer erlaubt. Der alte Code liest sie nicht und läuft weiter. Das Hinzufügen leerer Spalten schreibt die Tabelle nicht um, braucht aber kurz die stärkste Sperre; läuft dabei eine lange Abfrage auf der Kundentabelle, warten auch neue Anrufe dahinter. Deshalb läuft die Migration mit kurzer Wartegrenze für die Sperre und wird bei Zeitüberschreitung wiederholt (PostgreSQL-Doku, ALTER TABLE und Explicit Locking).
- Rückweg: Ein Code-Rollback funktioniert, weil der alte Code die neuen Spalten ignoriert. Die Änderung führt keine neue Umgebungsvariable ein; ein Rollback übernimmt die Variablen des älteren Deploys, und dort war `HINWEIS_AUSNAHMEN` schon gesetzt.
- Laufende Anrufe beim Ausliefern oder Zurückrollen: nicht berührt, weil die Ausnahme beim Start eines Anrufs geprüft wird.
- Woran man im Betrieb sieht, dass es nicht funktioniert: Zustellstatus `delivery_failed` im Log und Codes, die nie bestätigt werden.
- Laufende Kosten: eine SMS je angefordertem Code.

## Offene Fragen und Rückmeldungen an den Pitch
- Rückfrage an den Pitch: Die grobe Lösung sagt „Die Freischaltliste fällt weg“. Empfehlung: Sie fällt mit einer eigenen späteren Änderung weg (Zur Freigabe, Punkt 2).
- Vorgeschlagenes Szenario S8: SMS kann nicht gesendet werden
  Gegeben ein angemeldeter Kunde ohne hinterlegte eigene Nummer, und Telnyx lehnt das Senden ab (im Test nachgebildet)
  Wenn er über `POST /api/self-service/private-number` die Nummer "+4915100000001" hinterlegt
  Dann enthält die Antwort den Fehler `sms_nicht_gesendet` und den Status `unbestaetigt`
- Vorgeschlagenes Szenario B2: Freigeschaltetes Konto ruft seine unbestätigte Nummer an
  Gegeben ein Konto in der Freischaltliste mit der unbestätigten eigenen Nummer "+4915100000005"
  Wenn sein Agent mit `place_call` die Nummer "+4915100000005" anruft
  Dann ist der erste Satz im Transkript aus `get_call_result` die KI-Kennzeichnung aus `LOCALES.de`
- Vorgeschlagene Ergänzung von S5: „Gegeben die eigene Nummer … eines Kunden, dessen Konto nicht in der Freischaltliste steht, hat den Status `unbestaetigt`“.
