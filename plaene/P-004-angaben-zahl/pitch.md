# P-004 Einzahl und Mehrzahl in der Bestätigung von answer_consult

Status: freigegeben
Planung freigegeben: 8000000 Token
Issue: 1883
Design Doc: nein, weil es nur einen ernsthaften Weg gibt (Beugung in den drei Meldungsfunktionen über `Intl.PluralRules`), weder Werkzeugvertrag noch Daten berührt werden und ein Code-Rollback alles zurücknimmt.

## Absicht
Der Agent eines Kunden soll nach einer angenommenen Antwort auf eine Rückfrage einen grammatisch richtigen Satz bekommen, in dem die Zahl der übergebenen Angaben richtig gebeugt ist, in Deutsch, Englisch und Französisch. Nicht gewollt ist, den übrigen Wortlaut, die strukturierte Antwort oder den Werkzeugvertrag zu ändern oder die Beugung mit einem festen Vergleich auf 1 abzukürzen. Im Zweifel bleibt der Satz so nah am heutigen wie möglich.

## Problem
Während eines Anrufs fragt der Agent am Telefon nach dem Namen des Hundes; Claude beantwortet die Rückfrage mit `answer_consult` und einer Angabe. Hermes bestätigt „1 detail(s) passed on to the call.“ (auf Deutsch „1 Angabe(n) an den Anruf uebergeben.“, auf Französisch „1 information(s) transmise(s) à l'appel.“). Der Satz mit Klammer-Endungen wirkt wie ein Platzhalter, und Claude gibt ihn oft wörtlich an den Kunden weiter.

## Ergebnis
Nach dieser Änderung bestätigt `answer_consult` eine angenommene Antwort mit einem Satz ohne Klammer-Endungen, in dem die Zahl der übergebenen Angaben nach den Regeln der Sprache gebeugt ist, in der der Satz steht, zum Beispiel „1 detail passed on to the call.“ und „2 details passed on to the call.“.

## Grobe Lösung
Der Agent des Kunden sieht nach einer Antwort auf eine Rückfrage denselben Satz wie bisher, nur ohne „(n)“, „(s)“ und „(e)“: Einzahl, wenn die Sprache die Zahl als Einzahl behandelt (im Französischen auch 0), sonst Mehrzahl. Beteiligt sind nur die drei Bestätigungstexte in Deutsch, Englisch und Französisch; das Werkzeug ruft sie wie bisher mit der Zahl auf, die strukturierte Antwort bleibt gleich.

## Fallen
- Französisch beugt 0 in der Einzahl, Deutsch und Englisch in der Mehrzahl; ein fester Vergleich `count === 1` trifft Französisch bei 0 falsch: Die Kategorie kommt aus `Intl.PluralRules` der Sprache der gewählten Texttabelle, nicht der rohen Kontosprache, damit eine künftige Kontosprache ohne eigene Tabelle (etwa Portugiesisch, das 0 als Einzahl behandelt) die Regeln der Ersatztabelle bekommt; heute sind Kontosprachen auf `de`, `en`, `fr` begrenzt.
- Die deutsche MCP-Tabelle schreibt durchgehend in Umschrift („uebergeben“): Das bleibt so, diese Änderung stellt keine Umlaute um.

## Anforderungen

### Regel R1: Die Bestätigung von `answer_consult` mit `status` `"final"` beugt die Zahl der übergebenen Angaben nach der Sprache, in der der Satz steht.

#### Szenario S1: Eine Angabe auf Englisch
Gegeben ein Konto mit Sprache Englisch und eine offene Rückfrage, für die Hermes `merged_facts` `1` meldet
Wenn der Agent `answer_consult` mit `status` `"final"` und einer Antwort aufruft
Dann lautet der Text der Antwort „1 detail passed on to the call.“

#### Szenario S2: Zwei Angaben auf Englisch
Gegeben ein Konto mit Sprache Englisch und eine offene Rückfrage, für die Hermes `merged_facts` `2` meldet
Wenn der Agent `answer_consult` mit `status` `"final"` und zwei Antworten aufruft
Dann lautet der Text der Antwort „2 details passed on to the call.“

#### Szenario S3: Eine Angabe auf Deutsch
Gegeben ein Konto mit Sprache Deutsch und eine offene Rückfrage, für die Hermes `merged_facts` `1` meldet
Wenn der Agent `answer_consult` mit `status` `"final"` und einer Antwort aufruft
Dann lautet der Text der Antwort „1 Angabe an den Anruf uebergeben.“

#### Szenario S4: Drei Angaben auf Deutsch
Gegeben ein Konto mit Sprache Deutsch und eine offene Rückfrage, für die Hermes `merged_facts` `3` meldet
Wenn der Agent `answer_consult` mit `status` `"final"` und drei Antworten aufruft
Dann lautet der Text der Antwort „3 Angaben an den Anruf uebergeben.“

#### Szenario S5: Null Angaben auf Französisch
Gegeben ein Konto mit Sprache Französisch und eine offene Rückfrage, für die Hermes `merged_facts` `0` meldet
Wenn der Agent `answer_consult` mit `status` `"final"` und einer Antwort aufruft
Dann lautet der Text der Antwort „0 information transmise à l'appel.“

#### Szenario S6: Zwei Angaben auf Französisch
Gegeben ein Konto mit Sprache Französisch und eine offene Rückfrage, für die Hermes `merged_facts` `2` meldet
Wenn der Agent `answer_consult` mit `status` `"final"` und zwei Antworten aufruft
Dann lautet der Text der Antwort „2 informations transmises à l'appel.“

## Bleibt unverändert

### Szenario B1: Strukturierte Antwort
Gegeben ein Konto mit Sprache Englisch und eine offene Rückfrage, für die Hermes `merged_facts` `2` meldet
Wenn der Agent `answer_consult` mit `status` `"final"` und zwei Antworten aufruft
Dann enthält die strukturierte Antwort `accepted` `true` und `merged_facts` `2`

### Szenario B2: Zwischenbestätigung
Gegeben ein Konto mit Sprache Englisch und eine offene Rückfrage
Wenn der Agent `answer_consult` mit `status` `"working"` aufruft
Dann lautet der Text der Antwort „Consult acknowledged - the answer is expected next.“

## Nicht-Ziele
- Nicht Teil dieser Änderung: andere Meldungen des MCP-Katalogs, Umlaute in der deutschen Tabelle und ein Sonderwortlaut für 0 („Keine Angabe“), weil die Probe nur die Klammer-Endungen dieser einen Bestätigung behebt.
- Nicht Teil dieser Änderung: die strukturierte Antwort (`accepted`, `merged_facts`), das Werkzeug selbst und `docs/mcp-vertrag.json`, weil sich der Werkzeugvertrag für fremde Clients nicht ändern soll.

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
| PM1 | Weil die Beugung nach der rohen Kontosprache statt nach der Sprache der gewählten Tabelle laufen könnte, entsteht bei einem Konto mit Sprache ohne eigene Tabelle (Portugiesisch behandelt 0 als Einzahl) „0 detail passed on to the call.“, und Claude gibt den falschen Satz wörtlich weiter. | hingenommen: tritt heute nicht ein, weil eine Kontosprache nur `de`, `en` oder `fr` sein kann (`SUPPORTED_LANGUAGES` = Schlüssel von `LOCALES`, `src/i18n/locales.js:380`; Store-Prüfung `src/store/state-ops.js:2627-2644`), Tabelle und Kontosprache also immer gleich sind; die Falle oben hält die Bauregel für künftige Sprachen fest; Entscheidung der Betreuung steht aus |
