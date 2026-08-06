# Kickoff: Gespraechsqualitaet — das Haken zuerst

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er funktioniert ohne
Kenntnis vorheriger Gespraeche.

**Regel: nur Gemessenes.** Jede Aussage traegt einen Beleg (Call-ID, Log-Zeile, Datei:Zeile,
Anbieter-Doku) oder ist als **unbelegt** markiert.

---

## Auftrag

Du uebernimmst die Gespraechsqualitaet des Telefon-KI-Agenten Hermes. **Fang mit P1 an, in
dieser Reihenfolge.** Der Owner ist fuer Testanrufe **jederzeit erreichbar** — du darfst
anrufen, wann du willst.

Am 2026-08-05 wurde erstmals ein Anruf vollstaendig auswertbar (`call_msgf3r21x0w0`). Das
Owner-Urteil danach: *"Absolute Katastrophe, mit Abstand das Schlimmste, was ich bisher
erlebt habe."* Diese Messung ist die Grundlage von allem hier.

---

## Stand

- Live und `master`: `80b1209` (per `/healthz` gegenpruefen, **nie** aus einer Notiz lesen).
- `npm test`: 3996/3996 gruen.
- Gestern gebaut und live: GQ-P11 (Diagnose-Aufbewahrung), P13 (Consult ohne Fakten),
  P14 (Zusammenfassung kennt Notizen), P15 (Ausfall-Grund in der Nachricht),
  P16 (`endCallWait` richtungsneutral). Alle mit dualem Review, keiner beruehrt das Haken.
- **`DIAGNOSTIC_RETENTION_DAYS=7` steht live.** Jeder Anruf an die Owner-Nummer behaelt sein
  Rohtranskript 7 Tage. Das ist neu und der Grund, warum du ueberhaupt messen kannst.

Details: `tasks/gq-strategie-2026-08-06.md`, `tasks/gq-fragilitaet-2026-08-06.md`,
`tasks/gq-chain-state.md` (Abschnitt "Testanruf `call_msgf3r21x0w0`"). **Mit `grep -n`
hineingreifen, nicht am Stueck lesen.**

---

## Arbeitsweise — das Wichtigste zuerst

**Baue die Offline-Reproduktion, BEVOR du irgendetwas aenderst.** Das Haken (P1) ist eine
reine Zeit-Wechselwirkung zwischen zwei HTTP-Requests. Es braucht **kein Telefon**:
zwei POSTs an den Shim im Abstand von ~2,1 s, der zweite verlaengert den Text des ersten,
Erwartung: **eine** gesprochene Antwort. Heute sind es drei.

Das ist der Hebel, an dem gestern die meiste Zeit verloren ging: jede Messung kostete einen
echten Anruf mit einem Menschen, der eine Rolle spielt. Ein Testlauf, der in 200 ms laeuft,
schlaegt zehn Anrufe. **Testanrufe sind zur Verifikation da, nicht zum Iterieren.**

**Reihenfolge je Phase:** Offline-Repro (rot) -> Fix -> Repro gruen -> `npm test` gruen ->
Merge -> Deploy -> **ein** Testanruf zur Bestaetigung.

**Workflows/Subagenten: freigegeben, aber gezielt.** Meine Empfehlung, du darfst abweichen:

| Phase | Vorgehen | Begruendung |
|---|---|---|
| P1 Haken | **kein** Fan-out. Lead baut die Repro selbst, dann EINE Phase ueber `phase-impl-lean` | ein enges Problem in ein bis zwei Dateien; Fan-out bringt dort nichts ausser Token |
| P2 Modell-A/B | **kein** Workflow. Flag-Flip + Anrufe + Auswertung | das ist Messen, nicht Bauen |
| P3 Persona | **ja, Judge-Panel** (N unabhaengige Ansaetze, parallel bewertet, bester synthetisiert) | drei Prompt-Runden sind gescheitert; der Loesungsraum ist offen, und genau dafuer taugt ein Panel |

**Pre-Mortem vor jeder Phase** (CLAUDE.md verlangt es): ein Jahr in die Zukunft, die Phase
war falsch — was ist passiert? Bei P1 die naheliegende Antwort vorwegnehmen: *"Wir haben
Latenz gegen Doppelantworten getauscht, und jetzt ist der Agent zu langsam."* Deshalb ist
die Latenz-Zahl in P1 eine **Abnahmebedingung**, kein Nebeneffekt.

**Kein Merge ohne dualen Review.** **Keine Phase ohne vorher benannte Zahl.** **Behaupte
keinen Gewinn, den du nicht gemessen hast** — am 2026-08-05 wurden vier Phasen als
Fortschritt praesentiert, von denen keine am Telefon belegt war.

---

## P1 — Das Haken (hoechste Prioritaet)

### Der Befund, am Log belegt

`call_msgf3r21x0w0`, Render-Log:

```
turn_probe turnSeq 8  gapMs 2691  prevRelation "extends"
supersede  turnSeq 8  superseded:false  refusal:"no_inflight"
turn_probe turnSeq 9  gapMs 2077  prevRelation "extends"
supersede  turnSeq 9  superseded:false  refusal:"no_inflight"
```

`no_inflight` heisst: **es gab nichts mehr zu verdraengen.** Modell-Latenz 1107 / 1325 /
1972 ms; die Fortsetzung des Anrufers kommt nach 2077 / 2691 ms. Der Verdraengungs-Riegel
(GQ-P1, `src/telnyx-llm-shim.js`) kommt **strukturell** zu spaet.

Im Transkript: **drei Agenten-Antworten in fuenf Sekunden** (18:26:51 / :53 / :55) auf eine
einzige, wachsende Aeusserung.

**Wichtige Praezisierung** (eine frueher notierte Diagnose war hier zu grosszuegig): der
Riegel verhindert die doppelte **Nachricht** — `messagesCount` bleibt konstant. Er verhindert
NICHT die doppelte **Antwort**: der Turn laeuft trotzdem und spricht.

### Was die Anbieter-Doku dazu sagt

Zwei Ursachen sind **widerlegt** — nicht neu untersuchen:

- `interim_results` ist bei Telnyx/Deepgram **Default `false`**; der Shim sieht nur finale
  Transkripte. Live steht `null` (= Default).
- Eager End-of-Turn ist **aus**: Telnyx-Doku woertlich *"Set both thresholds to the same
  value to disable eager behavior"*; live `eot_threshold: 0.9` und `eager_eot_threshold: 0.9`.

Der Stand der Technik benennt genau unsere Konstellation als Fehler:

> *"With a tightly coupled pipeline and a graceful abort process, you buy several hundred
> milliseconds to catch and correct mistakes, and you can configure endpointing more
> aggressively **if you can gracefully abort the downstream steps**."*

**Hermes hat aggressives Endpointing OHNE funktionierenden Abbruch.** Das ist die Wurzel.
Ausserdem empfiehlt die Praxis fuer Telefonie ausdruecklich, *mehrere aufeinanderfolgende
hochkonfidente Schritte* zu verlangen, statt auf eine einzelne Messung hin zu committen.

Quellen:
`https://www.cekura.ai/blogs/endpointing-in-voice-ai-turn-detection` ·
`https://www.twilio.com/en-us/blog/developers/best-practices/guide-core-latency-ai-voice-agents` ·
`https://developers.telnyx.com/docs/voice/stt/websocket-streaming/parameters/interim-results` ·
`https://telnyx.com/release-notes/automatic-eager-end-of-turn-deepgram-flux`

### Die zwei Hebel — sie gehoeren zusammen betrachtet

1. **Abbruch reparieren (Code).** Der Riegel muss greifen, BEVOR gesprochen wird. Heute
   scheitert er an `hasSpokenText` ("lieber zwei Antworten als Stille") bzw. daran, dass der
   Turn schon fertig ist. Kandidat: eine kurze Haltefrist auf dem Sprech-Draht (~300-500 ms),
   in der eine Verlaengerung den Turn noch verwerfen kann.
2. **Endpointing entschaerfen (Provider-Konfiguration).** `eot_threshold` / `eot_timeout_ms`.
   **Erst `GET` + Snapshot nach `data/evidence/telnyx-config/`, dann patchen** — Telnyx-PATCH
   merged tief, `null` heisst "nicht aendern".

Welcher Hebel zuerst, entscheidet die Messung: Hebel 1 kostet Latenz auf **jeden** Turn,
Hebel 2 kostet Reaktionszeit nur an Pausen. **Erst rechnen, dann bauen.**

### Abnahme (beide Zahlen, nicht eine)

| | heute | Ziel |
|---|---|---|
| gesprochene Antworten auf eine wachsende Aeusserung | **3** | **1** |
| `supersede refusal:"no_inflight"` je Anruf | **2** | **0** |
| Modell-Latenz `shim_turn` (Median) | 1107-1972 ms | **darf sich nicht verschlechtern** |

Die dritte Zeile ist die Abnahmebedingung aus dem Pre-Mortem. Stand der Technik: unter 1 s
gesamt, ideal 500-800 ms — Hermes liegt schon heute darueber.

---

## P2 — Modellwechsel Haiku -> Sonnet (Owner-Entscheidung O-4, bindend)

**Vorher-Zahl steht:** im Testanruf enthielt `offeredToolNames` in **jedem** Turn (7, 8, 9, 10)
`get_consult` und `look_up`; `toolNames` war **jedes Mal leer** — waehrend der Agent die
Gegenstelle wiederholt nach Informationen ueber den Auftraggeber fragte. Also **0 von 4**.

Frueher gemessen: `look_up` 0/19, `get_consult` 0/4 (`call_msg0swwfhe5e`).

**O-4 ist bindend: dagegen hilft der Modellwechsel als A/B-Lauf mit Messung, NICHT die
naechste Prompt-Runde.** Prompt-Runden wurden dreimal versucht (AL-P14, AL-D3, GQ-P9) und
haben nie gewirkt.

Erst nach P1 auswerten — solange der Agent dreimal auf einen Satz antwortet, misst jede
Werkzeug-Statistik Rauschen.

---

## P3 — Persona und Identitaet

**GQ-P9 ist wirkungslos, am Log belegt.** Die Phase vom 2026-08-05 fuehrte die Regel ein, die
Gegenstelle nicht ueber den Auftraggeber auszufragen. Im Testanruf danach: **fuenf Verstoesse**
— *"Welches Fahrzeugmodell hat Antonios Auto denn?"*, *"kann ich ihn kurz sprechen?"*,
*"Ist er erreichbar?"*, *"Kann ich Antonio kurz ans Telefon bekommen?"*, *"Kann ich ihn
erreichen?"*

Zweiter Beleg gegen die Prompt-These: das Verhalten ist **aelter als die Regel**. Beleg im
Transkript vom 2026-08-01 (`call_msabz9975sph`), die Regel entstand am 2026-08-05 10:26 UTC.

**Neuer Befund aus demselben Anruf — Identitaets-Kollaps:** der Agent hielt die Gegenstelle
fuer den Auftraggeber. *"Hallo Antonio, ich bin Hermes, dein persoenlicher Assistent"* — zur
Werkstatt gesagt. Danach *"Jetzt bin ich am Telefon mit dir, Antonio."* Erst nach *"Ich bin
die Werkstatt"* korrigiert.

**Owner-Vorgabe (bindend), gilt in de/en/fr, sinngemaess uebersetzt:**

| Situation | Was Hermes sagt |
|---|---|
| Er weiss etwas nicht und klaert es jetzt | „Warten Sie kurz, ich schaue einmal nach." |
| Er findet es nicht | „Tut mir leid, ich kann die Information momentan nicht finden." |
| Er kann es erst spaeter klaeren | „Das klaere ich und melde mich bei Ihnen zurueck." |

**Verboten:** „auf meiner Seite", „bei meinem Auftraggeber", jede Nennung des Auftraggebers
als Auskunftsquelle gegenueber der Gegenstelle.

**Nicht als vierte Prompt-Runde bauen.** Hier ist das Judge-Panel angebracht: mehrere
unabhaengige Mechanismus-Ansaetze (z. B. Werkzeug-Zwang statt Formulierung, Rollenbindung im
Turn-Kontext, Nachbearbeitung der Antwort), parallel bewertet, bester umgesetzt.

---

## Was danach uebrig bleibt

| ID | Befund | Beleg |
|---|---|---|
| **Eroeffnung** | 13,6 s Monolog vor dem ersten Wort der Gegenstelle (`speak.started` 18:25:51,5 -> `speak.ended status=completed` 18:26:05,1), danach 6 s Stille, dann *"Du hast aufgehoert zu reden"* | Log |
| **Offenlegung** | Owner berichtet, sie sei nicht zu 100 % gekommen. Provider meldet den Speak als **vollstaendig**. Aus dem Log NICHT entscheidbar. Es existiert eine Telnyx-Aufnahme (`call.recording.saved`). **Absolute Regel 2 — hat Vorrang, sobald es einen Beleg gibt.** Audio laeuft NIE durch MCP | unbelegt |
| **D-2** | `await_call_event` liefert `done` mit *"(Noch keine Zusammenfassung verfuegbar)"*; die Summary entsteht danach und erreicht den Client nie. Kann die Rueckfrage-Faehigkeit mitten im Gespraech abschalten | live bestaetigt |
| **B-7** | STT-Kauderwelsch. `language: multi -> de` brachte nichts. Kandidaten: `keyterm`, anderes STT-Modell | offen |
| F6 | `DASHBOARD_PASSWORD` ohne Konsument, blockiert aber weiter den Boot (`config.js:966`, `:1610-1614`) | am Code belegt |
| F7 | `WORLD_DEFAULT_LANGUAGE_ENABLED` ohne Boot-Sonde — trifft die Sprache der **Offenlegung** | am Code belegt |
| F3 | `turnText.gapMs` wird berechnet, aber von keiner Entscheidung gelesen. **Gehoert zu P1** — dort ist es vielleicht genau das fehlende Signal | am Code belegt |

---

## Nicht nochmal untersuchen (widerlegt oder erledigt)

- `interim_results` / Eager-EOT als Ursache des Hakens — **beide widerlegt** (s. P1).
- **F5** (`CallDuration` vs. abgerechnete Dauer): gemessen, 7 Anrufe, Median-Differenz **0**,
  maximal 1 s, **in keinem Fall aendert sich die abgerechnete Minute**. Erledigt.
- `RETENTION_DAYS` ohne Boot-Sonde: widerlegt, `pruneOldData` liest den Wert unbedingt bei
  jedem Boot (`store/json.js:960-962`, `store/pg.js:637-639`).
- Du/Sie-Mischung: 1 von 12 Anrufen, dort spiegelte der Agent das Register der Gegenstelle.
  Kein systemischer Befund.
- `diagnostic` greift nicht: **erledigt durch GQ-P11**, live bewiesen (`diagnostic=true` ohne
  gesetztes Flag, erstmals Summary UND Segmente am selben Call).

---

## Betrieb

- **Deploy:** Render deployt `upstream/master` (Repo `jonas986/vodafone-agent`, Service
  `srv-d8m0fhflk1mc73bno570`), `autoDeploy: no` -> manuell ausloesen. `git push origin` macht
  **nichts** live. Live-Stand IMMER per `/healthz`.
- **Prod-DB:** `psql "$(cat ~/.config/hermes/db-url)"`. RLS ist FORCE — erst
  `select set_config('app.current_tenant','t_user_01KX600834GCJFV9GTZQKWZMTH',false);` in
  **derselben** Sitzung. **`started_at` ist TEXT.**
- **Rohtranskripte:** liegen jetzt vor (`DIAGNOSTIC_RETENTION_DAYS=7`), 7 Tage.
  `select at, role, text from transcript_segment where call_id='...' order by at;`
- **Log-Felder:** `turn_probe` (`prevRelation`, `gapMs`, `lastRole`, `messagesCount`),
  `supersede` (`superseded`, `refusal`), `turn_ok` (`toolNames` vs. `offeredToolNames`,
  `latencyMs`, `streamChunks`), `gate` (u. a. `provider_nudge`), Boot-Sonden im Banner.
  **Wer eine Sonde baut, muss ihre Felder auch auswerten.**
- **ElevenLabs-TTS** liefert seit 2026-08-03 `http_403` von Render aus (Cloudflare), Fallback
  Azure. Ungeloest, nicht Teil dieses Auftrags.
- Nach vollen Testlaeufen `ps -eo pid,command | grep "[n]ode src/server.js"` pruefen.

### Beim Testanruf beachten — ein Lead-Fehler vom 2026-08-05

Der Agent stellt vor dem Anruf Rueckfragen (Eroeffnungs-Consult). Auf *"Unter welcher
Rueckrufnummer ist Antonio erreichbar?"* antwortete der Lead *"Antonio meldet sich selbst."*
Das ging als Fakt in den Kontext (`answeredFacts: 3`) und hat die
"Kann ich Antonio sprechen?"-Schleife mit hoher Wahrscheinlichkeit **mitverursacht**.

**Eine Consult-Antwort ist Prompt-Inhalt, kein Formular.** Sie muss so formuliert sein, wie
der Agent sie der Gegenstelle gegenueber verwenden koennte. Im Zweifel den Owner fragen,
statt etwas zu erfinden oder eine Verlegenheitsformel zu setzen.

### Pflichtlektuere

1. `CLAUDE.md` — Absolute Regeln, bindend
2. `.claude/refs/workflow.md` und `.claude/refs/clean-code.md`
3. `tasks/gq-chain-state.md`, Abschnitt "Testanruf `call_msgf3r21x0w0`"
4. `tasks/lessons.md`, die letzten fuenf Abschnitte
