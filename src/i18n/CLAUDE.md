**Beispiel schlaegt Regel:** kein Regeltext traegt eine eckige Klammer — ein
Klammer-BEISPIEL im Prompt erzeugt genau das Verhalten, das die Regel verbietet
(Lehre 18.08.: das Prompt-Verbot mit Beispiel verlor gegen das Beispiel).
**Vorlage ist kanonisch, speechRules sind Uebersetzungen:** inhaltliche B1/B2- Aenderungen gehen im SELBEN
Commit an allen fuenf Stellen (Master-Prompt, soft_timeout-Override, speechRules de/en/fr) UND an ihren Pins
— wer nur eine Stelle aendert, erzeugt Drift zwischen Vorlage und speechRules, den kein Detektor sieht.
**Eroeffnungssaetze nur in `eroeffnung.js`:** der Wortlaut der Eroeffnung (Anruf an Dritte, Besitzer-Anruf) und der Name Hermes stehen nur dort. Vorlage (`first_message` = `{{eroeffnung}}`), Pruefkarte A6 und Docs verweisen darauf und schreiben keinen Satz ab; Tests halten die Ausgabe ueber den Anruf fest.

## Baustein texte (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Alle Texte und Sprachen.
- Darf nutzen: basis, begriffe, konfiguration, mail, sperrdaten
- Ort für Neues: Neue Dateien in `src/i18n/` gehören zu texte, solange tools/bausteine.json sie keinem anderen Baustein nennt.
- Eingang: Jede Datei in `src/i18n/` darf von anderen Bausteinen importiert werden.
