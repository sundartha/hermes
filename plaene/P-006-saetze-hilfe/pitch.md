# P-006 Vollständige Sätze in der Beugungs-Hilfe von answer_consult

Status: freigegeben
Planung freigegeben: 1000000 Token
Issue: 1915
Design Doc: nein, weil es nur einen ernsthaften Weg gibt (Einzahl- und Mehrzahl-Text werden je eine Funktion der Zahl, die Hilfe wählt nur noch zwischen ihnen), weder Werkzeugvertrag noch Daten berührt werden und ein Code-Rollback alles zurücknimmt.

## Absicht
Die gemeinsame Hilfe für die Bestätigung von `answer_consult` soll nur noch zwischen zwei vollständigen Sätzen wählen, die die Zahl selbst einsetzen, statt selbst Zahl und Wort zusammenzusetzen, damit eine Sprache die Zahl später an eine andere Stelle des Satzes stellen kann, ohne die Hilfe zu ändern. Nicht gewollt ist, den ausgegebenen Wortlaut, die Sprache, nach der gebeugt wird, die strukturierte Antwort oder bestehende Tests zu ändern, und ebenso wenig, die Zusammensetzung nur so umzuformen, dass sie anders aussieht, aber weiter in der Hilfe geschieht. Im Zweifel gilt: jede Sprache gibt byte-gleich aus wie vorher, und die Hilfe fügt nichts an die Sätze an.

## Problem
Heute: Die gemeinsame Hilfe `countedText` bekommt nur die Wörter nach der Zahl („Angabe an den Anruf uebergeben.“) und setzt den Satz selbst als Zahl, Leerzeichen und Wort zusammen (`src/i18n/mcp-texts.js:4-6`); eine Sprache, in der die Zahl nicht am Satzanfang steht, kann die Hilfe deshalb nicht nutzen, und das widerspricht der freigegebenen Falle aus P-005 (`plaene/P-005-beugung-hilfe/pitch.md`, „Fallen“, zweiter Punkt).

## Ergebnis
Nach dieser Änderung verhält sich Hermes nach außen wie bisher, und die Hilfe setzt an 0 Stellen statt an 1 Stelle Zahl und Wort zusammen; die 6 Sätze der drei Tabellen (de, en, fr, je Einzahl und Mehrzahl) setzen die Zahl selbst ein.

## Grobe Lösung
Niemand soll etwas bemerken: Der Agent des Kunden bekommt nach `answer_consult` mit `status` `"final"` denselben Satz wie heute, in Deutsch, Englisch und Französisch. Jede Tabelle gibt der Hilfe ihr festes Sprachkürzel und zwei vollständige Sätze, beide als Funktion der Zahl, die die Zahl an ihrer Stelle selbst einsetzen. Die Hilfe wählt nach der Pluralregel der Sprache einen der beiden Sätze und ruft ihn mit der Zahl auf; sie fügt selbst nichts hinzu. Das Werkzeug ruft den Bestätigungstext wie bisher mit der Zahl der übergebenen Angaben auf.

## Fallen
- Die Wortstellung unterscheidet sich je Sprache, und ein späterer Text muss die Zahl nicht vorne tragen: Die Hilfe setzt keinen Satz aus „Zahl + Wort“ zusammen und ersetzt keine Platzhalter; Einzahl- und Mehrzahl-Text bleiben vollständige Sätze, die die Zahl selbst einsetzen.
- Das Zusammensetzen könnte nur an eine andere Stelle wandern, etwa in eine Fabrik `(wort) => (count) => \`${count} ${wort}\`` neben `countedText`, die die Sätze erzeugt, und alle Tests blieben grün (PM1): Keine Funktion in der Datei der MCP-Texte macht aus einem Wort einen Satz mit Zahl; jeder der 6 Sätze steht ausgeschrieben als eigene Funktion der Zahl in seiner Tabelle. Die Sitzung prüft das vor dem Push über die ganze Datei.
- Die Sprache der Beugung könnte beim Umbau von der Sprache der Tabelle auf die Kontosprache wandern: Die Hilfe bekommt weiter das feste Sprachkürzel der eigenen Tabelle (`"de"`, `"en"`, `"fr"`), wie in P-004 entschieden; ein Wechsel wäre eine Verhaltensänderung.
- `Intl.PluralRules` wird heute bei jedem Aufruf neu angelegt: Das bleibt so; die Hilfe legt das Objekt erst beim Aufruf an, nicht beim Laden der Datei, damit ein Fehler im Sprachkürzel wie heute nur diese eine Meldung trifft (P-005 PM1).
- Die Hilfe wählt heute genau zwischen `"one"` und dem Rest: Das bleibt so, ohne weitere Pluralformen.
- Die deutsche MCP-Tabelle schreibt durchgehend in Umschrift („uebergeben“): Das bleibt so.

## Anforderungen
keine neuen, weil sich nach außen nichts ändert; der Wortlaut je Sprache ist schon durch die bestehenden Abnahmetests S1–S6 und B1–B2 aus P-004 über den Eingang `answer_consult` geprüft, und diese Tests bleiben unverändert grün.

## Bleibt unverändert
keins, weil kein neues Szenario nötig ist: die bestehenden Tests „answer_consult final: S1“ bis „S6“ sowie „B1“ und „B2“ in der Testdatei zur gebeugten Angabenzahl prüfen über `answer_consult` die Sätze „1 detail passed on to the call.“, „2 details passed on to the call.“, „1 Angabe an den Anruf uebergeben.“, „3 Angaben an den Anruf uebergeben.“, „0 information transmise à l'appel.“, „2 informations transmises à l'appel.“, die strukturierte Antwort und die Zwischenbestätigung; ein zusätzliches Szenario würde denselben Wortlaut ein zweites Mal testen.

## Nicht-Ziele
- Nicht Teil dieser Änderung: die Zahl in einer Sprache an eine andere Stelle des Satzes zu stellen, weil der Umbau die freie Wortstellung nur möglich macht und die Ausgabe byte-gleich bleiben muss.
- Nicht Teil dieser Änderung: Name, Parameterliste oder Ort der Hilfe (`countedText(lang, singular, plural)`, nicht exportiert, in der Datei der MCP-Texte), weil ein Umbau im kleinsten Schritt nur die Form der beiden Satz-Argumente ändert.
- Nicht Teil dieser Änderung: andere Meldungen des MCP-Katalogs oder anderer Textdateien, Umlaute in der deutschen Tabelle, ein Sonderwortlaut für 0, die strukturierte Antwort (`accepted`, `merged_facts`), das Werkzeug selbst und `docs/mcp-vertrag.json`, weil der Umbau nur die Form der drei Bestätigungstexte betrifft.
- Nicht Teil dieser Änderung: neue oder geänderte Tests, auch kein Test auf die Form der Hilfe, weil der Umbau kein Verhalten ändert, die bestehenden Tests den Wortlaut schon prüfen und ein Strukturtest bei einem reinen Umbau rot würde, ohne dass sich für einen Kunden etwas ändert; die Falle „keine Zahl + Wort“ prüft die Sitzung vor dem Push am Code.

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
| PM1 | Weil kein Test die Form der Hilfe prüft und die Tests nur den Wortlaut sehen, besteht auch ein Bau alle Tests, der das Zusammensetzen nur an eine andere Stelle schiebt (etwa eine Fabrik `(wort) => (count) => \`${count} ${wort}\`` neben `countedText`, die die sechs Sätze erzeugt), und die Folge ist, dass die Zahl weiter fest vor dem Wort hängt und eine spätere Sprache mit anderer Wortstellung die Hilfe erneut umbauen muss. | Falle (Fabrik verboten) und hingenommen: kein Verhaltenstest kann die beiden Formen unterscheiden (`merged_facts` 0–10, beide Formen liefern denselben Text), ein Strukturtest ist nach `CLAUDE.md` nicht erlaubt; die Prüfung vor dem Push am Code erfasst die ganze Datei der MCP-Texte, auch Fabriken oder Hilfsfunktionen neben `countedText` (Betreuung 2026-10-24) |
