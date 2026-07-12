# NEXT-SESSION — Gespraechsqualitaet optimieren: Strategie erarbeiten (KEINE Impl)

**In eine FRISCHE Claude-Code-Session einfuegen.**

## Auftrag

Erarbeite ein **Strategiedokument** (`PLAN-CONVERSATION-OPTIMIZATION.md` im Repo-Root), das
den Weg zu einem Telefonat beschreibt, das sich fuer den Angerufenen **natuerlich** anfuehlt.
Am Ende der Session steht das DOKUMENT, nicht Code. Owner entscheidet danach ueber die
Umsetzung.

Das Dokument muss enthalten:
1. Phasen (nummeriert, jede mit Ziel, Aenderung, falsifizierbarer Erwartung, Verifikation,
   Risiko/Pre-Mortem, Abbruchkriterium).
2. Pro Phase eine **Umsetzungsempfehlung**: Braucht sie das schwere `phase-impl-lean`-Workflow
   (Plan -> Impl im Worktree -> dualer Review -> Self-Fix) oder ist das Overkill und ein
   direkter Edit + Test reicht? Begruende pro Phase — nicht pauschal.
3. Eine ehrliche Reihenfolge nach Wirkung/Aufwand, inkl. was NICHT gemacht werden sollte.
4. Kostenabschaetzung (Telnyx-Minuten, LLM-Tokens, TTS-Zeichen) je Phase, wo relevant.

## Pflichtlektuere ZUERST (nicht auf Zusammenfassungen verlassen)

- `tasks/STATUS-ANRUFQUALITAET-2026-07-12.md` — vollstaendiger Ist-Stand des Anruf-Stacks,
  inkl. der fuenf belegten Schwachstellen S1-S5. **Das ist die Ausgangslage.**
- `tasks/afix-testcall-report.md` + `tasks/afix-testcall2-report.md` — die gemessenen Werte
  aus den beiden Live-Testanrufen (Kanalanalyse, Whisper-Gegenprobe, Timings).
- `tasks/rca-2026-07-12-assistant-dead-call.md` — die Wurzeln R1-R5 und die Forensik-Pipeline.
- `PLAN-ASSISTANT-CONVERSATION-FIX.md` — was gerade live ging (P1-P4) und was bewusst
  verworfen wurde (Greeting-Migration, Turn-Zaehler-Guard, `start_speaking_plan`).
- `CLAUDE.md` + `.claude/refs/workflow.md` + `.claude/refs/clean-code.md`.
- Memory: `voice-stack-strategy`, `barge-in-solution-options`, `call-quality-chain`
  (Haiku-Lehre: enge Verbote am Tool-Entscheidungspunkt, breite Stil-Regeln kippen in
  Ueberkorrektur), `telnyx-assistant-live-api-findings`.

## Die Probleme, die geloest werden sollen

**P-A (wichtigstes): Verworfene Antworten (R1).** Telnyx verwirft eine bereits generierte
Antwort, wenn der Nutzer im Latenzfenster weiterspricht — im letzten Testanruf 1 von 4 Turns
(25%), ausgeloest durch eine ganz normale Sprechpause. Fuer den Anrufer wirkt die KI dann
stumm; fuer uns sind es bezahlte LLM- + TTS-Tokens ohne Gegenwert. Das ist der Kern.

**P-B: Stille waehrend das LLM denkt.** Nach jeder Nutzer-Aeusserung ~2s Funkstille
(Median-TTFA 2.13s), Totzeit-Anteil im Gespraech 24-37%. Owner will hier Fuellwoerter /
Backchanneling ("mhm", "einen Moment", Atemgeraeusche) oder eine andere Technik, die die
Luecke natuerlich ueberbrueckt — statt toter Leitung.

**P-C: Latenz senken.** TTFA-Median 2.1s ist innerhalb des Ziels, aber spuerbar. Bestandteile
messen und einzeln angreifen: EOT-Erkennung (Telnyx `eot_timeout_ms: 5000`,
`eot_threshold: 0.8`), LLM-Zeit (Haiku 1.2-2.0s, non-streaming!), TTS-Anlauf.

**P-D: STT-Restfehler.** Der Sprach-Hint hat das Kauderwelsch stark reduziert, aber nicht
eliminiert (`"vêtementgut"` im letzten Call). flux ist die schwaechste Stelle; Whisper
transkribiert dasselbe Audio Hint-los korrekt.

**P-E: Farewell-Timing.** Die Zeichen-Heuristik schoepft den 12s-Cap immer aus (bis zu 4.5s
Stille vor dem Hangup). Es gibt kein Telnyx-Event fuer "Assistant-TTS fertig" — such nach
einem besseren Signal oder einer besseren Regel.

**P-F: E4.1 nachholen.** `npm run convo-bench` (Szenario `kauderwelsch-erstantwort`, n>=5)
konnte nicht laufen (lokaler `ANTHROPIC_API_KEY` = 401, Owner-Gate). Sobald ein gueltiger Key
in `.env` liegt: nachfahren, Ergebnis in den Report.

## Recherche (Pflicht, nicht optional)

Das meiste hiervon ist geloestes Handwerk in der Voice-AI-Branche — recherchiere im Netz,
statt es neu zu erfinden. Belege JEDE technische Behauptung im Strategiedokument mit einer
Quelle (URL + Datum) und markiere klar, was Doku-Aussage und was eigene Messung ist.

Themen:
- **Turn-Taking / Interruption-Handling**: Wie loesen LiveKit Agents, Pipecat, Vapi, Retell,
  Bland, ElevenLabs Agents und OpenAI Realtime das Verwerfen von Antworten bei
  Nutzer-Zwischenrede? Stichworte: endpointing, semantic VAD, "interruption grace period",
  utterance stitching, response cancellation vs. queueing, "user speaking while agent
  thinking".
- **Telnyx-spezifisch**: Was bietet die Telnyx-AI-Assistant-API konkret an
  (`interrupt_prediction_threshold`, `eot_timeout_ms`, `eot_threshold`,
  `eager_eot_threshold`, `start_speaking_plan`, `send_conversation_message_events`,
  Streaming-Verhalten des external_llm)? Lies die aktuelle OpenAPI-Spec
  (github.com/team-telnyx/openapi) und developers.telnyx.com. **Pruefe empirisch, was
  wirklich existiert** — die Doku hat sich schon geirrt (Beispiel: `PUT /v2/ai/assistants/{id}`
  existiert nicht, Update ist POST + Deep-Merge; das haben wir mit einem Wegwerf-Assistant
  bewiesen).
- **Fuellwoerter/Backchanneling**: Wie machen es andere (pre-synthetisierte Filler-Clips,
  "thinking sounds", ambient/background audio, sofortige Acknowledgement-Phrase vor der
  eigentlichen Antwort)? Was klingt natuerlich, was nervt? Telnyx hat
  `voice_settings.background_audio` (aktuell `silence`) — was kann das?
- **Latenz**: Sentence-Streaming des LLM (unser `agentTurn` ist heute NON-streaming — der
  Shim koennte erste Saetze als SSE-Chunks schicken, sobald sie da sind), Prompt-Caching,
  kuerzere Systemprompts, kleineres Modell fuer den ersten Satz. Was bringt jeweils wie viel?
- **STT**: Alternativen/Parameter bei Telnyx (andere Modelle, `keyterm`, `smart_format`);
  Trade-off beachten: flux ist laut Doku das einzige Telnyx-Modell mit Turn-Taking-Features.

## Strategische Weiche, die das Dokument klar beantworten muss

Wir sitzen im **Telnyx-AI-Assistant-Pfad**: Turn-Taking, Barge-in, EOT und TTS-Playback
gehoeren Telnyx, wir liefern nur das Gehirn (external LLM). Alle Probleme P-A/P-B/P-C liegen
genau in dem Teil, den wir NICHT kontrollieren.

Das Dokument muss ehrlich abwaegen:
- **Weg 1 — im Telnyx-Pfad bleiben** und mit den vorhandenen Stellschrauben + Prompt- und
  Shim-Tricks so weit kommen wie moeglich. Billig, schnell, aber die Decke ist Telnyx' Verhalten.
- **Weg 2 — eigener Streaming-Stack** (Memory `voice-stack-strategy`: RealtimeBackend-Port,
  ElevenLabs STT/TTS + Claude, `bridge.js` ist heute OpenAI-fest). Volle Kontrolle ueber
  Turn-Taking/Barge-in/Filler, aber 6-12 Wochen und ein neuer Betriebspfad.
- Gibt es einen **Zwischenweg** (z.B. Telnyx-Media-Streaming statt AI-Assistant, also
  Turn-Taking selbst machen, Telefonie bei Telnyx lassen)? Pruefen und bewerten.

Kriterium fuer die Empfehlung: Was macht das Gespraech fuer den Angerufenen am schnellsten
spuerbar besser, ohne Regel 1 (Safety-Gates) oder Regel 2 (Offenlegung als erster Satz,
per-Call zugestellt) anzutasten?

## Arbeitsweise (bindend)

- **Token-effizient**: Der Lead liest KEINEN Implementierungscode und keine langen
  Rohdaten. Delegiere Recherche, Code-Lektuere und Messungen an Subagenten/Workflows und
  lass dir verdichtete Ergebnisse zurueckgeben (Schema-Rueckgaben statt Fliesstext).
- Nutze einen **dynamischen Workflow / Agent-Team** fuer den Fan-out: mehrere unabhaengige
  Recherche-Spuren parallel (je Anbieter/Thema eine), danach eine Synthese-Stufe und eine
  adversariale Verifikations-Stufe, die jede Behauptung gegen die Quelle prueft (kein
  ungepruefter Doku-Glaube — siehe PUT-404-Lehre).
- **Modell-Pins** (Memory `workflow-model-policy`, PFLICHT): Subagenten NIE das Session-Modell
  erben lassen. Recherche/Report = Sonnet, Synthese/Bewertung/Review = Opus. Pins explizit in
  jedem `agent()`-Call.
- **Keine Live-Testanrufe ohne Owner** (Kosten + echte Menschen). Wenn eine Frage nur per
  Anruf beantwortbar ist: als Owner-Gate im Dokument benennen, nicht selbst anrufen.
- Read-only gegen Telnyx ist erlaubt (GET). Schreibende Provider-Calls (Assistant-Update)
  nur mit Owner-Freigabe. Ein Wegwerf-Assistant zum Testen von API-Verhalten ist erlaubt
  (danach loeschen!) — das hat sich bewaehrt.

## Nicht-Ziele dieser Session

- Kein Produktivcode, keine Deploys, keine Assistant-Aenderungen.
- Kein Anfassen von Offenlegung, Safety-Gates, Budget-Logik.
- Keine neuen Env-Vars/Dependencies vorschlagen, ohne den Nutzen zu belegen.

## Deliverable

`PLAN-CONVERSATION-OPTIMIZATION.md` + ein kurzer Chat-Report (was ist die Empfehlung, was
kostet sie, was ist der erste Schritt). Danach `tasks/todo.md` und Memory fortschreiben
(Kette `assistant-conversation-fix-chain` -> Nachfolger).
