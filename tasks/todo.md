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

---

# Task: Telnyx AI-Assistant Opening-Speak-Timeout-Guard — Start 2026-07-15

Quelle: PLAN-TELNYX-AI-ASSISTANT-NO-AUDIO.md (Jonas' Live-Testanruf 2026-07-14, 3 Calls ohne
Audio). Root Cause per Telnyx-`list_call_events` + Render-`list_deploys` API verifiziert (kein
neuer Testanruf noetig, siehe "API-Verifikation 2026-07-15" im Plan-Dokument):

- Befund 1 (Call 1, Media-Bridging-Defekt): App-/Control-Plane-Ebene zu 100% fehlerfrei
  bestaetigt — bleibt Owner-Gate (Telnyx-Support, `call_control_id` bekannt), KEIN Code-Fix
  moeglich in dieser Session.
- Befund 2 (Call 2/3, Speak stallt ohne jedes Lifecycle-Event): urspruengliche Hypothese
  "Webhook-Zustellung an app.sundartha.com haengt" WIDERLEGT (Telnyx' eigenes Ledger zeigt: Event
  wurde nie generiert). Echter Gap: `telnyx-call-control-ingest.js` hat keinen Timeout fuer
  "Speak-Command raus, aber weder speak.ended noch speak.failed kommt je" — Call haengt bis zum
  manuellen Hangup in Stille.

Erwartetes Ergebnis (deterministisch): neuer `telnyxOpeningSpeakTimeoutS`-Config-Wert +
Timer-Guard in `onAnswered`/`onSpeakEnded`/`onSpeakFailed`/`onHangup`, der ein ausbleibendes
speak.ended/speak.failed nach N Sekunden wie ein echtes `speak.failed` behandelt (bestehender
Azure-Retry-Fallback greift, keine Duplizierung). Verifikation: `npm test` gruen (neue
Fake-Timer-Tests + Bestandssuite unveraendert), `node --check`.

- [ ] Phase `telnyx-opening-speak-timeout` (Spec: `tasks/telnyx-opening-speak-timeout-spec.md`)
      via `phase-impl-lean`-Workflow (`tasks/wf-phase-impl-lean.js`, REPO-Pfad auf diesen Rechner
      korrigiert — war noch auf Antonios Mac-Pfad gebaked).
- [ ] Bei Gate=PASS: Merge nach master (Lead), Report lesen, Owner-Punkte (Befund 1) im
      Plan-Dokument als offen markiert lassen.

---

# Gespraechsqualitaet optimieren (PLAN-CONVERSATION-OPTIMIZATION.md, 2026-07-12)

Strategiedokument fertig, 6 Recherche-Spuren + 2 adversariale Opus-Pruefungen. Wartet auf
Owner-Freigabe. Kernbefund: Telnyx hat zwei Features gegen unsere zwei groessten Probleme —
beide sind bei uns per Default AUS.

- [x] K0 Messgrundlage (IMPL, Suite gruen; Owner-Gate: count_tokens braucht gueltigen Key): Metadaten-Auswerteskript (Telnyx `metadata` je Message liefert
      `end_user_perceived_latency_ms`, `llm_first_token_duration_ms` u.a.) + Shim-Request-Zaehler
      pro Call + `count_tokens`-Messung. Kein Anruf noetig. Vorbedingung fuer K5/K6/K8.
- [x] K1 `interrupt_prediction_threshold` 0.0 -> 0.4 (IMPL; NICHT ausgerollt -> Provisioner-Lauf = Owner-Gate) (Provisioner-Zeile). Filtert "mhm"/"ja" aus
      der Unterbrechungs-Erkennung -> direkter Schlag gegen S1 (Verwerf-Fenster).
      HARTES GATE E1.2: echtes Barge-in muss weiter sofort stoppen, sonst Rollback auf 0.0.
- [x] K2 `background_audio` `silence` -> `office` (IMPL; NICHT ausgerollt -> Provisioner-Lauf = Owner-Gate) (volume 0.3). Beweist zugleich, ob es im
      `ai_assistant_start`-Pfad ueberhaupt greift (unbelegt).
- [x] K3 Farewell-Konstanten (IMPL, NUR fuer `de` - en/fr behalten das Bestandsverhalten, bis gemessen) aus den vorhandenen Aufnahmen kalibrieren (70ms/Zeichen ueberschaetzt
      ElevenLabs -> 12s-Cap wird immer ausgeschoepft). Kein TTS-Ende-Event existiert (doppelt bewiesen).
- [ ] G1 GATE-EXPERIMENT: Konsumiert Telnyx unsere SSE-Chunks inkrementell? Wegwerf-Assistant +
      kuenstlich verzoegerte Chunks + 1 Testanruf. ROT => K5 und K6 gestrichen.
- [ ] K5 Sentence-Streaming im Shim (NUR bei G1 gruen) — phase-impl-lean PFLICHT (geteilter
      agentTurn-Seam, llm.js hat heute KEIN Streaming, Text-vor-Tool ist NICHT garantiert).
- [ ] K6 Filler/Soft-Timeout nach ElevenLabs-Vorbild (nur nach K5) — phase-impl-lean.
- [ ] K4 `keyterm` auf flux (per Call, wie der language-Hint) gegen den STT-Restfehler.
- [ ] K8 Eager-EOT einschalten — OWNER-KOSTENENTSCHEIDUNG: +50-70% LLM-Calls (Deepgram-Zahl),
      spekulative Turns sind fuer uns UNSICHTBAR. K0-Zaehler ist harte Vorbedingung.
- [ ] K9 Bench (E4.1) — weiterhin BLOCKIERT: lokaler ANTHROPIC_API_KEY liefert 401 (07-12 geprueft).

## Verworfen (mit Beleg, nicht aus Bequemlichkeit)
- Prompt-Caching-Phase: Haiku 4.5 braucht 4096 Token Mindest-Praefix, unser Praefix ~1200-1700
  -> Caching ist HEUTE inert und waere ohnehin ein Kosten-, kein Latenz-Hebel.
- STT-Modellwechsel: Interruption Prediction (= K1) ist flux-exklusiv. Wechsel wuerde den besten
  Fix gegen S1 opfern, um einen seltenen Transkriptions-Fetzen zu reparieren.
- `start_speaking_plan`-Tuning: greift bei flux laut Spec nicht.
- Hangup-Fix via `send_conversation_message_events`: null Spec, null Doku, GitHub-weit 1 fremdes
  Repo, das das Flag setzt und nie ausliest.

## Review-Ergebnis K0-K3 (2026-07-12, dualer Opus-Review, ZWEI Fix-Runden)

Suite 2168/2168 gruen. Clean-Code: PASS (0x S1, 0x S2). Safety: PASS erst nach Runde 2.

Der Safety-Reviewer hat einen echten Rueckfall gefunden, den ich sonst deployt haette:
Die Farewell-Kalibrierung wurde an AUSSCHLIESSLICH deutschen Sprachpassagen gemessen
(17.3-20.3 Zeichen/s), aber global angewandt. Englisch hat bei gleichem Sprechtempo
deutlich WENIGER Zeichen/s (kuerzere Woerter) -> ein englischer Abschiedssatz waere
ABGESCHNITTEN worden = R4 zurueck, der Bug, den P3 gerade behoben hat.
Auch die erste Korrektur war noch falsch (der globale minMs trug die de-Kalibrierung
weiter in die ungemessenen Sprachen).

Endstand: `minMs` lebt IN jedem Kalibrierungs-Eintrag. Nur `de` bekommt die gemessenen
Werte; jede andere/unbekannte Sprache behaelt das exakte Bestandsverhalten. Test F12 nagelt
die Invariante fest: der Fallback-Delay liegt fuer KEINE Zeichenzahl unter der alten Formel.

LEHRE (in lessons.md): Eine Messung an EINER Sprache/Konfiguration darf nie global
angewandt werden. Der Default fuer alles Ungemessene ist "Bestandsverhalten behalten",
nicht "der neue Wert wird schon passen".

## ROLLOUT-STAND 2026-07-13

- K1 + K2: **LIVE am Assistant** (Provisioner-Lauf 07-12, per GET verifiziert:
  interrupt_prediction_threshold=0.4, background_audio=office/0.3, enable=true,
  Safety-Felder intakt, Assistant-Anzahl unveraendert 4).
- K0 + K3: **DEPLOYT** (master 3ad5342, Render 07-13 07:04 UTC,
  `[boot] deployed commit=3ad534216e...`, /healthz 200, Suite 2175/2175).
- OFFEN, braucht einen Menschen: **EIN Testanruf**.
  - HARTES GATE E1.2: echtes Ins-Wort-Fallen (ganzer Satz) MUSS die KI sofort stoppen.
    Wenn nicht -> interrupt_prediction_threshold zurueck auf 0.0 (Barge-in = Launch-Pflicht).
  - GEGENPROBE E1.1: waehrend die KI spricht nur "mhm" sagen -> sie MUSS weiterreden.
  - E2.1: Agent-Kanal traegt jetzt einen Grundpegel (Ambiente) statt digitaler Null.
  - E3.1: Hangup <= Segment-Ende + ~3s, Abschied NIE abgeschnitten.
- DANACH: G1 (Gate-Experiment Streaming) entscheidet ueber K5/K6.
