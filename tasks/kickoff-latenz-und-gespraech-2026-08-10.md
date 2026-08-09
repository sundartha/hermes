# Kickoff: Latenz reparieren, Gespraechsqualitaet abnehmen (ab 2026-08-10)

Prompt fuer die naechste Session. Autor: Lead-Session c600bc69 (Track-B-Abschluss + FIX-1 + GQ-P17).
**Regel dieser Datei: GEMESSEN traegt ein Kommando. Alles andere ist Vermutung.**

---

> **STAND 2026-08-09, spaetere Session:** Abschnitt 3 (die Hauptaufgabe) ist **erledigt und
> gemergt** — GQ-P18, Merge `4d4a18c`; alle drei hier vorgeschlagenen Ansaetze wurden an
> Live-Daten gemessen und **alle drei verworfen**, der Umbau ging einen vierten Weg. Punkt 6.2
> (B4b/W6) ist **beantwortet** (`fd8d7c9`). Details: `tasks/gq-chain-state.md` (GQ-P18) und
> `tasks/todo.md`. **Offen bleiben 6.3 bis 6.6** — sie brauchen einen Testanruf bzw. eine
> Owner-Entscheidung. Abschnitt 7 (Betriebswissen) gilt unveraendert weiter.

## 1. Der Auftrag in einem Satz

**GQ-P17 (die Haltefrist) ist live, wirkt mechanisch — und ist wegen der Latenz vom Owner
abgelehnt worden. Sie ist per Env auf 0 gestellt. Bau sie so um, dass sie Fragmente faengt,
ohne jeden Turn zu bestrafen.**

Danach: die fuenf ungemessenen GQ-Phasen abnehmen und die zwei `GAP-15`-Rechtstexte
schliessen.

---

## 2. Stand (GEMESSEN am 2026-08-09)

| Behauptung | Kommando |
|---|---|
| master = `97c7b95`, live = derselbe Commit | `git log --oneline -1` + `curl -s https://vodafone-agent.onrender.com/healthz` |
| Suite gruen: **4135/4135**, fail 0 | `npm test` (im Worktree, s. Falle unten) |
| Track B KOMPLETT: Anbieterwechsel per `LLM_PROVIDER=anthropic\|deepseek` | am laufenden Dienst belegt, Dreierprobe + Gegenprobe |
| **`TELNYX_SHIM_EXTEND_HOLD_MS=0`** ist in der Render-Env gesetzt (2026-08-09, per MCP) | Render-Dashboard, Environment |
| Gates-Lauf: 603 Tests, **5 rot** (alle Bestandsbefunde) | `npm run test:gates` |

**Erster Handgriff:** `git fetch --all && git log --oneline -1`, `npm test`, und `/healthz`
gegen `git rev-parse master`. Stimmt eines nicht, halte an.

---

## 3. ⚠️ DIE HAUPTAUFGABE — die Haltefrist ist zu teuer

### Was gebaut wurde (GQ-P17, gemergt `6ef065c`)

`src/telnyx-turn-hold.js` + Schritt 7.5 in `src/telnyx-llm-shim.js`. Ein Request, dessen Text
den gehaltenen Vorgaenger fortschreibt, ueberholt ihn; der Vorgaenger schweigt (leere,
gueltige Completion), ruft nie `agentTurn`, bucht nichts, schreibt nichts ins Transkript.

### Was gemessen wurde (Anruf `call_mslz71hv6ogm`, 2026-08-09)

**Der Mechanismus WIRKT:** 6 `hold`-Zeilen, davon **2 mit `outcome: extended`** (turnSeq 5
und 6, rund 2 s auseinander) — zwei Fragment-Turns nachweislich unterdrueckt, keine zweite
`look_up`-Recherche.

**Der Preis ist inakzeptabel.** Owner-Urteil woertlich: *"latenz war extrem lange absolut
inakzepatable"*. 4 von 6 Fristen liefen komplett ab (`outcome: elapsed`), und **`shim_turn`
misst die Frist NICHT mit**:

| `shim_turn` | + Haltefrist | = tatsaechliche Wartezeit |
|---|---|---|
| 1321 ms | 3000 | 4,3 s |
| 5099 ms | 3000 | 8,1 s |
| **7607 ms** | 3000 | **10,6 s** |

Zum Vergleich der Stand VOR GQ-P17: `shim_turn` 1306-4911 ms, ohne Aufschlag.

### Der Denkfehler, den du nicht wiederholen sollst

Die Frist wartet **pauschal vor jedem Turn**. Der Lead hatte angenommen, sie sei "nur
spuerbar, wenn der Anrufer fertig geredet hat" — falsch: genau dann kostet sie voll, und das
ist der Normalfall (4 von 6). Sie zahlt sich nur in den 2 Faellen aus, in denen wirklich ein
Fragment nachkam.

### Ansaetze fuer den Umbau (keiner davon geprueft — das ist deine Arbeit)

1. **Adaptiv statt pauschal.** Nur halten, wenn dieser Call in diesem Gespraech schon einmal
   fragmentiert hat (`prevRelation === EXTENDS` kam vor). Kostet die erste Doppelantwort,
   danach nichts mehr fuer Anrufer, die nie fragmentieren.
2. **Deutlich kuerzer.** Die beiden gefangenen Fragmente lagen ~2000 ms auseinander, die
   historischen bei 1314/1633/2508/2926 ms. Eine Frist von 800-1200 ms faengt einen Teil zu
   einem Bruchteil des Preises. **Erst messen, welcher Anteil das waere.**
3. **Satzzeichen als Signal.** `smart_format`/`numerals` stehen am Assistant-Objekt auf
   `true`, erreichen den Call aber NICHT: `transcriptionFields()`
   (`src/telephony/adapters/telnyx/voice.js:343`) sendet pro Call nur `{model, language}`,
   und dieser Block **gewinnt laut Telnyx-OpenAPI ueber das Assistant-Objekt** — alle
   `settings` fallen weg. Deshalb kommt der erkannte Text kleingeschrieben und ohne
   Satzzeichen. **Bekaeme man `smart_format` bis in den Call, waere "Satz ohne Punkt" ein
   billiges Fragment-Signal.** Memory sagt, der Pro-Call-Block koenne `settings` schematisch
   nicht tragen ([[stt-modellwahl-seam]]) — **das ist zu verifizieren, nicht zu glauben**,
   es stammt aus einer aelteren Session.

**Rueckweg jederzeit:** `TELNYX_SHIM_EXTEND_HOLD_MS=0` (steht aktuell so). Der Wert ist per
Env trimmbar, ohne Code-Deploy — `mcp__render__update_environment_variables` merged per
Default und ist dafuer sicher.

---

## 4. Warum die Wurzel NICHT beim Anbieter zu drehen ist (belegt, nicht neu erheben)

Telnyx-Doku (`developers.telnyx.com/docs/inference/ai-assistants/transcription-settings`):

| Parametergruppe | gilt fuer |
|---|---|
| `eot_threshold`, `eot_timeout_ms`, `eager_eot_threshold` | **nur `deepgram/flux`** |
| `min_turn_silence`, `max_turn_silence`, `end_of_turn_confidence_threshold` | **nur AssemblyAI Universal-Streaming** |
| `smart_format`, `numerals` | nova-3 |

**Fuer `deepgram/nova-3` existiert KEIN Turn-End-Regler.** Die `eot_*`-Werte in unserer
Live-Config sind Flux-Parameter und tun seit dem STT-Wechsel am 08-08 nichts. Das erklaert
die Verschaerfung: 4 Fragmentierungen auf 13 Turns mit Flux, **5 auf 8** mit nova-3.

Verworfen: zurueck auf Flux (englisch-only, **97 % WER** auf Deutsch, Befund B-7).
Offen als Option: **AssemblyAI** haette die Regler — braucht aber erst eine WER-Messung
(`scripts/stt-wer.mjs`), weil dokumentierte Sprachunterstuetzung nichts ueber die gemessene
sagt (dieselbe Falle wie B-7).

---

## 5. Was am 2026-08-09 sonst erledigt wurde

- **Track B KOMPLETT** (B3b `48b9617`, B5 `f2f4927`). `claude.js`/`precall-briefing.js`
  tragen **null** Anthropic-Marker. Anbieterwechsel = `LLM_PROVIDER`. Default `anthropic`.
- **Barge-in-Wurzel gefixt** (Live-Config, kein Code): Telnyx'
  `interrupt_prediction_threshold` stand auf 0.2 (Doku: default 0.0=aus, 0.4 empfohlen,
  niedriger = leichter unterbrechbar) bei abgeschalteter Rauschunterdrueckung. Jetzt 0.4 +
  `deepfilternet`. Belegt: gekappte Antworten **1 von 3 -> 0 von 2**, laengste Antwort am
  Stueck 245 -> 680 Zeichen.
- **FIX-1** (`cd23fc9`): die Zusammenfassung konnte **strukturell nie gelingen** — 800
  Output-Token brauchen gemessen 7745/8856/8985 ms, der Timeout war 3500 ms. Jetzt eigener
  `CALL_SUMMARY_TIMEOUT_MS` (20000). **Am Live-Anruf belegt: es kommt wieder eine
  Zusammenfassung.**
- **Alle vier Token-Sorten stehen im Log** (`input_tokens`, `output_tokens` ergaenzt).
  **Und es GIBT Cache-Treffer** — im Anruf gemessen `cache_read_input_tokens: 4192`. Die
  frueher notierte Vermutung "Prompt-Caching tot" ist damit fuer diesen Pfad widerlegt.

---

## 6. Offen — nach Dringlichkeit

1. **Die Haltefrist umbauen** (Abschnitt 3). Danach ein Testanruf.
2. **B4b endlich messen.** Die Datenbasis steht jetzt (vier Sorten im Log, Cache-Treffer
   belegt). Frage W6: um wie viel sinkt der gebuchte Betrag bei realem Cache-Anteil, und
   schwaecht das die Kostendecke praktisch? **Braucht keinen neuen Code mehr.**
3. **Fuenf ungemessene GQ-Phasen abnehmen** — GQ-P2, P3, P4, P6, P7 sind live und im
   Kettenstand alle als *"ungemessen (braucht Testanruf)"* vermerkt. Mit einem gut geplanten
   Anruf sind mehrere gleichzeitig abnehmbar.
4. **`GAP-15` (zweimal rot):** die englischen Rechtstexte fehlen und es stehen Platzhalter im
   Rechtstext-Content. Vor einem weltweiten Launch kein Detail.
5. **Owner-Entscheidungen offen:** WF-4 (`bridge.js` bucht null Token — wer auf
   `VOICE_ENGINE=realtime` umstellt, faehrt blind), `OPENING_GOAL_MAX_CHARS=75` (kappt lange
   Anliegen hoerbar mitten im Satz), `DEFAULT_LANGUAGE`-Flip, Animation-Lab-Auswahl.
6. **Kleinere Posten:** Inbound erreicht die Gate-Achse mit keiner Carrier-Kostenart,
   DID-Miete ungebucht (geparkt), W7 ohne Traeger, `configHash` deckt die Preistabelle nicht
   ab, P16 (US-Stimme), CSP-Verschaerfung, Norse.otf fehlt, 45 Branches.

**`STATUS.md` ist mit Stand 2026-06-23 und "846/846 Tests" zwei Monate veraltet — nicht als
Quelle benutzen.** Der gepflegte Stand steht in `tasks/todo.md` und der Memory.

---

## 7. Betriebswissen, das sonst Zeit kostet (heute teuer gelernt)

- **`git checkout <branch>` scheitert STILL, wenn ein Worktree den Branch belegt.** Der
  folgende `npm test` lief auf `master` und meldete 4077 gruen — voellig plausibel und
  komplett wertlos. **Immer im Worktree testen** (`cd .claude/worktrees/<run>-2 && npm test`)
  **und den Lauf gegen ein Merkmal der Aenderung pruefen**
  (`grep -c "^ok .* - <PHASE>-"`), nie nur gegen `fail 0`.
- **Workflow-PASS ist keine Freigabe.** Zweimal in diesem Repo hat der Workflow `fail 0`
  gemeldet, waehrend der eigene Lauf `fail 1` fand. Flake-Beleg ist nicht das gruene
  Isoliert-Ergebnis, sondern **die Laufzeit** (321 ms isoliert gegen 3449 ms unter Last) plus
  das Bereichsargument.
- **Hintergrund-Testlaeufe NIE durch eine Pipe filtern** — auch nicht `| grep`. Beim
  Backgrounding ist die Pipe weg und das Ergebnis verloren (heute einem `test:gates`-Lauf
  ueber eine Stunde gekostet).
- **`phase-impl-lean` braucht `args` als OBJEKT** mit `phaseId`, nicht als Freitext. Sonst
  fail-closed-Abbruch (die Sicherung funktioniert). Der Auftragstext gehoert in eine
  Spec-Datei, die **committet sein muss**, bevor der Worktree entsteht.
- **`mcp__render__update_environment_variables` merged per Default** (`replace:false`) — eine
  einzelne Var setzen ist sicher und loest einen Restart aus. `trigger_deploy` ist dagegen
  vom Berechtigungs-Classifier geblockt; den Deploy loest der Owner im Dashboard aus.
- **Testanrufe:** `objective` **unter 75 Zeichen** halten (`OPENING_GOAL_MAX_CHARS`), sonst
  endet der Erst-Turn hoerbar mitten im Satz — heute zweimal passiert und faelschlich als
  Produktdefekt gemeldet. Alles Weitere gehoert ins `briefing` (wird nicht vorgelesen).
- **Was der Agent IM Gespraech ueber Ursachen sagt, ist erfunden.** Er behauptete woertlich
  ein Problem mit "der Audio-Pipeline"; der Verlust passierte bei Telnyx, nach unserer
  Auslieferung.
- **Telnyx-Gespraechsprotokoll:** `GET /v2/ai/conversations/<id>/messages`, das Textfeld
  heisst **`text`**, nicht `content`. Mit `sent_at`/`ended_at` die Zeichen/Sekunde rechnen —
  intakte Antworten liegen eng bei ~17,6; eine gekappte faellt durch abweichende Rate UND
  fehlendes Satzzeichen auf. **Die intakten Antworten sind die noetige Kontrollgruppe.**
- **Lokaler Serverstart** braucht `COST_TRUING_REQUIRED_RECORD_TYPES` (in der lokalen `.env`
  nicht gesetzt, `BASE_ENV` setzt `"sip-trunking,call-control"`), sonst Boot-Abbruch.
- **Worktrees nach jedem Workflow aufraeumen**, Pfad enthaelt ein Leerzeichen:
  `while IFS= read -r` statt `for w in $(...)`.

---

## 8. Zuerst lesen

1. `CLAUDE.md` — Absolute Regeln
2. `.claude/refs/workflow.md` + `.claude/refs/clean-code.md` — Pflicht
3. **`tasks/todo.md`**, die Abschnitte B3b / B5 / FIX-1+GQ-P17 — der Kettenstand
4. **`tasks/gq-chain-state.md`**, Abschnitt "GQ-H2" — die Barge-in-Wurzel und die
   Korrekturen am Bestand
5. `tasks/gq-p17-spec.md` + `tasks/gq-p17-report.md` — was gebaut wurde und warum
6. `tasks/lessons.md`, die letzten drei Abschnitte
