# P-008 Fragerunden

## Runde 1

1. Spanne in der Form „9-18“ (Leerzeichen um den Strich zwischen zwei Ziffern fallen weg), keine sprachabhängige Ersetzung „bis“/„to“. Empfehlung: ja, weil „14-15 Uhr“ heute schon ungeformt an die Sprachausgabe geht (`src/speech-shape.js:6` greift nur mit Leerzeichen), die Spanne also in eine Form kommt, die die Sprachausgabe heute schon bekommt; „bis“/„to“ bräuchte eine Sprache in `shapeForSpeech`, die heute an keinem der drei Aufrufer übergeben wird (`src/claude.js:673`, `src/thinking-signal.js:10`, `src/speech-chunker.js:33`).
2. „Zahl“ heißt: direkt vor dem Strich (vor den Leerzeichen) und direkt danach steht eine Ziffer 0–9; damit sind auch „9:30 - 18:00“ und „10 - 20 Euro“ erfasst. Empfehlung: ja, weil das die einfachste prüfbare Regel ist und Uhrzeiten mit Minuten mitnimmt.
3. Ein Unterstrich bleibt stehen, wenn direkt davor und danach ein Buchstabe oder eine Ziffer steht (`max_weber`, `snake_case_name`); am Wortrand fällt er weiter weg (`_kursiv_` → `kursiv`). Empfehlung: ja, weil Markdown-Kursiv immer am Wortrand steht und Adressen/Kennungen den Unterstrich innen tragen.
4. Beide Wege ändern sich gleich: `shapeForSpeech` (ganze Antwort, Denk-Signal) und `shapeChunkForSpeech` (Streaming-Häppchen), weil beide `shapedCore` nutzen. Empfehlung: ja, sonst klingt derselbe Satz je nach Weg verschieden.
5. Der Gedankenstrich zwischen Wörtern („Alles klar - ich buche“ → „Alles klar, ich buche“) bleibt, als Bleibt-unverändert-Szenario. Empfehlung: ja, weil das heute gewollt ist (`test/shape-for-speech.test.js:20`).
6. Altfunktion: `src/speech-shape.js:shapedCore` hat 2 Befunde `no-restricted-syntax` (Demeter G36, Kette aus fünf `.replace`, Zeile 3, unterdrückt in `eslint-suppressions.json`). Die Änderung liegt genau dort; Umbau der ganzen Funktion lintfrei als eigener Teil (Verhalten gleich), danach die Änderung. Empfehlung: ja, weil es keinen anderen Schnitt gibt (die Regex stehen in dieser Funktion) und der Umbau 10 Zeilen umfasst.
7. Gedankenstrich „–“ (U+2013) und „—“ (U+2014) bleiben außen vor (Nicht-Ziel). Empfehlung: ja, weil sie heute unverändert durchgehen (`src/speech-shape.js:6` kennt nur „-“) und eine Erweiterung eine eigene Entscheidung über deren Aussprache wäre.
8. Abnahmetests als Fachlogik-Tabelle über `shapeForSpeech`/`shapeChunkForSpeech` (in `tools/bereiche.json:79` unter `fachlogik` erlaubt), nicht über `/voice` mit Modell-Attrappe. Empfehlung: ja, weil CLAUDE.md Tabellentests reiner Fachlogik erlaubt und der Weg über `/voice` eine Modell-Attrappe bräuchte, die den Antworttext liefert (die Anthropic-Attrappe verwirft den Body, Lücke Q5 aus P-007).
9. Design Doc: nein. Empfehlung: ja (also nein zum Design Doc), weil eine Funktion, ein Weg, kein Anbieteraufruf und kein Werkzeugvertrag sich ändert und der Rückweg ein Code-Rollback ist.

### Antworten Runde 1
1.–9.: wie empfohlen (Betreuung im Auftrag von Antonio). Zu 1 zusätzlich: im Pitch belegen, dass „14-15 Uhr“ heute schon ungeformt durchgeht. Beleg: `src/speech-shape.js:6` greift nur mit Leerraum auf beiden Seiten (`/\s+-\s+/`); am master 7f5f1cb liefert `shapeForSpeech("Termin 14-15 Uhr")` den Text „Termin 14-15 Uhr.“; im Pitch als Szenario B2.

## Vorher-Rot
Gemessen am master 7f5f1cb mit einem Wegwerf-Skript, das `shapeForSpeech` und `shapeChunkForSpeech` aus `src/speech-shape.js` aufruft:
- S1: heute „Geöffnet 9, 18 Uhr.“ statt „Geöffnet 9-18 Uhr.“, `src/speech-shape.js:6`
- S2: heute „Termin 9:30, 18:00.“ statt „Termin 9:30-18:00.“, `src/speech-shape.js:6`
- S3: heute „Kosten 10, 20 Euro.“ statt „Kosten 10-20 Euro.“, `src/speech-shape.js:6`
- S4: heute „Mail an maxweber@beispiel.de.“ statt „Mail an max_weber@beispiel.de.“, `src/speech-shape.js:5`
- S5: heute „Kennung grüßgott2“ statt „Kennung grüß_gott_2“, `src/speech-shape.js:5`

Bleibt unverändert, heute schon so (gleiche Messung): B1 „Alles klar, ich buche.“, B2 „Termin 14-15 Uhr.“, B3 „Wichtig: morgen.“, B4 „Termin am Montag, 18 Uhr.“, B5 „fett bitte.“
Nach Premortem ergänzt (Messung am master 7f5f1cb, 18:37): B6 „Ihre Nummer ist 0 1 5 1, 2 3 4 5 6 7.“, B7 „Uhrzeiten: 9 18.“ S1–S5 haben ihr Dann nicht geändert; bei S3 und S5 ist nur das „Gegeben“ berichtigt (kein Live-Aufrufer übergibt `onSpeechChunk`, `src/routes/voice.js:396`).

## Runde 2

Nach dem Premortem (7 Gründe, Ausgänge im Pitch unter „Premortem“).

1. R1 enger fassen: Die Spanne entsteht nur, wenn keine der beiden Zahlen durch Leerraum an eine weitere Zahl grenzt; ziffernweise Telefonnummern („0 1 5 1 - 2 3 4 5 6 7“) bleiben „…1, 2…“ (neues B6). Empfehlung: ja, weil der Prompt Telefonnummern ziffernweise verlangt (`src/i18n/prompts/de.js:29`) und eine Spanne „1-2“ mitten in einer Rückrufnummer eine falsche Nummer hörbar macht.
2. Premortem 1, Rest: Eine gruppierte Nummer „030 - 123456“ wird zur Spanne „030-123456“ (heute „030, 123456“). Empfehlung: hingenommen, weil sie sich ohne Wortwissen nicht von „10 - 20 Euro“ unterscheiden lässt und der Prompt ziffernweise Nummern verlangt, die B6 schützt.
3. Premortem 3: Wie die Sprachausgabe „9-18 Uhr“ ausspricht, ist ungeprüft; die Frage bleibt unter „Kann warten“ (Hörtest auf Staging später) statt den Bau zu blockieren. Empfehlung: hingenommen, weil die Sprachausgabe diese Form heute schon bei „14-15 Uhr“ bekommt (B2) und der Auftrag die Frage ohne Produktion am Code klären lässt.
4. Premortem 5: Ein vom Modell genannter Werkzeugname (`take_message`) wird künftig mit Unterstrich gesprochen statt verschluckt. Empfehlung: hingenommen, weil der Fehler in der Modellausgabe liegt und sich ein Werkzeugname ohne Wortwissen nicht von `max_weber` unterscheiden lässt.
5. Premortem 7: Ergebnisse wie „2 - 1“ werden zur Spanne „2-1“ (heute „2, 1“). Empfehlung: hingenommen, weil sie in Assistenten-Telefonaten selten sind, sich nicht von Spannen unterscheiden lassen und die heutige Form ebenfalls falsch ist.
6. S3 und S5 behalten ihr Dann; ihr „Gegeben“ heißt jetzt „die Formung eines gestreamten Antwort-Häppchens“, weil kein Live-Aufrufer den Streaming-Weg einschaltet (`src/routes/voice.js:396` ruft `agentTurn` ohne `onSpeechChunk`). Empfehlung: ja, weil das Szenario sonst einen Anruf behauptet, den es nicht gibt, und die Formung auf beiden Wegen gleich bleiben soll (Runde 1, Frage 4).

### Antworten Runde 2
1.–6.: wie empfohlen (Betreuung im Auftrag von Antonio): R1 enger mit B6; Premortem 1 (Rest „030 - 123456“), 3, 5 und 7 hingenommen; Gegeben von S3 und S5 berichtigt.

## Vorher-Rot nach Freigabe (Sicherheitsprüfung und Gegenprüfung)
Gemessen am master 7f5f1cb um 18:52 mit demselben Wegwerf-Skript, B8–B10 heute schon so (Bleibt unverändert, Schutz gegen die neue Regel):
- B8: heute „Ich wiederhole Ihre Kartennummer: 4111, 1111, 1111, 1111.“ (`src/speech-shape.js:6`); ohne Kettenbedingung entstünde „…4111-1111, 1111-1111.“
- B9: heute „Kartennummer: 4111, 1111, 1111, 1111.“ (`src/speech-shape.js:6`, `\s+-\s+`)
- B10: heute „Karte 4111111111111111.“ (`src/speech-shape.js:5`)
- T1 und T2 haben dasselbe Dann wie B8 bzw. B10; T3: die heutige Formung hat keine verschachtelte Wiederholung (`src/speech-shape.js:4-8`), das Szenario ist heute grün und wird rot bei einer exponentiellen Umsetzung.

## Freigabe
2026-10-24 ~19:00 MESZ, Betreuung im Auftrag von Antonio: Freigabeliste Punkte 1–10 wie empfohlen; Punkt 11: Planung freigegeben 2500000 Token (statt empfohlen 2000000).

## Altfunktionen nach plane Exit 6
2026-10-24 ~19:12 MESZ, Betreuung: alle 10 von `plane` gemeldeten Belegfunktionen als „nicht berührt“ unter „## Altfunktionen“ (Vorschlag der Sitzung), neuer Lauf mit 2500000 Token.
