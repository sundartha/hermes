# Vorlage: Phasendatei für einen Fehler

Ablage: `plaene/F-<Nummer>-<kurzname>/phase.json`. `<Nummer>` ist die nächste freie dreistellige Nummer unter `plaene/F-*`. Was in spitzen Klammern steht, ersetzt du; alles andere bleibt so.

```json
{
  "phase": "F-<Nummer>-<kurzname>",
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
      "vorbild": "<bestehende Datei, deren Stil der Fix übernimmt>",
      "abnahme": "test/<name>.test.js",
      "erwarteterFehler": "<Meldung, mit der der Abnahmetest heute aus dem gemeldeten Grund rot wird, eine Zeile>",
      "wasDarfNiePassieren": ["<das Verhalten, das gleich bleiben muss, als prüfbarer Satz>"]
    }
  ]
}
```

Bleibt nichts Besonderes gleich, ist `wasDarfNiePassieren` die leere Liste `[]`, und der Grund steht im Entwurf.

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
