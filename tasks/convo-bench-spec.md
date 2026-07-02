# Conversation-Bench Spec (scripts/convo-bench.mjs)

> Herkunft: Analyse-Workflow 2026-07-02 (Bench-Design-Agent), vom Lead geprueft und
> als Umsetzungs-Spec fixiert. Ziel: Gespraechsqualitaet AUTONOM messbar machen —
> echter Server, echter systemPrompt, ECHTES claude-haiku-4-5, simulierte Gegenseite,
> KEIN echtes Telefonat.

## 0. Nicht verhandelbare Leitplanken

- Kein Wechsel von claude-haiku-4-5 / deepgram-nova-3 / Azure-Katja im Produktions-Pfad.
- Safety-Gates, Offenlegung, Auth bleiben unberuehrt.
- Kein neuer npm-Dep: `@anthropic-ai/sdk` ist bereits Dependency, reicht fuer Persona- und Judge-Calls.
- `/voice/outbound` bleibt LLM-frei — die Bench treibt es genau wie heute.
- Bench laeuft NICHT unter `npm test` (braucht Netz+echten Key) — eigenes Script + `npm run convo-bench`-Eintrag.

## 1. Dateien (neu)

```
scripts/convo-bench.mjs                 # CLI-Entry (Parsing, Orchestrierung, Exit-Code)
scripts/convo-bench/runner.mjs          # Kern: ein Scenario-Repeat end-to-end fahren
scripts/convo-bench/texml.mjs           # TeXML->{sayTexts[], hasGather, hasHangup} Regex-Parser
scripts/convo-bench/persona.mjs         # Persona-Sim-LLM-Call (+ scriptedTurns + sttNoise-Transform)
scripts/convo-bench/judge.mjs           # Judge-LLM-Call (fixe Rubrik, structured output)
scripts/convo-bench/checks.mjs          # deterministische Binary-Checks (reine Funktionen)
scripts/convo-bench/metrics-parse.mjs   # stdout `[metrics] ...`-Zeilen -> strukturierte Liste
scripts/convo-bench/report.mjs          # JSON-Report + kompaktes stdout-Summary
scripts/convo-bench/scenarios/friseur-voll.mjs
scripts/convo-bench/scenarios/termin-duenn.mjs
scripts/convo-bench/scenarios/partner-knapp.mjs
scripts/convo-bench/scenarios/stt-noise.mjs
scripts/convo-bench/scenarios/inbound-nachricht.mjs
scripts/convo-bench/scenarios/index.mjs  # Registry (id -> Modul)
```

Ergebnisse unter `data/convo-bench/<run-id>/` (`data/` ist bereits gitignored).
package.json scripts: `"convo-bench": "node scripts/convo-bench.mjs"`.

## 2. CLI

```
node scripts/convo-bench.mjs run \
  [--scenario <id>|--all] [--repeat 3] [--label baseline|candidate|<frei>] \
  [--persona-model claude-haiku-4-5] [--judge-model claude-sonnet-5] \
  [--max-turns 10] [--provider telnyx|twilio] [--out data/convo-bench/<run-id>]

node scripts/convo-bench.mjs compare <reportDirA> <reportDirB>   # Diff-Tabelle stdout
```

Exit-Code 0 nur wenn ALLE deterministischen Checks aller Szenarien/Repeats bestehen
(Judge-Scores sind informativ, kein Hard-Gate per Default).

## 3. Ablauf pro (Szenario, Repeat)

1. **Server-Start** via test/helpers.js `startServer` (Praezedenz fuer scripts-Reuse:
   scripts/smoke-stripe-payment.mjs importiert test/helpers.js):
   - `ANTHROPIC_API_KEY` aus `process.env` (NIE loggen, NIE in Report).
   - `ANTHROPIC_BASE_URL` UNGESETZT lassen -> echter Anthropic-Endpunkt.
   - `CLAUDE_MODEL=claude-haiku-4-5` (= Produktions-Default).
   - `METRICS_ENABLED=true` (explizit anheben, sonst keine `[metrics]`-Zeilen).
   - `ASSISTANT_CONTEXT_ENABLED` folgt dem Szenario (friseur-voll: true; termin-duenn:
     Live-Zustand nachbilden).
   - `MAX_BUDGET_EUR="20"` (defensive Anhebung fuer den Bench-Store).
   - Provider-Credentials bleiben BASE_ENV-Dummies/leer (Fail-closed-Netz: physisch
     kein echter Dial moeglich). `VOICE_ENGINE=budget`.
   - Store-Seed via `seedState`/`seedCall` (direkter Store-Seed, NIE `/api/calls` —
     das ist die einzige Route mit originateCall!). ownerNumber passend zu --provider
     (Default telnyx = Live-Provider; helpers defaulten twilio, Bench weicht bewusst ab).
2. **Erster Request**: outbound -> `POST /voice/outbound?callId=<id>`;
   inbound -> `POST /voice/incoming` (To=ownerNumber, From=callerNumber).
3. **Turn-Schleife** (bis MAX_TURNS oder `<Hangup`):
   a. TeXML parsen: sayTexts via `/<Say[^>]*>(.*?)<\/Say>/gs` + XML-Entities
      zuruecktransformieren; hasGather; hasHangup.
   b. Agenten-Text -> Transkript `{role:"agent", text}`.
   c. hasHangup -> Ende, `ended_via="agent_hangup"`.
   d. Sonst: `scenario.scriptedTurns[turnIndex]` (Vorrang, deterministische Repro)
      ODER Persona-Sim (§4).
   e. Falls `scenario.sttNoise`: Text-Korruptions-Transform (lowercase, Satzzeichen
      strippen, ~20% Chance Kappung, gelegentlich "aeh").
   f. `POST /voice/turn?callId=<id>` mit `SpeechResult=<text>`; Callee-Text VOR dem
      Post ins Transkript.
4. Cap ohne Hangup -> `ended_via="turn_cap"` (Befund, kein Absturz).
5. stdout sichern (Metrics-Parse), `srv.readStore()` fuer summary/objectiveAchieved/
   actionItems/calendar, `srv.stop()`.
6. Deterministische Checks -> 7. Judge-Call -> 8. Report.

## 4. Persona-Simulation

- Direkter Anthropic-Call (nicht durch den Server), selber Key.
- Default `claude-haiku-4-5`; `--persona-model` als Option.
- system = `scenario.personaPrompt` (Rolle + "1 kurzer Satz, KEIN Meta-Kommentar").
- messages = Transkript aus Callee-Sicht gespiegelt (agent->user, caller->assistant).
- max_tokens ~120, effort low.
- `scriptedTurns` = `{ <turnIndex>: "fixer Text" }` — Vorrang vor LLM (z.B.
  termin-duenn Turn 0: "17 Uhr passt mir gut.").
- `stop_reason==="refusal"` abfangen -> `ended_via="persona_refusal"`.

## 5. Messung

### (i) Deterministische Binary-Checks (checks.mjs)

Jede Check-Funktion: `(runResult, scenarioConfig) => { id, pass, detail }`.

| Check | Logik |
|---|---|
| `disclosure_first` | Outbound: erster sayText des ersten Turns beginnt mit `disclosureSentence(call)` (aus src/claude.js importieren — reiner Code, kein Netz) |
| `no_raw_iso_date_spoken` | `/\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?\b/` matcht NICHT in Agenten-Text |
| `farewell_before_terminal` | letzter Agenten-Turn vor Hangup != turnErrorSpeech/llmDegradedSpeech (aus locales.js), ausser Szenario testet Degradation |
| `no_verbatim_question_repeat` | keine zwei Agenten-Turns mit identischem getrimmtem Text |
| `no_redundant_ask_about_briefed_info` | `scenario.mustNotAskSubstrings` in Agenten-Turns zaehlen (Heuristik, Best-effort; Judge-Kriterium 2 ist die verlaessliche Instanz) |
| `booked_with_nongeneric_title` | falls `expectBooking`: Kalender hat NEUEN Eintrag mit Titel != "Termin" |
| `turn_count_within_budget` | Agenten-Turns <= scenario.maxTurns |
| `no_tool_loop_exhaustion` | aus metricsParsed: kein Turn mit roundtrips===4 |
| `inbound_no_disclosure_leak` | (inbound) keine Agenten-Zeile enthaelt Offenlegungsphrase |
| `message_taken` | (inbound) actionItems nicht leer |

### (ii) LLM-Judge

- Direkter Call, Default `claude-sonnet-5` (bewusst ANDERES Modell als das gebenchte
  Haiku — Selbstbewertungs-Bias; Default im Code hart vorgeben).
- Structured Output (json_schema): `{scores:{role_fidelity,coherence,task_progress,
  naturalness,efficiency}, rationale:{<criterion>:"1 Satz"}, overall_flag:"pass"|"concern"|"fail"}`,
  Scores 1-5 ganzzahlig.
- Judge-Input: Transkript, Szenario-Ground-Truth (goal/briefing/context), `judgeFocus`
  aus dem Szenario (termin-duenn: "Kriterium 2 besonders streng: darf der Agent nach
  einer reinen Zeitangabe unvermittelt nach dem Thema fragen?").
- Judge gated den Exit-Code NICHT (informativ).

### (iii) Report

Pro (Szenario, Repeat): `data/convo-bench/<run-id>/<scenario>-r<n>.json` mit
`{meta{scenario,repeat_index,label,started_at,agent_model,persona_model,judge_model,
provider,git_rev}, transcript, texml_samples, metrics{turns,stt_gaps_ms,llm_calls},
store_snapshot{summary,objective_achieved,action_items,calendar_new_events},
checks[], judge{}, cost_estimate_usd{}, turn_count, ended_via}`.
Plus `summary.json` (Aggregat) + kompakte stdout-Tabelle.

**A/B**: zwei `run`-Aufrufe (baseline im Master-Stand, candidate im Arbeits-Worktree),
IDENTISCHE Szenarien+scriptedTurns+repeat. `compare` druckt Deltas.
**Varianz**: `--repeat 3` Default fuer Judge-relevante Laeufe; Checks pro Repeat einzeln
("2/3 bestanden" sichtbar). temperature/top_p NICHT setzen.

## 6. Sicherheitsargument (kein echter Call moeglich)

- Bench ruft NIE `POST /api/calls` (einzige Route mit originateCall) — Call wird
  direkt in den Temp-Store geseedet; /voice/* sind reine Webhook-Renderer.
- Provider-Credentials bleiben Dummies/leer (Defense-in-Depth).
- VOICE_ENGINE=budget -> nie Connect/Stream.
- ANTHROPIC_API_KEY: nur process.env -> Kindprozess-Env; NIE loggen, NIE in Reports,
  auch nicht in Fehlerpfaden (keine Request-Header dumpen).

## 7. Grenze (ehrlich)

Bench misst TEXT-Qualitaet + Ablauf. NICHT: echte Deepgram-Erkennungsguete, echtes
speechTimeout/Endpointing-Verhalten, Katja-Prosodie (Owner-Ohr-Test). Ziel: Symptom 2
(Inkohaerenz) + Text-Anteil von Symptom 1.

## 8. Kosten

Haiku $1/$5 pro 1M, Sonnet-5 Intro $2/$10 (bis 2026-08-31). Pro Szenario-Lauf
~0.01-0.03 USD; voller Sweep (5 Szenarien x 3 Repeats x A/B) ~0.3-0.9 USD.
Erster Lauf IMMER `--scenario <eins> --repeat 1` als Sanity-Check.

## 9. Szenarien (Pflicht)

- **friseur-voll** (outbound, context ENABLED): goal="Naechsten freien Termin fuer
  einen Herrenhaarschnitt vereinbaren", briefing="Stammkunde bei Friseur Schneider,
  moechte wie immer zu Petra, bevorzugt vormittags", context={summary, key_facts:
  ["Stammkunde seit 2 Jahren","bevorzugt Petra"], desired_outcome:"Termin fest gebucht"}.
  Checks: disclosure_first, no_redundant_ask_about_briefed_info ("welchen service",
  "was fuer einen termin"), booked_with_nongeneric_title, farewell_before_terminal,
  turn_count_within_budget(8).
- **termin-duenn** (outbound, EXAKTE Repro von call_mr3dz9t9u5jm): goal="Den naechsten
  freien Termin erfragen.", briefing/constraints/context=null, Flag wie live.
  scriptedTurns={0:"17 Uhr passt mir gut."}. Checks: no_raw_iso_date_spoken,
  turn_count_within_budget(8), no_verbatim_question_repeat; mustNotAskSubstrings
  ["was ist denn das thema","worum geht es"] als Heuristik-Flag (NICHT Hard-Gate);
  Judge-Kohaerenz ist das primaere Signal.
- **partner-knapp** (outbound): personaPrompt erzwingt 1-3-Wort-Antworten, teils
  unkooperativ. Checks: no_verbatim_question_repeat, farewell_before_terminal,
  turn_count_within_budget.
- **stt-noise** (outbound, Basis friseur-voll, sttNoise:true): Basis-Checks +
  no_tool_loop_exhaustion.
- **inbound-nachricht** (inbound via /voice/incoming): Anrufer will Nachricht
  hinterlassen. Checks: inbound_no_disclosure_leak, message_taken,
  turn_count_within_budget.

## 10. Nicht-Ziele

Kein Ersatz fuer echte Testanrufe (Stimme/Audio). Kein npm-test-Bestandteil. Kein
Eingriff in src/ noetig. Kein neuer Safety-Mechanismus.

## Risiken (bei Implementierung beachten)

- MAX_TURNS-Kappe verbindlich (Kosten-Runaway-Bremse).
- Key-Hygiene auch in Fehlerpfaden.
- termin-duenn: Heuristik nie zum Hard-Gate hochstufen (Overfitting auf Wortlaut).
- Kopplung an test/helpers.js ist bewusst (Praezedenz smoke-stripe-payment.mjs).
