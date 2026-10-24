# P-008 Sprachformung erhält Zahlenspannen und Unterstriche

Status: freigegeben
Planung freigegeben: 2500000 Token
Issue: 1973
Design Doc: nein, weil die Änderung in einer Funktion (`src/speech-shape.js:shapedCore`) auf einem Weg liegt, kein Anbieteraufruf und kein Werkzeugvertrag sich ändert und der Rückweg ein Code-Rollback ist

## Absicht
Was Hermes am Telefon spricht, soll Zahlenspannen und Adressen so weitergeben, wie das Sprachmodell sie geschrieben hat: „9 - 18 Uhr“ bleibt eine Spanne, `max_weber@beispiel.de` behält den Unterstrich, damit der Angerufene keine falsche Öffnungszeit oder Adresse notiert. Nicht gewollt ist eine zweite Formungsstelle, eine sprachabhängige Ersetzung oder eine Änderung an den Aufrufern. Im Zweifel bleibt das heutige Verhalten für alles, was weder Ziffer-Strich-Ziffer noch Unterstrich mitten im Wort ist.

## Problem
Auf dem Telnyx-Rückfallweg sagt das Sprachmodell einem Anrufer „Geöffnet 9 - 18 Uhr, Mail an max_weber@beispiel.de“. Die Sprachformung macht daraus „Geöffnet 9, 18 Uhr, Mail an maxweber@beispiel.de.“ (`src/speech-shape.js:5-6`): Der Anrufer hört zwei einzelne Uhrzeiten statt einer Spanne und notiert eine Adresse, die es nicht gibt.

## Ergebnis
Nach dieser Änderung geht an die Sprachausgabe „Geöffnet 9-18 Uhr, Mail an max_weber@beispiel.de.“, und alle übrigen Formungsregeln (Listenzeichen, Markdown-Zeichen, Gedankenstrich zwischen Wörtern, Leerraum, Schlusspunkt) wirken wie bisher.

## Grobe Lösung
Der Angerufene hört Spannen und Adressen so, wie das Sprachmodell sie geschrieben hat. Die Formung vor der Sprachausgabe erkennt zwei Fälle neu: Ein Bindestrich mit Leerzeichen zwischen zwei Zahlen wird zur Spanne ohne Leerzeichen („9 - 18“ → „9-18“), außer eine der beiden Zahlen ist Teil einer ziffernweise gesprochenen Folge wie einer Telefonnummer („0 1 5 1 - 2 3 4“ bleibt „0 1 5 1, 2 3 4“) oder einer Kette aus drei oder mehr Zahlen mit Strichen wie einer Kartennummer in Vierergruppen (bleibt „4111, 1111, 1111, 1111“, damit die Maskierung im Transkript sie weiter erkennt), also in die Form, die die Sprachausgabe heute schon ungeformt bekommt („14-15 Uhr“ bleibt heute „14-15 Uhr“, Szenario B2). Ein Unterstrich mit einem Buchstaben oder einer Ziffer auf beiden Seiten bleibt stehen; am Wortrand fällt er wie bisher weg (Markdown-Kursiv), und zwischen zwei Ziffern fällt er ebenfalls wie bisher weg, damit eine Kartennummer mit Unterstrichen zusammenhängend und maskierbar bleibt. Beide Formungswege, die ganze Antwort und das Streaming-Häppchen, teilen dieselbe Formung und ändern sich gleich. Vorher wird die Formung so umgebaut, dass sie lintfrei ist, ohne ihr Verhalten zu ändern. Die Abnahmetests prüfen die Formung als Tabelle reiner Fachlogik (Eingabetext des Sprachmodells → Text an die Sprachausgabe).

## Fallen
- Die Formung ist heute eine Kette aus fünf `.replace` und verstößt gegen die Demeter-Regel (G36, 2 Befunde, unterdrückt): erst Umbau der ganzen Funktion lintfrei mit gleichem Verhalten, dann die Änderung.
- Die Reihenfolge der Ersetzungen bestimmt das Ergebnis (Listenzeichen am Zeilenanfang → Markdown-Zeichen → Gedankenstrich → Leerraum): Der Umbau behält diese Reihenfolge; die Spannenregel greift vor der Regel „ - “ → „, “, und Listenzeichen am Zeilenanfang werden weiter zuerst entfernt, so dass „9“ am Zeilenende und „- 18“ in der nächsten Zeile keine Spanne bilden.
- „Zahl“ in R1 heißt: eine Folge aus Ziffern 0–9, in der zwischen zwei Ziffern ein `:` oder `.` stehen darf („9“, „9:30“, „18.00“); „grenzt durch Leerraum an eine weitere Zahl“ heißt: vor der linken Zahl steht Leerraum und davor wieder eine Ziffer, oder hinter der rechten Zahl steht Leerraum und dahinter wieder eine Ziffer (B6). „030 - 123456“ wird damit zur Spanne „030-123456“ (Premortem Nr. 1).
- „Kette“ in R1 heißt: die linke Zahl steht selbst hinter einem Strich mit einer Zahl davor, oder die rechte Zahl steht selbst vor einem Strich mit einer Zahl dahinter. Der Strich der Kette ist dasselbe Trennzeichen wie in R1 und in der heutigen Regel `src/speech-shape.js:6`: Leerraum beliebiger Länge, Bindestrich, Leerraum beliebiger Länge, nicht nur das wörtliche „ - “ (B9, Sicherheitsprüfung Gegenprüfung Nr. 2). Jeder Strich einer Kette wird wie heute „, “ (B8).
- Die neuen Regeln laufen auf Text, den Anrufer und Angerufene über das Modell beeinflussen, im einzigen Prozess für alle Mandanten: Die Mustersuche darf keine verschachtelten Wiederholungen enthalten und muss auf 500 Ziffern in weniger als 1 Sekunde enden (Sicherheitsprüfung T3). Die Semgrep-Regel `detect-redos` prüft `replace` nicht und meldet eine solche Umsetzung deshalb nicht.
- „Buchstabe“ beim Unterstrich schließt Umlaute und ß ein (`grüß_gott`): Die Regel arbeitet mit Unicode-Buchstaben und -Ziffern, nicht mit `[A-Za-z0-9]`.
- Doppelte Unterstriche am Wortrand (`__fett__`) sind Markdown-Fett: Ein Unterstrich bleibt nur, wenn direkt davor und direkt danach ein Buchstabe oder eine Ziffer steht und nicht beide Seiten Ziffern sind; ein Unterstrich neben einem Unterstrich fällt weg.
- Der Streaming-Weg schneidet nur hinter `.`, `!`, `?` oder `…` mit folgendem Leerraum (`src/speech-chunker.js:5`); eine Spanne „9 - 18“ wird also nie auf zwei Häppchen verteilt. Keine Änderung am Schneiden.
- Die neue Katalogzeile in `docs/sicherheitsgrenzen.md` (Sicherheitsprüfung, Abschnitt 5, Kennung SG-27) braucht einen Test, dessen Name mit „SG-27 “ beginnt, und die letzte Spalte der Zeile muss mit „SG-27 “ beginnen; sonst ist `tools/katalog-pruefen.mjs` rot (`:24`, `:110`). Der Test zu T3 trägt diesen Namen.
- Abnahmetests importieren nur `src/speech-shape.js` (in `tools/bereiche.json:79` unter `fachlogik` erlaubt) und kein anderes Modul unter `src/`, weil die Regel `tests-nur-ueber-eingaenge` sonst erst am Phasenende rot wird (P-007, R13).

## Altfunktionen
- Umbau: `src/speech-shape.js:shapedCore`
- nicht berührt: `src/claude.js:agentTurn`, weil die Änderung nur in `src/speech-shape.js:shapedCore` liegt und `src/claude.js:673` die Formung unverändert aufruft
- nicht berührt: `src/claude.js:summarizeCall`, weil die Änderung nur in `src/speech-shape.js:shapedCore` liegt und sie nur als Beleg für den Weg des Transkripts in die Zusammenfassung steht (Sicherheitsprüfung T1)
- nicht berührt: `src/i18n/prompts/de.js:speechRules`, weil die Änderung nur in `src/speech-shape.js:shapedCore` liegt und sie nur als Beleg für die Promptregel „Ziffer für Ziffer“ steht (Premortem, Sicherheitsprüfung T2, T4) und der Prompt unverändert bleibt
- nicht berührt: `src/mcp-tools.js:pickCallStatus`, weil die Änderung nur in `src/speech-shape.js:shapedCore` liegt und sie nur als Beleg für den Weg der Transkriptzeilen zu `get_call_status` steht und das Werkzeug unverändert bleibt
- nicht berührt: `src/mcp-tools.js:anonym ab Zeile 110`, weil die Änderung nur in `src/speech-shape.js:shapedCore` liegt und sie nur als Beleg für die Maskierung je Transkriptzeile in `get_call_status` steht und unverändert bleibt
- nicht berührt: `src/mcp-tools.js:pickTranscript`, weil die Änderung nur in `src/speech-shape.js:shapedCore` liegt und sie nur als Beleg für `get_call_result` steht und unverändert bleibt
- nicht berührt: `src/mcp-tools.js:registerTools`, weil die Änderung nur in `src/speech-shape.js:shapedCore` liegt und sie nur als Beleg für die Werkzeugregistrierung steht und sich kein Werkzeug ändert
- nicht berührt: `src/mcp-tools.js:callStatusResult`, weil die Änderung nur in `src/speech-shape.js:shapedCore` liegt und sie nur als Beleg für die Ausgabe von `get_call_status` steht und unverändert bleibt
- nicht berührt: `src/routes/voice.js:makeVoiceRoutes`, weil die Änderung nur in `src/speech-shape.js:shapedCore` liegt und sie nur als Beleg für den Telnyx-Weg (`/voice/turn`, Ausgabe an die Sprachausgabe) steht und die Route unverändert bleibt
- nicht berührt: `src/routes/voice.js:anonym ab Zeile 310`, weil die Änderung nur in `src/speech-shape.js:shapedCore` liegt und sie nur als Beleg für die Signaturprüfung steht und unverändert bleibt
- nicht berührt: `src/routes/voice.js:anonym ab Zeile 373`, weil die Änderung nur in `src/speech-shape.js:shapedCore` liegt und sie nur als Beleg für den Aufruf von `agentTurn` ohne `onSpeechChunk` steht und unverändert bleibt

## Anforderungen

### Regel R1: Ein Bindestrich mit Leerzeichen zwischen zwei Zahlen wird zur Spanne ohne Leerzeichen, wenn keine der beiden Zahlen durch Leerraum oder über einen weiteren Strich an eine weitere Zahl grenzt.

#### Szenario S1: Öffnungszeit als Spanne
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Geöffnet 9 - 18 Uhr“ gibt
Dann geht an die Sprachausgabe der Text „Geöffnet 9-18 Uhr.“

#### Szenario S2: Uhrzeiten mit Minuten als Spanne
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Termin 9:30 - 18:00“ gibt
Dann geht an die Sprachausgabe der Text „Termin 9:30-18:00.“

#### Szenario S3: Spanne im Streaming-Häppchen
Gegeben die Formung eines gestreamten Antwort-Häppchens (Streaming-Weg von `agentTurn`, den heute kein Live-Aufrufer einschaltet)
Wenn das Sprachmodell den Satz „Kosten 10 - 20 Euro.“ streamt
Dann geht als Häppchen an die Sprachausgabe der Text „Kosten 10-20 Euro.“

### Regel R2: Ein Unterstrich mit einem Buchstaben oder einer Ziffer direkt davor und direkt danach bleibt stehen, außer auf beiden Seiten steht eine Ziffer.

#### Szenario S4: Mailadresse mit Unterstrich
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Mail an max_weber@beispiel.de“ gibt
Dann geht an die Sprachausgabe der Text „Mail an max_weber@beispiel.de.“

#### Szenario S5: Kennung mit Umlaut und Ziffer im Streaming-Häppchen
Gegeben die Formung eines gestreamten Antwort-Häppchens (Streaming-Weg von `agentTurn`, den heute kein Live-Aufrufer einschaltet)
Wenn das Sprachmodell den Text „Kennung grüß_gott_2“ streamt
Dann geht als Häppchen an die Sprachausgabe der Text „Kennung grüß_gott_2“

## Bleibt unverändert

### Szenario B1: Gedankenstrich zwischen Wörtern wird Komma
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Alles klar - ich buche“ gibt
Dann geht an die Sprachausgabe der Text „Alles klar, ich buche.“

### Szenario B2: Spanne ohne Leerzeichen geht unverändert durch
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Termin 14-15 Uhr“ gibt
Dann geht an die Sprachausgabe der Text „Termin 14-15 Uhr.“

### Szenario B3: Markdown-Kursiv fällt weg
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „_Wichtig_: morgen“ gibt
Dann geht an die Sprachausgabe der Text „Wichtig: morgen.“

### Szenario B4: Strich zwischen Wort und Zahl bleibt Komma
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Termin am Montag - 18 Uhr“ gibt
Dann geht an die Sprachausgabe der Text „Termin am Montag, 18 Uhr.“

### Szenario B5: Markdown-Fett mit doppeltem Unterstrich fällt weg
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „__fett__ bitte“ gibt
Dann geht an die Sprachausgabe der Text „fett bitte.“

### Szenario B6: Ziffernweise Telefonnummer mit Gruppenstrich bleibt Komma
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Ihre Nummer ist 0 1 5 1 - 2 3 4 5 6 7“ gibt
Dann geht an die Sprachausgabe der Text „Ihre Nummer ist 0 1 5 1, 2 3 4 5 6 7.“

### Szenario B7: Eingerückte Aufzählung bildet keine Spanne
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Uhrzeiten:“, Zeilenumbruch, „  - 9“, Zeilenumbruch, „  - 18“ gibt (zwei Leerzeichen vor jedem Listenzeichen)
Dann geht an die Sprachausgabe der Text „Uhrzeiten: 9 18.“

### Szenario B8: Kartennummer in Vierergruppen bleibt Komma
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Ich wiederhole Ihre Kartennummer: 4111 - 1111 - 1111 - 1111“ gibt
Dann geht an die Sprachausgabe der Text „Ich wiederhole Ihre Kartennummer: 4111, 1111, 1111, 1111.“

### Szenario B9: Kartennummer mit ungleichem Leerraum am Strich bleibt Komma
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Kartennummer: 4111 - 1111“, zwei Leerzeichen, „-“, zwei Leerzeichen, „1111 - 1111“ gibt
Dann geht an die Sprachausgabe der Text „Kartennummer: 4111, 1111, 1111, 1111.“

### Szenario B10: Unterstrich zwischen zwei Ziffern fällt weg
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Karte 4111_1111_1111_1111“ gibt
Dann geht an die Sprachausgabe der Text „Karte 4111111111111111.“

## Nicht-Ziele
- Nicht Teil dieser Änderung: eine sprachabhängige Ersetzung der Spanne („bis“, „to“, „à“), weil die Formung die Sprache des Anrufs nicht kennt und „9-18“ die Form ist, die die Sprachausgabe heute schon bekommt.
- Nicht Teil dieser Änderung: die Aufrufer `src/claude.js`, `src/thinking-signal.js` und `src/speech-chunker.js` zu ändern oder ihnen eine Sprache zu übergeben, weil die Änderung ganz in der gemeinsamen Formung liegt.
- Nicht Teil dieser Änderung: die Gedankenstriche „–“ (U+2013) und „—“ (U+2014), weil sie heute unverändert durchgehen und ihre Aussprache eine eigene Entscheidung ist.
- Nicht Teil dieser Änderung: der Hauptweg über die ElevenLabs-Agents-Plattform, weil er die Formung nicht aufruft.
- Nicht Teil dieser Änderung: das Entfernen der Satzzeichen am Ende und der angehängte Schlusspunkt in `shapeForSpeech` (`src/speech-shape.js:19-20`), weil sie mit Spannen und Unterstrichen nichts zu tun haben.
- Nicht Teil dieser Änderung: Spannen mit Einheit an beiden Enden („9 Uhr - 18 Uhr“, „9 h - 18 h“, „9 am - 5 pm“), weil sie sich ohne Wort- und Sprachwissen nicht von „Termin am Montag - 18 Uhr“ (B4) unterscheiden lassen und die Formung die Sprache des Anrufs nicht kennt.
- Nicht Teil dieser Änderung: wie die Sprachausgabe den Unterstrich ausspricht, weil das Ergebnis als Text an die Sprachausgabe festgelegt ist und kein Testweg den erzeugten Ton erreicht (CLAUDE.md Regel 5).

## Neue Begriffe
keine

## Offene Fragen

### Vor dem Bau zu klären
keine

### Kann warten
- Wie spricht die Sprachausgabe (Azure über Telnyx, ElevenLabs-TTS) „9-18“ und den Unterstrich in `max_weber` in jeder Sprache aus? Heute bekommt sie „9-18“ schon bei „14-15 Uhr“ (B2); ein Hörtest auf Staging kann beides später bestätigen.

## Premortem
| Nr. | Grund | Ausgang |
|---|---|---|
| 1 | Das Modell schreibt Telefonnummern ziffernweise (Prompt `src/i18n/prompts/de.js:29`) und trennt Gruppen mit „ - “; R1 in der ersten Fassung machte aus „0 1 5 1 - 2 3 4 5 6 7“ die Spanne „1-2“. | Neues Szenario B6; R1 enger gefasst (keine der beiden Zahlen grenzt durch Leerraum an eine weitere Zahl). Gruppierte Nummer „030 - 123456“ wird zur Spanne: hingenommen, weil sie sich ohne Wortwissen nicht von „10 - 20 Euro“ unterscheiden lässt und der Prompt ziffernweise Nummern verlangt, die B6 schützt (Runde 2, Frage 2). |
| 2 | Spannen mit Einheit an beiden Enden („9 Uhr - 18 Uhr“, „9 h - 18 h“, „9 am - 5 pm“) bleiben zwei Uhrzeiten. | Nicht-Ziel |
| 3 | Liest die Sprachausgabe „9-18 Uhr“ als „neun achtzehn“ oder „neun minus achtzehn“, ist das schlechter als heute „9, 18“; B2 zeigt nur, dass die Form vorkommt. | hingenommen: die Sprachausgabe bekommt die Form heute schon bei „14-15 Uhr“ (B2); Hörtest auf Staging unter „Kann warten“ (Runde 2, Frage 3) |
| 4 | Die Sprachausgabe kann den Unterstrich überspringen oder als „underscore“ lesen. | Nicht-Ziel; Unterstrich in die Hörtest-Frage unter „Kann warten“ aufgenommen |
| 5 | Nennt das Modell einen Werkzeugnamen (`take_message`), wird er künftig mit Unterstrich gesprochen statt verschluckt. | hingenommen: der Fehler liegt in der Modellausgabe; ein Werkzeugname lässt sich ohne Wortwissen nicht von `max_weber` unterscheiden (Runde 2, Frage 4) |
| 6 | Geht beim Umbau `[ \t]*` aus der Listenzeichen-Regel verloren, wird kein bestehender Test rot, und eine eingerückte Liste „9“/„18“ würde zur erfundenen Spanne „9-18“. | Neues Szenario B7 |
| 7 | Ergebnisse wie „2 - 1“ werden zur Spanne „2-1“. | hingenommen: selten in Assistenten-Telefonaten, nicht von Spannen unterscheidbar, heutige Form „2, 1“ ebenso falsch (Runde 2, Frage 5) |
