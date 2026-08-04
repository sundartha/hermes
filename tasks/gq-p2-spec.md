# GQ-P2 — Der Consult-Rueckkanal: die Antwort muss ankommen

**Befunde B-3 (Rueckkanal versagt) und B-2 (Werkzeug fehlt im Satz).** Beide sind
deterministisch — hier wird kein Modellverhalten erhofft, sondern ein Kanal repariert.

## Was gemessen ist

**Live am 2026-08-04, `call_mseq9zxodt53`:** Der Agent stellte einen Consult, der Assistent
antwortete **innerhalb von Sekunden**, und die Antwort wurde trotzdem verworfen:

```
c0  askedAt 14:03:41.450  "Welche Fahrzeugdaten braucht die Werkstatt?"
    status: timed_out   answeredAt: null   answeredFacts: 0
answer_consult ->  { accepted: false, merged_facts: 0 }
14:03:51.780  Agent: "Ich kann Antonio leider gerade nicht erreichen."
```

**Live am 2026-08-04, `call_msetewtfmvpb`:** `get_consult` wurde dem Modell gar nicht erst
angeboten:

```
offeredToolNames: ["end_call","take_message","look_up"]   <- get_consult FEHLT
consultPollFresh: false
```

**Die Zahlen, an denen der Fix haengt (nachgemessen, nicht geschaetzt):**

| Konstante | Wert | Bedeutung |
|---|---:|---|
| `CONSULT_POLL_ABORT_MS` (Frischefenster) | 25 000 ms | wie lange ein Poll als "aktiv" gilt |
| `CONSULT_POLL_HOLD_MS` | 22 000 ms | wie lange ein `await_call_event` haelt |
| `CONSULT_TIMEOUT_MS` (Antwortfrist) | **4 000 ms** | wie lange auf die Antwort gewartet wird |

## Die zwei Wurzeln

**W1 — Die Antwortfrist ist unrealistisch.** Vier Sekunden reichen weder einem Menschen noch
einem KI-Assistenten, um eine Frage zu lesen, zu verstehen und zu beantworten. Der Consult
ist praktisch immer tot, bevor die Antwort eintrifft. Das ist keine Vermutung: die Antwort
oben war in Sekunden da und kam zu spaet.

**W2 — Der Abbruch haengt am Turn-Zaehler, nicht an der Uhr.** `advanceInCallConsult`
(`src/store/state-ops.js`) setzt einen Consult beim **zweiten** Aufruf nach der Frage
bedingungslos auf `TIMED_OUT` — geprueft wird nur `consult.held`, nicht erneut die
verstrichene Wanduhrzeit. Telefon-Turns folgen schneller aufeinander, als ein Antwortender
tippen kann. **Selbst mit einer grosszuegigen Frist wuerde dieser Zaehler weiter abbrechen** —
W1 allein zu beheben reicht nicht.

Folgefehler, am Code belegt: laeuft der Consult ins Timeout, behauptet das Modell, es habe
die Faehigkeit nicht (*"Ich habe leider keine Funktion, um Antonio zu konsultieren"*). Der
injizierte Timeout-Text (`consultTimeout`, `src/i18n/prompts/de.js`) enthaelt **keine**
solche Aussage — das Modell erfindet sie, weil der Rueckkanal leer bleibt. Ein ehrlicher,
konkreter Timeout-Text ("die Antwort steht noch aus, ich reiche sie nach") ist deshalb Teil
dieser Phase; eine Falschaussage ueber die eigenen Faehigkeiten ist ein Produktdefekt.

## Was zu bauen ist

**Die Antwort darf spaeter kommen, ohne dass der Agent schweigt.** Am Telefon sind ~4 s
Wartezeit vertretbar, mehr nicht ([[in-call-research-is-mandatory]]: 4 s Warten sind OK,
Stille nicht). Daraus folgt die Trennung, die diese Phase herstellt:

1. **Warten und Sterben sind zwei verschiedene Fristen.** Wie lange der Agent im laufenden
   Turn auf die Antwort *wartet*, bevor er ueberbrueckt, bleibt kurz. Wie lange ein Consult
   *offen* bleibt und eine eintreffende Antwort noch annimmt, wird deutlich laenger.
2. **Der Abbruch wird an die Wanduhr gehaengt**, nicht an einen Turn-Zaehler. Ein Consult
   stirbt, wenn seine Frist abgelaufen ist — nicht, weil zufaellig zwei Turns vergingen.
3. **Eine spaeter eintreffende Antwort fliesst in einen der naechsten Turns ein**, statt
   verworfen zu werden. `answer_consult` liefert dann `accepted: true`.
4. **Der Ueberbrueckungstext sagt die Wahrheit:** die Antwort steht noch aus und wird
   nachgereicht — **nie**, dass die Faehigkeit fehle.

**B-2 (`get_consult` fehlt im Werkzeugsatz):** Das Frischefenster ist mit 25 s gegen 22 s
Poll-Hold **nicht** strukturell zu eng — die Marge betraegt aber nur 3 s, und jede Pause
zwischen zwei Polls (Modell-Overhead des Assistenten) faellt in diese Luecke. Miss zuerst,
**warum** `consultPollFresh: false` stand, obwohl der Client pollte, und behebe genau das.
**Wenn die Messung zeigt, dass die Marge reicht und die Ursache woanders liegt, sag das** —
und aendere die Konstante NICHT auf Verdacht.

## Harte Randbedingungen

- **`get_consult` ist Assistent-zu-Assistent**, nicht Agent-zu-Mensch: der persoenliche
  KI-Assistent des Users loest den Anruf ueber MCP aus und haelt die
  `await_call_event`-Schleife offen. Der aktive Poll ist der **vorgesehene Normalzustand**.
  **Kein Redesign zu einem Postfach** — vom Owner ausdruecklich verworfen.
- **Safety-Gates unberuehrt:** Kostendecke, `OUTBOUND_FROZEN`, Denylist, Land-Gate,
  Stundenlimit, Max-Dauer, Signaturpruefung, Offenlegungssatz, Auth. Ein laenger offener
  Consult darf **kein** Gespraech verlaengern und keine Max-Dauer aushebeln.
- **Kein Fail-open:** ist unklar, ob eine Antwort noch gueltig ist, wird sie **nicht**
  eingespeist. Eine veraltete Antwort in einem spaeteren Gespraechskontext ist schlimmer
  als keine.
- **Kein Prompt-Umbau** ausser dem einen Timeout-/Ueberbrueckungstext. B-4/B-5 sind eigene
  Baustellen.
- Konfigurierbares nach `src/config.js` **und** `.env.example`. ESM, kein Build-Step.
  Kommentare deutsch **ohne** Umlaute. Gesprochene Strings tragen **korrekte** Umlaute.

## Abnahme

1. `npm test` gruen (Vorbedingung, nicht das Ergebnis).
2. Neue Tests, jeder mit Gegenbeispiel:
   - Antwort nach ~10 s -> `accepted: true`, `merged_facts >= 1` (heute: false/0)
   - Antwort nach Ablauf der Offen-Frist -> `accepted: false` (Fail-closed bleibt)
   - zwei Turns vergehen ohne Antwort -> Consult **lebt weiter**, solange die Uhr laeuft
     (heute: `timed_out`) — das ist der Gegenbeweis zu W2
   - der Ueberbrueckungstext behauptet **nie** eine fehlende Faehigkeit
3. **Das Ergebnis ist der naechste Testanruf:** in der `consults`-Spalte muss
   `answeredFacts >= 1` und `answeredAt != null` stehen, und `answer_consult` muss
   `accepted: true` liefern. Zusaetzlich: `get_consult` erscheint in `offeredToolNames`,
   solange der Assistent pollt.

## Rueckweg

Die Fristen liegen in `src/config.js`; die alten Werte stellen das heutige Verhalten wieder
her. Der Wanduhr-Fix ist eine Verhaltenskorrektur ohne Datenmodell-Aenderung — Revert des
Commits genuegt.
