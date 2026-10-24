# P-007 Fragerunden

## Runde 1
1. Wir bauen die Änderung, obwohl das Gesprächsgedächtnis heute nur in der Telnyx-Engine im Prompt landet (`src/claude.js:36` → `counterpartyMemoryFor` `:55-58` → `callMemorySection` `:208-213`) und der ElevenLabs-Outbound (`ELEVENLABS_OUTBOUND_ENABLED`, `render.yaml:53`) es gar nicht liest? Empfehlung: ja, weil der Fehler in diesem Pfad echt ist, der Pfad als Rückweg bestehen bleibt und P-007 vor allem den Durchlauf durch das System messen soll; das Gedächtnis in den ElevenLabs-Pfad zu bringen ist ein eigenes Vorhaben (Nicht-Ziel).
2. Der Eingang des Szenarios ist `place_call` mit einem `to`, zu dem es einen früheren Outbound-Anruf mit langem Ergebnis gibt (Telnyx-Engine, `allowCallMemory: true`), und das Dann ist die Anweisung, die Hermes dem Sprachmodell-Anbieter schickt: Sie enthält das Ergebnis bis zum letzten ganzen Wort und nie ein angeschnittenes Wort? Empfehlung: ja, weil die Anfrage an den Anbieter die Grenze ist, an der das abgeschnittene Wort nach außen geht, und was der Agent dann sagt, nicht deterministisch prüfbar ist.
3. Beide Kappungen werden an der Wortgrenze gekürzt: das Ergebnis (100 Zeichen, `src/call-memory.js:16`) und die ganze Zeile aus Ergebnis und Fakten (200 Zeichen, `:22`)? Empfehlung: ja, weil an der Grenze von 200 Zeichen genauso ein Fakt mitten im Wort abbrechen kann („Telefon 0151 23“) und beide Stellen dieselbe vorhandene Hilfe `clampAtWordBoundary` (`src/utils/text.js:1`) nutzen.
4. Ein einzelnes Wort ohne Leerzeichen bis zur Grenze (etwa eine lange URL) wird weiter hart abgeschnitten, so wie `clampAtWordBoundary` es heute tut? Empfehlung: ja, weil sonst die ganze Angabe wegfiele und das die Hilfe für alle Aufrufer ändern würde (Nicht-Ziel).
5. Ein Satzzeichen oder Trenner vor dem Schnitt (etwa „bestaetigt;“) bleibt stehen, es wird nichts nachgeputzt? Empfehlung: ja, weil das keinen falschen Wert erzeugt und die Änderung klein bleibt.
6. Design Doc: nein? Empfehlung: ja (nein), weil es mit der vorhandenen Hilfe nur einen ernsthaften Weg gibt, weder Werkzeugvertrag noch gespeicherte Daten berührt werden und ein Code-Rollback alles zurücknimmt; `design.md` bekommt nur „Ausgangslage und Annahmen“.

### Antworten Runde 1
1–6: wie empfohlen (Betreuung).

## Runde 2
1. Eine Angabe, die selbst Leerzeichen enthält, kann auch an der Wortgrenze zu einem falschen Wert werden: Beim Nachrechnen der Werte für S2 endete die Zeile heute mit „Durchwahl der Buchhaltung ist 0151“, weil die Grenze von 200 Zeichen genau hinter „0151“ vor „23456789“ fiel; die Wortgrenze ändert daran nichts. Das bleibt ein Nicht-Ziel (Kürzung an der Wortgrenze, nicht an der Grenze einer Angabe), und S2 bekommt Werte, bei denen der Schnitt heute mitten im Wort liegt? Empfehlung: ja, weil die Alternative (Fakten nur ganz oder gar nicht aufnehmen, und nur ein einzelner zu langer Fakt wird an der Wortgrenze gekürzt) eine zweite Regel mit eigenem Szenario und mehr Mutanten bringt; sie ist als eigenes Vorhaben besser aufgehoben als in dieser Mini-Phase.

### Antworten Runde 2
1: wie empfohlen (Betreuung): Nicht-Ziel, S2 mit Schnitt mitten im Wort; „Fakten ganz oder gar nicht“ notiert die Betreuung als Kandidat für eine nächste Mini-Phase.

## Runde 3 (Premortem)
1. PM2 (ein Wort, das genau auf dem 100. bzw. 200. Zeichen endet und dem ein Leerzeichen folgt, fällt durch `clampAtWordBoundary` ganz weg, obwohl es heute ganz im Prompt steht, etwa „Kundennummer 4711“ → „Kundennummer“) wird hingenommen und steht als Falle im Pitch? Empfehlung: ja, weil die Behebung entweder die gemeinsame Hilfe für 5 Aufrufstellen ändert (Nicht-Ziel) oder als eigene Prüfung des Zeichens hinter der Grenze ein zweiter Weg zur Wortgrenze wäre (Falle); der Fall tritt nur ein, wenn die Grenze genau auf ein Wortende fällt, und das Wort wird weggelassen statt verfälscht.
2. PM1 (die Ergebniskarte kürzt schon beim Speichern hart auf 200 Zeichen, `src/call-result.js:10-15`) wird Nicht-Ziel, und das Ergebnis heißt „jede Gedächtniszeile, die beim Bau des Gedächtnisses gekürzt wird“? Empfehlung: ja, weil die Behebung gespeicherte Daten und deren andere Leser (`get_call_result`, SMS) ändert, die das Design Doc ausschließt; als Kandidat für die nächste Mini-Phase eignet sie sich zusammen mit „Fakten ganz oder gar nicht“.
3. PM3 (eine an der Wortgrenze gekürzte Aussage kann vollständig aussehen und das Gegenteil sagen, etwa „… am Dienstag nicht“ → „… am Dienstag“) wird Nicht-Ziel? Empfehlung: ja, weil es nur mit einem Kürzungszeichen (Runde 1, Frage 5) oder „Fakten ganz oder gar nicht“ (Runde 2) zu verhindern wäre; ein Szenario könnte nur das Weglassen festschreiben, nicht den Schaden verhindern.

### Antworten Runde 3
1: ja (Betreuung): PM2 hingenommen, als Falle im Pitch.
2: ja (Betreuung): PM1 Nicht-Ziel, Kandidat für die nächste Mini-Phase.
3: nein (Betreuung): „Eine Kürzung darf nie wie eine vollständige Aussage aussehen, sonst nennt der Agent dem Angerufenen das Gegenteil.“ Korrektur der Antwort zu Runde 1, Frage 5: Jede gekürzte Angabe endet sichtbar mit „…“ innerhalb der 100/200 Zeichen, ungekürzte bleiben byte-gleich. Folge im Pitch: S1, S2 mit „…“; bisheriges B2 (Wort ohne Leerzeichen) wird S3, weil es jetzt „…“ bekommt; neues B2 (genau 100 Zeichen ohne „…“); PM3 Ausgang S1–S3. Kein zweiter Weg zur Wortgrenze nötig: das Gedächtnis ruft `clampAtWordBoundary` mit Grenze minus 1 auf und hängt „…“ an; ob gekürzt wird, entscheidet ein Längenvergleich mit der Grenze.

## Vorher-Rot
- S1: heute „… am Dienstag um 15:30 Uh“ (100 Zeichen, ohne „…“) statt „… am Dienstag um 15:30…“, weil `singleLine(entry?.outcome).slice(0, MEMORY_MAX_OUTCOME_CHARS)` hart nach 100 Zeichen schneidet, `src/call-memory.js:16`; nachgestellt mit `memoryLine` auf b45867a am 2026-10-24.
- S2: heute „… Lieferung kommt per Spedition Hans“ (200 Zeichen, ohne „…“) statt „… Lieferung kommt per Spedition…“, weil `parts.join(MEMORY_PART_SEPARATOR).slice(0, MEMORY_MAX_ENTRY_CHARS)` hart nach 200 Zeichen schneidet, `src/call-memory.js:22`; nachgestellt wie S1.
- S3: heute die ersten 100 Zeichen ohne „…“ statt der ersten 99 Zeichen und „…“, `src/call-memory.js:16`; nachgestellt wie S1. (In Runde 3 aus „Bleibt unverändert“ B2 hierher verschoben, weil die Korrektur zu Runde 1 Frage 5 das Dann geändert hat.)
- B1 und B2 treten heute schon ein (nachgestellt: „Reklamation 4711 aufgenommen; Reklamationsnummer 4711“; ein Ergebnis von genau 100 Zeichen bleibt ganz, `slice(0, 100)` lässt es unverändert) und stehen deshalb unter „Bleibt unverändert“.

## Freigabe
1–6 wie vorgelegt (Betreuung, 2026-10-24): PM1 bleibt Nicht-Ziel (Lücke für die nächste Mini-Phase); keine Angriffswege; Annahme zu „…“ und Werkzeugaufrufen hingenommen, kein convo-bench in P-007; Gegenprüfung ohne Befund; Planung freigegeben 800000 Token; Issue #1929.

Nachtrag 2026-10-24 14:17 (Betreuung): Abschnitt „## Altfunktionen“ mit 10 Einträgen „nicht berührt“ nachgetragen, weil `plane` ihn seit 30da3ae verlangt; die Änderung trifft nur `memoryLine` (laut karte ohne Befunde), alle 10 Funktionen stehen in Design Doc und Sicherheitsprüfung nur als Beleg für den Weg.
