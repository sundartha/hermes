# P-006 Vollständige Sätze in der Beugungs-Hilfe von answer_consult: Design Doc

Status: freigegeben
Pitch: plaene/P-006-saetze-hilfe/pitch.md
Entscheidung: keine eigene technische Entscheidung (Design Doc: nein); dieses Dokument hält nur die Ausgangslage fest.

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| `answer_consult` mit `status` `"final"` antwortet mit `loc.mcp.consultAnswerAccepted(mergedFacts)`; das ist der einzige Aufrufer im Produktcode. | `src/mcp-tools.js:1018`; `grep -rn consultAnswerAccepted src test` am 2026-10-24 | – |
| Die Hilfe `countedText(lang, singular, plural)` gibt `(count) => \`${count} ${… === "one" ? singular : plural}\`` zurück, setzt also Zahl, Leerzeichen und Wort selbst zusammen; `singular` und `plural` sind heute Texte ohne Zahl. | `src/i18n/mcp-texts.js:4-6` | – |
| Die drei Tabellen rufen die Hilfe mit festem Sprachkürzel und zwei Texten auf. | `src/i18n/mcp-texts.js:118` (de), `:225` (en), `:333` (fr) | – |
| `countedText` hat außer diesen drei Einträgen keinen Nutzer und wird nicht exportiert. | `grep -rn countedText src test` am 2026-10-24: nur `src/i18n/mcp-texts.js:4`, `:118`, `:225`, `:333` | – |
| Der Wortlaut je Sprache ist über den Eingang `answer_consult` schon geprüft: „answer_consult final: S1“ bis „S6“, „B1“, „B2“. | `test/gemeinsam/rueckfrage-bestaetigung-beugt-angabenzahl.test.js:38-80` | – |
| Ein weiterer Test vergleicht die Bestätigung mit `consultAnswerAccepted(2)` statt mit festem Wortlaut; er bleibt gültig, solange der Tabelleneintrag eine Funktion der Zahl bleibt. | `test/al-p13-consult-channel.test.js:873` | Wäre der Eintrag keine Funktion der Zahl mehr, würde dieser Test rot. |
| `src/i18n/mcp-texts.js` steht weder in `eslint-legacy-exceptions.json` noch in `eslint-suppressions.json`; in `tools/basis/` nur in `test-importe.json` als Importziel bestehender Tests. | grep am 2026-10-24 | – |
| Die Lint-Regeln verlangen Namen mit mindestens 2 Zeichen außer `i`, `j`, `k` und höchstens 3 Parameter; ein Satz als `(n) => …` wäre rot. | `eslint.config.js:522`, `:549`; P-005 Lauf Runde 1 rot an `id-length` | Bau-Runde scheitert an lint. |
| Eine Vorlagen-Zeichenkette `${count}` mit einer Zahl ergibt dieselben Bytes wie heute, weil die Hilfe die Zahl heute ebenso über `${count}` einsetzt. | `src/i18n/mcp-texts.js:5` | Ausgabe wäre nicht byte-gleich; S1–S6 würden rot. |
