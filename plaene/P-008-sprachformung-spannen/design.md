# P-008 Sprachformung erhält Zahlenspannen und Unterstriche: Design Doc

Status: freigegeben
Pitch: plaene/P-008-sprachformung-spannen/pitch.md
Entscheidung: keine eigene technische Entscheidung (Design Doc: nein); dieses Dokument hält nur die Ausgangslage fest.

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| Vorhandene Hilfe für Zahlenspannen oder Unterstriche in gesprochenem Text: nichts gefunden. | `node tools/auftrag.mjs suche "range\|Spanne\|bis\b"`: keine Treffer; `suche "underscore\|Unterstrich"`: keine Treffer; `suche Bindestrich`: nur Website/Design-Doku und Testkennungen; Positivkontrolle `suche shapeForSpeech`: 5 Treffer (am 2026-10-24) | – |
| Die ganze Formung steht in `shapedCore`: Listenzeichen am Zeilenanfang, dann `[*_#\`]` entfernen, dann `\s+-\s+` → „, “, dann Leerraum falten, dann `trim`. | `src/speech-shape.js:1-10` (Zeile 4, 5, 6, 7, 8) | – |
| `shapeForSpeech` und `shapeChunkForSpeech` rufen beide `shapedCore`; `shapeForSpeech` entfernt danach `,;:` am Ende und hängt einen Punkt an, wenn kein `.!?` am Ende steht. | `src/speech-shape.js:12-21` | – |
| Aufrufer: die ganze Antwort des Sprachmodells, das Denk-Signal und das Streaming-Häppchen. | `src/claude.js:673` (`shapeForSpeech`), `src/thinking-signal.js:10` (`shapeForSpeech`), `src/speech-chunker.js:33` (`shapeChunkForSpeech`) | – |
| Der Text geht auf dem Telnyx-Weg als `<Say>` mit dem Stimmprofil der Anrufsprache an die Sprachausgabe; die Formung kennt die Sprache nicht. | `src/routes/voice.js:284-288`, `src/telephony/voice-render.js:14-19`, `src/telephony/adapters/telnyx/render.js:47-49` | – |
| Der Streaming-Weg schneidet nur hinter `.!?…` mit folgendem Leerraum. | `src/speech-chunker.js:5`, `:14-24` | Eine Spanne könnte auf zwei Häppchen verteilt werden; S3 bliebe trotzdem grün, weil es einen ganzen Satz streamt. |
| „14-15 Uhr“ ohne Leerraum geht heute unverändert an die Sprachausgabe. | `src/speech-shape.js:6` verlangt `\s+` auf beiden Seiten; Messung am master 7f5f1cb: `shapeForSpeech("Termin 14-15 Uhr")` = „Termin 14-15 Uhr.“ | – |
| `shapedCore` hat 2 Befunde `no-restricted-syntax` (Demeter G36: mehr als 4 verkettete Zugriffe), unterdrückt mit Zähler 2. | `node tools/auftrag.mjs karte src/speech-shape.js`; `eslint-suppressions.json:774`; Selektor `eslint.config.js:273-274` (vier verschachtelte `MemberExpression`) | Umbau würde nicht verlangt. |
| `src/speech-shape.js` und `src/speech-chunker.js` sind im Bereich `anrufe` als `fachlogik` eingetragen; Tests dürfen sie direkt importieren. | `tools/bereiche.json:74`, `:79`; Regel `tests-nur-ueber-eingaenge` `.dependency-cruiser.cjs:51-57` | Abnahmetest wäre rot an `abhaengigkeiten`. |
| Bestehende Tests prüfen nur Wort-Strich-Wort und Markdown-Unterstriche am Wortrand; keiner prüft Ziffer-Strich-Ziffer oder Unterstrich mitten im Wort. | `test/shape-for-speech.test.js:16-22`, `test/anrufe/sprechausgabe.test.js:59-62` | Ein bestehender Test würde mit der Änderung rot. |
| `test/anrufe/sprechausgabe.test.js` ruft die Formung direkt auf, ohne Modell-Attrappe. | `test/anrufe/sprechausgabe.test.js:3-4` | – |
