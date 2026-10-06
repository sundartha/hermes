**Beispiel schlaegt Regel:** kein Regeltext traegt eine eckige Klammer — ein
Klammer-BEISPIEL im Prompt erzeugt genau das Verhalten, das die Regel verbietet
(Lehre 18.08.: das Prompt-Verbot mit Beispiel verlor gegen das Beispiel).
**Vorlage ist kanonisch, speechRules sind Uebersetzungen:** inhaltliche B1/B2- Aenderungen gehen im SELBEN
Commit an allen fuenf Stellen (Master-Prompt, soft_timeout-Override, speechRules de/en/fr) UND an ihren Pins
— wer nur eine Stelle aendert, erzeugt Drift zwischen Vorlage und speechRules, den kein Detektor sieht.
