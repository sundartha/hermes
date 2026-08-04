# GQ-P1 — Kumulative Turns: einen Turn je Aeusserung, nicht je Zwischenstand

**Befund B-1, die Wurzel der Kette.** Solange sie steht, misst jeder andere Befund Rauschen.

## Was gemessen ist (2026-08-04, `call_mseq9zxodt53`, Sonde A aus GQ-S1)

Die Spracherkennung liefert **kumulative** Transkripte. Jeder Zwischenstand kommt als
eigener POST auf `/v1/chat/completions` an, und der Shim behandelt jeden POST als
eigenstaendigen Turn. Ergebnis: der Agent antwortet auf den halben Satz und kurz darauf
noch einmal auf den ganzen.

| turnSeq | Zeichen | Relation | Abstand |
|---:|---:|---|---:|
| 2 | 3 | `other` | – |
| 3 | 35 | **`extends`** | 1 409 ms |
| 4 | 22 | `other` | 9 620 ms |
| 5 | 69 | **`extends`** | 3 569 ms |
| 6 | 69 | `same` | 9 635 ms |
| 8 | 82 | **`extends`** | 4 812 ms |

Am Transkript hoerbar:

```
14:03:25.089 caller  "Ja,"
14:03:25.997 agent   "Guten Tag, ich bin Hermes…"            <- Antwort auf "Ja,"
14:03:26.498 caller  "Ja, teil was hat der denn fürn auto"   <- Erweiterung
14:03:26.697 agent   "Guten Tag! Ich bin Hermes…"            <- zweite Antwort, 0,7 s spaeter
```

Der Owner beschreibt genau das: *"hakt der staendig die Saetze ab"* und *"wiederholt
staendig, was ich sage"*.

**Zwei Hypothesen sind vorher gestorben** — nicht wiederbeleben:
`start_speaking_plan` ist live `null` (der Provisioner-Wert 0.8 s existiert nicht), und
`eager_eot_threshold: 0.8` ist der Telnyx-**Default**, der laut Anbieter-Doku den
eager-Modus bereits deaktiviert. **Es ist kein Provider-Knopf. Der Fix sitzt bei uns.**

Ebenfalls gemessen: `telnyxHeaders: {}` — Telnyx sendet **keine** identifizierenden Header.
Eine Zuordnung ueber Request-IDs ist nicht moeglich; die Textrelation ist der einzige Weg.

## Die Erkennung existiert bereits

`makeTurnTextProbe()` in `src/telnyx-turn-probe.js` (GQ-S1, live) berechnet je Turn schon
`prevRelation` mit den Werten `first` / `same` / `extends` / `other` — PII-frei ueber
Zeichenzahl und Hash, ohne den Text zu speichern. **Diese Phase baut keine neue Erkennung,
sie macht aus dem bestehenden Signal eine Handlung.**

## Was zu bauen ist

Trifft fuer einen Call ein Request mit `prevRelation === "extends"` ein, waehrend der
vorherige Turn desselben Calls **noch laeuft**, dann gilt: der vollstaendigere Text
gewinnt. Der laufende Turn wird abgebrochen, der neue beantwortet.

Zu entscheiden und zu begruenden (das ist der Kern der Phase):

1. **Wie wird ein laufender Turn abgebrochen?** Es gibt heute keinen `AbortController` im
   Turn-Pfad. Der Abbruch muss den Modell-Aufruf beenden UND verhindern, dass die bereits
   erzeugte Antwort noch gesprochen wird.
2. **Was bekommt der abgebrochene Request als HTTP-Antwort?** Er darf nicht einfach haengen
   oder leer zurueckkommen: Rate- und Budget-Gate schreiben heute bewusst eine
   Degradations-Completion, weil Telnyx einen Turn ohne gueltige Completion als abgebrochen
   liest und der Anrufer dann **Stille** hoert. Ein Abbruch, der Stille erzeugt, ist
   schlimmer als der Doppel-Turn.
3. **Was, wenn schon Text gestreamt wurde?** Gesprochenes ist nicht zurueckholbar (kein
   Retract-Event). Nenne das Verhalten in diesem Fall ausdruecklich — und miss es, statt es
   zu behaupten.
4. **`same` ist NICHT `extends`.** Der eine gemessene `same`-Fall trug `lastRole: "system"`
   und `messagesCount` 5->7: das war der Consult-Nachfass, ein legitimer Turn. Wer `same`
   mitbehandelt, unterdrueckt Consult-Antworten. Nur `extends` ist der Befund.

## Harte Randbedingungen

- **Safety-Gates unberuehrt:** Kostendecke, `OUTBOUND_FROZEN`, Denylist, Land-Gate,
  Stundenlimit, Max-Dauer, Signaturpruefung, Offenlegungssatz, Auth. Der Riegel sitzt
  **vor** dem Agenten-Turn, also **nach** bzw. neben diesen Pruefungen — er darf ihre
  Reihenfolge nicht aendern und ihre Zaehler (`turnSeq`, `emptyStreak`, Rate-Fenster,
  Budget-Buchung) weder umgehen noch verfaelschen. Ein unterdrueckter Turn darf
  insbesondere **keine** Kosten doppelt oder gar nicht buchen.
- **Kein Fail-open.** Ist die Relation unbekannt oder der Zustand unklar, wird **nicht**
  abgebrochen — der Bestand (zwei Antworten) ist haesslich, Stille ist schlimmer.
- **Keine Inhalte ins Log**, keine Rufnummern, keine Secrets. Wie GQ-S1: Laengen, Hashes,
  Relationen, Zeitstempel.
- **Kein Prompt-Umbau.** Diese Phase fasst weder Systemprompt noch Werkzeugbeschreibungen
  an. B-2/B-4/B-5 sind eigene Phasen.
- ESM, kein Build-Step, kein TypeScript. Kommentare deutsch **ohne** Umlaute.
  Konfigurierbares nach `src/config.js` **und** `.env.example`.

## Abnahme

1. `npm test` gruen (Vorbedingung, nicht das Ergebnis).
2. Neue Tests, jeder mit **Gegenbeispiel**:
   - `extends` bei laufendem Turn -> alter Turn abgebrochen, neuer beantwortet
   - `extends` bei **abgeschlossenem** Turn -> **kein** Abbruch, normaler Turn
   - `same` -> **kein** Abbruch (Consult-Nachfass bleibt unangetastet)
   - `other` -> **kein** Abbruch
   - abgebrochener Request bekommt eine gueltige Completion, nie Stille
3. **Das Ergebnis ist die Messung am naechsten Testanruf:** in den `turn_probe`-Zeilen
   muessen `extends`-Faelle weiterhin auftauchen (die Spracherkennung aendert sich nicht),
   aber **keine zwei gesprochenen Antworten** mehr erzeugen. Gegenprobe im Transkript:
   keine zwei aufeinanderfolgenden `agent`-Segmente auf dieselbe Aeusserung.
   **Zusaetzlich Pflicht:** die Zahl der beantworteten Anrufer-Aeusserungen bleibt gleich —
   keine darf ohne Antwort bleiben. Ein zu scharfer Riegel erzeugt Stille und sieht in der
   Metrik BESSER aus als der Bestand.

## Rueckweg

Der Riegel haengt an einem Schalter in `src/config.js` (Default AN). Umlegen stellt das
heutige Verhalten wieder her, ohne Deploy von Code.
