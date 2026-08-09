# GQ-P17 — Haltefrist gegen die Doppelantwort auf fragmentierte Spracherkennung

Spezifikation, Stand 2026-08-09. Basis: `master` (nach FIX-1).
Owner-Entscheidung 2026-08-09: **Weg C** (Haltefrist im Shim), nach Vorlage von drei Wegen.

## 1. Der Befund, am Live-Anruf gemessen

Owner hoerte im Anruf `call_mslml7vvy1oe` **zwei Wetterberichte mit widersprechenden Zahlen**
(16-21 Grad und 30-33 Grad). Das ist keine Halluzination — es waren **zwei unabhaengige
`look_up`-Recherchen**, weil Hermes auf **zwei Fragmente derselben Aeusserung** geantwortet hat:

| turnSeq | Zeichen | `prevRelation` | `gapMs` | `providerMessagesGrew` |
|---|---|---|---|---|
| 1 | 61 | `first` | — | `null` |
| 2 | 100 | **`extends`** | **2508** | **`false`** |

`extends` heisst: der Vorgaengertext ist ein echtes Praefix — die Spracherkennung hat
denselben Satz fortgeschrieben. Beide Fragmente haben einen vollen LLM-Turn ausgeloest.

Im Anruf davor (`call_mslm38yfw5xb`) waren es **5 von 8** Turns mit `extends`.

## 2. Die Wurzel — und warum Konfiguration sie NICHT loesen kann

Belegt an der Telnyx-Doku (`developers.telnyx.com/docs/inference/ai-assistants/transcription-settings`)
und an der Live-Config des Assistants:

| Parametergruppe | gilt fuer | Live-Wert bei uns |
|---|---|---|
| `eot_threshold`, `eot_timeout_ms`, `eager_eot_threshold` | **nur `deepgram/flux`** | 0.9 / 5000 / null |
| `min_turn_silence`, `max_turn_silence`, `end_of_turn_confidence_threshold` | **nur AssemblyAI Universal-Streaming** | null / null / null |
| `smart_format`, `numerals` | nova-3 | true / true |

**Wir fahren `deepgram/nova-3` (seit dem B-7-Fix am 2026-08-08). Fuer nova-3 existiert KEIN
Turn-End-Regler.** Die Werte in unserer Config sind Flux-Parameter und tun seither nichts.

Das erklaert die Verschaerfung exakt: mit Flux waren die Regler wirksam (4 Fragmentierungen
auf 13 Turns am 06.08.), mit nova-3 sind sie tot (5 auf 8 am 09.08.).

**Verworfene Alternativen (Owner-Entscheidung):**
- **Zurueck auf Flux** — scheidet aus: englisch-only, gemessene **97 % Wortfehlerrate** auf
  Deutsch (Befund B-7, `stt-flux-english-root-cause`).
- **AssemblyAI Universal-Streaming** — haette die Regler, ist aber ein Modellwechsel mit
  ungemessener Deutsch-Qualitaet. B-7 mahnt: dokumentierte Sprachunterstuetzung sagt nichts
  ueber die gemessene. Braeuchte erst eine WER-Messung (`scripts/stt-wer.mjs`).

**Damit liegt der einzige Hebel bei uns.**

## 3. Die widerlegte Praemisse — ausdruecklich festgehalten

`tasks/gq-chain-state.md` haelt fest: *"Eine Haltefrist im Code (P1b) waere der falsche
Hebel — sie tauschte Latenz gegen ein Doppelsprechen, das es nicht gibt."*

**Diese Praemisse ist am 2026-08-09 widerlegt.** Das Doppelsprechen existiert und ist
belegt: zwei gesprochene Wetterberichte mit widersprechenden Zahlen, vom Owner gehoert, in
Telnyx' Gespraechsprotokoll nachweisbar. Die damalige Begruendung galt fuer den Flux-Stand,
auf dem der Provider die Fragmente selbst zusammenhielt.

## 4. Auftrag

Ein Turn, dessen Text die Fortschreibung eines gerade erst gesehenen Turns ist
(`prevRelation === EXTENDS`), darf **keine zweite Antwort** erzeugen. Der Shim soll die
Fragmente zusammenfassen, statt jedes einzeln zu beantworten.

**Der Mechanismus ist NICHT vorgegeben** — der Plan-Agent waehlt ihn am Code und begruendet
ihn. Naheliegend ist eine kurze Haltefrist, bevor ein Turn den LLM-Aufruf startet: kommt in
dieser Zeit ein `extends`-Nachfolger, gewinnt der laengere Text und der Vorgaenger antwortet
still. Bestehende Mechanik ist zu beruecksichtigen, nicht zu duplizieren:
`supersede` (GQ-P1), `discarded_answer` (GQ-H1-a), der Provider-Anstoss-Riegel (GQ-P5,
`lastRole`) und `observeTurnText` (`src/telnyx-llm-shim.js:659`).

## 5. Invarianten — jede Verletzung ist ein Blocker

1. **Keine echte Aeusserung darf verschluckt werden.** `prevRelation === SAME` (doppelte
   Zustellung desselben Requests) ist ausdruecklich AUSGENOMMEN — dort wurde die
   Vorgaengerantwort sehr wohl gesprochen. Dieselbe Ausnahme traegt schon GQ-H1-a
   (`shim:690`); sie darf nicht aufgeweicht werden.
2. **Der Riegel darf nur STRENGER machen, nie fail-open.** Im Zweifel (nicht entscheidbar,
   `providerMessagesGrew === null`, erster Request) bleibt das Bestandsverhalten.
3. **Telnyx wartet synchron auf die HTTP-Antwort des Shims.** Die Haltefrist MUSS deutlich
   unter dem Provider-Timeout bleiben und ist gegen das bestehende Turn-Budget zu rechnen
   (`src/turn-budget.js`, EINE Quelle — dort nachrechnen, nicht schaetzen).
4. **Der Preis ist Latenz und muss benannt werden.** Die gewaehlte Frist ist zu begruenden
   (Messgroesse: die beobachteten `gapMs` zwischen Fragmenten lagen bei 1314-2926 ms; eine
   Frist, die alle faengt, waere teuer — die Abwaegung gehoert in den Report).
5. **Safety-Gates, Offenlegungssatz, Budget-Notaus bleiben unberuehrt.** Der Riegel sitzt
   NACH der Sonde und darf keines der Gates umgehen oder verzoegern.
6. **Ein neuer Beobachtungskanal ist Pflicht** (Muster: `discarded_answer`), PII-frei
   (`callId` + `turnSeq` + Grund-Token), damit die Wirkung im naechsten Anruf **auszaehlbar**
   ist. Ohne Messinstrument ist der Fix nicht abnehmbar — GQ-P1 galt zwei Monate als "live",
   ohne dass jemand seine Wirkungslosigkeit sah.

## 6. Abnahme

1. `node --check` auf jede geaenderte Datei, Exit 0.
2. `npm test` -> `fail 0`, Exit 0, `pass` **>= Stand der Basis**. Ein SINKEN ist ein Blocker.
   **Lauf MUSS im Worktree stattfinden** (`git checkout` scheitert still bei belegtem
   Worktree, Lehre 2026-08-09), und gegen ein **Merkmal der Aenderung** geprueft werden
   (`grep -c "^ok .* - GQ-P17-"`), nicht nur gegen `fail 0`.
3. **Repro-Test:** zwei aufeinanderfolgende Requests, der zweite ein echtes Praefix-Extend
   des ersten -> **genau EIN** LLM-Turn, genau EINE gesprochene Antwort.
4. **Gegenprobe `SAME`:** doppelte Zustellung desselben Requests -> Bestandsverhalten,
   die Antwort wird NICHT unterdrueckt.
5. **Gegenprobe `other`:** eine echte neue Aeusserung nach einer Pause -> normaler Turn,
   keine Verzoegerung ueber die Frist hinaus.
6. **Rotprobe (Pflicht):** den Riegel entschaerfen -> der Repro-Test aus (3) MUSS rot werden.
7. **Latenz-Beleg:** ein Test oder eine Rechnung, die zeigt, dass die Frist das Turn-Budget
   nicht sprengt.

## 7. Arbeitsweise (Repo-Lehren)

- Erst Branch/Worktree auf `master` anlegen, **dann** lesen.
- `src/telnyx-llm-shim.js` ist der **Live-Sprechpfad**. Aenderungen dort sind heikel: der
  Shim beantwortet jeden Telnyx-Request synchron.
- Hintergrund-Testlaeufe **nie** durch eine Pipe filtern — volle Ausgabe in eine Datei.
- Commit-Messages mit Anfuehrungszeichen ueber `-F datei`, nie inline.
- Dateien **einzeln** adden, **nie** `git add -A`.
- Kommentare auf Deutsch OHNE Umlaute; gesprochene deutsche Strings behalten korrekte Umlaute.
- Neue Env-Variable (falls die Frist konfigurierbar wird): `src/config.js` + `.env.example` +
  `render.yaml` + **`BASE_ENV` in `test/helpers.js`**.
