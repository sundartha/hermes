# Uebergabe P7 Laerm — turn_eagerness

Kette: `PLAN-ANRUFDEFEKTE.md` (W6, P7, PM-4, F-7). Spec: `tasks/p7-spec.md`. Vorher-Messung:
`tasks/p7-vorher-messung.md`.

## 1. Was live gebracht werden muss (Owner, eigene Sitzung)

```
npm run elevenlabs:push -- --felder=turn_eagerness --ausfuehren
```

Genau EIN Feld — das ist E-1, nicht Vorsicht. Zwei gleichzeitig gedrehte Stellschrauben
machen jede Nachher-Messung uninterpretierbar.

## 2. Rueckfall in einem Schritt

Vorlage `"turn_eagerness": "patient"` auf `"normal"` zuruecksetzen, denselben Push erneut
ausfuehren. Vorher live gemessen: **`normal`** (`tasks/p7-vorher-messung.md`).

## 3. Vor dem Push zu pruefen (Bestandsrisiko, nicht von P7 erzeugt)

`art "wert"` schreibt das Blatt; PATCH **ersetzt** Dict-Felder beim Anbieter (Skriptkopf
`push-elevenlabs.mjs`, "GEGENPROBE STATT VERTRAUEN"). Unter `conversation_config.turn`
liegen 8 weitere besessene Blaetter. Das Skript sagt den Nachher-Stand trocken voraus und
liest nach dem Schreiben erneut — meldet es ROT, ist der Push zurueckzunehmen, nicht zu
wiederholen.

## 4. Abnahme nach dem Push (Owner-Arbeit, nicht in diesem Lauf)

Mindestens fuenf Testanrufe unter vergleichbaren Bedingungen, dann:

```
node scripts/anruf-unterbrechungen.mjs <conv_ids>
```

Vergleich **nur** gegen die Zeile "nur gefuehrte Gespraeche (>= 3 Agenten-Turns)" aus
`tasks/p7-vorher-messung.md`: **24,8 %** Unterbrechungsanteil bei **72,1 s** mittlerer
Dauer. Dieselbe Regel anwenden, sonst werden zwei verschiedene Dinge verglichen.

## 5. E-4 / PM-4 ausdruecklich

Sinkt der Unterbrechungsanteil, steigt aber die mittlere Gespraechsdauer deutlich ueber
72,1 s, ist das **kein Erfolg, sondern ein Tausch** (30 ct/min gegen die Tenant-
Kostendecke). Die Entscheidung gehoert dem Eigentuemer.
