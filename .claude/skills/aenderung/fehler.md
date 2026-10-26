# Vorlage: Phasendatei für einen Fehler

Ablage: `plaene/F-<Nummer>-<kurzname>/phase.json`. `<Nummer>` ist die nächste freie dreistellige Nummer unter `plaene/F-*`; mit zählen die Ordner `plaene/F-*` in jedem Worktree unter `.claude/worktrees/` des Hauptklons, denn eine vertrauliche Phase liegt bis zur Veröffentlichung nur dort. Was in spitzen Klammern steht, ersetzt du; alles andere bleibt so.

```json
{
  "phase": "F-<Nummer>-<kurzname>",
  "issue": <Nummer des Issues>,
  "absicht": "<2 bis 4 Sätze: wofür die Behebung da ist, welche Abkürzung nicht gewollt ist, wie im Zweifel zu wählen ist>",
  "entwurf": {
    "<bereich>": "<Entwurf, siehe unten, Zeilen mit \\n getrennt>"
  },
  "auftraege": [
    {
      "id": "a1",
      "art": "fehlerbehebung",
      "ziel": "<was nach dem Fix richtig ist, eine Zeile, höchstens 72 Zeichen>",
      "bereich": "<Datei, oder Ordner mit / am Ende, in dem der Fix liegt>",
      "erwarteteDateien": ["<Dateien im Bereich, die sich ändern>", "<Pfad aus abnahme>"],
      "abnahme": "test/<name>.test.js",
      "erwarteterFehler": "<wörtlicher Text der Meldung, mit der der Abnahmetest heute aus dem gemeldeten Grund rot wird, eine Zeile>",
      "wasDarfNiePassieren": ["<das Verhalten, das gleich bleiben muss, als prüfbarer Satz>"]
    }
  ]
}
```

- `issue`: Leg das Issue an, bevor du `lauf` startest, und trag seine Nummer ein. Sein erster Abschnitt ist `## Absicht` mit genau dem Text aus `absicht`; `lauf` gleicht beides ab und hält sonst an. Eine vertrauliche Phase hat statt `issue` das Feld `"vertraulich": true` (`vertraulich.md`).
- `erwarteterFehler`: `lauf` sucht diesen Text wörtlich in der Fehlermeldung des roten Abnahmetests; ein Testname zählt nicht. Der Test-Agent gibt ihn dem `assert`, das heute fehlschlägt, als Meldung mit, etwa `assert.equal(ist, soll, "<erwarteterFehler>")`. Steht der Text so in keiner Meldung, ist die Runde rot („nicht mit dem erwarteten Fehler“), auch wenn der Test aus dem richtigen Grund fehlschlägt.
- Bleibt nichts Besonderes gleich, ist `wasDarfNiePassieren` die leere Liste `[]`, und der Grund steht im Entwurf.

## Entwurf

```text
Was passiert: <ein Satz>
Was passieren sollte: <ein Satz>
Wie man es auslöst: <ein Satz>
Bleibt gleich: <beobachtbares Verhalten nahe der Stelle> (oder: nichts Besonderes, weil <Grund>)
Vermutete Diagnose: <wo weicht es ab, woran sieht man es, warum>
Echte Inhalte gelesen: keine (oder: Anruf <ID>, weil <Grund>)
Nicht-Ziele: <je mit „weil“> (oder: keine)

Premortem:
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil <Umstand>, passiert <Ereignis>, und die Folge ist <Folge>. | <Test: Satz in wasDarfNiePassieren> oder <Nicht-Ziel> oder <hingenommen: Grund> |
(oder unter der leeren Tabelle: Keine Gründe gefunden, weil <Grund>)
```
