# P7 - Laerm: EINE Stellschraube, gegen die Messung aus P6

Autoritative Spec fuer Phase P7 aus `PLAN-ANRUFDEFEKTE.md` (Abschnitt 4, P7). Umbrella-Kontext:
W6 in Abschnitt 2, PM-4 in Abschnitt 5, Owner-Entscheidung F-7 in Abschnitt 6.

**Vorbedingung: P6 ist gemergt und die Vorher-Messung liegt in `tasks/p7-vorher-messung.md`.**
Ohne Vorher-Messung belegt die Nachher-Messung nichts.

## Warum (in einem Satz)

Der Eigentuemer, woertlich: *"Ist natuerlich super wichtig, dass der KI-Assistent auch einfach
steht, wenn man im Restaurant ist."* Im 12:44-Anruf waren 6 von 7 Agenten-Turns unterbrochen,
teils mitten im Wort, ohne dass der Agent sich je erholte.

## SCOPE

Genau EINE Anbieter-Stellschraube: **`turn_eagerness: "patient"`** in
`elevenlabs/agent_configs/outbound-agent.template.json` (unter `conversation_config.turn`),
plus der Besitz-Eintrag, damit das Drift-Gate das Feld kuenftig ueberwacht.

**Warum diese und keine der drei anderen.** Der Anbieter hat keinen numerischen
Empfindlichkeitswert - die Suche ueber das GESAMTE OpenAPI-Schema nach
background/noise/denoise/echo/ambient/barge ergab genau vier ungenutzte Stellschrauben:
`background_voice_detection`, `turn_eagerness`, `interruption_ignore_terms` +
`merge_with_default_ignore_terms`, `asr.keywords`. `background_voice_detection` filtert laut
Schema-Beschreibung FREMDSTIMMEN, nicht Musik - der Eigentuemer benennt im Transkript des
12:44-Anrufs aber ausdruecklich Musik als Stoerer. `turn_eagerness` ist die generische
Warteschwelle vor der Turn-Uebernahme und damit die einzige der vier, die zum gemessenen Fall
passt. Die beiden uebrigen sind Feinschliff.

## ENTSCHEIDUNGEN (bindend)

- **E-1: genau EIN Feld je Messrunde.** Zwei gleichzeitig geaenderte Felder machen jede
  Nachher-Messung uninterpretierbar. Das ist die Kernauflage aus F-7.
- **E-2: der Besitz-Eintrag ist so eng wie das Feld.** Nur `turn_eagerness` wandert in den
  Schreib- und Vergleichspfad. **Fail-safe-Bedingung (Blocker bei Verletzung):** kein weiteres
  Feld unter `turn.*`, `vad.*` oder `asr.*` wird dabei mit erfasst. Die Vorlage ist fuer diese
  Felder nie gegen den Live-Stand abgeglichen worden; ein breiter Schreibpfad wuerde live
  gemessene Werte durch nie gepruefte Vorlagenwerte ersetzen (Lehre
  `telnyx-assistant-provisioner-env-trap`).
- **E-3: der Rueckfallwert steht in der Uebergabe.** Vorher ist `turn_eagerness = "normal"`
  (live gemessen). Diese Zeile gehoert in den Uebergabetext, damit der Owner in einem Schritt
  zurueckkann.
- **E-4: die Abnahme umfasst die Gespraechsdauer** (PM-4). `turn_eagerness: "patient"` laesst
  den Agenten laenger warten - das kann die Unterbrechungsrate senken UND die Anrufe
  verlaengern. Bei 30 ct/min schlaegt das auf die Kostendecke durch. Sinkt der
  Unterbrechungsanteil, steigt aber die mittlere Gespraechsdauer deutlich, ist das kein Erfolg,
  sondern ein Tausch - und die Entscheidung darueber gehoert dem Owner.

## INVARIANTEN (Verletzung = Blocker)

- **I-1: kein Push.** `scripts/push-elevenlabs.mjs` ist in dieser Kette in JEDER Aufrufform
  gesperrt, auch der Trockenlauf. Diese Phase legt die Vorlage bereit; live bringt sie der
  Owner in einer eigenen Sitzung.
- **I-2: keine Aenderung an `src/`.** Diese Phase aendert die Vorlage und den
  Besitz-/Vergleichspfad, nicht die Laufzeit.
- **I-3: keine der drei anderen Stellschrauben wird angefasst** (E-1).
- **I-4: `transcribe_on_disabled_interruptions` und `disable_first_message_interruptions`
  bleiben unveraendert** - das erste reaktiviert den Phantom-Turn-Defekt (N-6), das zweite
  schuetzt die Art.-50-Eroeffnung.
- **I-5:** Kein Safety-Gate, kein Offenlegungssatz, keine Auth-Regel wird beruehrt.

## Abnahme (deterministisch)

1. Die Vorlage traegt `turn_eagerness: "patient"`; das Feld steht im Besitz und wird vom
   Vergleich erfasst.
2. `node scripts/check-elevenlabs-drift.mjs` (read-only) meldet eine Abweichung GENAU fuer
   `turn_eagerness` und fuer nichts sonst. **Das ist der erwartete Zustand VOR dem Owner-Push**
   und der Beleg, dass die Besitz-Erweiterung greift und eng ist. Ein roter Drift-Lauf mit genau
   diesem einen Feld ist KEIN Merge-Blocker; jede weitere Abweichung schon.
3. `npm test` bleibt gruen (die Phase aendert keine Laufzeit).

### Offen und ausdruecklich NICHT in diesem Lauf abnehmbar (Owner-Arbeit)

4. Nach dem Push: ueber mindestens **fuenf** Testanrufe unter vergleichbaren Bedingungen liegt
   der mit P6 gemessene Anteil unterbrochener Agenten-Turns unter dem Vorher-Wert aus
   `tasks/p7-vorher-messung.md`, **und die mittlere Gespraechsdauer steigt nicht deutlich**
   (E-4). Das braucht echte Anrufe und echtes Geld und gehoert in eine eigene Sitzung mit
   Owner-Freigabe.

## Verifikation

```
node scripts/check-elevenlabs-drift.mjs   # read-only; erwartetes Ergebnis siehe Abnahme 2
npm test
```

## ABGRENZUNG (ausdruecklich NICHT in dieser Phase)

- Kein Push, kein Deploy, kein Testanruf.
- Keine zweite Stellschraube, auch nicht "weil sie naheliegt".
- Kein breiter Besitz-Umbau der Vorlage (`vad.*`, `asr.*`, werkzeug-interne Felder) - das ist P8.
- Keine Aenderung an `src/`, an Tests der Laufzeit oder am Messwerkzeug aus P6.
