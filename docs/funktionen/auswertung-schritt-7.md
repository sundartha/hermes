# Auswertung Schritt 7 (Issue #3412)

Quelle: Issue-Verlauf von #3410 (S7.5, ElevenLabs-Port) und seine PRs #5254, #5269, #5280. Nichts hier ist über diese Quellen hinaus ergänzt.

## Testanruf

Beleg: [Kommentar von Hermes-Produkt vom 18.11. 10:14 Uhr in #3412](https://github.com/sundartha/hermes/issues/3412#issuecomment-6974188618). call_id: call_mwlwn6zqbsli. Weg: Staging-Werkzeug place_call, Ziel ist Antonios eigene freigegebene Nummer (Ja vom 17.11.). Ergebnis wie gemeldet: Der Anruf wurde aufgebaut und beendet, Status completed. Die Zusammenfassung des Systems lautet: Der Assistent begrüßte und nannte sich als KI-Assistent, wollte die Verbindung prüfen, das Gespräch endete abrupt. objective_achieved: unklar, es gab keine bestätigte Antwort der Gegenseite. Der Anruf lief technisch durch die typisierten Wege bis zum Gespräch, ist aber nicht als erfolgreich zu werten, nur als belegt. Das Kriterium „Testanruf erfolgreich, Beleg im Issue“ bleibt deshalb offen. Getrennt davon bekannt: die doppelte Ansage am Anrufanfang (Kette 5321).

Staging stand seit 18.11. 07:39 UTC auf master (617f8625) und enthält die ElevenLabs-Schnittstellen aus den PRs #5254, #5269 und #5280.

## Was im Durchstich getragen hat

- Der Schnitt in Häppchen: PR #5254 (Konto-Abfragen über die Registry, gemergt 18.11. 04:27 UTC), PR #5269 (Outbound-Port, gemergt 05:02 UTC) und PR #5280 (Restimporte über Ports, Regel auf alle Adapter-Dateien, gemergt 07:31 UTC) liefen nacheinander durch die Kette bis in die Merge-Queue.
- Verhalten gleich: Der Diff von PR #5269 verdrahtet nur Importe neu (drei Funktionen über `elevenlabsOutbound()` statt direkt aus `outbound.js`); die Kette ließ den Code in beiden Haltefällen unverändert.
- Die Rückläufe wurden an der Ursache bewertet statt blind nachgebessert: Zweimal war der Diff nicht schuld, und die Kette hielt an, nannte die Ursache in einem Satz und startete nur die roten Jobs neu.
- Die Lesungen des Prüfers auf den Köpfen von PR #5269 (e21c7e7) und PR #5280 (e86daa8) kamen ohne MUSS-Befund zurück.

## Was nicht getragen hat

- Ort: `test/anrufe/webhook-zustellung-nachlauf-zweifach.test.js` (Zeile 302 bei PR #5269, Zeilen 333 und 366 bei PR #5280), 20-Sekunden-Zeitgrenze unter CI-Last. Folge: roter Job „Tests 5/12“ bzw. „Tests 9/12“ ohne Ursache im Diff, je ein Halt und ein Neustart des Jobs. Folge-Issues: #5255, #5247, #4886 (offen), #5292 (geschlossen).
- Ort: Rotprobe am PR #5280, Testdateien, die auf master schon grün sind, weil das Verhalten dort gilt (`src/telephony/call-finish.js:49/7`, `src/boot.js:289/2`). Folge: zwei Rückläufe, weil der Abschnitt „## Überlebende Mutanten“ im PR-Text fehlte oder erst nach dem Lauf kam. Folge-Issue: #5324.
- Ort: Abnahme von #3412 selbst, der Testanruf. Folge: Der Bau-Agent kann ihn nicht auslösen (Kosten, echte Nummer); die Kette hielt am 18.11. 07:38 UTC, bis der Plan-Nachtrag den Weg über Hermes-Produkt festlegte. Folge-Issue: keins nötig, der Weg steht im Plan-Nachtrag von #3412.

## Warteliste

Die Warteliste der noch nicht typisierten Stellen mit ihren Gründen steht in `WARTELISTE` in `test/anrufe/typisierung-warteliste.test.js`. Sie wird dort geführt und hier nicht abgeschrieben.
