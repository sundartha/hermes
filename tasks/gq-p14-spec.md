# GQ-P14 — die Zusammenfassung erfaehrt, was im Gespraech schon notiert wurde

## Warum (am Code belegt, Messung M-6)

Belegter Befund N-2: `call_msg0swwfhe5e` hinterliess **drei** Action Items fuer **einen**
Sachverhalt:

```
1) "Werkstatt fragt nach dem Fahrzeugmodell fuer die faellige Inspektion. Bitte
    Fahrzeugmodell mitteilen, damit ich den Termin vereinbaren kann."
2) "Fahrzeugmodell von Antonio recherchieren und an Werkstatt mitteilen"
3) "Werkstatt erneut kontaktieren, um Inspektionstermin zu vereinbaren"
```

Im Log feuerte `take_message` **einmal** (turnSeq 4). Die Eintraege 2 und 3 stammen aus der
**Nachbereitung**:

```js
// src/claude.js:1277
for (const item of parsed.actionItems || []) store.addActionItem(call.id, item, "todo");
```

**GQ-P10 greift deshalb am falschen Pfad.** Sein Prompt-Block SCHON NOTIERT haengt an
`systemPrompt` und wirkt nur im Gespraech, also nur auf `take_message`. Die
Zusammenfassung sieht ihn nie.

Der Entdopplungs-Riegel hilft hier nicht: `addActionItem` (`state-ops.js:1054`) vergleicht
ueber `actionItemKey`, also **inhaltsgleichen** Text. Das Modell formuliert jedes Mal neu —
der Riegel greift nie. Genau das steht schon im GQ-P10-Kommentar: *„Die Wurzel ist nicht die
Aehnlichkeitsschwelle, sondern dass das Modell NIE erfaehrt, was es schon notiert hat."*
Die Wurzel wurde erkannt und dann an der falschen Stelle behoben.

Nebenbefund im selben Aufruf: `claude.js:1277` verwirft den Rueckgabewert von
`addActionItem` — `{ duplicate }` wird nicht gelesen, waehrend der Gespraechs-Pfad
(`claude.js:560`) ihn ausdruecklich auswertet. Dieselbe Fehlerklasse noch einmal.

## Aenderung

Die Zusammenfassung bekommt dieselbe Information, die GQ-P10 dem Gespraech gibt: **was in
diesem Anruf bereits notiert ist**, mit der Anweisung, es nicht zu wiederholen, sondern nur
noch **wirklich Neues** zu ergaenzen.

- Quelle ist derselbe Leser, den GQ-P10 bereits gebaut hat (die notierten Items des Calls) —
  **kein zweiter Leser, keine zweite Formatierung** (G5). Wenn der bestehende Leser dafuer
  nicht passt, ist er zu teilen, nicht zu kopieren.
- Der Block rendert nur, wenn etwas notiert ist. Ist nichts notiert, bleibt der
  Zusammenfassungs-Prompt **byte-identisch** zum Bestand.
- Text in **de, en, fr**, an der bestehenden i18n-Stelle der Zusammenfassung.

## Was diese Phase NICHT tut

- **`actionItemKey` / die Entdopplungs-Schwelle wird nicht angefasst.** Eine
  Aehnlichkeitssuche waere die naheliegende, aber falsche Antwort: sie raet, wo der Prompt
  wissen kann.
- **Keine Aenderung an `take_message`** und nicht am GQ-P10-Block im Gespraechs-Prompt.
- **Kein Loeschen bestehender Action Items**, kein nachtraegliches Zusammenfuehren.
- Keine Aenderung an `objective_achieved`, `result` oder der Ergebnis-Karte.

## Verifikation — deterministisch

`npm test` gruen (Basis 3959). Neue Tests, offline (Prompt-Zusammenbau, kein Modellaufruf):

1. Call mit zwei bereits notierten Items -> der Zusammenfassungs-Prompt enthaelt beide
   Texte. **Heute enthaelt er keinen davon** — das ist der Kern.
2. Call ohne notierte Items -> Prompt byte-identisch zum Bestand (Golden-Master-Pin).
3. de/en/fr: der Block rendert in der Sprache des Calls.
4. Der Block haengt am **Zusammenfassungs**-Prompt, nicht am Gespraechs-Systemprompt — ein
   Test, der die beiden auseinanderhaelt (GQ-P10 ist genau daran gescheitert).

**Live-Zahl:** Action Items je Sachverhalt nach einem Anruf. Belegt heute **3 fuer 1**
(`call_msg0swwfhe5e`), Ziel **1 fuer 1**. Diese Zahl braucht einen Testanruf und wird
ausdruecklich **nicht** in dieser Phase behauptet.

## Absolute Regeln

Keine Gates, keine Auth, kein Kostenpfad. Der Zusammenfassungs-Prompt traegt fremde Rede
(Gespraechsinhalt) — es wird nichts Zusaetzliches gespeichert oder ausgeleitet, nur bereits
Gespeichertes in denselben Prompt gespiegelt.
