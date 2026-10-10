# P-<Nummer> <kurzer Titel>: Sicherheitsprüfung

Status: Entwurf
Grundlage: pitch.md, design.md (oder: kein Design Doc), Code-Stand <Commit>

## Zur Freigabe
1. Die schwersten Angriffswege, höchstens drei: T<n>, T<n>. Entspricht das deiner Einschätzung?
   (oder: keine, siehe Angriffswege)
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden:
   1. T<n>: <weglassen | hinnehmen | übertragen> vorgeschlagen, weil <…>. Empfehlung: <…>
   2. <G<n> aus der Gegenprüfung oder ein neuer Wert, etwa eine Grenze>: <Vorschlag>. Empfehlung: <…>
   (oder: nichts zu entscheiden, weil alle Bedrohungen „verhindern“ haben und die Gegenprüfung nichts Strittiges ergab)

## 1. Woran arbeiten wir
### Umfang
<Was die Änderung an Eingängen, Daten und Anrufen berührt, in wenigen Sätzen, mit Belegen.>
### Beteiligte
- <Beteiligter>: <Position und Rechte>
### Eingänge und Grenzen
- <Eingang>: <welche Grenze er überquert>. Beleg: `<Datei>` oder <Abschnitt> (oder: angenommen). Angriffswege: T<n> (oder: keiner, weil …)
(oder: keine neue Grenze; angesehen: <bestehende Grenzen und Datenfluss>)
### Werte
- <Wert>: <warum er schützenswert ist>
### Wem wir was glauben
- <Anbieter, Kunde oder Agent des Kunden>: wir glauben, dass <…>; wenn nicht, dann <…>
(oder: keine neue Vertrauensannahme, weil …)
### Nicht-Ziele
- Diese Änderung schützt nicht gegen <…>, weil <…>.
(oder: keine)

## 2. Angriffswege
### T1: <ein Satz: wer über welchen Eingang was erreicht>
Wer: <Position, nicht Motiv>
Weg: <Schritte, je mit Beleg>
Schaden: <konkret, für wen, in Worten>
Ausgang: <verhindern | weglassen (Vorschlag) | hinnehmen (Vorschlag) | übertragen an <wen> (Vorschlag)>, weil <…>
Szenario (nur bei „verhindern“; prüft schon ein Szenario des Pitches genau das, genügt „S<n> im Pitch“):
Gegeben <Ausgangslage>
Wenn <genau ein Ereignis über einen echten Eingang>
Dann <von außen sichtbares Ergebnis, das ohne den Schutz nicht eintreten würde>

(oder: keine Angriffswege gefunden, weil <…>)

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1 bis H15 | trifft zu → T<n> / trifft nicht zu, weil <…> (mehrere Punkte mit gemeinsamem Grund in einer Zeile) |
| STRIDE an <neuer oder geänderter Grenze> | <Kategorien mit konkretem Weg → T<n>; übrige in einem Satz mit Grund> |
| LINDDUN für die angerufene Person | trifft zu → T<n> / trifft nicht zu, weil <…> |

## 4. Offene Fragen
- <Annahme>. Ändert: T<n>. Prüfen durch: <…>
(oder: keine)

## 5. Vorschlag für docs/sicherheitsgrenzen.md
<neue Grenze, neuer Eingang oder neue Vertrauensannahme>
(oder: keiner, weil keine neue Grenze)

## 6. Gegenprüfung
| Nr. | Art | Bezug | Befund mit Beleg | Übernommen als |
|---|---|---|---|---|
| G1 | <Schutz umgangen / Szenario prüft nicht / widerlegt / neuer Weg> | T<n> | <…> | <neues Szenario zu T<n> / T<n> neu / Vorschlag zur Freigabe> |
(oder: nichts gefunden, weil <Begründung des Angreifer-Agenten>)
