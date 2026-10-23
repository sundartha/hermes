# P-005 Gemeinsame Beugungs-Hilfe für die Bestätigung von answer_consult: Design Doc

Status: freigegeben
Pitch: plaene/P-005-beugung-hilfe/pitch.md
Entscheidung: keine eigene technische Entscheidung (Design Doc: nein); dieses Dokument hält nur die Ausgangslage fest.

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| `answer_consult` mit `status` `"final"` antwortet mit `loc.mcp.consultAnswerAccepted(mergedFacts)`; `mergedFacts` ist `merged_facts` aus der internen Antwort oder 0. Das ist der einzige Aufrufer. | `src/mcp-tools.js:1016-1019`; `grep -rn consultAnswerAccepted src` | – |
| Die drei Bestätigungstexte legen je ein `Intl.PluralRules` mit dem festen Kürzel ihrer Tabelle an, wählen zwischen zwei Sätzen und geben die Zwischenvariable `form` zurück. | `src/i18n/mcp-texts.js:114-117` (de), `:224-227` (en), `:335-338` (fr) | – |
| Es gibt im Repo keine vorhandene Einzahl/Mehrzahl-Hilfe, die der Produktcode nutzen könnte. Gesucht am 2026-10-23 mit `grep -rIn -i -E "PluralRules\|plural\|singular\|einzahl\|mehrzahl"` und `grep -rIn -E "(===\|==) ?1 \?"` über `src/`, `apps/` (`web`, `hermes-studio`, `hermes-animation-lab`), `tools/` und `scripts/`, ohne `node_modules` und `dist`. Treffer außerhalb von `mcp-texts.js` sind nur Werkzeug-Code: die Objektfelder `einzahl`/`mehrzahl` in `tools/auftrag/planung/schnitt.mjs:324-325` sowie die deutschen Einzeiler `=== 1 ? "1 Tag" : …` in `tools/systemstand.mjs:267` und `=== 1 ? "1 Platz" : …` in `tools/schwerlauf/sperre.mjs:304`. Keiner ist eine wiederverwendbare Funktion mit Sprache, und `tools/` ist für `src/` kein Importziel. | Suche oben, Protokoll P-005 | – |
| `src/i18n/mcp-texts.js` steht weder in `eslint-legacy-exceptions.json` noch in `eslint-suppressions.json`. | grep, 2026-10-23 | – |
| Die Tabellen haben kein Sprachfeld; das Locale-Objekt hängt sie als `mcp: MCP_TEXTS.de\|fr\|en` ein. Das Sprachkürzel der Beugung steht deshalb als Literal in der jeweiligen Tabelle. | `src/i18n/mcp-texts.js:22-23`, `:137`; `src/i18n/locales.js:168`, `:253`, `:336` | – |
| `Intl.PluralRules` liefert für 0/1/2/1,5/−1: de other/one/other/other/one, en other/one/other/other/one, fr one/one/other/one/one. Für `de`, `en` und `fr` wirft das Anlegen nicht. Die Hilfe legt das Objekt wie heute je Aufruf an (Pitch, Fallen und Nicht-Ziele, PM1). | nachgemessen in Node 22.23.2, 2026-10-23 | – |
| Der Wortlaut je Sprache ist über den Eingang `answer_consult` schon geprüft: „answer_consult final: S1“ bis „S6“, „B1“, „B2“. | `test/gemeinsam/rueckfrage-bestaetigung-beugt-angabenzahl.test.js:38-67` | – |
| Ein weiterer Test vergleicht die Bestätigung mit `consultAnswerAccepted(2)` statt mit festem Wortlaut; er bleibt nach dem Umbau gültig, solange der Tabelleneintrag eine Funktion der Zahl bleibt. | `test/al-p13-consult-channel.test.js:873` | Wäre der Eintrag keine Funktion mehr, würde dieser Test rot; die grobe Lösung hält den Eintrag als Funktion der Zahl fest. |
