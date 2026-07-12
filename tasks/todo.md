# Arbeits-Todo (Scratch)

Dieses File ist der Arbeits-Scratch fuer die jeweils laufende Phase (siehe
`.claude/refs/workflow.md`) und wird pro Aufgabe neu befuellt.

- Dauerhafter Ueberblick ueber offene Punkte: **`STATUS.md`**
- Lehren aus abgeschlossenen Aufgaben: **`tasks/lessons.md`**

---

# Task: C-Telnyx-Remediation (PLAN-TELNYX-ASSISTANT-REMEDIATION.md) — Start 2026-07-11

Lean-Lead. Wahrheitsquelle = PLAN-TELNYX-ASSISTANT-REMEDIATION.md. Bug BEWIESEN (§0):
jeder external-LLM-Turn an den Shim -> 403. Strategie: SEHEN vor FIXEN.

## FERTIG — Observability-Batch (Code-Track, lokal master `4accb6d`, NICHT deployt)
- [x] OBS-1 Shim-Gate-Logs (PII-frei) — PASS, `59b8e28`
- [x] OBS-2 Event-Ingest (roh) + voice.js-Erfolgspfade — PASS (3 Fix-Runden)
- [x] OBS-3 /voice-Signatur-403 Provider-Herkunft — PASS, `b4795e7`
- [x] OBS-FLAG `TELNYX_SHIM_DEBUG_SHAPE` (4-Orte, default-off) — PASS (1 Fix-Runde)
- [x] SAFE-1 Secret/PII-Leak-Regressionsguard (test-only) — PASS (2 Fix-Runden)
- [x] Voll-Suite 2041/2041 (Baseline 2004). Suite-Flake p5-gate-proof = VORBESTEHEND
      (nicht OBS, isoliert 15/15 gruen) -> Gate-Protokoll: rot nur echt wenn isoliert rot.

## ERLEDIGT — P2 + P2.5 (2026-07-11, DEPLOYT 4accb6d, Owner-Call call_mrgj8trkypk8)
- [x] P2: Observability deployt (`[boot]=4accb6d`), curl-403-Log-Beweis, EIN Owner-Testanruf.
- [x] P2.5: **Zweig B, Gate 2 (no_ccid).** Wurzel BEWIESEN: Telnyx sendet ccid in `extra_metadata`,
      Shim liest `metadata` -> null -> 403 jeder Turn. NICHT Bearer/Event-Kette/STT.
      Doku: "must explicitly read extra_metadata, separate from native metadata."

## LAEUFT — P1b-FIX (Spec tasks/telnyx-p1b-fix-spec.md, self-diagnosing)
- [~] Shim liest ccid aus `extra_metadata.call_control_id` (single trusted source, Top-Level-Fallback raus,
      Anti-Spoof); ccid-null-Log um `extraMetadataKeys` erweitert -> Verify-Call funktioniert ODER pinnt Sub-Key.

## OFFEN — Owner-Gate (async)
- [ ] INFRA-0: hermes-db FREE laeuft 2026-07-24 ab (Paid+Backup, DRINGEND); ElevenLabs Paid; Telnyx-Guthaben.
      (Render autoDeploy bleibt AN = mein Deploy-Hebel, da render-MCP keinen manuellen Deploy-Trigger hat.)
- [ ] Flag-Posture: TELNYX_AI_ASSISTANT_ENABLED ist LIVE AN -> real callers mute bis P1b-FIX deployt.
- [ ] Verify-Call nach P1b-FIX-Deploy.

## Downstream (nach P1b-Verify)
- [ ] PROV-1 -> PROV-2 (single-writer provision.mjs); P4 (Ela-Disclosure fail-SAFE, merge nach P1b)
- [ ] WATCHDOG (Dead-Air-Kill); GATE-MATRIX (E2E test-only); SEC-DOC
- [ ] P5 Owner-Live (Hard-Barge-in=Launch-Pflicht); P6 Mid-Call-Kill-Drill

## Merge-Topologie (erledigt)
fad95dd -> OBS-1(FF) -> OBS-3(FF) -> OBS-2(3-way) -> OBS-FLAG(3-way, helpers.js auto-clean) -> SAFE-1(FF) = 4accb6d

## 2026-07-12 RCA: Assistant-Call tot nach Offenlegung+Anlass (Diagnose-only)
- [ ] Bruchstelle des 07-12-Testanrufs benennen, belegt durch BEIDE Sichten (Render-Logs + Telnyx-API), keine Annahmen
  - Erwartet: exakte Stelle der Kette (User-Turn->STT->Shim->LLM->TTS) an der es bricht, mit Log-Zeilen/API-Response als Beweis
  - Verifikation: Log-Timeline + Telnyx-Conversation-Record stimmen ueberein; falls Shim-seitig: lokale curl-Repro
  - Stand 07-12: Beide Sichten + Aufnahme + call_events + Kosten-Falsifikation erhoben. BELEGT: 2 Shim-Turns ok, 0 assistant-Messages bei Telnyx, 0 TTS-Audio (Agent-Kanal digital still, einziger 89ms-Blip=Klick-Artefakt), STT-Kauderwelsch (flux/multi erkannte DE als NL), LLM schloss aus Kauderwelsch "Ziel erreicht"+end_call, Owner legte selbst auf (hangup VOR unserem endCall). Fuehrende Hypothese: eager-EOT/TurnResumed-Discard (dokumentiert: "Cancel the in-progress response") + Hangup-Race bei Turn 2; TTS-Kosten-Delta ($0.006240 vs. flat $0.003216 bei allen 4 textlosen Calls) deutet auf Synthese-ohne-Wiedergabe. Finaler Diskriminator: 1 kontrollierter Stille-Testanruf.
  - [x] RCA abgeschlossen+verifiziert (Kontrollanruf call_mrhj23qvru6c als Diskriminator): tasks/rca-2026-07-12-assistant-dead-call.md — R1-R5, Pipeline entlastet
  - [x] Fix-Plan geschrieben: PLAN-ASSISTANT-CONVERSATION-FIX.md, Rev. 2 nach Opus-Review (PASS-mit-Auflagen -> alle BLOCKER/MAJOR eingearbeitet, Greeting-Migration verworfen)
  - [ ] Re-Review Rev. 2 (laeuft) -> danach Owner-Freigabe vor Impl
  - [x] Re-Review Rev. 2 -> PASS-eng; alle Punkte eingearbeitet -> Rev. 3 FINAL
  - [ ] NAECHSTE SESSION: Owner-Freigabe PLAN-ASSISTANT-CONVERSATION-FIX.md -> Impl P1-P4 -> Provisioner -> Deploy -> gebuendelter Testanruf (Skript i-v)
  - [x] Owner-Feedback eingearbeitet: P4.2 gestrichen, E2.4 Sprachwechsel-Observable, Whisper-Cross-Modell-Beweis (flux Hint-los schwach) in RCA+Plan
  - [x] Kickoff-Datei fuer Impl-Session: tasks/NEXT-SESSION-ASSISTANT-FIX-IMPL-PROMPT.md

# Task: Assistant-Conversation-Fix P1-P4 umsetzen — Start 2026-07-12

Spec (autoritativ): `tasks/assistant-fix-spec.md`. Umbrella: PLAN-ASSISTANT-CONVERSATION-FIX.md (Rev. 3,
owner-freigegeben). Lean-Lead: Phasen ueber phase-impl-lean (Impl/Report=Sonnet, Safety-Review=Opus),
Merge im Lead, Basis master `bed694e` (= Live-Commit).

## Vorab-Befunde (2026-07-12, empirisch, VOR der Impl)
- Live-Assistant per GET gelesen: `transcription.language=multi` (= R2-Wurzel), `user_idle_reply_secs=10`,
  `time_limit_secs=1800`, `recording_settings.enabled=true`, `interruption_settings.enable=true`.
- **`PUT /v2/ai/assistants/{id}` existiert nicht (404)** -> Provisioner-Update-Pfad war nie funktionsfaehig.
  Update = `POST /v2/ai/assistants/{id}`. Bugfix ist Teil von P1.3.
- POST-Update = **Deep-Merge** (an Wegwerf-Assistant bewiesen, danach geloescht): nicht gesendete Felder
  (auch Geschwister in `telephony_settings`) ueberleben -> `buildAssistantConfig` muss nur
  `user_idle_reply_secs` ergaenzen, Safety-Felder (time_limit_secs, recording) gehen NICHT verloren.
- Render `vodafone-agent`: autoDeploy=**no** -> Deploy ist manuell (kein Auto-Deploy-Unfall).

## STAND 2026-07-12: P1-P4 gemerged auf lokalem master (NICHT gepusht, NICHT deployt)
Merge-Topologie: bed694e -> P1 `960afe5` -> P2 `bc1861a` -> P3 `577cf9d` -> P4 (HEAD).
Kombinierte Vollsuite im Haupt-Repo: **2133/2133 gruen** (Baseline vor der Kette: 2041),
`node --check` auf allen geaenderten Dateien sauber. Jede Phase hat den dualen Review-Gate
(Safety=Opus, Clean-Code) mit PASS bestanden; Berichte: tasks/afix-p{1,2,3,4}-report.md.

Offen (Owner-Gate): E4.1 (convo-bench) BLOCKIERT — lokaler ANTHROPIC_API_KEY liefert 401
(invalid x-api-key), 0 erfolgreiche LLM-Calls. Der Lauf sah wie ein inhaltliches FAIL aus
(5/5 agent_hangup), war aber die Fehlerbehandlung -> siehe tasks/lessons.md.

## Phasen (jede: Erwartung + Verifikation)
- [x] P1 Opening-Stimme (ElevenLabs via `useAssistantVoice`-Port-Param + Fallback-Kette) + Provisioner
      (`user_idle_reply_secs=4`, PUT->POST-Fix)
  - Erwartet: Adapter-Body traegt `voice=ElevenLabs.<model>.<voiceId>` + `voice_settings.api_key_ref`;
    ohne Param/ohne Config -> Azure-Body byte-identisch; Sync-Fehler UND `speak.failed` -> genau EIN
    Azure-Retry, danach heutiger Fail-Safe (kein startAssistant).
  - Verifikation: `npm test` (neue Adapter-/Ingest-Tests), `node --check`.
- [x] P2 STT-Sprach-Hint pro Call (`startAssistant({..., language})` -> adapter-intern
      `transcription={model:deepgram/flux, language:<hint|auto>}`, NIE "multi")
  - Erwartet: `de`->`de`, `tr`->`auto`, kein language -> KEIN transcription-Feld (Inbound unveraendert).
  - Verifikation: `npm test` (neue Adapter-/Ingest-Tests).
- [x] P3 Farewell-Hangup im Watchdog (`scheduleFarewellHangup`, clamp 3000..12000ms, Dead-Air-Suspend,
      Cancel bei neuem Turn, ein Terminate)
  - Erwartet: Fake-Timer-Tests gruen; Shim ruft bei end_call `scheduleFarewellHangup` statt sofortigem
    Terminate; Notaus-Pfade (Loop-Guard/Budget) bleiben sofortig.
  - Verifikation: `npm test` (Watchdog-Fake-Timer + Shim-Tests).
- [x] P4 end_call-Disziplin (Prompt-Regel am Tool-Entscheidungspunkt) + Bench-Szenario
  - Erwartet: Prompt-Assertion-Test gruen; `npm run convo-bench --repeat>=5`: Szenario
    "kauderwelsch-erstantwort" endet mit EINER Nachfrage statt Auflegen, keine Regression.
  - Verifikation: `npm test` (gruen, Revert-Pin auf die Regel) + Bench-Report.
  - [ ] E4.1 OFFEN/BLOCKIERT: Bench braucht einen gueltigen ANTHROPIC_API_KEY (lokal 401).

## Owner-Gates (danach)
- [ ] Render-Env pruefen/setzen: `TELNYX_ELEVENLABS_VOICE_ID`, `_MODEL`, `_API_KEY_REF` (sonst faellt P1
      still auf Azure zurueck; Log-Marker `opening_voice=` macht es sichtbar).
- [ ] Provisioner-Lauf gegen den Live-Assistant (user_idle_reply_secs=4).
- [ ] Deploy im No-Call-Fenster (push origin + upstream, manueller Render-Deploy, [boot]-Banner pruefen).
- [ ] EIN gebuendelter Testanruf (Skript i-v inkl. Overlap-Probe = R1-Gate <=5s) -> jede E*-Erwartung
      einzeln PASS/FAIL in tasks/-Report.
