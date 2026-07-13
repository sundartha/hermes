# PLAN-TELNYX-ASSISTANT-REMEDIATION

## 0. BESTAETIGTE LIVE-EVIDENZ (Telnyx-Portal via Chrome, 2026-07-11) — LIEST §1/§3 NEU

Nach Erstellung dieses Plans hat der Lead per Chrome-Extension direkten Telnyx-Portal-Zugriff bekommen und den
Failing-Call `call_mrg89vrori37` Zeile fuer Zeile verifiziert. Die in §1/§3 als "~0.35 unbewiesen" gefuehrte Wurzel
ist damit BEWIESEN und ein Teil des Phase-0-Blockers ERLEDIGT. Diese Sektion hat Vorrang, wo sie §1/§3 widerspricht.

**BEWIESEN — die EINZIGE Fehlerursache: jeder external-LLM-Turn an unseren Shim bekommt HTTP 403.**
- "Validate LLM connection" im Assistant-Editor -> **403** (Request-ID ef91ea67-...). Der Shim ist ERREICHBAR
  (kein DNS/Host-Problem), antwortet aber 403 = eine der stummen Gates greift.
- Webhook-Timeline (alle "Delivered"/2xx an `app.sundartha.com/voice/call-control`): initiated -> answered ->
  speak.started (Offenlegung) -> speak.ended -> **conversation.created** -> hangup.
- `call.conversation.ended`-Payload: `llm_model: null`; `messages` = NUR 2x `role:"user"` ("Yeah. Hello?", "No."),
  **KEINE einzige `role:"assistant"`-Nachricht**; `stt_model:"deepgram/flux"`; `tts_provider:"elevenlabs"`,
  `tts_voice_id:"SJJe86Va82zRzg6zi2dX"`.

**Kausalkette bewiesen:** Origination OK, Offenlegung (Azure) OK, `ai_assistant_start` OK (conversation.created),
STT OK (Deepgram transkribierte den Anrufer), Assistant-TTS = ElevenLabs (konfiguriert) — der Assistant konnte NUR
nicht antworten, weil jeder Shim-Turn 403 gibt. Anrufer wurde gehoert; KI blieb stumm; Anrufer legte auf.

**Phase-0-Decisive-Checks (§3) — Status nach Telnyx-Zugang:**
- (a) speak.ended zugestellt + unser /voice/call-control -> **200**: ERLEDIGT.
- (b) ai_assistant_start akzeptiert (conversation.created folgte): ERLEDIGT.
- (c) external-LLM-Request traf den Shim, Status **403**: ERLEDIGT.
- (e) Deepgram-STT transkribiert Caller: ERLEDIGT (funktioniert).
- (d) exakte `forward_metadata`-JSON-Position der `call_control_id`: **OFFEN** — die per-Message-`metadata` traegt nur
  `telnyx_conversation_channel`, NICHT die call_control_id; die Request-Body-Position wurde noch nicht direkt gesampelt.
  Das ist der EINZIGE verbleibende Diagnose-Knopf (OBS-1/OBS-FLAG + ein Call).

**Assistant-Config (LIVE gelesen, Hermes `assistant-dcf48d08-1d4e-4673-ab94-2681b22d26d4`):** Use Custom LLM AN;
Base URL `https://vodafone-agent.onrender.com/v1` (NICHT die kanonische `app.sundartha.com` — beide erreichen denselben
Service, aber PROV-1 normalisiert das); Auth=Token via Integration-Secret `hermes_shim_secret`; Forward Metadata AN;
Greeting-Mode "Assistant waits for user" (spricht nicht vor der Offenlegung — Regel-2-konform); STT deepgram/flux;
TTS ElevenLabs eleven_flash_v2_5.

**AUSWIRKUNG AUF DEN KRITISCHEN PFAD (ueberschreibt die Rangliste in §1):**
- Die "Stumm"-Ursache ist NICHT die Event-Kette und NICHT fehlende STT. Damit sind **P1a-FIX (speak.ended-Parsing)
  und PROV-2 (STT setzen) NICHT auf dem kritischen Pfad** — sie bleiben sinnvolle Haertung/Tech-Debt (der
  Provisioning-SCRIPT setzt Event-Robustheit/STT nicht, der LIVE-Assistant hat sie), erklaeren DIESEN Call aber nicht.
  Hypothese 3 (ai_assistant_start feuerte nie) ist durch conversation.created WIDERLEGT.
- P2.5-Klassifikation ist vorab auf **Zweig (B): Shim erreicht + 403** gepinnt; offene Unterfrage nur noch
  Bearer (Gate 1) vs ccid-Position (Gate 2).
- **Kritischer Pfad kollabiert auf:** INFRA-0 -> OBS-1 + OBS-FLAG + SAFE-1 -> P2 (EIN Call zeigt Gate 1 vs Gate 2) ->
  entweder **Bearer-Fix** (Owner-Env: Wert von `hermes_shim_secret` == `TELNYX_SHIM_SHARED_SECRET`, KEIN Code) ODER
  **P1b-FIX** (ccid-Position). Danach P4 (ElevenLabs-Offenlegung) + WATCHDOG + GATE-MATRIX + PROV-1 als Haertung,
  dann P5/P6 Live-Verify (Hard-Barge-in bleibt die eigentliche Launch-Pflicht).

---

## 1. Executive Summary

Ziel: Der C-Telnyx-AI-Assistant-Pfad (Telnyx-gehostetes STT + TTS + Turn-Taking, unser in-house Custom-LLM-Shim `/v1/chat/completions` als Gehirn) wird professionell funktionsfaehig gemacht — mit der Owner-ElevenLabs-Stimme bei Offenlegung UND Gespraech und mit empirisch bewiesenem Hard-Barge-in (dem einzigen Grund, C-Telnyx statt der Budget-Engine zu fahren). Rollback ist ausdruecklich KEINE Loesung, nur ein Sicherheitsnetz (`TELNYX_AI_ASSISTANT_ENABLED=false` / `OUTBOUND_FROZEN`), das eine live regressierende Phase stoppt.

RCA-Baseline in drei Saetzen: Ein Outbound-Testanruf (`call_mrg89vrori37`, 2026-07-11) klingelte, die Offenlegung war hoerbar (aber in Azure, nicht ElevenLabs), danach war die KI stumm, hoerte den Anrufer nicht und hinterliess NULL Logs — Origination, Signaturpruefung, `call.answered` und Disclosure-Speak funktionieren also, der Bruch liegt DANACH. Fuehrende, aber unbewiesene Ursachen (alle mit identischem "stumm + Null-Logs"-Symptom): stiller HTTP-403 an den Shim-Gates (falsche `forward_metadata`-`call_control_id`-Position ~0.35, Bearer-Mismatch ~0.20), nie feuerndes `ai_assistant_start` wegen falsch geparstem `call.speak.ended`-Status-Token (Hypothese 3, in der RCA logisch fehlerhaft entkraeftet — hier auf mindestens ccid-Rang angehoben), Telnyx-seitige Fehlprovisionierung inkl. fehlender STT/Deepgram-Config (~0.12). Die eigentliche systemische Wurzel: Der Pfad wurde mit quasi null Observability auf Live-Telefonie geschaltet und hat seit dem Merge (2026-07-08) nie end-to-end funktioniert — deshalb sind wir blind, und deshalb ist SEHEN vor FIXEN die tragende Strategie.

Der beweisende Beleg liegt Telnyx-seitig. Der Lead hat KEINEN Telnyx-MCP/API-Zugriff — jede Root-Fix-Entscheidung haengt zwingend an einem Owner-Dashboard-Check ODER einem Telnyx-API-Key (Phase-0-Blocker).

---

## 2. Prinzipien & Leitplanken

**Absolute Regeln (CLAUDE.md, in JEDER Phase gewahrt, nie aufgeweicht):**
1. Safety-Gates (Subscriber+KYC statt statischer Allowlist, Denylist, Land-Gate, Stundenlimit, Budget-Schnittmenge global UND pro-Tenant, Max-Dauer, Provider-Signatur fail-closed) bleiben unangetastet. C-Telnyx braucht Mid-Call-Kill auf ZWEI Achsen: Minuten (Max-Dauer/Reserve) UND Tokens (Shim-Budget-Gate) — plus einen zeit-/dead-air-basierten Deckel (Watchdog), weil der Token-Kill turn-getrieben ist und im Silent-Dead-Zustand nie feuert.
2. Offenlegungssatz bleibt fest verdrahtet als allererster Satz; die `onSpeakFailed`-Sperre (kein `ai_assistant_start` ohne gehoerte Offenlegung) bleibt. Daraus folgt: Die Disclosure-Stimme ist **fail-SAFE** (Azure-Fallback), nie fail-closed — eine Stimmwahl, die die Pflicht-Offenlegung verstummen lassen kann, verletzt den Geist von Regel 2.
3. Auth fail-closed, timing-sichere Vergleiche (`safeEqual`), Empty-Secret-Trap.
4. Secrets nur via Env, nie loggen/leaken. Neue Observability-Logs tragen NUR Key-NAMEN/Booleans/Status-/Protokoll-Token, nie Werte/PII/Secrets/E.164. `Object.keys()` — NIE `Object.values()`, kein Rekursions-Dump in `metadata`.
5. Audio nie durch MCP.
6. Nur implementieren, was gefragt ist.
7. Erst Runtime lesen, nie raten.

**Arbeitsprinzipien:**
- **Verify-before-fix, pro Fix-Phase:** Kein Fix ohne Runtime-Evidenz aus echten Render-Logs/Telnyx-Call-Debug. JEDE Fix-Phase hat ihr eigenes verify-before-fix-Gate (deployte Vorstufen-Observability per `[boot]`-Banner-Commit-Check + eigener ueberwachter Call), nicht ein einmaliger globaler Testanruf. Der Plan kalkuliert offen 3-4 ueberwachte Testanrufe ein (Events -> Bearer -> ccid -> Final-Verify).
- **Observability-first:** Additive, PII-freie Logs an allen stummen Gates ZUERST — zugleich fruehester Deliverable und Sicherheits-Verbesserung (laute statt stumme Fehler). Logs sind unconditional (`console.warn`/`log`-Muster des Bestands), NICHT hinter `metricsEnabled` (das war im Vorfall aus).
- **Observability darf den Fix-Input nicht maskieren:** Der Diagnose-Log muss den ROHEN `event_type` + `payload.status` durchlassen, nicht auf eine `completed`/`failed`-Allowlist klemmen — sonst verschluckt die Beobachtung genau den Token, den der `speak.ended`-Fix braucht.
- **Lean-Fit:** Jede Code-Phase ist EIN `phase-impl-lean`-Lauf: klein, klar abgegrenzt, fail-closed, additiv wo moeglich, mit DoD + Test + Pre-Mortem. Owner-/Telnyx-gated Schritte sind bewusst KEINE Lean-Laeufe (Ausnahme-Muster wie P0/P7/P11 im Ur-Plan).
- **Kill-Switch = Sicherheitsnetz, nicht Ziel:** `TELNYX_AI_ASSISTANT_ENABLED=false` faellt byte-identisch auf Budget/TeXML zurueck. ACHTUNG: Auf FREE-Tier/1-Instanz loest der Flag-Flip selbst einen Redeploy aus (droppt in-flight Calls, Cold-Boot) — er ist forward-only, nicht unterbrechungsfrei (Abschnitt 6).

---

## 3. Bestaetigter Ausgangszustand

### Aus dem Code BEWIESEN (read-only verifiziert)
- Auth-Modell ist bereits statisches Shared-Secret (`bearerFrom()` vs `config.telnyxShimSharedSecret` per `safeEqual`, Empty-Secret-Trap), NICHT mehr per-Call-Token. Boot-pflichtig bei aktivem Flag (`assertConfig` ~684-695). `startAssistant` traegt bewusst keinen Auth-Parameter mehr.
- Die vier Shim-Gates sind strikt sequentiell und alle fail-closed (403 ohne `agentTurn`): flag->404, dann bearer->403, dann ccid->403, dann call-resolve->403. KEINES loggt beim Greifen. Ein einziger Testanruf zeigt nur das ERSTE gebrochene Glied.
- `callControlIdFromForwardedMetadata` (shim.js:36-46) ist explizit "LIVE UNBESTAETIGT": primaer `body.metadata.call_control_id`, Fallback `body.call_control_id` (spoofbar!), sonst null->403.
- `parseCallControlEvent` mappt nur `call.answered`/`call.speak.ended`/`call.hangup`; `SPEAK_ENDED` nur bei `payload.status==='completed'` (speak-events.js:65) — jeder andere Token -> `NONE` -> `ai_assistant_start` feuert NIE -> Shim nie erreicht = exakt das Symptom.
- Disclosure-Speak laeuft ueber `telnyxVoice.speak()` (voice.js:170-185) -> `voiceAttrs()` = Azure-only. Der ElevenLabs-Config-Block wird hier NICHT gelesen -> beweist die "Azure statt Ela"-Beobachtung.
- Mid-Call-Kill beidachsig implementiert+getestet: Minuten (`armMaxDurationTimer`/`terminateCappedCall` ueber `callControlId`, Boot-Re-Arm) und Tokens (Budget-Gate im Shim). `OUTBOUND_FROZEN` sitzt vor der C-Telnyx-Origination-Verzweigung und ist gegen den Branch getestet. `voice.js` Erfolgspfade und `ingest` Erfolgspfade loggen NICHTS.
- STT/Deepgram ist NIRGENDS im Assistant-Provisioning gesetzt (`buildAssistantConfig` hat kein `transcription`/`stt`-Feld). Der Assistant ist EIN statisches globales Objekt ohne `call.language`-Override; Live ist DE/FR/EN.
- Provisioning schreibt blind (POST/PUT), `smokePass` haengt nur an zurueckgelieferter `id` — KEIN GET/Read-Back, kein Feld-Diff. Voice-Slot-Casing `ElevenLabs.<model>.<voiceId>` ist selbst als "live UNBESTAETIGT" markiert.
- Infra LIVE (per `get_service` srv-d8m0fhflk1mc73bno570): plan=free, region=frankfurt, `autoDeploy=yes` (Drift ggue. `render.yaml:false`), `healthCheckPath` LEER (Drift ggue. `render.yaml:/healthz`), numInstances=1.

### Telnyx-seitig NOCH ZU VERIFIZIEREN (Phase-0-Blocker — Lead hat keinen Telnyx-MCP, Owner-Dashboard ODER Telnyx-API-Key noetig)
- (a) `call.speak.ended`-Webhook-Zustellung an `/voice/call-control` + HTTP-Status; roher `event_type` + `payload.status`-Token.
- (b) Wurde `ai_assistant_start` von Telnyx akzeptiert (kein 4xx)?
- (c) Hat der external-LLM-Request `/v1/chat/completions` ueberhaupt getroffen + welcher Status (wiederholte 403 => Shim-Gate)?
- (d) Realer `forward_metadata`-Turn-Body-Shape: exakte JSON-Position der `call_control_id`, Praesenz eines `metadata`-Objekts (Feldnamen, nie Werte).
- (e) Transkribiert Deepgram das Caller-Audio (STT an, richtige Sprache)?
- Assistant-Config-Diff: `name`; `external_llm.base_url == https://<PUBLIC_URL>/v1`; KEIN top-level `model` (Doppelfeld->400); `external_llm.forward_metadata == true`; `interruption_settings.enable == true` (Barge-in); `greeting == ""`; `voice_settings.voice == ElevenLabs.<model>.<voiceId>` + `api_key_ref`; Call-Control-App `webhook_url == unsere /voice/call-control`.
- Secret-Paritaet: Telnyx-Integration-Secret hinter `TELNYX_SHIM_API_KEY_REF` == Render-Env `TELNYX_SHIM_SHARED_SECRET` (Owner vergleicht, nie loggen).
- Vendor: ElevenLabs Paid-Plan + Guthaben >0 auf dem Telnyx-Secret `elevenlabs_prod`; Telnyx-Guthaben deutlich >2 USD (sonst stiller HTTP 402).

---

## 4. Der Phasenplan

Legende: **[CODE]** = ein `phase-impl-lean`-Lauf. **[OWNER]** = Owner/Telnyx-gated, kein Lean-Lauf, kein Repo-Diff. **[DOC]** = reiner Doku-/Konfig-Lauf.

---

### INFRA-0 — Infra/Vendor-Vorbedingungs-Gate [OWNER] — HARTER BLOCKER DER GESAMTEN KETTE
**Ziel:** Alle beweglichen externen Realitaeten festnageln, bevor irgendeine Code-Phase gegen sie laeuft.
**Scope IN:** (1) `autoDeploy` im Render-Dashboard auf OFF (Deploy-Freeze) fuer die Remediation-Dauer; Deploys nur manuell in verifizierten No-Call-Fenstern. (2) `healthCheckPath` im Dashboard auf `/healthz` setzen. (3) `hermes-db` FREE-Postgres-Ablauf (Memory: 2026-07-24, in 13 Tagen) + Plan verifizieren, Backup ziehen, VOR Ablauf auf Paid-Postgres heben — sonst Total-Verlust des Stores (Calls/Numbers/tenant_budget/subIndex) und BEIDER Engines. (4) Keep-Warm-Entscheidung: Paid-Tier (Zero-Downtime + kein Cold-Start) ODER externer Ping-Cron — Owner-Kostenentscheidung. (5) ElevenLabs: Paid-Plan + Guthaben, Telnyx-Secret `elevenlabs_prod` haelt den Paid-Key (nicht mit dem funktionierenden `ELEVENLABS_API_KEY`/Play-TTS verwechseln). (6) Telnyx-Guthaben auf sicheren Puffer (>>2 USD) aufladen.
**Scope OUT:** jede Code-Aenderung.
**Dateien:** keine.
**dependsOn:** —. **Parallel:** blockiert alle Code-Phasen; Owner kann die 6 Punkte parallel abarbeiten.
**DoD/Verifikation:** Re-Check per `mcp__render__get_service` zeigt `autoDeploy!=yes` UND `healthCheckPath=='/healthz'`; `mcp__render__get_postgres` zeigt `hermes-db` Plan/Ablauf unkritisch (Backup vorhanden); Owner bestaetigt ElevenLabs Paid + Telnyx-Guthaben-Puffer (Werte nie ins Repo/Log).
**Pre-Mortem:** In 1 Jahr: mitten in der Remediation lief die Free-DB am 2026-07-24 ab -> kompletter Store weg, beide Engines tot, voellig unabhaengig vom Shim-Bug — das groesste ungenannte Kill-Risiko. Gegenmassnahme: DB-Deadline als harter Blocker mit Backup vor jeder anderen Phase.
**Lean-Fit:** Kein Code — reine Infra-/Vendor-Entscheidung, als Phase gefuehrt, damit sie nicht verloren geht und ihre Blocker-Rolle sichtbar bleibt.
**Safety:** Beseitigt die aktivste Regression (autoDeploy killt Testanrufe + in-flight Calls) und das Store-Total-Ausfall-Risiko VOR jedem Code-Push.

---

### P0 — Live-Verify-Gate: Telnyx-Decisive-Checks + Config-Diff + Secret-Paritaet [OWNER] — BLOCKER
**Ziel:** Die telnyx-seitigen Tatsachen (Abschnitt 3, a-e + Config-Diff + Secret-Paritaet) klaeren, bevor geraten wird. Secret-Paritaet und `forward_metadata==true` sind UP-FRONT-Hartgates, nicht bedingte Nachlaeufe.
**Scope IN:** Owner/Telnyx-Dashboard bzw. Read-API: die 5 Decisive-Checks je Ja/Nein/Status; Assistant-Config-Diff jede Zeile gruen/rot (inkl. `forward_metadata==true`, `webhook_url`, STT/Sprache, Voice-Slot); Secret-Paritaet bestaetigt; Telnyx-Guthaben-Recheck; Bestaetigung Flag-Posture (regulaerer Verkehr auf Budget-Engine, Flag AUS bis Kern gefixt).
**Scope OUT:** jede Code-Aenderung, jeder Live-Testanruf (das ist P2).
**Dateien:** keine.
**dependsOn:** INFRA-0. Kann teils parallel zu OBS-1/2/3 laufen (Owner-Track vs Code-Track).
**DoD:** Protokoll (tasks/telnyx-p*-report.md-Stil) mit allen Punkten; jede Vermutung als Vermutung markiert, nicht als Tatsache. Falls Owner keinen Zugang gibt: P0 auf die aus unseren Logs (P2) ableitbaren Punkte reduziert, `forward_metadata==true` und Secret-Paritaet bleiben aber Owner-Pflicht.
**Pre-Mortem:** In 1 Jahr: ohne Telnyx-Zugang blind weitergeraten, ccid falsch getippt, mehrere Calls verbrannt. Gegenmassnahme: P0 als harter Blocker vor jedem Fix; Secret-Paritaet + `forward_metadata` up-front raus aus dem Rennen.
**Lean-Fit:** Ausnahme (Owner-gated), kein Lean-Lauf.
**Safety:** Regel 4 — Secrets vergleicht der Owner, nie Repo/Log. Flag-AUS-Posture beendet die aktive Live-Regression.

---

### OBS-1 — Observability: Shim-Gates [CODE]
**Ziel:** Jede der stummen 403-/Degradations-Flaechen im Brain-Shim hinterlaesst eine unconditional, PII-/secret-freie Log-Zeile mit distinktem Grund-Token — insbesondere die ccid-null-Gate, deren `Object.keys(body)` + `Object.keys(body.metadata||{})` die reale `forward_metadata`-Form offenlegt.
**Scope IN:** `src/telnyx-llm-shim.js`: Log an Bearer-Mismatch (`reason=auth`, Booleans `hasHeader`/`secretConfigured`, nie Wert), ccid-null (`reason=no_ccid`, Feldnamen-Keys, nie Werte, kein Rekursions-Dump), Call-unresolved (`reason=call_unresolved`, Boolean ccid-resolvebar + `call.status`), Rate-Gate (`reason=rate_limited`, `call.id`), Budget-Gate (`reason=budget_tenant|budget_global`, `call.id`, `tenantId`); unbedingter Erfolgs-Log pro Turn (`call.id`, `latencyMs`), unabhaengig von `metricsEnabled`. HTTP-402-Fall (Vendor) als eigenes Watched-Token. Bonus: stalen Kommentar `server.js:211` (altes per-Call-Token-Modell) auf E1/E2 korrigieren.
**Scope OUT:** jede Gate-/Kontrollfluss-Aenderung; ingest/voice.js (OBS-2); Signatur (OBS-3); neues Flag (OBS-FLAG).
**Dateien:** `src/telnyx-llm-shim.js`, `src/server.js` (nur Kommentar), `test/telnyx-llm-shim.test.js`.
**dependsOn:** INFRA-0. **Parallel:** OBS-2, OBS-3 (disjunkte Dateien), P0.
**DoD:** `node --check` gruen; `npm test >=` Baseline (1918/0). Console-Spy-Test: jedes Gate gibt WEITER 403 UND emittiert genau eine Zeile; PII-Assertion gegen Fixture-Body mit Fake-Secret + Fake-Transkript -> Wert taucht NICHT im Log auf. Smoke: `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true TELNYX_AI_ASSISTANT_ENABLED=true` + curl ohne/falschem Bearer/ccid-losem Body -> je 403 + distinktes Token.
**Pre-Mortem:** In 1 Jahr: `Object.values`- oder Roh-Body-Log leakte Transkript/Secret in Render-Logs (FREE-Tier, nicht isoliert) -> DSGVO-Vorfall. Gegenmassnahme: harte "PII-Wert NICHT im Log"-Assertion, nur Keys/Booleans/Token; SAFE-1 als Regressionsguard.
**Lean-Fit:** Rein additiv, ein Datei-Cluster, kein Kontrollfluss — klassischer Ein-Lauf-Scope.
**Safety:** Gates byte-identisch; einziges Risiko Regel 4, durch DoD-Negativtest gedeckt.

---

### OBS-2 — Observability: Event-Ingest (roh) + voice.js-Erfolgspfade [CODE]
**Ziel:** Die Call-Control-Kette answered->speak->speak.ended->ai_assistant_start->hangup->Settlement wird pro Call nachvollziehbar; der ROHE `event_type` + `payload.status` jedes `call.speak.*` wird sichtbar (nicht auf `completed`/`failed`-Allowlist geklemmt), damit P1a-FIX die reale Token-Form kennt.
**Scope IN:** `src/telnyx-call-control-ingest.js`: Erfolgs-Logs in `onAnswered`/`onSpeakEnded`/`onHangup`; Log bei unbekanntem callId (`reason=unknown_call`, kein Roh-Query-Wert); Log bei `eventType=null` MIT rohem `event_type` + `payload.status` (Telnyx-Protokoll-Token, kein PII). `src/telephony/adapters/telnyx/voice.js`: Erfolgs-Log nach jedem `assertTelnyxOk` in `originateViaCallControl`/`endCallViaCallControl`/`startAssistant`/`speak` (Op-Name + HTTP-Status + `call_control_id`-PRAESENZ-Boolean, nie der Wert, nie API-Key).
**Scope OUT:** Event-Klassifikations-/Verhaltensaenderung (das ist P1a-FIX); shim/server (OBS-1/3).
**Dateien:** `src/telnyx-call-control-ingest.js`, `src/telephony/adapters/telnyx/voice.js`, `test/telnyx-event-ingest-machine.test.js`, `test/telnyx-call-control.test.js`.
**dependsOn:** INFRA-0. **Parallel:** OBS-1, OBS-3, P0.
**DoD:** `node --check` gruen; Baseline gehalten. Spy-Test: answered->Speak-Log, speak.ended->assistant_start-Log, unbekannter callId->genau ein Log, hangup->Settlement-Log; ein `call.speak.*` mit Nicht-`completed`-Status loggt den rohen Token; kein Log traegt Voll-`call_control_id`/API-Key.
**Pre-Mortem:** In 1 Jahr: Ingest ackt 200 und schluckt einen falsch gemappten `event_type` still -> erneut blind; ODER die Allowlist verschluckt genau den realen `speak.ended`-Token, den der Fix braucht. Gegenmassnahme: roher `event_type`+`status`-Log am null-Zweig ist harte DoD-Zeile.
**Lean-Fit:** Additiv, zwei Dateien disjunkt von OBS-1/3.
**Safety:** Reihenfolge/Semantik unberuehrt; Regel 4 via Praesenz-Booleans.

---

### OBS-3 — Observability: /voice-Signatur-403 [CODE]
**Ziel:** Ein fehlgeschlagener Provider-Signatur-Check (Twilio UND Telnyx) hinterlaesst eine Log-Zeile mit Provider-Herkunft + Pfad statt lautlos 403.
**Scope IN:** `src/server.js` `app.use('/voice', ...)` (~532-542): `console.warn` bei `!ok` mit `req.path` + Provider-Marker (Praesenz `telnyx-signature-ed25519` vs `Twilio-Signature` als Boolean, nie Header-Werte/rawBody/Timestamps).
**Scope OUT:** Verify-Logik selbst.
**Dateien:** `src/server.js`, `test/telnyx-signature.test.js` (erweitern).
**dependsOn:** INFRA-0. **Parallel:** OBS-1, OBS-2, P0. ACHTUNG: `server.js` ist auch von OBS-1 (nur Kommentar) beruehrt — OBS-1 und OBS-3 daher NICHT gleichzeitig im Worktree mergen (Single-Writer, Abschnitt 5).
**DoD:** `node --check` gruen; manipulierte/fehlende Signatur -> 403 + Log; GUELTIGE Signatur -> keine Zeile; bestehende Twilio-Signatur-Tests gruen (gemeinsame Naht, "HEIKLE STELLE"-Sorgfalt).
**Pre-Mortem:** In 1 Jahr: die Warn-Zeile flutet bei jedem Scanner-403 die Logs und verdeckt echte Vorfaelle. Gegenmassnahme: eine Zeile ohne Stacktrace/Body; `/voice`-Volumen ist gering.
**Lean-Fit:** Eine Middleware-Stelle; bewusst eigene Phase, weil nicht Telnyx-spezifisch (betrifft Twilio-Live-Betrieb).
**Safety:** Additiv VOR dem bestehenden fail-closed-403; Regel 1/3 unberuehrt.

---

### OBS-FLAG — Shape-Debug-Flag + Env-Plumbing [CODE]
**Ziel:** Ein one-shot, default-off Shape-Dump-Flag `TELNYX_SHIM_DEBUG_SHAPE`, das NUR Top-Level-Key-Namen des `forward_metadata`-Body + Booleans "ccid in metadata? / top-level?" loggt (keys-aware, nie Werte) — fuer den EINEN ueberwachten Diagnose-Call.
**Scope IN:** neue Var an 4 Orten (`config.js` / `.env.example` / `render.yaml` / `test/helpers.js` BASE_ENV) mit neutralem fail-closed Default (NICHT boot-required); gated Log-Zweig im Shim; Test dass Flag-aus = byte-identisch keine Zeile.
**Scope OUT:** Werte/Rekursion; jede Verhaltensaenderung am Gate.
**Dateien:** `src/config.js`, `.env.example`, `render.yaml`, `test/helpers.js`, `src/telnyx-llm-shim.js`, `test/telnyx-llm-shim.test.js`.
**dependsOn:** OBS-1 (gemeinsame Datei `telnyx-llm-shim.js` -> seriell NACH OBS-1, nicht parallel). **Parallel:** OBS-3.
**DoD:** Flag=true -> nur Key-Namen+Booleans; Default aus -> keine Zeile; 4-Orte-grep nicht leer; `node --check` + Baseline.
**Pre-Mortem:** In 1 Jahr: die neue Var wurde boot-required und der Code deployte vor gesetztem Render-Env -> `assertConfig` `process.exit` -> einziger Prozess tot, Total-Outage. Gegenmassnahme: neutraler Default, nie boot-required; Env-vor-Code-Reihenfolge im Report.
**Lean-Fit:** Klein, Flag + Plumbing; bewusst aus der Observability-Mega-P0 herausgeloest.
**Safety:** Default-off, keys-only; Regel 4.

---

### SAFE-1 — Secret/PII-Leak-Regressionsguard [CODE] — HARTES GATE VOR JEDEM FLAG-AN-TESTANRUF
**Ziel:** Ein dauerhaft gruener Test verhindert, dass eine kuenftige Aenderung an OBS-1/2/3/FLAG ein Secret/PII in eine Log-Zeile einschleust.
**Scope IN:** neuer Test (`test/telnyx-observability-secret-guard.test.js`): liest die Quelltexte von `telnyx-llm-shim.js`, `telnyx-call-control-ingest.js`, `telephony/adapters/telnyx/voice.js`, `server.js` (nur `/voice`-Middleware) via `readFileSync`, Regex-Assertion dass kein `console.*`-Aufruf Secret-/Auth-Bezeichner (`config.telnyx*Secret`/`ApiKey`, `req.headers.authorization`, `telnyx-signature-ed25519`, `rawBody`) direkt interpoliert; zusaetzlich generischer Teilstring-Fang `secret`/`apiKey`/`authorization` + E.164-Regex in `console.*`-Argumenten.
**Scope OUT:** kein Runtime-Scan, kein neuer Dep, keine Aenderung an OBS-Phasen.
**Dateien:** `test/telnyx-observability-secret-guard.test.js`.
**dependsOn:** OBS-1, OBS-2, OBS-3, OBS-FLAG. **Parallel:** —. **MUSS gruen sein, bevor P2 mit aktivem Flag laeuft.**
**DoD:** `npm test` gruen inkl. neuem Test; Mutation-Probe (testweise Secret einloggen) macht ihn NACHWEISLICH rot, danach zurueckgesetzt; kein neuer Dependency.
**Pre-Mortem:** In 1 Jahr: der Regex ist zu eng, ein Rename umgeht ihn still. Gegenmassnahme: generischer Teilstring-Fang zusaetzlich zu exakten Bezeichnern.
**Lean-Fit:** Reiner Test-Zusatz, kleiner Abschlusslauf der Observability-Kette.
**Safety:** Der Guard IST die Regel-4-Absicherung fuer den scharfen Testanruf.

---

### P2 — Ueberwachter Testanruf #1 (Payload-Beweis) [OWNER]
**Ziel:** Mit deployter Observability (OBS-1..FLAG, SAFE-1 gruen) + P0-Zugang EINEN Outbound-Testanruf zur Owner-Nummer fahren und die entscheidende Payload festhalten: hat der Shim ueberhaupt einen Request gesehen, welches Gate greift, wie sieht der `forward_metadata`-Body-Shape aus, welcher rohe `speak.ended`-Status kam.
**Scope IN:** OBS-Phasen + SAFE-1 nach upstream deployen (`[boot]`-Banner-Commit verifizieren; ein curl `/v1/chat/completions` mit falschem Secret -> 403+Log beweist VOR dem Anruf, dass die Logs live sind); Flag im minimalen Testfenster AN; Ziel ausschliesslich Owner-Nummer; Render-Logs + Telnyx-Call-Debug parallel lesen; Flag SOFORT wieder AUS.
**Scope OUT:** jeder Fix.
**Dateien:** keine.
**dependsOn:** INFRA-0, P0, OBS-1, OBS-2, OBS-3, OBS-FLAG, SAFE-1.
**DoD:** `[boot]`-Banner zeigt den Observability-Commit; Testanruf-Protokoll: exaktes Gate ODER Erfolgs-Turn ODER "Shim nie getroffen" identifiziert; bei ccid-null die geloggten Body-Feldnamen + Praesenz `metadata`-Objekt notiert; roher `speak.ended`-Status notiert; Cross-Check mit P0-(c)/(d).
**Pre-Mortem:** In 1 Jahr: angerufen ohne dass die Logs wirklich live waren (alter Commit) -> wieder nichts, Call verbrannt; ODER ein konkurrierender Auto-Deploy killte den Call. Gegenmassnahme: `[boot]`-Commit-Check + curl-Vorprobe hart; autoDeploy ist per INFRA-0 aus. Globaler Flag-Flip exponiert im Fenster JEDEN realen Anrufer -> minimales Fenster in nachfrageschwacher Zeit, Owner bestaetigt "kein Regelverkehr erwartet", Inbound-Fallback auf Budget-Engine geprueft.
**Lean-Fit:** Ausnahme, Owner-gated.
**Safety:** Gates scharf, Ziel nur Owner-Nummer, Guthaben per INFRA-0/P0 gepueffert.

---

### P2.5 — Diagnose-Gate: Flow-Stop-Entscheidungsbaum [OWNER/DOC]
**Ziel:** Aus P0+P2-Evidenz klassifizieren, WO der Flow stoppte, und erst daraus das Ziel der Fix-Phasen ableiten — statt ccid vorwegzunehmen.
**Scope IN:** verpflichtender Entscheidungsbaum: (A) external-LLM-Request nie eingetroffen -> Ursache Event-Kette (P1a-FIX) ODER Provisioning (PROV-1/PROV-2/STT) -> ccid ist FALSCHES Ziel; (B) Shim erreicht + 403 -> welches Token: Bearer (Owner-Env-Fix, kein Code) vs ccid (P1b-FIX, aber nur wenn `metadata`-Objekt PRAESENT) vs call-resolve; (C) Turn ok -> Stille liegt in STT/Voice/Barge-in. Ergebnis pinnt, welche Fix-Phase startet.
**Scope OUT:** Code.
**Dateien:** keine (Protokoll im tasks/-Report).
**dependsOn:** P0, P2.
**DoD:** Klassifikation dokumentiert; die zu startende(n) Fix-Phase(n) benannt; bei (B/ccid) explizit bestaetigt, dass ein `metadata`-Objekt existiert UND `forward_metadata==true` — sonst ist die Ursache Provisioning, kein Code.
**Pre-Mortem:** In 1 Jahr: P1b hat blind die ccid-Schicht gefixt, obwohl der Bruch in der Event-Kette lag -> falsche Schicht, naechster Call entlarvt das naechste Glied, 4 Zyklen statt 2. Gegenmassnahme: dieses Gate zwischen Beobachtung und Fix.
**Lean-Fit:** Kein Code, reines Routing-Gate.
**Safety:** Verhindert blinde Fixes (Regel 7).

---

### P1a-FIX — Event-Zustandsmaschine an reale Telnyx-Shapes fixieren [CODE] — VOR P1b-FIX
**Ziel:** `parseCallControlEvent`/`parseSpeakEvent` gegen die aus P2 gecapturten ECHTEN `event_type`- und `payload.status`-Token haerten, sodass `ai_assistant_start` nach gehoerter Offenlegung tatsaechlich feuert (Regel 2 gewahrt). Adressiert die auf ccid-Rang angehobene Hypothese 3.
**Scope IN:** `call-control-events.js`/`speak-events.js`/`ingest`: `SPEAK_ENDED`-Mapping gegen die realen Token (z.B. auch `succeeded`/`done`, falls P2 das zeigt); Fixtures aus echtem Call-Debug-Body; `onSpeakEnded->startAssistant`-Pfad verifizieren.
**Scope OUT:** Shim-Auth/Korrelation (P1b-FIX), Stimme (P4), Provisioning (PROV).
**Dateien:** `src/telephony/adapters/telnyx/call-control-events.js`, `src/telephony/adapters/telnyx/speak-events.js`, `src/telnyx-call-control-ingest.js`, `test/telnyx-event-ingest-parser.test.js`, `test/telnyx-event-ingest-machine.test.js`.
**dependsOn:** P2.5 (Klassifikation A/Event-Kette). **Parallel:** GATE-MATRIX (test-only, disjunkt). **NICHT parallel zu P1b-FIX** (Fix-Phasen seriell entlang der Evidenzkette).
**DoD:** `node --check` + Baseline; realer `speak.ended(<realer status>)`-Fixture -> `SPEAK_ENDED`; `SPEAK_FAILED` behaelt Vorrang (Sperre); Regel-2-Invariante-Test bleibt gruen (kein `ai_assistant_start` ohne `speak.ended`). Eigenes verify-before-fix-Gate: Deploy + `[boot]` + ueberwachter Call zeigt in Telnyx-Debug `ai_assistant_start=akzeptiert` -> jetzt trifft der external-LLM-Request erstmals den Shim (liefert den `forward_metadata`-Body fuer P1b).
**Pre-Mortem:** In 1 Jahr: `speak.ended` kam mit `succeeded` statt `completed`, wir werteten es als FAILED -> `ai_assistant_start` feuerte NIE -> Symptom nur verlagert. Gegenmassnahme: Fixtures ausschliesslich aus echtem Call-Debug; fail-safe bleibt "kein Assistant-Start" (Call sicher tot statt KI ohne Offenlegung).
**Lean-Fit:** Zwei Parser + Ingest, Einzeiler-Korrekturen getrieben von echten Bodies.
**Safety:** Offenlegung-zuerst + `onSpeakFailed`-Sperre unantastbar.

---

### P1b-FIX — Shim-Korrelation gegen realen forward_metadata-Body, single trusted source [CODE]
**Ziel:** `callControlIdFromForwardedMetadata` auf die aus P2 bewiesene reale Position fixieren, sodass jeder Turn den `agentTurn` erreicht — OHNE spoofbare Fallback-Quelle.
**Scope IN:** `src/telnyx-llm-shim.js` `callControlIdFromForwardedMetadata`: die EINE verifizierte Position hart aus `forward_metadata` lesen; den spoofbaren Top-Level-`body.call_control_id`-Fallback ENTFERNEN (single trusted source = `forward_metadata.call_control_id` + `store.getCallByControlId(status==active)`); unbekannt -> null -> 403 bleibt byte-genau. Regressionstest mit realem (feldnamen-bestaetigtem, inhaltlich synthetischem) Body-Fixture. Kommentar-Marker "LIVE UNBESTAETIGT" -> "LIVE BESTAETIGT [Datum, Quelle=P2]".
**Scope OUT:** Schritte 5-8 (Rate/Budget/agentTurn/end_call) unberuehrt; Bearer (reiner Owner-Env-Fix, falls P2.5-B); Event-Kette (P1a).
**Dateien:** `src/telnyx-llm-shim.js`, `test/telnyx-llm-shim.test.js`, `docs/RUNBOOK-TELNYX-ASSISTANT.md`.
**dependsOn:** P1a-FIX (Shim wird erst nach funktionierendem `ai_assistant_start` getroffen), P2.5 (bestaetigt `metadata`-Praesenz). **Parallel:** GATE-MATRIX.
**DoD:** `node --check` + Baseline; realer Body-Fixture -> ccid korrekt; leerer/fehlender/fremder Body -> 403, kein `agentTurn`/Token-Burn; **Anti-Spoofing-Assertion: ein Body mit fremder Top-Level `call_control_id` -> 403** (kein permissiver Fallback); `safeEqual`/Empty-Secret-Trap unveraendert. Eigenes verify-before-fix-Gate: Deploy + `[boot]` + ueberwachter Call zeigt `[telnyx-shim]`-Turn ERFOLG statt 403, KI antwortet hoerbar; Body-Shape auf inbound UND outbound bestaetigt bevor "geschlossen"; ccid-null-Log bleibt permanent (Drift-Detektor).
**Pre-Mortem:** In 1 Jahr: permissive Kaskade behielt die angreiferkontrollierte Top-Level-Position -> nach einem Secret-Leak adressiert ein Angreifer fremde aktive Calls -> Cross-Tenant-Token-Burn/Toll-Fraud. Gegenmassnahme: Fallback entfernt, single trusted source, Anti-Spoof-Test.
**Lean-Fit:** Ein Zugriffspfad-Fix + Fixture-Test — kleinster denkbarer Lauf. R1 (Auth) -> dualer Review + Lead-Checkliste.
**Safety:** Auth fail-closed byte-genau; Korrelation ausschliesslich provider-kontrolliert.

---

### PROV-1 — Provisioning: GET-vor-Update + Read-Back-Assert + Config-Diff [CODE]
**Ziel:** `scripts/telnyx-assistant-provision.mjs` von "blind POST/PUT, id=Erfolg" zu "GET -> PUT/POST -> GET Read-Back -> Feld-Assert" umbauen; ein `--verify`-Modus difft die LIVE-Config gegen `buildAssistantConfig`, sodass Drift (falsche `base_url`, top-level `model`, `greeting!=""`, `interruption` aus, Voice-Slot) beim Lauf auffaellt statt beim naechsten toten Call. Reproduzierbares Provisioning statt manuellem Pasten.
**Scope IN:** `provision.mjs`: GET bei vorhandener `TELNYX_ASSISTANT_ID` (secret-frei loggen), Read-Back nach Schreiben, reine Diff-Funktion (IO-frei, testbar) fuer alle Nicht-Secret-Felder (`external_llm.base_url`/`model`-Abwesenheit/`llm_api_key_ref`-NAME/`forward_metadata`, `voice_settings.voice`/`api_key_ref`-NAME, `greeting==""`, `interruption_settings.enable`, `webhook_url`); bei Abweichung `smokePass=false` + Feldname (nie Wert); Normalisierung (trim/dokumentiert-unschaedliches Casing) VOR Vergleich; 402-explizites Fehlerhandling statt stillem Abbruch. RUNBOOK Abschnitt 5: Greeting-Kriterium automatisiert statt "im Portal oeffnen".
**Scope OUT:** STT/Sprache (PROV-2); Live-GET selbst als Test (Owner-gated); src/-Verhalten.
**Dateien:** `scripts/telnyx-assistant-provision.mjs`, `test/telnyx-assistant-config.test.js`, `test/telnyx-assistant-route-drift.test.js`, `docs/RUNBOOK-TELNYX-ASSISTANT.md`. **SINGLE-WRITER** (Abschnitt 5).
**dependsOn:** P2.5 (bestaetigte Schema-Wahrheit). **Parallel:** P1a-FIX, P1b-FIX, P4 (disjunkte Dateien) — aber NICHT parallel zu PROV-2 (gleiche Datei).
**DoD:** `node --check` + Baseline; Offline-Test: Diff meldet Mismatch bei top-level `model`/`greeting!=""`/`interruption` aus/falscher `base_url`, Match bei erwarteter Config, Rueckgabe traegt nie `api_key_ref`-Wert/Secret; Drift-Test `SHIM_BASE_ROUTE + "/chat/completions" == SHIM_ROUTE` gruen; idempotenter zweiter Lauf ruft PUT (kein Duplikat). Owner-Live-Lauf (gated): `--verify` zeigt 0 Diffs ODER benennt abweichende Felder (Namen).
**Pre-Mortem:** In 1 Jahr: jemand editierte die Config im Dashboard von Hand (top-level `model` -> 400, oder `greeting` gesetzt -> KI prescht vor der Offenlegung, Regel 2), unbemerkt bis zum toten Call; ODER das Assert vergleicht einen normalisiert zurueckgegebenen Wert -> Dauer-false-Negatives, Owner deaktiviert die Pruefung. Gegenmassnahme: `--verify` als Config-als-Code-Wahrheit; Normalisierung vor Vergleich, im ersten Live-Lauf kalibrieren.
**Lean-Fit:** Ein Skript + Diff-Test + RUNBOOK-Absatz, disjunkt von src/.
**Safety:** Regel 2 (`greeting==""` harte Assertion) + Regel 4 (nur Feldnamen/Booleans).

---

### PROV-2 — Provisioning: STT/Deepgram + Sprache setzen + verifizieren [CODE]
**Ziel:** `buildAssistantConfig` setzt explizit das (in P0 identifizierte) STT/Transkriptions-Feld inkl. Sprachwert statt Telnyx-Default; das Multi-Language-Problem (DE/FR/EN) ist strukturell entschieden.
**Scope IN:** `provision.mjs` (STT-Feld + Sprachwert, ggf. `TELNYX_STT_LANGUAGE`) + `config.js` (Var an 4 Orten) + Test. Falls P0 "kein Per-Call-Override": REQUIRED-Gate + `language`-Parameter, getrennte `TELNYX_ASSISTANT_ID_DE/_FR/_EN`; die Aufrufer-Verzweigung in `startAssistant`-Naehe (`telnyx-call-control-ingest.js`/`telnyx-origination.js`) wird dann als eigene Folgephase PROV-2b gesplittet (beruehrt Origination-Naehe, ggf. R1).
**Scope OUT:** Live-Test des STT-Verhaltens (das ist P5-Kriterium); Shim-Auth/Budget-Gates.
**Dateien:** `scripts/telnyx-assistant-provision.mjs`, `src/config.js`, `.env.example`, `render.yaml`, `test/helpers.js`, `test/telnyx-assistant-config.test.js`, `docs/RUNBOOK-TELNYX-ASSISTANT.md`. **SINGLE-WRITER** mit PROV-1.
**dependsOn:** P0 (STT-Schema-Befund), PROV-1 (gleiche Datei, seriell danach). **Parallel:** P1a/P1b/P4 (disjunkt).
**DoD:** `node --check` + Baseline; Test: `buildAssistantConfig` setzt STT-Feld + Sprachwert pro unterstuetzter Sprache; 4-Orte-grep nicht leer; RUNBOOK-Voraussetzungstabelle ergaenzt. Bei Multi-Assistant: dokumentierte Owner-Entscheidung, welche Sprachen beim ersten Cutover live gehen (ggf. nur DE zuerst, F/EN Folgephase — Owner-Sign-off bei Scope-Reduktion explizit im Report).
**Pre-Mortem:** In 1 Jahr: STT nur fuer Deutsch getestet, ein FR/EN-Anrufer wird falsch transkribiert, KI antwortet daneben, kein Sprach-Test faengt es. Gegenmassnahme: Test pro Sprache; sonst Owner-Sign-off der Scope-Reduktion, nie stillschweigend.
**Lean-Fit:** Bei Per-Call-Override: klein genug. Bei Multi-Assistant: PROV-2a (Config) + PROV-2b (Aufrufer, eigener Plan).
**Safety:** Regel-4-4-Orte-Muster gegen BASE_ENV-Drift; STT ist unabhaengige, symptomgleiche Stumm-Ursache.

---

### P4 — ElevenLabs-Stimme auf dem Disclosure-Speak-Node, fail-SAFE [CODE]
**Ziel:** Der deterministische Call-Control-Disclosure-Speak-Node spricht die Owner-ElevenLabs-Stimme statt Azure; das Gespraech laeuft bereits ueber Assistant-`voice_settings` (PROV/P0). **Fail-SAFE: bei nicht gesetzter/bestaetigter ElevenLabs-Voice bleibt Azure** — die Pflicht-Offenlegung wird NIE stumm (widerlegt den fail-closed-Vorschlag).
**Scope IN:** `voice.js` `speak()` nutzt fuer den ElevenLabs-Slot dieselbe Quelle wie `render.js sayVoiceAttrs` (G5, eine Voice-Slot-Quelle) — nur wenn `apiKeyRef` UND `voiceId` gesetzt -> `ElevenLabs.<model>.<voiceId>` + `api_key_ref`, sonst Azure-Bestand byte-identisch. Offenlegungs-TEXT/-Reihenfolge/`onSpeakFailed`-Sperre unberuehrt.
**Scope OUT:** Gespraechs-Voice (Assistant-Config); Play-TTS-Pfad; TeXML-Pfad; Env-Aktivierung in Prod (bleibt leer bis P5 gruen).
**Dateien:** `src/telephony/adapters/telnyx/voice.js`, `src/telephony/adapters/telnyx/render.js`, `test/telnyx-call-control.test.js`.
**dependsOn:** P1a-FIX (Disclosure-Node lebt). **Parallel:** PROV-1, PROV-2, GATE-MATRIX (disjunkte Dateien). **Merge NACH P1b-FIX** (Owner-Wunsch: stabiler Shim-Kern zuerst) — die frueher widerspruechliche `dependsOn`+`parallelizableWith`-Metadatei ist damit aufgeloest.
**DoD:** `node --check` + Baseline; Test: vollstaendiges ElevenLabs-Env -> Body traegt Slot + `api_key_ref` (kein Klartext-Key); leeres/halbes Env -> Azure byte-identisch; Offenlegungs-TEXT unveraendert (nur voice-Attribut); `onSpeakFailed`-Pfad gruen. Live-Verify verschoben nach P5 (Call-Control-`speak`-ElevenLabs-Akzeptanz live UNBESTAETIGT, im Code markiert). Merge OHNE Live-Aktivierung: `TELNYX_ELEVENLABS_*` bleiben in Render leer bis P5.
**Pre-Mortem:** In 1 Jahr: Owner setzt Env ungeduldig nach Merge, Telnyx lehnt den ElevenLabs-Slot im Call-Control-`speak` ab -> Disclosure `speak.failed` -> `onSpeakFailed` sperrt jeden Call an der Offenlegung -> gleiches "stumm nach Klingeln"-Symptom, Diagnose verwirrt (zwei Ursachen, ein Symptom); ODER ElevenLabs-402 (Free-Key) toetet die Offenlegung. Gegenmassnahme: fail-SAFE Azure-Fallback (Offenlegung kommt IMMER); Env-Aktivierung hart an gruenes P5-Live-Verify + INFRA-0-Vendor-Precondition, nicht an den Merge.
**Lean-Fit:** Eine Adapter-Methode + wiederverwendete Voice-Slot-Quelle. R1-nah (Regel 2) -> dualer Review, aber nur Stimme, nicht Text/Reihenfolge.
**Safety:** Regel 2 Text/Reihenfolge/Sperre unberuehrt; Regel 4 `api_key_ref` ist Referenz; fail-SAFE bewusst (Betriebszustand, kein Programmierfehler).

---

### WATCHDOG — No-Progress/Dead-Air-Mid-Call-Kill [CODE] — PFLICHTGLIED (nicht optional)
**Ziel:** Feuert `ai_assistant_start`, kommt aber im konservativen Fenster kein Shim-Turn/Speak-Fortschritt (genau der beobachtete Silent-Dead-Zustand), wird der Call frueh via Call-Control-Hangup beendet — engerer Deckel als der Max-Dauer-Timer, damit ein toter Call nicht Dead-Air-Minuten + gesperrte Reserve bis zum Cap verbrennt. Schliesst die Luecke, dass der Token-Kill turn-getrieben ist.
**Scope IN:** per-Call-Timer, armt beim `ai_assistant_start`, disarmt beim ERSTEN Shim-Turn; Ablauf -> `endCallViaCallControl` (G5, selber Helper wie Budget-Kill) + Settlement; neues Config-Fenster (Default konservativ deutlich ueber Worst-Case-Tool-Loop-Latenz, aus P2 gemessen). Var an 4 Orten, neutraler Default, nicht boot-required.
**Scope OUT:** ersetzt NICHT den Max-Dauer-Cap; keine Aenderung der Budget-/Token-Achse.
**Dateien:** `src/telnyx-call-control-ingest.js`, `src/telnyx-llm-shim.js`, `src/server.js`, `src/config.js`, `.env.example`, `render.yaml`, `test/helpers.js`, `test/telnyx-noprogress-watchdog.test.js`.
**dependsOn:** P1a-FIX, P1b-FIX (Turn-Begriff muss real existieren). **Parallel:** —. ACHTUNG `server.js`/`ingest`/`shim` Ueberschneidung mit P6 -> seriell (Single-Writer).
**DoD:** `node --check` + Baseline; Test: kein Turn im Fenster -> Hangup via `call_control_id`; Turn im Fenster -> disarm, kein Hangup; idempotent zum Max-Dauer-/hangup-Settlement (`billedAt`-Guard, kein Doppel-Write); 4-Orte-grep.
**Pre-Mortem:** In 1 Jahr: der Watchdog legt einen langsamen-aber-lebenden Turn (Tool-Loop-Worst-Case) faelschlich auf -> abgeschnittene Gespraeche. Gegenmassnahme: Fenster konservativ ueber gemessener Worst-Case-Latenz; disarm beim ERSTEN Turn; Defense-in-Depth, nicht primaerer Cap.
**Lean-Fit:** Ein Timer + config + Test.
**Safety:** Regel 1 Minuten-Achse; selber `endCallViaCallControl`-Helper; idempotent.

---

### GATE-MATRIX — E2E-State-Machine + volle Pre-Dial-Gate-Matrix [CODE, test-only]
**Ziel:** Der volle C-Telnyx-Flow ist offline reproduzierbar getestet (Spawn-basiert, fake-Telnyx) — schliesst die systemische Wurzel "nie e2e getestet" — inklusive der Negativ-/Safety-Matrix, die den stillen 403 gefangen HAETTE, UND jedes Pre-Dial-Gate gegen den C-Telnyx-Origination-Branch.
**Scope IN:** Integrationstest (Server-Kindprozess, `PORT=0`, `DATA_DIR`-Override, `TELNYX_AI_ASSISTANT_ENABLED=true`, FAKE_ORIGINATE): `/api/calls`-Gate-Kette -> Origination-Branch -> synthetische Call-Control-Webhooks in echter Shape (answered->speak.ended->ai_assistant_start) -> synthetischer `/v1/chat/completions`-Turn mit realem `forward_metadata`-Fixture (aus P2, geteilte Fixture-Quelle) -> hangup-Settlement. Asserted: Disclosure-vor-Assistant, Bearer/ccid-403 (inkl. Anti-Spoof), inaktiver-Call-403, Ed25519-fail-closed am Ingest, Mid-Call-Budget-Kill BEIDE Achsen, idempotentes Settlement, **je ein Negativpfad PRO Pre-Dial-Gate** (Denylist, Land-Gate, Stundenlimit, Budget-Schnittmenge global+Tenant, Subscriber+KYC, `OUTBOUND_FROZEN`) gegen den `telnyxAiAssistant`-Origination-Zweig; expliziter Test "falsche ccid-Position -> Turn scheitert SICHTBAR, nicht stumm". Beide Backends (json + pglite) — pglite NICHT mit Spawn in einer Datei mischen (p6a-Lehre).
**Scope OUT:** Produktionscode; echter Telnyx-/Claude-Netz-Call. Findet der Test einen echten Bug -> separate Folgephase.
**Dateien:** `test/telnyx-e2e-assistant-flow.test.js`, `test/telnyx-shim-harness.js`, `test/helpers.js`.
**dependsOn:** P1a-FIX, P1b-FIX (reale Fixtures). **Parallel:** P4, PROV-1/2 (test-only, aber `test/helpers.js` Ueberschneidung mit PROV-2/WATCHDOG -> Env-Var-Serialisierung beachten, Abschnitt 5).
**DoD:** neue Suite gruen; Happy-Path endet mit gebuchten Minuten + freigegebener Reserve (`finishCall` idempotent); >=5 Negativpfade gruen; jeder Pre-Dial-Gate-Negativpfad gegen den C-Telnyx-Branch gruen; Fixtures 1:1 aus P2 (Verhalten asserten, nicht "gleiche Werte gleich"); BASE_ENV traegt neue Vars fail-closed.
**Pre-Mortem:** In 1 Jahr: die Suite testete gegen selbst-erfundene Fixtures, war gruen, Live-Pfad brach trotzdem — exakt der diesmalige Fehler (Tests gruen, Cutover blind); ODER ein Cutover-Refactor umging ein Pre-Dial-Gate im Origination-Branch -> teurer Anruf ins falsche Land. Gegenmassnahme: geteilte reale Fixture-Quelle; Gate-Matrix PRO Gate.
**Lean-Fit:** Rein test-seitig; bei zu breiter Suite Split GATE-MATRIX-a (Happy-Path-Zustandsmaschine) / GATE-MATRIX-b (Negativ-/Gate-Matrix).
**Safety:** Nur Tests; exerciert die Safety-Gates, weicht sie nicht auf.

---

### P5 — Live-Verify: Barge-in + Ela + Disclosure-first + Inbound-Cold-Start (Launch-Pflicht) [OWNER]
**Ziel:** Empirisch am realen integrierten Pfad (P1a/P1b/P4/PROV deployt) die Launch-Kriterien beweisen, die der Ur-Plan-P0 nie konnte.
**Scope IN:** Deploy + `[boot]`-verifiziert, Flag AN im Testfenster, `TELNYX_ELEVENLABS_*` jetzt gesetzt. Kriterien: (1) **Hard-Barge-in** — Owner redet waehrend die KI spricht -> KI verstummt hoerbar sofort (nicht DTMF, Sprache; `interruption_settings` empirisch); (2) Ela hoerbar bei Offenlegung UND Gespraech; (3) Caller wird gleichzeitig gehoert (kein Inbound-Track-Suppress); (4) Offenlegung ZUERST vor jeder Assistant-Aeusserung (`greeting==""`); (5) **ein INBOUND-Testanruf** auf die (per INFRA-0 warm gehaltene) Instanz — Cold-Start-Verhalten, weil der RCA-Fehl-Call outbound war und den Inbound-Webhook-Timeout maskiert. Optional: ein absichtlich stiller Call wird vom WATCHDOG frueh beendet.
**Scope OUT:** Mid-Call-Kill-Drill (P6); neue Features.
**Dateien:** keine.
**dependsOn:** P1a-FIX, P1b-FIX, P4, PROV-1, PROV-2, WATCHDOG (deployt), INFRA-0 (Keep-Warm).
**DoD:** `[boot]` zeigt die Commits; Live-Protokoll 5 Kriterien je Ja/Nein. Barge-in NEIN -> Eskalation (`interruption_settings`-Tuning ODER dokumentierte Alternativen C-ElevenLabs/D), KEIN Cutover-Weiterbau, Fallback-Pfad bleibt offen (Shim P1a/P1b bei C-ElevenLabs identisch). Ela-Disclosure NEIN (Telnyx lehnt Call-Control-ElevenLabs-`speak` ab) -> P4-Fallback Azure aktiv, Offenlegung kommt trotzdem, Nachsteuern dokumentiert.
**Pre-Mortem:** In 1 Jahr: C-Telnyx voll committet, dann Barge-in real nicht sauber (nur doku-belegt) -> Launch-Pflicht verfehlt, Umbau umsonst. Gegenmassnahme: dieses Gate VOR jedem Cutover-Weiterbau; Barge-in rot = kein Cutover.
**Lean-Fit:** Ausnahme, Owner-gated Live-Verify.
**Safety:** Kill-Switch-Netz: Barge-in/Ela rot -> Flag AUS -> Budget-Engine; Ziel nur Owner-Nummer.

---

### P6 — Live-Drill: Mid-Call-Kill (beide Achsen) + Deploy-Re-Arm + Rollback [OWNER + Contingency-CODE]
**Ziel:** Die gemergte, aber nie live-exerzierte Kosten-Sicherung (Regel 1, beide Achsen) und die Deploy-Festigkeit real beweisen; den Kill-Switch als forward-only Sicherheitsnetz drillen und MESSEN.
**Scope IN (Owner-Live):** aktiver C-Telnyx-Call -> Deploy ausloesen -> assert Call ueberlebt bzw. wird via `call_control_id` (nicht `twilioSid`) gekappt; Max-Dauer -> Hangup; Budget-Cap mid-call -> Abschluss-Ansage + realer Hangup (Token-Achse); **`terminateCappedCall` auf dem re-armten C-Telnyx-Call BUCHT (`terminateAndBillCall`) + gibt Reserve idempotent frei** (Reserve-Leak-Backstop, da `call.hangup`-Webhook im Fehlerfall ausbleibt); Rollback-Drill `TELNYX_AI_ASSISTANT_ENABLED=false` -> Budget-Engine, dabei die redeploy-induzierte In-Flight-Call-Drop + Cold-Boot-Dauer MESSEN und als "Kill-Switch ist forward-only, NICHT unterbrechungsfrei" dokumentieren.
**Contingency (nur falls Drill einen Bug zeigt, EIN kleiner Lean-Fix):** eine Timer-/rearm-/reattach-Callsite adressiert doch `twilioSid` statt `callControlId`.
**Scope OUT:** neue Features.
**Dateien (Contingency):** `src/server.js`, `src/telephony/reattach.js`, `test/telnyx-p6-boot-rearm.test.js`, `test/telnyx-p6-midcall-budget-kill.test.js`, `test/telnyx-p9-flag-matrix.test.js`.
**dependsOn:** P5. **Parallel:** —.
**DoD:** Drill-Protokoll (i)-(iv) + Reserve-Freigabe-Punkt; `OUTBOUND_FROZEN=true` blockt auch den C-Telnyx-Branch (Flag-Matrix `telnyxAiAssistantEnabled x provider x frozen`); Boot-Re-Arm ueber `callControlId`; idempotenter Hangup (`billedAt`-Guard); Kill-Switch-Dauer gemessen + als forward-only dokumentiert; bei Contingency `node --check` + Baseline + ID-Form-Test. STATUS.md/RUNBOOK: Cutover-Stand + Kill-Switch-Prozedur.
**Pre-Mortem:** In 1 Jahr: haengender Call + Cutover-Deploy -> Cap orphant (rearm mit `twilioSid` gegen TeXML-Endpunkt), Tokenkosten liefen ungebremst; ODER der Rollback-Flip war nie geuebt und im Ernstfall wusste niemand, dass er selbst einen A6-Redeploy ausloest. Gegenmassnahme: expliziter Deploy-waehrend-Call-Drill; ID-Form-Test an ALLEN Timer-Callsites; Kill-Switch-Dauer gemessen.
**Lean-Fit:** Primaer Owner-Live-Drill; Contingency = EIN enger Fix (eine Callsite, ID-Form-Test). R1 -> dualer Review.
**Safety:** Regel 1 beide Achsen; `OUTBOUND_FROZEN` + Flag als Netz; Idempotenz nicht verletzen.

---

### SEC-DOC — PLAN-SECURITY.md: akzeptierte Restrisiken [DOC]
**Ziel:** Die bewussten Vereinfachungen des C-Telnyx-Pfads dokumentieren statt stillschweigend akzeptieren.
**Scope IN:** `PLAN-SECURITY.md`-Eintraege: (1) "C-Telnyx Token-Cap ist entry-per-Turn; begrenzter Ueberlauf hart auf 4 Roundtrips x 300 Tokens/Turn, erst der NAECHSTE Turn blockt — akzeptiert ODER Mid-Turn-Recheck als Folgephase"; (2) Custom-LLM-Endpunkt + Event-Ingest + Disclosure-Voice als bewusste Regel-3-Ausnahme (`/v1/chat/completions` vor Basic-Auth, eigenes 404-Flag-Gate + Bearer); (3) Kill-Switch forward-only auf FREE/1-Instanz.
**Scope OUT:** Code.
**Dateien:** `PLAN-SECURITY.md`, `README.md` (Abweichungen).
**dependsOn:** P1b-FIX, WATCHDOG (Verhalten steht). **Parallel:** GATE-MATRIX, P4.
**DoD:** Eintraege vorhanden; bei Security-Arbeit Pflicht-Update erledigt.
**Pre-Mortem:** In 1 Jahr: der Turn-Ueberlauf summiert sich bei Millionen-Skala und niemand wusste, dass er akzeptiert war. Gegenmassnahme: explizit als bewusstes Restrisiko festgehalten.
**Lean-Fit:** Reiner Doku-Lauf.
**Safety:** Macht das entry-only-Budget-Restrisiko sichtbar.

---

## 5. Abhaengigkeits- & Parallelisierungsgraph

```
INFRA-0  ─────────────────────────────────────────────── (HARTER BLOCKER, alles darunter)
   │
   ├── P0 (Owner) ──────────────────────────────┐
   │                                             │
   ├── OBS-1 ─┐   (shim.js)                       │
   ├── OBS-2 ─┤   (ingest.js + voice.js)  PARALLEL│  disjunkte Dateien
   ├── OBS-3 ─┤   (server.js /voice)             │  (OBS-1 beruehrt server.js NUR im Kommentar
   │          │                                  │   -> nicht gleichzeitig mit OBS-3 mergen)
   │      OBS-FLAG (nach OBS-1, gleiche shim.js)  │
   │          │                                  │
   │       SAFE-1 (nach OBS-1/2/3/FLAG)  ◄── HARTES GATE vor P2
   │          │                                  │
   └──────────┴──────────────► P2 (Owner Call #1) ◄── P0
                                     │
                                 P2.5 Diagnose-Gate (Routing)
                                     │
                        ┌────────────┴───────────────┐
                        ▼ (Klassifikation A/Events)   ▼ (Provisioning-Spur, parallel)
                   P1a-FIX ──► P1b-FIX           PROV-1 ──► PROV-2
                   (seriell entlang Evidenz)     (SINGLE-WRITER provision.mjs)
                        │          │                   │
                        │          ├──────► P4 (voice.js, merge NACH P1b)
                        │          │
                        └────┬─────┴──────► GATE-MATRIX (test-only, nach P1a+P1b)
                             │                         │
                          WATCHDOG (nach P1a+P1b)      │
                             │                         │
                             └────────► P5 (Owner Live: Barge-in+Ela+Inbound) ◄── P4, PROV, WATCHDOG
                                             │
                                          P6 (Owner Drill + Contingency-Fix)
                                             │
                                          SEC-DOC (Doku, ab P1b/WATCHDOG parallel)
```

**Sequenziell zwingend:** INFRA-0 -> alles. P0/OBS-* -> SAFE-1 -> P2 -> P2.5 -> P1a-FIX -> P1b-FIX. Cutover-Weiterbau NIE vor P5. Fix-Phasen strikt seriell entlang der Evidenzkette; NUR Observability-Phasen duerfen parallel laufen ("keine Fix-Phase parallel zu ihrer Vorstufen-Fix-Phase").

**Echt parallel:** OBS-1 ‖ OBS-2 ‖ OBS-3 (disjunkte Dateien); P1a/P1b-Spur ‖ PROV-Spur ‖ P4 ‖ GATE-MATRIX (nach ihren dependsOn).

**Worktree-Kollisionsgefahr (Single-Writer-Ressourcen — nur EINE in-flight Phase darf editieren):**
- `scripts/telnyx-assistant-provision.mjs` + `test/telnyx-assistant-config.test.js` + `docs/RUNBOOK-TELNYX-ASSISTANT.md`: PROV-1, PROV-2 (und Teile von P4/GATE-MATRIX beruehren die Config-Test-Datei) -> strikt seriell PROV-1 -> PROV-2, `parallelizableWith` auf diesen Dateien entfernt.
- `src/server.js`: OBS-1 (Kommentar), OBS-3, WATCHDOG, P6-Contingency -> seriell, Merge im Lead dazwischen.
- `src/telnyx-llm-shim.js`: OBS-1, OBS-FLAG, P1b-FIX, WATCHDOG -> seriell.
- `src/telnyx-call-control-ingest.js`: OBS-2, P1a-FIX, WATCHDOG -> seriell.
- Env-Quartett `config.js` / `.env.example` / `render.yaml` / `test/helpers.js` (BASE_ENV): OBS-FLAG, PROV-2, WATCHDOG, GATE-MATRIX -> nur EINE in-flight Phase; jede neue Var vollstaendig an allen 4 Orten INNERHALB ihrer Phase (BASE_ENV-Drift-Landmine: sonst lokal rot / CI gruen).

---

## 6. Kill-Switch / Sicherheitsnetz

**Zwei Ebenen, beide bereits scharf und gegen den C-Telnyx-Branch getestet:**
- `TELNYX_AI_ASSISTANT_ENABLED=false` -> byte-identischer Rueckfall auf Budget/TeXML-Engine (Shim wird 404, Inbound-Handoff aus). Globaler Master-Schalter, kein Split-Brain zwischen In-/Outbound.
- `OUTBOUND_FROZEN=true` -> globaler Not-Aus vor der Origination-Verzweigung; blockt auch den C-Telnyx-Branch (Flag-Matrix in GATE-MATRIX/P6).

**Wie eine live regressierende Phase gestoppt wird:** Symptom im ueberwachten Fenster (P2/P5/P6) erkannt -> Flag AUS -> regulaerer Verkehr laeuft auf der Budget-Engine weiter. Regel-Verkehr laeuft ohnehin auf Budget-Engine (Flag nur in ueberwachten Fenstern AN), sodass eine tote C-Telnyx-Phase keine echten Kunden trifft.

**Ausdruecklich KEINE Rollback-Loesung:** Der Flag ist ein Sicherheitsnetz, das Zeit kauft, um die Ursache zu fixen — nicht der Zielzustand. Der Owner will diese Architektur funktionsfaehig, nicht abgeschaltet.

**Kritische Ehrlichkeit (Infra):** Auf FREE-Tier/1-Instanz loest JEDE Env-Aenderung (also auch der Kill-Flip) einen Redeploy aus, der in-flight Calls droppt (STATUS A6) und ein Cold-Boot-Fenster oeffnet. Der Kill-Switch ist damit **forward-only** — er schuetzt den NAECHSTEN Anruf, nicht den laufenden, und ist NICHT unterbrechungsfrei. P6 misst diese Drop-/Cold-Boot-Dauer und dokumentiert sie. Echter Zero-Downtime-Kill braucht Paid-Tier (INFRA-0) oder einen store-gebackenen Runtime-Flag ohne Redeploy (moegliche Folgephase, nicht in diesem Scope).

---

## 7. Uebergabe an die naechste Session

1. **Dieses Dokument ist die Wahrheitsquelle.** Jede Phase oben ist als EIN `phase-impl-lean`-Lauf geschnitten (Owner/Doku-Ausnahmen markiert). Nach Compaction/Session-Start: die genannten Quelldateien NEU lesen, nicht auf Zusammenfassungen verlassen.
2. **Reihenfolge:** INFRA-0 (Owner) und P0 (Owner) zuerst — ohne Telnyx-Zugang (Dashboard ODER Read-API-Key) bleibt jede Fix-Entscheidung blind; der Lead hat keinen Telnyx-MCP. Dann die Observability-Kette (OBS-1/2/3/FLAG) + SAFE-1 als Gate, deployen, P2 (ein ueberwachter Call), P2.5 Diagnose-Gate, dann die Fix-Phasen entlang der Klassifikation.
3. **Frische Session pro Phase** (Lean-Orchestrierung): `tasks/wf-phase-impl-lean.js`, Phase im per-run Skript HART pinnen (args-Misfire-Lehre), echten Git-Stand selbst pruefen. Lead bleibt duenn, liest keinen Code (<100k), Merge im Lead.
4. **Modell-Politik (bindend):** Subagenten NIE Fable erben lassen. Opus = Plan + Safety-Review; Sonnet = Impl/Audit/Fix/Report. Pins in jedem `agent()`-Call explizit.
5. **Pro Fix-Phase eigenes verify-before-fix-Gate:** Vorstufen-Observability deployt (`[boot]`-Banner-Commit per render-MCP/`get_service` pruefen, autoDeploy trotz `render.yaml:false` moeglich) + eigener ueberwachter Call. Plane offen 3-4 Testanrufe ein (Events -> Bearer -> ccid -> Final), nicht 1-2.
6. **Vor jedem Owner-gated Live-Lauf:** Telnyx-Guthaben (>>2 USD) + ElevenLabs-Paid-Guthaben re-checken; 402 ist ein stiller Killer, der als Code-Bug maskiert.
7. **Single-Writer + Env-Quartett** aus Abschnitt 5 beim Parallelisieren strikt beachten; `git stash` NIE waehrend `isolation:worktree`-Laeufen (Stash-Clobber-Lehre).
8. **Push/Deploy:** Live deployt UPSTREAM (`git push upstream master`), nicht origin allein; Deploy-Freeze (INFRA-0) waehrend der Remediation, manuelle Deploys nur in No-Call-Fenstern, Live-Commit per `[boot]`-Banner pruefen.