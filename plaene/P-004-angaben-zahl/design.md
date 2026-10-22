# P-004 Einzahl und Mehrzahl in der Bestätigung von answer_consult: Design Doc

Status: freigegeben
Pitch: plaene/P-004-angaben-zahl/pitch.md
Entscheidung: keine eigene technische Entscheidung (Design Doc: nein); dieses Dokument hält nur die Ausgangslage fest.

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| `answer_consult` mit `status` `"final"` antwortet mit `loc.mcp.consultAnswerAccepted(mergedFacts)`; `mergedFacts` ist `merged_facts` aus der internen Antwort oder 0. | `src/mcp-tools.js:1016-1019` | – |
| Mit `status` `"working"` antwortet das Werkzeug mit `consultAckAccepted` und `merged_facts` 0, ohne `consultAnswerAccepted`. | `src/mcp-tools.js:1010-1014` | – |
| Die drei Bestätigungstexte sind einzeilige Funktionen mit Klammer-Endungen. | `src/i18n/mcp-texts.js:114`, `:221`, `:329` | – |
| `src/i18n/mcp-texts.js` steht weder in `eslint-legacy-exceptions.json` noch in `eslint-suppressions.json`. | grep, 2026-10-23 | – |
| Die Sprache der Meldungen kommt je Konto; Sprachen ohne eigene Tabelle fallen auf Englisch zurück. | `src/routes/mcp.js:95`, `src/i18n/locales.js:406-407` | – |
| `Intl.PluralRules` liefert für 0/1/2: de other/one/other, en other/one/other, fr one/one/other. | nachgemessen in Node 22, 2026-10-23 | – |
| Ein bestehender Test vergleicht die Bestätigung mit `consultAnswerAccepted(2)` statt mit festem Wortlaut. | `test/al-p13-consult-channel.test.js:873` | – |
