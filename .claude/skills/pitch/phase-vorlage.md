# Vorlage: Phasendatei für eine größere Änderung

Ablage: `plaene/P-<Nummer>-<kurzname>/phase.json`, im selben Ordner wie Pitch, Design Doc und Sicherheitsprüfung. `phase` ist genau der Name dieses Ordners. Was in spitzen Klammern steht, ersetzt du; alles andere bleibt so. Jeder Auftrag ist ein Objekt in `auftraege`; die Vorlage zeigt einen Auftrag mit Nummern und einen Umbau.

```json
{
  "phase": "P-<Nummer>-<kurzname>",
  "entwurf": {
    "<bereich>": "<Entwurf für diesen Bereich, siehe unten, Zeilen mit \\n getrennt>"
  },
  "auftraege": [
    {
      "id": "a<n>",
      "art": "<funktion oder fehlerbehebung>",
      "ziel": "<was sich ändert, eine Zeile, höchstens 72 Zeichen>",
      "bereich": "<Datei, oder Ordner mit / am Ende, in dem die Änderung liegt>",
      "erwarteteDateien": ["<Dateien im Bereich, die sich ändern>", "<Pfad aus abnahme>"],
      "abnahme": "test/<bereich aus tools/bereiche.json>/<name>.test.js",
      "erwarteterFehler": "<kurzes Stück einer Zeile, mit der der Abnahmetest heute rot wird>",
      "wasDarfNiePassieren": ["<prüfbarer Satz, der in keinem Szenario steht>"],
      "prueft": ["<Nummer wie im Dokument, etwa S1, B1 oder T1>"],
      "szenarien": {
        "<Nummer>": "<Text der Nummer wörtlich aus dem Dokument, Zeilen mit \\n getrennt>"
      },
      "abhaengigVon": ["<id der Aufträge, die vorher übernommen sein müssen>"]
    },
    {
      "id": "a<n>",
      "art": "umbau",
      "ziel": "<was sich am Aufbau ändert, eine Zeile, höchstens 72 Zeichen>",
      "bereich": "<Datei, oder Ordner mit / am Ende>",
      "erwarteteDateien": ["<Dateien im Bereich, die sich ändern>"],
      "abnahme": "<bestehender Test, der die Stelle prüft und grün bleibt>",
      "prueft": "keiner, weil Umbau: bestehende Tests bleiben unverändert grün",
      "abhaengigVon": []
    }
  ]
}
```

- `funktion` und `fehlerbehebung`: `abnahme` ist ein neuer Test über den echten Eingang, der heute rot wird. Sein Pfad liegt unter `test/` in einem Ordner, der in `tools/bereiche.json` als `bereich` steht; der Dateiname beschreibt das Verhalten und enthält keine Kennungen wie `p001`, `a1` oder `s3`.
- `umbau`: Nur der Aufbau des Codes ändert sich. `abnahme` ist ein Test, der beim Start der Phase schon im Repo steht und grün ist, nicht einer, den erst ein Auftrag derselben Phase anlegt; es gibt kein `erwarteterFehler` und kein `szenarien`, und `prueft` ist genau der Satz aus der Vorlage. Benennt ein Umbau eine Datei, die nur Typen dazubekommt, von `x.js` nach `x.ts` um, nennt `erwarteteDateien` die neue Datei `x.ts` (oder beide) und `bereich` die alte Datei `x.js`.
- `prueft` nennt die Nummern so, wie sie in Pitch und Sicherheitsprüfung stehen: `S1`, `B1`, `T1`, ohne Bindestrich.
- `szenarien` hat genau die Nummern aus `prueft`. Bei `S<n>` und `B<n>` sind das die Zeilen unter der Überschrift des Szenarios bis zur Leerzeile; bei `T<n>` alles hinter „Szenario …:“ in derselben Zeile und die Zeilen darunter bis zur Leerzeile.
- Gibt es nichts, was in keinem Szenario steht und trotzdem nie passieren darf, ist `wasDarfNiePassieren` die leere Liste `[]`. Ohne Vorgänger ist `abhaengigVon` die leere Liste `[]`.
- Mehrere Aufträge mit demselben `bereich` teilen sich einen Eintrag unter `entwurf`.

## Entwurf je Bereich

```text
Grundlage: plaene/P-<Nummer>-<kurzname>/design.md, Abschnitt <…> (oder: kein Design Doc, Pitch „Grobe Lösung“)
Aufträge: <id>: <was dieser Auftrag hier ändert>; <id>: <…>
Fehlerfälle: <Fall>: <Ausgang aus dem Design Doc> (oder: keine in diesem Bereich, weil <Grund>)
Reihenfolge: <warum die Aufträge in abhaengigVon vorher kommen> (oder: keine Vorgänger)
```
