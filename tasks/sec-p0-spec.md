# SEC-P0 — Ergaenzung zum Phasenabschnitt in PLAN-SEC-FIX.md

Diese Datei ERGAENZT `PLAN-SEC-FIX.md` -> Abschnitt "SEC-P0 — Testbank gruen". Sie ersetzt ihn
nicht. Bei Widerspruch gilt der Plan.

## Frisch gemessener Ausgangsstand (Lead, heute, voller Lauf)

```
npm test  ->  EXIT 1
# tests 5803 / # pass 5801 / # fail 2 / # skipped 0 / # todo 0
not ok - KV2-10 (d1): Unterschaetzung (Minutensatz 10) -> GENAU EINE Mail und EINE SMS mit dem konkreten Paar
not ok - KV2-10 (d2): gedeckter Tarif (Minutensatz 20) -> KEINE Mail, KEINE SMS, nur die tarifpaar-Logzeile
```

In DIESEM Lauf haben die fuenf bekannten Flake-Dateien NICHT gefeuert. Das entkraeftet sie
nicht — sie sind lauf-abhaengig (Parallel-Last). Es heisst nur: der echte Defekt ist
reproduzierbar, die Flakes sind es nicht.

## (a) Der Tarifpaar-Defekt — wie die Richtungsfrage zu entscheiden ist

Der Plan sagt: "Erst entscheiden, ob der Test oder der Code die richtige Erwartung traegt."
Das ist eine echte Entscheidung, keine Formsache — und sie ist NICHT nach Aufwand zu treffen.

**Der Alarmkanal ist die geschuetzte Sache, nicht der Test.** Was der Kanal leisten muss:

- Bei Unterschaetzung (der hinterlegte Tarif deckt die Ist-Kosten nicht) MUSS genau EIN Alarm
  je Sachverhalt raus. Zwei Mails/SMS fuer denselben Sachverhalt sind ein Defekt mit zwei
  Kosten: Geld (SMS ist kostenpflichtig) und Vertrauen (ein Kanal, der doppelt meldet, wird
  weggefiltert und meldet dann gar nichts mehr).
- Bei gedecktem Tarif MUSS der Kanal SCHWEIGEN. Ein Alarm ohne Sachverhalt ist ein Fehlalarm —
  dieselben zwei Kosten, schlimmer.

Daraus folgt die Beweislast: **wer den TEST aendert, muss belegen, dass das heutige
CODE-Verhalten die obige Anforderung erfuellt** (also: dass "zwei Mails" bzw. "eine Mail bei
gedecktem Tarif" fachlich richtig ist, z.B. weil es zwei verschiedene Sachverhalte sind, die
nur gleich aussehen). Gelingt dieser Beleg nicht, ist der CODE zu fixen, nicht der Test.

Verboten, weil es Gruen ohne Wahrheit erzeugt:
- die beiden Faelle loeschen, `skip`en, in einen anderen Testlauf verschieben oder ihre
  Kennung/Namen so aendern, dass sie aus dem Regressionslauf fallen,
- die Zusicherung auf "mindestens eine" / "hoechstens zwei" aufweichen,
- den Alarm im Testmodus abschalten statt ihn richtig zu machen.

Wird der Test geaendert, gehoert die Begruendung als Kommentar an den Test — ein Satz, warum
das erwartete Verhalten sich geaendert hat.

## (b) Die fuenf Flake-Dateien — Wurzel, nicht Symptom

`auth-p5-internal-only`, `el-consult-timeout-spur`, `el-geldpfad-s1`, `telnyx-p5-origination`,
`al-p10-precall-research`. Einzeln gruen, unter Parallel-Last wechselnd rot.

Vorhandenes Wissen ZUERST lesen, es benennt die Bauart der Ursache:
`tasks/lessons.md` -> Lehren `suite-flake-p5-gate-proof` und
`verwaiste-testserver-elternwaechter`.

Zulaessige Fixes sind solche, die die RACE beseitigen (deterministische Bereitschaftspruefung
statt Zeitfenster, eigener Zustand/Port/Verzeichnis je Test, sauberes Aufraeumen des
Kindprozesses). Nicht zulaessig, weil es die Ursache nur verdeckt:
- Retry-Schleifen "bis gruen",
- pauschal erhoehte Timeouts als alleinige Massnahme,
- `--test-concurrency 1` oder ein anderes Serialisieren der ganzen Bank,
- `--test-skip-pattern` anfassen (der Plan verbietet es ausdruecklich).

## Testumfang in dieser Phase (Abweichung, die hier besonders zaehlt)

Die volle Suite faehrt der LEAD, zweimal, am Ende. Kein Agent faehrt sie. Fuer die Flake-Frage
ist der aussagekraeftige Agenten-Lauf ohnehin nicht die volle Bank, sondern die betroffenen
Dateien MEHRFACH hintereinander bzw. gemeinsam in EINEM `node --test`-Aufruf — genau dort
entsteht die Parallel-Last, die die Flake ausloest.

## Abnahme (unveraendert aus dem Plan, hier nur praezisiert wer misst)

Der Lead faehrt `npm test` ZWEIMAL hintereinander; beide Laeufe Exit 0. Zusaetzlich pruefbar
und nicht verhandelbar: `# skipped 0`, `# todo 0`, `# tests` NICHT kleiner als 5803, und
`--test-skip-pattern` in `test/testbaenke-run.mjs` unveraendert.
