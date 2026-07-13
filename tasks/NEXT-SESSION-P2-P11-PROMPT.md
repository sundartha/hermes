Rolle: Du bist der **Lean-Lead-Orchestrator** fuer die C-Telnyx-Voice-Migration (Hard-Barge-in),
Phasen **P2 bis P11**, im Repo vodafone-agent (Hermes). P0 ist GO, P1 ist fertig+gemerged — du startest bei P2.

ZUERST LESEN (frisch lesen, NICHT auf Zusammenfassungen verlassen):
- CLAUDE.md, .claude/refs/workflow.md, .claude/refs/clean-code.md
- PLAN-TELNYX-AI-ASSISTANT.md  (die vollstaendige 12-Phasen-Bibel P0-P11)
- tasks/telnyx-p1-report.md  (P1-Ergebnis + 3 Safety-Concerns)
- tasks/telnyx-chain-carryover.md  (Forward-Guards — MUSST du in die jeweilige Phasen-Spec ziehen)
- tasks/lessons.md  (Betriebs-Stolpersteine)
- Memory: telnyx-assistant-strategy-plan, telnyx-assistant-chain-state, barge-in-solution-options,
  workflow-model-policy, lean-phase-orchestration, phase-impl-workflow-args
- Den Driver tasks/wf-phase-impl-lean.js (dein Werkzeug pro Phase — schon macOS-korrigiert + Modell-gepinnt)

STAND (selbst per git verifizieren):
- **P0 = GO.** Barge-in am echten PSTN-Call bestaetigt (2026-07-07): 60s-Gespraech, Owner konnte jederzeit
  unterbrechen, wurde durchgaengig gehoert, Disclosure zuerst, Latenz ~1.3-1.6s (hosted Haiku). C-Telnyx committed.
- **P1 (Brain-Shim) fertig + gemerged in LOKALEN master `21d9c9e`** (NICHT gepusht, 404-dark). `src/telnyx-llm-shim.js`
  + Tests. Gate PASS (Safety+Clean-Code+Lead-§5.5). Du startest bei **P2**.

ARBEITSWEISE (Lean, Plan-Abschnitt 5.1-5.5):
- Reiner Orchestrator, bleib <100k Tokens. Pro Phase GENAU EIN phase-impl-lean-Lauf via
  `Workflow({scriptPath: "tasks/wf-phase-impl-lean.js"})`; du bekommst nur den Postage-Stamp zurueck (phaseId,
  finalBranch, gate, testPassCount, filesTouched, fixRounds, remainingBlockers, reportPath, summary).
- Pro Lauf schreibst du zuerst eine Spec `tasks/telnyx-p<N>-spec.md` (Scope / NICHT in Scope / Invarianten+Safety /
  deterministisch pruefbare Checks / Reiner-Refactor-Hinweis; zieh die Carryover-Guards rein).
- Dann editierst du im Driver NUR den `PHASE_CONFIG`-Block (phaseId/phaseTitle/branch/planDoc/specFile). Kein roher
  args-Aufruf. Danach `Workflow({scriptPath: "tasks/wf-phase-impl-lean.js"})`.
- Merge den zurueckgegebenen `finalBranch` (kann `BRANCH-fixN` sein) im Lead in `master`. Jede Phase frische
  Worktree-Isolation. NICHT pushen — Deploy ist Owner-gated (P11).
- Modell-Politik (§5.2): Opus=Plan+Safety-Review, Sonnet=Impl/Clean-Code-Audit/Self-Fix/Report, NIE Fable. Die 6
  `model:`-Pins sind im Driver bereits gesetzt — vor dem ersten Lauf verifizieren, dass sie da sind.
- **R1-Phasen (P3a, P4, P4.5, P5, P6, P8, P9, P11): §5.5-Ausnahme** — `gate=PASS` allein reicht NICHT zum Merge.
  Du (Lead) liest den Safety-Review-Abschnitt des Reports ODER faehrst einen zweiten Safety-Pass mit der Checklist
  (alle Gates 0-13 auch fuer C-Telnyx? rearm/reattach kennen `call_control_id` statt `twilioSid`? keine Verzweigung
  an `voiceEngine`? Shim 404-bei-Flag-aus + per-Call-gebunden + Budget-gegatet? `call.hangup`→releaseReserve+finishCall?
  `speak.ended` gatet `ai_assistant_start`? Inbound-Budget-Gate?) BEVOR du merged.

KRITISCHE BETRIEBS-LEHREN (aus der P1-Session — ignorieren = Zeitverlust):
- Driver `REPO` MUSS macOS-lokal sein: `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent` (das Original war ein
  toter Linux-Pfad `/srv/openclaw/...`). Ist bereits gesetzt — pruefen.
- phaseId IMMER `telnyx-p<N>` namespacen (sonst kollidiert der abgeleitete Review-Branch `review-p<N>` mit alten
  Branches aus `p1-cancel-cap-fix`). Vor JEDEM Lauf `git branch -a | grep -i telnyx-p<N>` = leer pruefen.
- Infra-Fallback: bricht ein Lauf mit "subscription access disabled"/Netzausfall mitten ab, ist `gate=BLOCKED` +
  phantom `finalBranch:-fixN` KEIN Code-Block. Journal (`.../journal.jsonl`) + echten Git-Stand pruefen, den
  substantiell reviewten Branch identifizieren, nur die infra-getoeteten Review-Stufen nachziehen (dualer
  Agent-Review + Lead-§5.5), dann mergen.
- Vor Edits an bestehenden Funktionen: grep nach ALLEN Callern (Tools werden von Budget-Engine UND Shim genutzt).

PARALLELITAET (Plan §5.3 — effizient fahren):
```
P2 (Resilienz-Bruecke im Shim, P1-abhaengig, non-R1)   ── zuerst, seriell
   │  Merge
P4 (Call-Control-Adapter)  ‖  P7 (Assistant-Provisioning)   ── PARALLEL (disjunkte Dateien, je Worktree)
   │  Barriere: Merge P4 (+P7)
P4.5 → P3a → P5 → P6 → P8 → P9   ── SERIELL (alle server.js; Merge im Lead zwischen jeder)
   │       (P3a haengt an P1+P4; Shim-Datei, sicher seriell)
P10 (Doku+Tests+Obs)   ── nach P9 mergen
P11 (Live-Cutover)   ── Owner: Flag setzen nach verifiziertem Deploy + Live-Testanruf + Rollback-Drill
```
- **P3b (echtes Streaming) ist bedingt:** P0-Latenz ~1.4s (hosted Haiku) war ok, ABER die BYO-Shim-Latenz +
  **Latenz-Messung #2** (Worst-Case-Tool-Loop 4 Roundtrips vs. Telnyx-Custom-LLM-Request-Timeout) wurde im Spike
  NICHT gemacht (hosted Modell, kein Tool-Loop). P4 holt das live nach; wenn zu langsam → P3b bauen, sonst deferred.

FORWARD-GUARDS aus P1 (aus tasks/telnyx-chain-carryover.md — in die jeweilige Spec ziehen):
- **P4:** dedizierter per-callId-Rate-Limiter am Shim (P1 stuetzt sich nur auf globalen IP-Limiter + Budget-Cap;
  vor Flag-Aktivierung noetig). `aiAssistantToken` NIE in die pg-Portal-SELECT-Projektion (`portalStore.listCalls`
  geht nicht ueber `publicCall`).
- **P3a:** `end_call` laeuft ueber den bestehenden `agentTurn`-Rueckgabewert — kein zweiter Store-Write.
- **P10:** `TELNYX_AI_ASSISTANT_ENABLED` an allen 4 Orten (.env.example, render.yaml, BASE_ENV, assertConfig/footguns).

TELNYX-API-BEFUNDE aus dem P0-Spike (fuer P4/P7 — spart Recherche, alles live gegen die API verifiziert):
- AI Assistant API laeuft. Model kann `anthropic/claude-haiku-4-5` (Telnyx-hosted) ODER **`external_llm`-Feld** =
  BYO-Custom-LLM-Slot (= unser Shim aus P1; URL = `PUBLIC_URL/<shim-route>`). Das ist der P4-Anknuepfpunkt.
- Voice: `voice_settings.voice = "ElevenLabs.<model>.<voiceId>"` + `voice_settings.api_key_ref = "elevenlabs_prod"`
  (Integration-Secret liegt in Telnyx). Ela-Voice-ID selbst = `ELEVENLABS_VOICE_ID` in der Render-Env (lokal leer).
- Greeting: Feld `greeting`; `""` = deaktiviert (Regel-2-Voraussetzung, P7). Deterministische Disclosure kann als
  Greeting-Feld ODER als separater Speak-Node vor `ai_assistant_start` laufen — P7/P4.5 entscheiden.
- `interruption_settings`: `enable:true` per Default (Barge-in im Spike bestaetigt); `start_speaking_plan.wait_seconds`.
- Origination im Spike: `POST /v2/texml/calls/{texml_app_id}` (Assistant erzeugt AUTO eine TeXML-App); auf Answer
  connectet der Call zum Assistant. **Achtung:** Call-Control (`/v2/calls` + `ai_assistant_start`) existiert im Repo
  NICHT — P4 baut ihn neu. Der TeXML-auf-Assistant-App-Weg ist eine VALIDE Alternative; P4 entscheidet
  Call-Control vs. TeXML-Origination (Plan bevorzugt Call-Control wegen `call_control_id` fuer P6-Boot-Recovery).
- Outbound braucht ein OB-Voice-Profil mit dem Ziel-Land in der Whitelist (Profil "MCP"=US/CA/DE, "Default"=US/CA).
- Latenz-Telemetrie steckt in der Conversation-Message-Metadata (`end_user_perceived_latency_ms`,
  `llm_first_token_duration_ms`, `audio_first_token_duration_ms`, `transcription_duration_ms`).

WOMIT DU STARTEST:
1. Alles oben lesen; echten Git-Stand pruefen (`git log --oneline -2` → master @ `21d9c9e` mit P1 drin;
   `git branch -a | grep telnyx` sauber).
2. Spec `tasks/telnyx-p2-spec.md` schreiben (P2 = Resilienz-Bruecke im Shim; Plan-Abschnitt P2:
   `LlmUnavailableError` → lokalisierte Degradations-Response; nicht-transiente Fehler → Catch-All; nie 5xx ohne Body).
3. `PHASE_CONFIG` im Driver auf `phaseId:"telnyx-p2"`, `branch:"phase/telnyx-p2-resilienz"`, `planDoc` +
   `specFile:"tasks/telnyx-p2-spec.md"` pinnen. Branch-Kollision pruefen.
4. `Workflow({scriptPath: "tasks/wf-phase-impl-lean.js"})`. Postage-Stamp pruefen, mergen. Dann Parallel-Block P4‖P7.

Bei Unsicherheit: NIE raten, fragen. Alles was Calls/SMS/Auth/Budget beruehrt = nicht-trivial (Plan Mode + Review).
