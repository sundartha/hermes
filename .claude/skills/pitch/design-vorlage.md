# P-<Nummer> <kurzer Titel>: Design Doc

Status: Entwurf
Pitch: plaene/P-<Nummer>-<kurzname>/pitch.md
Entscheidung: <ein Satz, was technisch entschieden wird>

## Zur Freigabe
1. <Entscheidung in einem Satz.> <Einbahnstraße | umkehrbar>. Empfehlung: <ein Satz Grund>.
2. Ungeprüfte Annahme: <Annahme>. Wenn sie nicht stimmt: <Folge>.
3. Vorschlag für den Pitch: <Szenario, Nicht-Ziel oder Rückfrage> (siehe letzter Abschnitt)
(oder: nur der gewählte Weg; keine Einbahnstraße, keine ungeprüfte Annahme, kein Vorschlag für den Pitch)

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| <Fakt über den heutigen Code oder einen Anbieter> | `<Datei>` oder <Link> | – |
| <Annahme> | ungeprüft; prüfen durch: <Weg> | <Folge> |

## Was die Wahl bestimmt
- S<Nr.> / B<Nr.>: <warum dieses Szenario zwischen den Wegen entscheidet>
- Randbedingung: <z. B. bestehende Grenze, Verhalten eines Anbieters>. Beleg: <…>
(oder: nur die Szenarien des Pitches; keine weitere Randbedingung, weil <Grund>)

## Lösung
<Überblick in wenigen Sätzen. Beteiligte Teile und Anbieter und wer wen aufruft, nur im Code gesehene Verbindungen. Ablauf eines typischen Falls in nummerierten Schritten. Daten, die neu entstehen oder sich ändern, in Worten.>

Zuordnung: S1 → <Teil>, S2 → <Teil>, B1 → <Teil>

### Werkzeugvertrag
Werkzeug `<name>` (neu | geändert)
- Beschreibung in der Werkzeugliste: "<Text, den der Agent des Kunden sieht>"
- Eingaben: <Name: Bedeutung, Pflicht oder optional>
- Antwort bei Erfolg: <Felder in Worten>
- Antworten bei Fehlern: <Fall: Ergebnis mit `isError` oder Protokollfehler>
- Wirkung: <liest nur | ändert | doppelt aufrufbar ohne doppelte Wirkung>
- Für heutige Nutzer ändert sich: <nichts | nur hinzugefügt: … | Bestehendes ändert sich: … (Einbahnstraße)>
(oder: kein Werkzeug neu oder geändert, und kein von außen sichtbares Verhalten bestehender Werkzeuge ändert sich; angesehen: `docs/mcp-vertrag.json`, <weitere Stellen>)

## Fehlerfälle
| Aufruf oder Ereignis | Fehler oder Zeitüberschreitung | doppelt oder andere Reihenfolge | Wiederholung: wo, womit | was der Aufrufer sieht |
|---|---|---|---|---|
| <Telnyx: …> | <…> | <…> | <…> | <…> |
(oder: keine, weil kein Aufruf nach außen und kein eingehendes Ereignis neu oder geändert ist; angesehen: <Stellen>)

## Verworfene Wege
- <Weg>: <was er gut kann>. Verworfen, weil <Grund mit Bezug auf „Was die Wahl bestimmt“>.
(oder: keine, weil <es keinen gleich tragfähigen Weg gibt; Beleg>)

## Nachteile
- <Nachteil der gewählten Lösung, auch für Betrieb, Wartung oder die Agenten der Kunden>
(oder: keine bekannt; angesehen wurden Betrieb, laufende Kosten, Wartung und die Agenten der Kunden)

## Übergang, Rückweg und Betrieb
- Für heutige Kunden und fremde Agenten: <was sie anders sehen> (oder: nichts, weil …)
- Daten: <was sich ändert; ob der alte Code sie lesen kann, solange beide laufen; ob eine Schemaänderung Tabellen sperrt, die laufende Anrufe brauchen> (oder: keine Datenänderung)
- Rückweg: <wie man abschaltet; ob ein Code-Rollback mit den neuen Daten funktioniert; was mit neuen Umgebungsvariablen beim Rollback passiert> (oder: Rollback über den Deploy-Weg, weil weder Daten noch Werkzeugvertrag sich ändern)
- Laufende Anrufe beim Ausliefern oder Zurückrollen: <was mit ihnen passiert> (oder: nicht berührt, weil …)
- Woran man im Betrieb sieht, dass es nicht funktioniert: <vorhandenes Signal> (oder: nichts Neues zu beobachten, weil …)
- Laufende Kosten: <was sich je Anruf oder je Monat ändert, mit Quelle> (oder: unverändert, weil …)

## Offene Fragen und Rückmeldungen an den Pitch
- <Frage?> Empfehlung: <Antwort>
- Vorgeschlagenes Szenario: <Name>
  Gegeben <Ausgangslage; hängt sie von einem Anbieter ab, etwa „Telnyx antwortet 30 Sekunden lang nicht“, steht dabei „(im Test nachgebildet)“>
  Wenn <genau ein Ereignis über einen echten Eingang>
  Dann <von außen sichtbares Ergebnis mit konkretem Wert>
- Vorgeschlagenes Nicht-Ziel: <was>, weil <warum>.
(oder: keine)
