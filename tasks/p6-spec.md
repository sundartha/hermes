# P6 - Laerm: das Messwerkzeug zuerst

Autoritative Spec fuer Phase P6 aus `PLAN-ANRUFDEFEKTE.md` (Abschnitt 4, P6). Umbrella-Kontext:
W6 in Abschnitt 2, PM-4 in Abschnitt 5, Owner-Entscheidung F-7 in Abschnitt 6.

## Warum (in einem Satz)

Die Ursache der hohen Unterbrechungsrate ist ERSCHLOSSEN, nicht gemessen: dieselbe
Agenten-Konfiguration lief am selben Tag durch einen sauberen Anruf, und auf der Mischspur ist
kein Laerm-Unterschied messbar. Ohne Vorher-Messung belegt jede spaetere Aenderung nichts
(Lehre `bench-must-reproduce-defect`).

## SCOPE

Neues, **rein lesendes** Skript `scripts/anruf-unterbrechungen.mjs` (Muster: `scripts/stt-wer.mjs`,
`scripts/call-abandon-rate.mjs`) plus ein Fixture-Test ohne Netz.

### Ausgabe je Anruf

| Kennzahl | Definition |
|---|---|
| Agenten-Turns | Anzahl Turns mit `role === "agent"` |
| davon mit Text | Turns mit nicht-leerem `message` (die uebrigen sind Werkzeug-/Abschluss-Turns) |
| unterbrochen | Turns mit `interrupted === true` |
| Unterbrechungsanteil | unterbrochen / Agenten-Turns (**Hauptkennzahl**) |
| ausgelieferter Zeichenanteil | je unterbrochenem Turn `len(message) / len(original_message)` |
| Recap im Folge-Turn | Heuristik, siehe unten |
| Gespraechsdauer | `metadata.call_duration_secs` |

Plus eine Zusammenfassung ueber alle uebergebenen Anrufe: mittlerer Unterbrechungsanteil und
**mittlere Gespraechsdauer**.

## ENTSCHEIDUNGEN (bindend)

- **E-1: der Nenner ist "alle Agenten-Turns", nicht "Turns mit Text".** Nur so sind die im
  Plan-Dokument belegten Zahlen konsistent (12:44 = 6/7, Kontrolle = 1/6, Referenz = 2/7). Der
  in der P6-Tabelle des Plan-Dokuments genannte Wert "1 von 4" fuer den Kontrollanruf benutzt den
  anderen Nenner (Turns mit Text) - deshalb gibt das Werkzeug BEIDE Zaehlungen aus und
  dokumentiert, welche welche ist. Vom Lead am 06.09. an der Rohantwort nachgerechnet.
- **E-2: die Gespraechsdauer gehoert in dieselbe Messung** (PM-4): `turn_eagerness: "patient"`
  kann die Unterbrechungsrate senken und gleichzeitig die Anrufe verlaengern und damit
  verteuern. Ein Werkzeug, das nur Unterbrechungen zaehlt, wuerde diesen Rueckschritt nicht
  sehen. Die Abnahme von P7 braucht beide Zahlen.
- **E-3: die Recap-Heuristik wird im Skript BENANNT und BEGRUENDET.** Sie ist eine Heuristik
  und wird als solche ausgewiesen (Kommentar + Ausgabe-Fussnote), nicht als Messwert verkauft.
  Grundlage ist der belegte Fall: der als "gut" bewertete Anruf vom 03.09. hatte einen zu 52,5 %
  abgeschnittenen Turn und lief sauber weiter, **weil der Agent im naechsten Turn explizit
  zusammenfasste**. Das unterscheidende Merkmal ist die Rate unterbrochener Turns UND das
  Fehlen einer Recap-Erholung - nicht der Verlust eines Einzel-Turns.
- **E-4: die Fixtures sind vorgegeben und werden NICHT veraendert.**
  `test/fixtures/anruf-unterbrechungen.js` enthaelt die drei Referenzanrufe als echte,
  inhaltsfreie Aufzeichnung (Allowlist-Projektion, Sprechtext durch laengengleiche Platzhalter
  ersetzt). Sie sind die Positiv-Kontrolle: **weicht eine Zahl ab, ist das Messwerkzeug falsch,
  nicht die Wirklichkeit.** Wer die Fixture an das Werkzeug anpasst, hat den Zweck zerstoert.
  Die Recap-Heuristik ist an den Platzhaltertexten nicht pruefbar und bekommt deshalb einen
  eigenen, ausgedachten und als ausgedacht markierten Fixture-Fall.
- **E-5: keine Netzabhaengigkeit im Test.** Der Fixture-Test laeuft offline und ohne `.env`,
  wie die ganze Suite. Das Skript selbst spricht live mit der Anbieter-API.

## INVARIANTEN (Verletzung = Blocker)

- **I-1: read-only.** Kein `PATCH`, kein `POST`, kein `PUT`, kein Schreibzugriff auf die
  Prod-DB, kein Aufruf von `scripts/push-elevenlabs.mjs`. Das Skript liest die
  Conversation-API und - falls noetig - die Prod-DB lesend.
- **I-2: keine Transkriptinhalte in Dateien, die im Repo landen** (Absolute Regel 4/5). Ausgabe
  sind Zahlen, keine Zitate. Auch nicht "zur Veranschaulichung", auch nicht gekuerzt.
- **I-3: kein Laufzeit-Code wird beruehrt.** Diese Phase aendert nichts in `src/`. Ein Diff, der
  `src/` anfasst, ist ausserhalb des Scopes.
- **I-4:** Der API-Schluessel kommt aus der Umgebung, wird nie geloggt und nie in eine Datei
  geschrieben.

## Abnahme (deterministisch)

1. Der Fixture-Test reproduziert aus `test/fixtures/anruf-unterbrechungen.js` genau:

   | Fixture | erwartet |
   |---|---|
   | `laut_12_44` | 7 Agenten-Turns, 6 unterbrochen; Anteile 56,7 / 65,7 / 86,3 / 35,5 / 21,4 / 85,4 %; Dauer 87 s |
   | `kontrolle_10_26` | 6 Agenten-Turns (4 mit Text), 1 unterbrochen; Anteil 98,7 %; Dauer 101 s |
   | `referenz_03_09` | 7 Agenten-Turns (5 mit Text), 2 unterbrochen; Anteile 52,5 % und 96,7 %; Dauer 55 s |

2. Das Skript ohne Argumente gibt eine kurze Hilfe aus und ruft NICHTS ab (kein versehentlicher
   Grossabruf).
3. Ein unbekannter/fehlerhafter Anruf-Bezeichner fuehrt zu einer verstaendlichen Fehlermeldung
   und einem Exit-Code ungleich 0 - nicht zu einer stillen 0 (Lehre
   `pruefkommando-ohne-positiv-kontrolle`).

## Verifikation

```
node --check scripts/anruf-unterbrechungen.mjs
node --test test/anruf-unterbrechungen-script.test.js
npm test
```

Der Live-Lauf gegen die drei echten Anrufe wird vom Lead ausgefuehrt, nicht vom Impl-Agenten
(der Worktree hat keine `.env`).

## ABGRENZUNG (ausdruecklich NICHT in dieser Phase)

- **Keine Konfigurationsaenderung am Agenten.** Kein `turn_eagerness`, kein
  `background_voice_detection`, keine `interruption_ignore_terms`, keine `asr.keywords` -
  das ist P7, und dort genau EINE Stellschraube.
- Keine Aenderung an `scripts/call-abandon-rate.mjs` (dessen falsche Kennzahl ist N-2/P10).
- Keine Audio-Analyse: der Anbieter liefert nur die Mischspur, eine kanalgetrennte
  Laermmessung ist ueber seine API nicht herstellbar (gemessen, W6).
- Kein neues npm-Paket.
