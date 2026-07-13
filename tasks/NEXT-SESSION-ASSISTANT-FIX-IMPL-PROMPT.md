# NEXT-SESSION — PLAN-ASSISTANT-CONVERSATION-FIX.md umsetzen (P1-P4)

**In eine FRISCHE Claude-Code-Session einfuegen.**

## Auftrag

Setze PLAN-ASSISTANT-CONVERSATION-FIX.md (Rev. 3, owner-freigegeben, P4.2
gestrichen) um: Phasen P1, P2, P3, P4 — NUR diese, P5 nur falls die
Entscheidungsregel E2.3 es erzwingt, P6 (Inbound) NICHT.

## Vorgehen (bindend)

1. Lies ZUERST vollstaendig: PLAN-ASSISTANT-CONVERSATION-FIX.md,
   tasks/rca-2026-07-12-assistant-dead-call.md, CLAUDE.md,
   .claude/refs/workflow.md, .claude/refs/clean-code.md. Verlass dich NICHT
   auf Zusammenfassungen — die Plan-Datei ist die Spezifikation, inkl. aller
   E*-Erwartungen, Fallback-Ketten und "Explizit NICHT tun".
2. Orchestrierung lean (Memory `lean-phase-orchestration`): Lead bleibt
   duenn (<100k Tokens, liest keinen Implementierungs-Code), Phasen laufen
   ueber das etablierte Muster phase-impl-lean (Plan -> Impl im Worktree ->
   dualer Review Safety/Verhalten + Clean-Code -> Self-Fix bis PASS ->
   kompakter Report). Merge im Lead.
3. Modell-Pins (Memory `workflow-model-policy`, PFLICHT): Subagenten NIE das
   Session-Modell erben lassen — Impl/Audit/Report = Sonnet, Safety-/
   Verhaltens-Review = Opus, Pins explizit in JEDEM agent()-Call. Phase im
   per-run Skript HART pinnen (Memory `phase-impl-workflow-args`:
   args-Misfires = verbrannter Lauf).
4. Reihenfolge: P1 -> P2 (gleiche Adapter-Datei, sequenziell) -> P3 -> P4.1.
   Ein Branch, Phasen einzeln committen.
5. Nach jeder Phase: Suite + node --check; neue Tests laut Plan (E3.3, E4.1).
6. VOR dem Deploy: Provisioner-Aenderung (user_idle_reply_secs=4 in
   buildAssistantConfig) + Provisioner-Lauf gegen den Live-Assistant.
7. Deploy NUR im No-Call-Fenster: git push origin UND upstream (Memory
   `deploy-repo-split`: Render deployt UPSTREAM!), manueller Render-Deploy,
   [boot]-Banner auf den Live-Commit pruefen.
8. Danach Owner fuer den EINEN gebuendelten Testanruf holen — Skript
   (i)-(v) steht im Plan, inkl. Overlap-Probe (R1-Gate: hoerbare Antwort
   <= 5s nach jeder Aeusserung, sonst Rollout-FAIL) und Englisch-Probe (E2.4).
   Auswertung mit der Forensik-Pipeline aus dem RCA (Render-Logs,
   /v2/call_events, /v2/ai/conversations/{id}/messages, Recording-
   Kanalanalyse, Whisper-Referenz via /v2/ai/audio/transcriptions).
   JEDE E*-Erwartung einzeln PASS/FAIL in einem tasks/-Report.
9. FAIL-Handling steht im Plan (nur gescheiterte Phase zurueckrollen;
   E1.2-FAIL = Sofort-Rollback P1; R1-Gate-FAIL = kein Launch-GO, P5 wird
   Pflicht).

## Leitplanken

- Regeln 1+2 (Gates, Offenlegung) unantastbar; der Opening-`speak`-Anker mit
  speak.ended-Gate und onSpeakFailed-Fail-Safe bleibt bestehen (die
  Greeting-Migration ist BEWUSST verworfen — nicht "wiederentdecken").
- KEINE neuen Env-Vars fuer P1 (config.telnyxElevenLabs.* wiederverwenden).
- P3 lebt im Watchdog (scheduleFarewellHangup), NICHT als loser Shim-Timer.
- Scope: NUR was im Plan steht. Kein P4.2 (vom Owner gestrichen), kein
  start_speaking_plan, kein Eager-EOT-Touch, kein Format-/Widget-Umbau.
- Nach Abschluss: tasks/todo.md + Memory aktualisieren (Kette
  assistant-conversation-fix-plan fortschreiben).
