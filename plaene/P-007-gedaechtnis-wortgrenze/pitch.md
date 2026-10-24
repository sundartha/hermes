# P-007 Gesprächsgedächtnis an der Wortgrenze kürzen

Status: freigegeben
Planung freigegeben: 1600000 Token
Issue: 1929
Design Doc: nein, weil es mit der vorhandenen Hilfe `clampAtWordBoundary` nur einen ernsthaften Weg gibt, weder Werkzeugvertrag noch gespeicherte Daten berührt werden und ein Code-Rollback alles zurücknimmt.

## Absicht
Wenn Hermes bei einem Outbound-Anruf frühere Anrufe an dieselbe Nummer als Gedächtnis in die Anweisung an das Sprachmodell schreibt, soll eine gekürzte Angabe nie mit einem angeschnittenen Wort enden und nie wie eine vollständige Aussage aussehen, damit das Modell dem Angerufenen keinen verstümmelten Namen, keine halbe Uhrzeit und nicht das Gegenteil des Ergebnisses als Tatsache nennt. Nicht gewollt ist, die Grenzen von 100, 200 und 600 Zeichen oder die Zahl von 3 Anrufen zu ändern, die gemeinsame Hilfe `clampAtWordBoundary` für ihre anderen Aufrufer zu ändern, eine neue Kürzungshilfe zu bauen oder bestehende Tests umzuschreiben. Im Zweifel gilt: jede Kürzung endet sichtbar mit „…“ innerhalb der Grenze, und alles, was unter die Grenze passt, steht byte-gleich wie bisher im Prompt.

## Problem
Ein Kunde lässt Hermes (Telnyx-Engine, `allowCallMemory` an) eine Nummer zum zweiten Mal anrufen. Das Ergebnis des ersten Anrufs war „Rueckruf vereinbart, Frau Weber hat den Termin fuer die Lieferung bestaetigt am Dienstag um 15:30 Uhr“ (101 Zeichen). Im Gedächtnis-Block der Anweisung an das Sprachmodell steht davon heute „… am Dienstag um 15:30 Uh“, weil hart nach 100 Zeichen abgeschnitten wird. Bei der ganzen Zeile aus Ergebnis und Fakten (200 Zeichen) wird aus „Spedition Hansen“ ebenso „Spedition Hans“, ein anderer, plausibler Name. Dass gekürzt wurde, sieht das Modell in keinem der beiden Fälle.

## Ergebnis
Nach dieser Änderung endet jede Angabe, die beim Bau des Gedächtnisses für das Sprachmodell gekürzt wird, an einem ganzen Wort und danach mit „…“, und sie bleibt innerhalb ihrer Grenze: aus „… um 15:30 Uhr“ wird bei 100 Zeichen „… um 15:30…“, aus „… Spedition Hansen“ wird bei 200 Zeichen „… Spedition…“; Angaben, die unter ihre Grenze passen, bleiben byte-gleich und ohne „…“.

## Grobe Lösung
Der Angerufene bemerkt nur, dass der Agent keine halben Wörter und keine abgebrochenen Aussagen mehr aus früheren Anrufen als vollständig nennt. Das Ergebnis eines früheren Anrufs wird wie bisher auf eine Zeile gefaltet und auf höchstens 100 Zeichen gebracht, die ganze Zeile aus Ergebnis und Fakten auf höchstens 200 Zeichen. Ist eine Angabe länger als ihre Grenze, wird sie mit der vorhandenen Hilfe für die Kürzung an der Wortgrenze auf ein Zeichen weniger als die Grenze gekürzt und bekommt „…“ (ein Zeichen) angehängt, sodass sie mit dem Zeichen genau in die Grenze passt. Ein Wort ohne Leerzeichen bis zur Grenze wird wie bisher hart gekürzt und bekommt ebenfalls „…“. Passt eine Angabe, bleibt sie, wie sie ist.

## Fallen
- Die Hilfe `clampAtWordBoundary` sucht nur nach dem Leerzeichen `" "`, nicht nach Tabs oder Zeilenumbrüchen: Die Zeile wird wie heute zuerst auf ein Leerzeichen je Lücke gefaltet und erst danach gekürzt; die Reihenfolge Falten, dann Kürzen bleibt.
- Die Hilfe wird auch von der Rückfrage an den Auftraggeber, dem Denk-Signal, der Eröffnung und der Recherche benutzt (5 Aufrufstellen in 4 Dateien): Sie bleibt unverändert; keine neue Kürzungshilfe neben ihr, kein zweiter Weg zur Wortgrenze. Das Gedächtnis ruft sie mit der Grenze minus 1 auf und hängt „…“ an.
- Ob gekürzt wird, entscheidet allein die Länge der Angabe gegenüber ihrer Grenze (länger als 100 bzw. 200 Zeichen), nicht ein Vergleich mit dem Ergebnis der Hilfe: Eine Angabe von genau 100 bzw. 200 Zeichen passt und bekommt kein „…“; würde man die Hilfe mit der Grenze minus 1 aufrufen und am geänderten Text erkennen, ob gekürzt wurde, bekäme gerade sie fälschlich ein „…“.
- Das Zeichen ist genau „…“ (U+2026, ein Zeichen), nicht drei Punkte, damit eine gekürzte Angabe mit ihm genau 100 bzw. 200 Zeichen lang ist und die Summe von 600 Zeichen hält.
- Wird das Ergebnis bei 100 Zeichen gekürzt und danach die ganze Zeile bei 200, bekommt die Zeile nur am eigenen Schnitt ein „…“; das „…“ des Ergebnisses bleibt mitten in der Zeile stehen, wenn der Schnitt der Zeile dahinter liegt.
- `clampAtWordBoundary` schaut nur auf die ersten `maxChars` Zeichen: Endet ein ganzes Wort genau auf dem letzten erlaubten Zeichen und folgt ein Leerzeichen, fällt dieses Wort trotzdem weg (PM2). Das wird hingenommen; die Hilfe bleibt unverändert, und es gibt keine eigene Prüfung des Zeichens hinter der Grenze neben ihr.
- Ein Trenner vor dem Schnitt („angeben;“) bleibt stehen, das „…“ folgt direkt dahinter; es wird nichts nachgeputzt (Runde 1, Frage 5, ohne das Kürzungszeichen).
- Die Grenzen sind exportierte Werte (`MEMORY_MAX_CALLS`, `MEMORY_MAX_ENTRY_CHARS`, `MEMORY_MAX_CHARS`) und werden von anderen Stellen gelesen: Namen, Werte und Export bleiben, ebenso die Hälfte für das Ergebnis.
- Die bestehenden Tests in `test/al-p12-call-memory.test.js` (Faltung, Budget, Reihenfolge, Byte-Gleichheit bei ausgeschaltetem Gedächtnis) bleiben unverändert grün.

## Altfunktionen
- nicht berührt: `src/call-result.js:normalizeCallResult`, weil das Ergebnis beim Speichern unverändert normalisiert wird und erst `memoryLine` in `src/call-memory.js:15-23` beim Lesen kürzt
- nicht berührt: `src/claude.js:personaHeader`, weil der Prompt-Aufbau unverändert bleibt und die Änderung nur in `memoryLine` in `src/call-memory.js:15-23` liegt
- nicht berührt: `src/claude.js:assignmentBlock`, weil er die Gedächtniszeilen unverändert einsetzt und die Änderung nur in `memoryLine` in `src/call-memory.js:15-23` liegt
- nicht berührt: `src/claude.js:outboundSituation`, weil der Prompt-Aufbau unverändert bleibt und die Änderung nur in `memoryLine` in `src/call-memory.js:15-23` liegt
- nicht berührt: `src/claude.js:callMemorySection`, weil sie die fertigen Zeilen unverändert übernimmt und die Kürzung in `memoryLine` in `src/call-memory.js:15-23` liegt
- nicht berührt: `src/claude.js:summarizeCall`, weil sie das Ergebnis unverändert erzeugt und erst `memoryLine` in `src/call-memory.js:15-23` es kürzt
- nicht berührt: `src/research/lookup-guard.js:lookupFactsFrom`, weil die Recherche `clampAtWordBoundary` unverändert weiter nutzt und nur `memoryLine` in `src/call-memory.js:15-23` die Hilfe neu aufruft
- nicht berührt: `src/store/state-ops.js:counterpartyMemory`, weil sie die früheren Anrufe unverändert liefert und die Kürzung in `memoryLine` in `src/call-memory.js:15-23` liegt
- nicht berührt: `src/store/state-ops.js:anonym ab Zeile 922`, weil sie Teil von `counterpartyMemory` ist, unverändert bleibt und die Kürzung in `memoryLine` in `src/call-memory.js:15-23` liegt
- nicht berührt: `src/store/state-ops.js:anonym ab Zeile 923`, weil sie Teil von `counterpartyMemory` ist, unverändert bleibt und die Kürzung in `memoryLine` in `src/call-memory.js:15-23` liegt

## Anforderungen

### Regel R1: Eine beim Bau des Gedächtnisses gekürzte Angabe endet an einem ganzen Wort, danach mit „…“, und hält ihre Grenze.

#### Szenario S1: Langes Ergebnis wird bei 100 Zeichen an der Wortgrenze gekürzt und markiert
Gegeben ein Konto mit `allowCallMemory` an, die Telnyx-Engine, ein früherer Outbound-Anruf an `+4930123456` mit dem Ergebnis „Rueckruf vereinbart, Frau Weber hat den Termin fuer die Lieferung bestaetigt am Dienstag um 15:30 Uhr“ ohne Fakten, und ein neuer Anruf an dieselbe Nummer über `place_call`
Wenn der Angerufene „Weber, guten Tag.“ sagt
Dann enthält die Anweisung an den Sprachmodell-Anbieter die Gedächtniszeile „Rueckruf vereinbart, Frau Weber hat den Termin fuer die Lieferung bestaetigt am Dienstag um 15:30…“ (98 Zeichen), und sie enthält nicht „15:30 Uh“

#### Szenario S2: Lange Zeile aus Ergebnis und Fakten wird bei 200 Zeichen an der Wortgrenze gekürzt und markiert
Gegeben ein Konto mit `allowCallMemory` an, die Telnyx-Engine, ein früherer Outbound-Anruf an `+4930123456` mit dem Ergebnis „Rueckruf vereinbart fuer naechste Woche“ und den Fakten „Ansprechpartnerin ist Frau Weber aus der Buchhaltung im zweiten Stock“, „Kundennummer 4711-0815 bei allen Rueckfragen angeben“ und „Lieferung kommt per Spedition Hansen“, und ein neuer Anruf an dieselbe Nummer über `place_call`
Wenn der Angerufene „Weber, guten Tag.“ sagt
Dann enthält die Anweisung an den Sprachmodell-Anbieter die Gedächtniszeile „Rueckruf vereinbart fuer naechste Woche; Ansprechpartnerin ist Frau Weber aus der Buchhaltung im zweiten Stock; Kundennummer 4711-0815 bei allen Rueckfragen angeben; Lieferung kommt per Spedition…“ (196 Zeichen), und sie enthält nicht „Spedition Hans“

#### Szenario S3: Ein Wort ohne Leerzeichen wird hart gekürzt und markiert
Gegeben ein Konto mit `allowCallMemory` an, die Telnyx-Engine, ein früherer Outbound-Anruf an `+4930123456` mit dem Ergebnis `https://beispiel.de/` gefolgt von 120-mal `a` ohne Fakten, und ein neuer Anruf an dieselbe Nummer über `place_call`
Wenn der Angerufene „Weber, guten Tag.“ sagt
Dann enthält die Anweisung an den Sprachmodell-Anbieter eine Gedächtniszeile aus genau den ersten 99 Zeichen dieses Ergebnisses und „…“, zusammen 100 Zeichen

## Bleibt unverändert

### Szenario B1: Kurze Erinnerung steht unverändert im Prompt
Gegeben ein Konto mit `allowCallMemory` an, die Telnyx-Engine, ein früherer Outbound-Anruf an `+4930123456` mit dem Ergebnis „Reklamation 4711 aufgenommen“ und dem Fakt „Reklamationsnummer 4711“, und ein neuer Anruf an dieselbe Nummer über `place_call`
Wenn der Angerufene „Weber, guten Tag.“ sagt
Dann enthält die Anweisung an den Sprachmodell-Anbieter die Gedächtniszeile „Reklamation 4711 aufgenommen; Reklamationsnummer 4711“ ohne „…“

### Szenario B2: Ein Ergebnis von genau 100 Zeichen passt und bleibt unverändert
Gegeben ein Konto mit `allowCallMemory` an, die Telnyx-Engine, ein früherer Outbound-Anruf an `+4930123456` mit dem Ergebnis „Frau Weber bestaetigt die Lieferung am Dienstag um 15:30 Uhr an die Hauptstrasse 12 in Berlin-Mitte.“ (100 Zeichen) ohne Fakten, und ein neuer Anruf an dieselbe Nummer über `place_call`
Wenn der Angerufene „Weber, guten Tag.“ sagt
Dann enthält die Anweisung an den Sprachmodell-Anbieter die Gedächtniszeile „Frau Weber bestaetigt die Lieferung am Dienstag um 15:30 Uhr an die Hauptstrasse 12 in Berlin-Mitte.“ ohne „…“

## Nicht-Ziele
- Nicht Teil dieser Änderung: das Gesprächsgedächtnis in den ElevenLabs-Outbound zu bringen, weil dieser Pfad es heute gar nicht liest; das ist ein eigenes Vorhaben (Runde 1, Frage 1).
- Nicht Teil dieser Änderung: an der Grenze einer Angabe statt an der Wortgrenze zu kürzen; eine Angabe mit eigenem Leerzeichen (etwa „0151 23456789“) kann weiter an einem inneren Leerzeichen gekürzt werden, dann aber mit „…“, weil „Fakten ganz oder gar nicht“ eine zweite Regel mit eigenem Szenario wäre (Runde 2, Frage 1).
- Nicht Teil dieser Änderung: `clampAtWordBoundary` zu ändern oder eine neue Kürzungshilfe zu bauen, weil Rückfrage, Denk-Signal, Eröffnung und Recherche dieselbe Hilfe nutzen.
- Nicht Teil dieser Änderung: die harte Kürzung auf 200 Zeichen beim Speichern der Ergebniskarte (`src/call-result.js:10-15`); ein schon beim Speichern gekürzter einzelner Fakt ohne Ergebnis kommt weiter unverändert und ohne „…“ ins Gedächtnis, weil die Behebung gespeicherte Daten und ihre anderen Leser ändern würde (PM1).
- Nicht Teil dieser Änderung: die Grenzen 100, 200, 600 Zeichen und 3 Anrufe zu ändern.

## Neue Begriffe
- `…`: das Kürzungszeichen (U+2026) am Ende einer im Gedächtnis gekürzten Angabe; zählt als ein Zeichen innerhalb der Grenze.

## Offene Fragen

### Vor dem Bau zu klären
keine

### Kann warten
- Soll das Gesprächsgedächtnis auch im ElevenLabs-Outbound ankommen?

## Premortem
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil die Ergebniskarte schon beim Speichern Ergebnis und jeden Fakt hart auf 200 Zeichen kürzt (`src/call-result.js:10-15`), passiert bei einem früheren Anruf ohne Ergebnis mit einem einzigen langen Fakt, dass die Gedächtniszeile genau 200 Zeichen lang ist und unverändert durch die Wortgrenze geht, und die Folge ist ein weiter angeschnittenes Wort im Prompt. | Nicht-Ziel |
| PM2 | Weil `clampAtWordBoundary` nur die ersten `maxChars` Zeichen betrachtet, passiert bei einem Wort, das genau auf der Grenze endet und dem ein Leerzeichen folgt, dass das ganze Wort wegfällt, und die Folge ist, dass etwa „Kundennummer 4711“ zu „Kundennummer“ wird, obwohl die Nummer heute ganz im Prompt steht. | hingenommen: Die Behebung gehörte in die gemeinsame Hilfe (Nicht-Ziel, 5 Aufrufstellen) oder wäre ein zweiter Weg zur Wortgrenze neben ihr (Falle); die Lücke steht als Falle im Pitch. |
| PM3 | Weil die Zeile nach der Kürzung sauber an einem Wort endet und kein Kürzungszeichen bekommt, passiert bei einer Verneinung oder einem Verb am Satzende („… am Dienstag nicht“), dass der Rest wie eine vollständige Aussage aussieht, und die Folge ist, dass der Agent das Gegenteil des Ergebnisses als Tatsache nennt. | S1, S2, S3 (jede Kürzung endet mit „…“) |
