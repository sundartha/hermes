# P-005 Gemeinsame Beugungs-Hilfe für die Bestätigung von answer_consult

Status: freigegeben
Planung freigegeben: 4000000 Token
Issue: 1890
Design Doc: nein, weil es nur einen ernsthaften Weg gibt (eine gemeinsame Hilfe in der Datei der MCP-Texte, die die drei Tabelleneinträge nutzen), weder Werkzeugvertrag noch Daten berührt werden und ein Code-Rollback alles zurücknimmt.

## Absicht
Die Einzahl/Mehrzahl-Wahl der Bestätigung von `answer_consult` soll an genau einer Stelle stehen: eine gemeinsame kleine Hilfe nimmt Sprache, Einzahl-Text und Mehrzahl-Text, und die deutsche, englische und französische Tabelle nutzen sie, statt dieselbe Wahl dreimal mit eigener Zwischenvariable auszuschreiben. Nicht gewollt ist, den ausgegebenen Wortlaut, die Sprache, nach der gebeugt wird, die strukturierte Antwort oder bestehende Tests zu ändern, und ebenso wenig, die Wiederholung nur so umzuformen, dass keine Prüfung sie mehr meldet. Im Zweifel gilt: jede Sprache gibt byte-gleich aus wie vorher, und die Wahl steht einmal.

## Problem
Heute: Jeder der drei Bestätigungstexte für eine angenommene Antwort auf eine Rückfrage legt selbst ein `Intl.PluralRules`-Objekt seiner Sprache an, vergleicht mit `"one"`, wählt zwischen zwei Sätzen, legt das Ergebnis in eine Zwischenvariable `form` und gibt sie zurück (`src/i18n/mcp-texts.js:114-117`, `:224-227`, `:335-338`); kommt eine vierte Sprache oder eine zweite gebeugte Meldung dazu, wird dieselbe Form ein weiteres Mal kopiert.

## Ergebnis
Nach dieser Änderung verhält sich Hermes nach außen wie bisher, und die Wahl zwischen Einzahl und Mehrzahl steht für die drei Bestätigungstexte an 1 Stelle statt an 3 Stellen, ohne Zwischenvariable `form`.

## Grobe Lösung
Niemand soll etwas bemerken: Der Agent des Kunden bekommt nach `answer_consult` mit `status` `"final"` denselben Satz wie heute, in Deutsch, Englisch und Französisch. Eine kleine gemeinsame Hilfe in der Datei der MCP-Texte nimmt die Sprache der Tabelle, den Einzahl-Text und den Mehrzahl-Text, beide als Text abhängig von der Zahl, und liefert den fertigen Bestätigungstext als Funktion der Zahl. Die drei Tabelleneinträge rufen nur noch diese Hilfe mit ihren beiden Sätzen auf. Das Werkzeug ruft den Bestätigungstext wie bisher mit der Zahl der übergebenen Angaben auf.

## Fallen
- Die Sprache der Beugung könnte beim Umbau von der Sprache der Tabelle auf die Kontosprache wandern: Die Hilfe bekommt weiter das feste Sprachkürzel der eigenen Tabelle (`"de"`, `"en"`, `"fr"`), wie in P-004 entschieden; ein Wechsel wäre eine Verhaltensänderung.
- Die Wortstellung unterscheidet sich je Sprache, und ein späterer Text muss die Zahl nicht vorne tragen: Die Hilfe setzt keinen Satz aus „Zahl + Wort“ zusammen und ersetzt keine Platzhalter; Einzahl- und Mehrzahl-Text bleiben vollständige Sätze, die die Zahl selbst einsetzen.
- `Intl.PluralRules` wird heute bei jedem Aufruf neu angelegt: Das bleibt so; die Hilfe legt das Objekt erst beim Aufruf an, nicht beim Laden der Datei, damit ein Fehler im Sprachkürzel wie heute nur diese eine Meldung trifft (PM1).
- Es gibt im Repo keine vorhandene Einzahl/Mehrzahl-Hilfe, die der Produktcode nutzen könnte (Suche über `src/`, `apps/`, `tools/`, `scripts/` in `design.md`, „Ausgangslage und Annahmen“): Die Hilfe entsteht neu, nicht exportiert, in der Datei der MCP-Texte, weil sie dort ihren einzigen Nutzer hat und eine eigene Datei nur eine neue Import-Kante brächte.
- Die deutsche MCP-Tabelle schreibt durchgehend in Umschrift („uebergeben“): Das bleibt so.

## Anforderungen
keine neuen, weil sich nach außen nichts ändert; der Wortlaut je Sprache ist schon durch die bestehenden Abnahmetests S1–S6 und B1–B2 aus P-004 über den Eingang `answer_consult` geprüft, und diese Tests bleiben unverändert grün.

## Bleibt unverändert
keins, weil kein neues Szenario nötig ist: die bestehenden Tests „answer_consult final: S1“ bis „S6“ sowie „B1“ und „B2“ in der Testdatei zur gebeugten Angabenzahl prüfen über `answer_consult` die Sätze „1 detail passed on to the call.“, „2 details passed on to the call.“, „1 Angabe an den Anruf uebergeben.“, „3 Angaben an den Anruf uebergeben.“, „0 information transmise à l'appel.“, „2 informations transmises à l'appel.“, die strukturierte Antwort und die Zwischenbestätigung; ein zusätzliches Szenario würde denselben Wortlaut ein zweites Mal testen.

## Nicht-Ziele
- Nicht Teil dieser Änderung: andere Meldungen des MCP-Katalogs oder anderer Textdateien, weil es heute keine zweite gebeugte Meldung gibt; sie nutzen die Hilfe erst, wenn eine entsteht.
- Nicht Teil dieser Änderung: Umlaute in der deutschen Tabelle, ein Sonderwortlaut für 0, die strukturierte Antwort (`accepted`, `merged_facts`), das Werkzeug selbst und `docs/mcp-vertrag.json`, weil der Umbau nur die Struktur der drei Bestätigungstexte betrifft.
- Nicht Teil dieser Änderung: das `Intl.PluralRules`-Objekt vorab beim Laden anzulegen, weil das ein reiner Umbau im kleinsten Schritt ist und ein vorab angelegtes Objekt einen Fehler im Sprachkürzel vom Aufruf an den Import der Datei verlegen würde (PM1).
- Nicht Teil dieser Änderung: Sprachen mit mehr als zwei Pluralformen (etwa Polnisch, Russisch, Tschechisch, Arabisch mit `two`, `few` oder `many`), weil die Hilfe wie heute genau zwischen `"one"` und dem Rest wählt; wer eine solche Sprache einführt, erweitert die Hilfe in derselben Änderung und ergänzt einen Abnahmetest je zusätzlicher Form.
- Nicht Teil dieser Änderung: neue oder geänderte Tests, weil der Umbau kein Verhalten ändert und die bestehenden Tests den Wortlaut schon prüfen.

## Neue Begriffe
keine

## Offene Fragen

### Vor dem Bau zu klären
keine

### Kann warten
keine

## Premortem
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil die Hilfe das `Intl.PluralRules`-Objekt schon beim Laden der Datei anlegt statt erst beim Aufruf, wirft ein fehlerhaftes Sprachkürzel einer künftigen Tabelle (etwa `"pt_BR"`) schon beim Import einen RangeError, und die Folge ist, dass die ganze Datei der MCP-Texte und damit der Dienst nicht startet statt nur diese eine Bestätigung zu scheitern. | Nicht-Ziel (Objekt vorab beim Laden anlegen); die Betreuung hat die Entscheidung, es beim Laden anzulegen, zurückgenommen |
| PM2 | Weil die Hilfe nur Einzahl- und Mehrzahl-Text kennt, das Problem aber eine künftige vierte Sprache als Nutzerin nennt, bekommt eine Sprache mit mehr Formen (Polnisch, Russisch) einen falsch gebeugten Satz, und kein Test meldet das, weil S1–S6 nur `de`, `en`, `fr` prüfen. | Nicht-Ziel (Sprachen mit mehr als zwei Pluralformen) |
