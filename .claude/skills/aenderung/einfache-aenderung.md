# Vorlage: Phasendatei für eine einfache Änderung

Ablage: `plaene/E-<Nummer>-<kurzname>/phase.json`. `<Nummer>` ist die Nummer des Issues aus dem Feld `issue` (`SKILL.md` 3c Schritt 1). Was in spitzen Klammern steht, ersetzt du; alles andere bleibt so.

```json
{
  "phase": "E-<Nummer>-<kurzname>",
  "issue": <Nummer des Issues>,
  "absicht": "<2 bis 4 Sätze: wofür die Änderung da ist, welche Abkürzung nicht gewollt ist, wie im Zweifel zu wählen ist>",
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
      "abnahme": "test/<name>.test.js",
      "erwarteterFehler": "<nur bei funktion: wörtlicher Text der Meldung, mit der der Abnahmetest heute rot wird, eine Zeile>",
      "wasDarfNiePassieren": ["<das Verhalten, das gleich bleiben muss, als prüfbarer Satz>"]
    }
  ]
}
```

- `funktion`: Die Änderung zeigt sich von außen. `abnahme` ist ein neuer Abnahmetest über den echten Eingang, der heute mit `erwarteterFehler` rot wird.
- `umbau`: Nur der Aufbau des Codes ändert sich, oder nur die Gestaltung der Website. `abnahme` ist ein bestehender Verhaltenstest, der grün bleibt; `erwarteterFehler` fällt weg. Kein bestehender Test ändert sich, neue Absicherungstests des alten Stands, die `lauf` bei überlebenden Mutanten und als Schutztests zu `wasDarfNiePassieren` ergänzt, sind erlaubt und erwünscht; schreib in `absicht` und Entwurf deshalb „bestehende Tests ändern sich nicht“, nie „keine Testdatei ändert sich“.
- `issue`: die Nummer des Issues, nach dem der Ordner heißt. Sein erster Abschnitt ist `## Absicht` mit genau dem Text aus `absicht`; `lauf` gleicht beides ab und hält sonst an.
- `erwarteterFehler`: `lauf` sucht diesen Text wörtlich in der Fehlermeldung des roten Abnahmetests; ein Testname zählt nicht. Der Test-Agent gibt ihn dem `assert`, das heute fehlschlägt, als Meldung mit, etwa `assert.equal(ist, soll, "<erwarteterFehler>")`.
- Bleibt nichts Besonderes gleich, ist `wasDarfNiePassieren` die leere Liste `[]`, und der Grund steht im Entwurf.

## Entwurf

```text
Was sich ändert: <ein Satz>
Bleibt gleich: <beobachtbares Verhalten> (oder: nichts Besonderes, weil <Grund>)
Abnahme: <Bildschirmfotos vorher und nachher, Desktop und Handy | Testgespräche über die geänderte Stelle und die festen Fälle | Abnahmetest über den echten Eingang> (bei Umbau: Abnahmetest: keiner, weil Umbau: bestehende Tests bleiben unverändert grün; Absicherungstests des alten Stands sind erlaubt)
Nicht-Ziele: <je mit „weil“> (oder: keine)

Premortem:
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil <Umstand>, passiert <Ereignis>, und die Folge ist <Folge>. | <Test: Satz in wasDarfNiePassieren> oder <Nicht-Ziel> oder <hingenommen: Grund> |
(oder unter der leeren Tabelle: Keine Gründe gefunden, weil <Grund>)
```
