# HANDOVER — C-Telnyx Live-Cutover (Fixes + P11)

**Fuer die naechste Session. Lies ZUERST dieses File + die Memory `telnyx-assistant-live-api-findings`
+ `telnyx-assistant-chain-state`. Dann handeln — NICHT alles neu recherchieren (die reale API ist
unten dokumentiert).**

## TL;DR
Die komplette C-Telnyx-Code-Kette (P2-P10) ist gebaut, gemergt, gepusht und **LIVE deployt — aber
INAKTIV** (Flag `TELNYX_AI_ASSISTANT_ENABLED=false`, Live-Leitung laeuft byte-identisch auf
Budget/TeXML). Beim Versuch, live zu schalten (P11), wurde die echte Telnyx-API verifiziert und
dabei **2 Code-Bugs + 1 Ordering-Problem** gefunden, die einen Cutover blockieren. Ein Flag-Flip
JETZT wuerde kaputten/unsicheren Code aktivieren. Deine Aufgabe: **die Fixes bauen (mit Review),
dann den Cutover in korrekter Reihenfolge fahren.** NICHT live hacken, NICHTS am Flag drehen bis
die Fixes drin sind.

## Was fertig + sicher ist
- **Code-Kette komplett:** master `1f7134b`, Suite 1912/0. Alle Phasen P1-P10 gemergt.
  Reports unter `tasks/telnyx-p<N>-report.md`, Specs `tasks/telnyx-p<N>-spec.md`.
- **Deployt (inaktiv):** `git push upstream master` (ffb89c1..1f7134b) erledigt. Render-Service
  `vodafone-agent` (`srv-d8m0fhflk1mc73bno570`, Frankfurt, FREE-Plan, autoDeploy=commit auf master),
  Deploy `dep-d97591ks728c` = status **live**, gebootet mit Flag AUS. `PUBLIC_URL` in Prod =
  `https://vodafone-agent.onrender.com`.
- **Live-Leitung unangetastet.** Flag aus = kein C-Telnyx im Call-Pfad. Rollback = Flag bleibt aus.

## DIE REALE TELNYX-API (2026-07-08 live verifiziert — NICHT neu recherchieren)
- `GET /v2/ai/assistants` → HTTP 200. Account hat 3 "Blank"-Templates (NICHT unser Hermes).
- Assistant-Schema (top-level Felder): `model` (Pflicht), `external_llm`, `voice_settings`
  {`voice`=`Provider.Model.VoiceId`, `api_key_ref`}, `greeting`, `interruption_settings`
  {enable, start_speaking_plan.wait_seconds, endpointing}, `transcription` {model `deepgram/flux`},
  `telephony_settings` {default_texml_app_id auto, time_limit_secs 1800}, `llm_api_key_ref`.
- **Custom-LLM-Schema (Doku developers.telnyx.com/docs/inference/ai-assistants/custom-llm):**
  ```json
  "external_llm": { "base_url": "<prefix>", "model": "<name>", "llm_api_key_ref": "<integration-secret>", "forward_metadata": true }
  ```
  base_url ist der PRAEFIX, Telnyx haengt `/chat/completions` an → base_url = `${PUBLIC_URL}/v1`.
  Auth = STATISCHES Telnyx-Integration-Secret (per Bearer an den Shim); `forward_metadata:true` legt
  Call-Metadaten (u.a. callId) in den Request-BODY.

## DIE 3 BLOCKER + FIXES

### Befund 1 (Code-Bug): Provisioning-Skript external_llm-Feldnamen falsch
`scripts/telnyx-assistant-provision.mjs` `buildAssistantConfig` setzt heute
`external_llm: { api_base: publicUrl + "/v1/chat/completions" }`.
**Fix:** `external_llm: { base_url: publicUrl + "/v1", model: <claude-model-name>, llm_api_key_ref:
<integration-secret-name>, forward_metadata: true }`. Plus top-level `model`-Frage klaeren (was
setzt Telnyx als model wenn external_llm gesetzt ist — evtl. egal/Platzhalter, live testen).
Der Offline-Test `test/telnyx-assistant-config.test.js` muss mitgezogen werden.

### Befund 2 (Architektur-Mismatch, SICHERHEITSRELEVANT): Shim-Auth passt nicht
Der Shim (`src/telnyx-llm-shim.js`, P1) erwartet `Authorization: Bearer <callId>:<secret>` und liest
callId NUR aus dem Bearer (Anti-Spoof). Telnyx sendet aber ein STATISCHES Integration-Secret als
Bearer + callId via `forward_metadata` im BODY. → **Shim-Auth-Rework:** (a) Bearer gegen einen
statischen Shared-Secret aus config vergleichen (timing-sicher, `safeEqual`); (b) callId aus dem
forward_metadata-Body ziehen; (c) callId gegen den Store validieren (`store.getCall`) + der
per-callId-Rate-Limiter (existiert schon) greift weiter; (d) Budget-Gate + Degradation + end_call +
Mid-Call-Kill (P2/P3a/P6) bleiben. Das ist die real aufgeloeste offene Frage #2 → statischer-Header-
Zweig. Der per-Call-Bearer aus P5 (`customLlmAuth`→ai_assistant_start `llm_api_key`) faellt weg bzw.
wird zum statischen `llm_api_key_ref`. **Regel-3-relevant → phase-impl-lean mit dualem Review + §5.5.**
Neue config-Var noetig (z.B. `TELNYX_SHIM_SHARED_SECRET`) an 4 Orten (P10-Muster). Genaue
forward_metadata-Body-Form (wo genau die callId liegt) beim ersten Live-Call verifizieren.

### Befund 3 (Ordering/Henne-Ei): Cutover-Reihenfolge
Telnyx validiert die Custom-LLM-Verbindung teils beim Speichern → Shim muss erreichbar (nicht 404)
sein. Shim ist 404 bis Flag an; Flag an ohne `TELNYX_ASSISTANT_ID` → assertConfig Boot-Crash (P10,
gewollt) = Leitung down. **Cutover-Sequenz (Wartungsfenster):** Fixes deployen → im Render-Dashboard
`TELNYX_AI_ASSISTANT_ENABLED=true` + `TELNYX_ASSISTANT_ID=<Platzhalter>` + `TELNYX_SHIM_SHARED_SECRET`
setzen (Boot ok, Shim erreichbar) → Provisioning-Skript laufen lassen (legt Assistant an, Telnyx
validiert gegen den nun erreichbaren Shim) → echte `assistant_id` in `TELNYX_ASSISTANT_ID` → Live-
Testanruf → Rollback = Flag aus. (Alternativ pruefen ob die API OHNE Verbindungs-Validierung anlegt
— dann entfaellt das Henne-Ei.)

## NOCH ZU VERIFIZIEREN (separate APIs, noch NICHT geprueft)
- **Call-Control-Call-Flow:** `originateViaCallControl` (`POST /v2/calls`), `startAssistant`
  (`ai_assistant_start`), Event-Webhooks (`call.answered`/`speak.ended`/`call.hangup`), Inbound-
  Handoff-TeXML (Platzhalter `[]`). Alle in `src/telephony/adapters/telnyx/voice.js` +
  `src/telnyx-call-control-ingest.js` + `src/telnyx-inbound.js` als "live UNBESTAETIGT" markiert.
  Read-only probierbar (GET, wie bei /v2/ai/assistants) ODER am echten Call.
- **Ela-Voice-ID** (`TELNYX_ELEVENLABS_VOICE_ID`) liegt in der Render-Prod-Env (maskiert; die
  Chrome-Extension blockt das JS-Lesen sensibler Keys — richtig so). `TELNYX_ELEVENLABS_API_KEY_REF`
  = `elevenlabs_prod` (Integration-Secret in Telnyx). Fuer die Voice-ID entweder Owner fragen ODER
  im Render-Dashboard das eine Feld enthuellen (Augen-Icon der `TELNYX_ELEVENLABS_VOICE_ID`-Zeile).
- **Latenz-Messung #2** (Worst-Case-Tool-Loop vs Telnyx-Timeout) am Live-Call → entscheidet P3b.

## GUARDRAILS (nicht verletzen)
- Flag bleibt AUS bis alle Fixes drin + geprueft. KEIN Flag-Flip zum "mal testen".
- Auth-Aenderung (Befund 2) ist sicherheitsrelevant → dualer Review + §5.5, nicht slapdash.
- NICHT live hacken (kein Guess-and-Mutate am Prod-Telnyx-Account/Render). Erst Code sauber, dann
  Cutover in Reihenfolge.
- Der reale Live-Testanruf (Barge-in + Ela + Disclosure-zuerst) braucht den Owner am Telefon.
- Deploy = `git push upstream master` (jonas986). `origin` deployt NICHT.

## WERKZEUGE/POINTER
- Orchestrator-Driver `tasks/wf-phase-impl-lean.js` (PHASE_CONFIG pinnen, 6 Modell-Pins, phaseId
  namespacen). Muster: alle bisherigen `tasks/telnyx-p<N>-spec.md`.
- Memory: `telnyx-assistant-live-api-findings` (DIE reale API), `telnyx-assistant-chain-state`
  (Phasen-Historie), `telnyx-assistant-strategy-plan`, `lean-phase-orchestration`, `workflow-model-policy`.
- Plan-Bibel: `PLAN-TELNYX-AI-ASSISTANT.md`. Provisioning-Runbook: `docs/RUNBOOK-TELNYX-ASSISTANT.md`
  (muss nach Befund-1-Fix aktualisiert werden).
- Render-MCP: Workspace `tea-d8m0b9jeo5us73cvasg0` (nur einer). Service `srv-d8m0fhflk1mc73bno570`.
  Env NUR schreibbar via MCP (kein Read-Tool) — Dashboard-Read via Chrome (Owner eingeloggt).

## EMPFOHLENER ERSTER SCHRITT DER NAECHSTEN SESSION
1. Dieses File + die 2 Memories lesen, Git-Stand pruefen (`git log --oneline -3` → `1f7134b`).
2. EINE fokussierte Fix-Phase spec'en (`tasks/telnyx-fix-live-schema-auth-spec.md`): Befund 1 (Skript
   base_url) + Befund 2 (Shim-Auth-Rework auf statisches-Secret + forward_metadata-callId) zusammen,
   phase-impl-lean, dualer Review + §5.5 (Auth-Sicherheit). Neue config-Var + 4-Orte-Doku.
3. Danach mit dem Owner: Ela-Voice-ID + Cutover-Wartungsfenster + Live-Testanruf.
