# Vorlage: Phasendatei für eine einfache Änderung

Ablage: `plaene/E-<Nummer>-<kurzname>/phase.json`. `<Nummer>` ist die nächste freie dreistellige Nummer unter `plaene/E-*`. Was in spitzen Klammern steht, ersetzt du; alles andere bleibt so.

```json
{
  "phase": "E-<Nummer>-<kurzname>",
  "entwurf": {
    "<bereich>": "<Entwurf, siehe unten, Zeilen mit \\n getrennt>"
  },
  "auftraege": [
    {
      "id": "a1",
      "art": "<funktion oder umbau>",
      "ziel": "<was sich ändert, eine Zeile, höchstens 72 Zeichen>",
      "bereich": "<Datei, oder Ordner mit / am Ende, in dem die Änderung liegt>",
      "erwarteteDateien": ["<Dateien im Bereich, die sich ändern>", "<Pfad aus abnahme>"],
      "vorbild": "<bestehende Datei, deren Stil die Änderung übernimmt>",
      "abnahme": "test/<name>.test.js",
      "erwarteterFehler": "<nur bei funktion: Meldung, mit der der Abnahmetest heute rot wird, eine Zeile>",
      "wasDarfNiePassieren": ["<das Verhalten, das gleich bleiben muss, als prüfbarer Satz>"]
    }
  ]
}
```

- `funktion`: Die Änderung zeigt sich von außen. `abnahme` ist ein neuer Abnahmetest über den echten Eingang, der heute mit `erwarteterFehler` rot wird.
- `umbau`: Nur der Aufbau des Codes ändert sich, oder nur die Gestaltung der Website. `abnahme` ist ein bestehender Verhaltenstest, der grün bleibt; `erwarteterFehler` fällt weg.
- Bleibt nichts Besonderes gleich, ist `wasDarfNiePassieren` die leere Liste `[]`, und der Grund steht im Entwurf.

## Entwurf

```text
Was sich ändert: <ein Satz>
Bleibt gleich: <beobachtbares Verhalten> (oder: nichts Besonderes, weil <Grund>)
Abnahme: <Bildschirmfotos vorher und nachher, Desktop und Handy | Testgespräche über die geänderte Stelle und die festen Fälle | Abnahmetest über den echten Eingang> (bei Umbau: Abnahmetest: keiner, weil Umbau: bestehende Tests bleiben unverändert grün)
Nicht-Ziele: <je mit „weil“> (oder: keine)

Premortem:
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil <Umstand>, passiert <Ereignis>, und die Folge ist <Folge>. | <Test: Satz in wasDarfNiePassieren> oder <Nicht-Ziel> oder <hingenommen: Grund> |
(oder unter der leeren Tabelle: Keine Gründe gefunden, weil <Grund>)
```
