# PLAN-STABILIZE-LAUNCH.md — Master-Stabilisierung "Ich will endlich wieder anrufen"

> **Erstellt:** 2026-07-11 · **Methode:** 8-Stream-Fan-out-Workflow (5-Why + Pre-Mortem, adversarial gegengeprüft, 11 Agenten, ~960k Tokens) + Lead-Verifikation gegen echten Code und Render-Live-Logs.
> **Zweck:** Ein einziges, ehrliches Lagebild + ein phasenweises Umsetzungs-Skelett. Die nächste Session fährt **pro Phase einen `phase-impl-lean`-Workflow**, parallele Tracks gleichzeitig.
> **Wahrheitsquelle-Verweise:** `PLAN-TELNYX-ASSISTANT-REMEDIATION.md` (Assistant-Detail), Memories `telnyx-remediation-chain-state`, `suite-flake-p5-gate-proof-spawn-race`. Diese Datei ist der übergeordnete Fahrplan.

> **⚑ OWNER-DIREKTIVE (2026-07-11):** „Ich will eine richtige Lösung, es ist egal ob ich heute nicht telefonieren kann — mach deine beste Lösung, damit endlich alles funktioniert, robust für Millionen von Usern." → **Kein Zeitdruck, kein Pflaster.** Der Flag-Flip auf die Budget-Engine (Option A, §3) ist damit **degradiert zum reinen Notfall-Fallback** und NICHT der Plan. Ziel ist die **Wurzel-Lösung**: der AI-Assistant-Pfad (Hard-Barge-in) wird robust und evidenz-basiert repariert, alle Tracks werden auf Millionen-Skala-Robustheit gebaut. Der einzige externe Abhängigkeits-Engpass, den ich NICHT selbst schließen kann, ist die **Telnyx-Portal-Evidenz (P4)** — Telnyx-interne TTS/STT sind aus unserem Code prinzipiell unsichtbar.
>
> **⚑ TOOLING-BEFUND (2026-07-11):** Die render-MCP ist für Services **read-only** (`update_web_service` → „Updating a service directly is not supported"). P1/P2/P3 (autoDeploy, healthCheck, DB-Plan, Env-Flags) sind daher **Owner-Dashboard-Aktionen**; der Agent kann sie nicht ausführen, nur exakt anleiten und via `get_service`/`list_logs` **verifizieren**.

---

## 0. TL;DR — Was WIRKLICH kaputt ist (vs. Symptom)

Der Frust ist berechtigt, aber die Ursache ist **nicht** „alles ist kaputt". Es ist ein präzise benennbares Muster:

1. **Der Anruf schlägt fehl, weil ein NEUER, nie empirisch verifizierter Pfad live geschaltet wurde.** Der C-Telnyx-AI-Assistant-Pfad wurde in einen Live-Testanruf deployt, **ohne** je den External-LLM-Vertrag (was Telnyx sendet/erwartet), die Voice-Slot-Config, das ElevenLabs-Funding oder die Deepgram-Sprache **zu beobachten**. Fünf verschiedene unverifizierte Annahmen können **einzeln** exakt dasselbe Bild erzeugen: „Shim liefert `turn_ok`, aber der Anrufer hört nichts". Das ist die **tiefste Prozess-Wurzel** des Anruf-Problems — nicht ein einzelner Bug.

2. **Der bewährte Pfad ist intakt und EINEN Flag-Flip entfernt.** Die Budget-Engine (TeXML/Gather + ElevenLabs-Play-TTS) ist seit dem 06.07. (`ffb89c1`) **code-beweisbar unverändert**, strukturell an genau einer `if/else`-Weiche vom Assistant-Pfad getrennt (`server.js:1763`). `TELNYX_AI_ASSISTANT_ENABLED=false` stellt die Telefonierbarkeit **ohne Code-Risiko** wieder her — hörbar, nur ohne Hard-Barge-in.

3. **Das Widget-Problem ist NICHT das, was bisher vermutet wurde.** Die `ui://`-Resource wird bereits korrekt registriert (kein Stateless-Miss). Der First-Call-Fehler + Demo-Inhalt kommt aus einem **hand-gebauten MCP-Apps-Contract, der nie gegen den echten Host validiert wurde**, plus einem code-beweisbaren Strukturfehler: auf `tools/call` fehlt `params.capabilities` → immer der mcp-native Renderer (ist der Live-Host in Wahrheit ChatGPT, bekommt er nie seinen Adapter). „Pizza/Wetter" existiert **nicht in unserem Repo** → der Host zeigt seinen generischen Platzhalter, weil unser Widget nicht bindet.

4. **Das Branding ist KEIN Code-Bug mehr.** Alle vier Icon-Pfade sind live 200/valide. Es blieb jahrelang „ungefixt", weil **nie verifiziert wurde, was der Host tatsächlich empfängt** — es wurde blind am Code geschraubt statt der Host-Output erfasst. Weitere `icons[]`-Edits sind Aktionismus.

5. **Darunter liegen drei Infra-Zeitbomben**, die „ständig bricht was" **strukturell** verursachen: `hermes-db` (FREE) läuft **2026-07-24** ab (Total-Store-Verlust), `autoDeploy=yes` + `healthCheckPath=""` gekoppelt mit A6 (**jeder Push killt laufende Calls**), und Telnyx-Guthaben ~3,97 USD (402 = stiller Killer).

> **Das rote Muster hinter allem:** Es wurde wiederholt **gegen eine Blackbox geraten** (Assistant-Vendor-Config, MCP-Host-Verhalten, Connector-Icon-Quelle) statt **einmal den echten Output zu erfassen**. Das ist ein direkter Verstoß gegen CLAUDE.md „erst Runtime lesen, nie raten". Jeder Fix behob ein Symptom, das nächste tauchte auf, weil die Wurzel (fehlende Beobachtung der realen Schnittstelle) nie geschlossen wurde. **Dieser Plan dreht das um: Verify-First, dann fixen.**

---

## 1. Wie die nächste Session diese Datei benutzt

- **Ein `phase-impl-lean`-Workflow pro Code-Phase** (`tasks/wf-<phase>.js`, Phase im per-run-Skript **hart pinnen** — Lehre aus Memory `phase-impl-workflow-args`). Owner-Actions und Spikes laufen **nicht** als Code-Workflow.
- **Parallele Tracks** (siehe Abhängigkeitsgraph §4.0): Track C (Widget/Branding) und Track D (A6) sind **vollständig unabhängig** vom Call-Track und laufen gleichzeitig.
- **Absolute Regeln bleiben unantastbar** (CLAUDE.md): Safety-Gates (Regel 1), Offenlegungssatz als garantiert erster Satz (Regel 2), Auth fail-closed (Regel 3), Secrets/PII nie loggen (Regel 4). Jede Phase, die Calls/SMS/Auth/Budget berührt, ist automatisch nicht-trivial.
- **Gate-Protokoll (bindend, Memory `suite-flake-p5-gate-proof-spawn-race`):** Ein rotes `npm test`-Gate ist nur eine echte Regression, wenn es **isoliert** rot ist. `test/telnyx-p5-gate-proof.test.js` „Gate 11 Budget 402" ist ein bekannter ~12%-Spawn-Race-Flake → re-run statt Self-Fix-Runde verbrennen.
- **Deploy-Regel:** `git push upstream master` deployt live (Memory `deploy-repo-split`). Deploys **nur im No-Call-Fenster** (bis P1 gebaut ist, killt jeder Push laufende Calls — A6). Live-Commit per `[boot]`-Banner prüfen.
- **Subagenten-Modell-Politik** (Memory `workflow-model-policy`): NIE Fable erben lassen. Opus = Plan/Safety-Review, Sonnet = Impl/Audit/Fix/Report — in jedem `agent()`-Call explizit pinnen.
- **Owner-Testanruf-Ökonomie:** Pro Assistant-Fix genau **ein** überwachter Owner-Testanruf — aber **erst nachdem die Vendor-Evidenz (P4) vorliegt**, sonst wird der Anruf verbrannt, während die Vendor-Config evtl. noch kaputt ist.

---

## 2. Evidenz — die Grundlage (NICHT neu untersuchen)

### 2.1 Verify-Call-Zeitleiste (Render-Logs, `call_mrgnucvyttaz`, 2026-07-11, PII-frei)

```
17:50:40.313  originateViaCallControl ok 200
17:50:45.804  call.answered
17:50:46.065  Disclosure-Speak (AZURE) abgesetzt
17:50:56.056  speak.ended completed        <- Disclosure dauerte ~10 s
17:50:57.411  startAssistant ok 200        <- AI-Assistant übernimmt (STT+LLM-Shim+TTS Telnyx-intern)
17:51:01.197  Turn1  llm success  tools=[]        (~4 s nach Start)
17:51:03.151  Turn2  llm success  tools=[]        (+2 s)
17:51:05.848  Turn3  llm success  tools=["end_call"]   (+2 s)  <- Claude legt auf
17:51:06.145  call.hangup
17:51:07.507  Turn4  llm success           (feuert NOCH nach hangup)
```
Owner hörte **keine** KI-Antwort. Nach `ai_assistant_start` **kein** `[telnyx/voice] speak` mehr — **das ist by-design** (nur die Offenlegung läuft über unseren Speak-Node; danach spricht Telnyx-intern). **Fehlspur, kein Bug.**

### 2.2 Der EINE entscheidende Diskriminator (stumm: unser Format vs. Vendor)

`agentTurn.speech` ist **nie leer** (`claude.js:452-453` Fallback). Daraus folgt zwingend:
- **Leere** `role:'assistant'`-Message in den Telnyx-Conversation-Insights → **Parse-Drop unseres Formats** (unser Code, low-risk fixbar, → P6).
- **Nicht-leere** assistant-Message mit unserem Text → Stille liegt **eindeutig am TTS/Vendor** (ElevenLabs-402 / Voice-Slot / Deepgram, → P4 Owner-Evidenz).

**Dieser eine Read entscheidet die ganze Verzweigung und MUSS vor jedem Assistant-Code-Fix erhoben werden.**

### 2.3 Code-beweisbare Wurzeln (mit Datei:Zeile — bereits verifiziert)

| # | Wurzel | Beleg | In unserer Kontrolle |
|---|--------|-------|:---:|
| R1 | Budget-Engine intakt + an 1 Weiche getrennt; Flip=false = telefonierbar | `server.js:1763` (Outbound), `:1066` (Inbound-Handoff, fail-safe→TeXML); unverändert seit `ffb89c1` | ✅ |
| R2 | `suppressEndCall` ist **content-blind** — prüft nur Existenz einer `caller`-Zeile, nicht substanzielle Sprache; eine Echo-Zeile deaktiviert den Frühauflege-Schutz | `claude.js:380-381` | ✅ |
| R3 | Assistant-Pfad **ohne Empty-Turn-Semantik** — erbt Gather-Prompt („schließe ab, wenn Gegenüber nicht mitmacht"); Budget-Engine WARTET via `<Gather>`, Assistant-Pfad hat diese Pause-Semantik nicht | `claude.js:115` + fehlender Guard | ✅ |
| R4 | Bootstrap-User-Message **re-injiziert bei jedem Leer-Turn** (Bedingung „letzte Zeile != user" statt „noch keine agent-Zeile") → widersprüchliches „beginne"-Signal | `claude.js:365-373` | ✅ |
| R5 | **Disclosure/Goal-Vertragsbruch** — `onAnswered` spricht NUR die Disclosure, `systemPrompt` behauptet aber, das Anliegen sei bereits gesprochen → hörbares, aber sinnloses Gespräch | `telnyx-call-control-ingest.js` onAnswered vs. `claude.js:114` | ✅ |
| R6 | **Observability-Lücke am Vendor-Boundary** — `turn_ok` loggt nur `callId+latencyMs`; „Sprach Telnyx?" ist aus unseren Logs unbeweisbar (Enabling-Root der Ambiguität, nicht die Ausfall-Ursache) | `telnyx-llm-shim.js:115-117,284` | ✅ |
| R7 | Widget: **kein** Stateless-Resource-Miss — `enableWidgetUi` registriert eager pro POST | `mcp-tools.js:305-309`, `server.js:2452/2463` | ✅ |
| R8 | Widget: auf `tools/call` fehlt `params.capabilities` → `capabilityDeclaresChatgptUi=false` → **immer** mcp-native Renderer (ChatGPT-Adapter strukturell unerreichbar) | `server.js:2451`, `registry.js:29` | ✅ |
| R9 | Branding: **kein Code-Bug** — icons[0] data-URI valide, icons[1] `app.sundartha.com` 200, favicon.ico/svg 200/Flügel; Wurzel ist Prozess (Host-Output nie verifiziert) | `mcp-server-info.js`, live-curl | ✅ (nichts zu fixen) |
| R10 | Infra-Zeitbomben: `hermes-db` FREE `expiresAt=2026-07-24`; `autoDeploy=yes` + `healthCheckPath=""` ↔ A6; Telnyx-Guthaben ~3,97 USD | Render-MCP live | ✅ (Owner) |

### 2.4 Braucht Owner-/Telnyx-Evidenz (aus unserem Code UNBEWEISBAR)

- **E1 — Stille-Ursache:** leere vs. nicht-leere assistant-Message in den Conversation-Insights (§2.2).
- **E2 — Stream-Richtung:** sendet Telnyx im `/v1/chat/completions` `stream:true` oder `false`? Loggt es einen Parse-Fehler/leeren Content?
- **E3 — Akustisches Echo (starke unifizierende Hypothese):** transkribiert Deepgram die 10-s-Azure-Disclosure als Anrufer-Sprache? Das erklärt **simultan** die spurious `caller`-Zeile (hebelt R2), den 2-s-Turn-Takt **und** die degenerierte Eingabe (→ frühes `end_call`). Prüfbar über Transkript-Timing (Überlappung mit 17:50:46–56).
- **E4 — Deepgram-Sprache:** steht STT am Assistant auf `de` oder fälschlich `en`?
- **E5 — ElevenLabs-Funding:** Plan/Guthaben/402 des Keys hinter Telnyx-Secret `elevenlabs_prod` (NICHT der Budget-Engine-Key) zur Call-Zeit.
- **E6 — Assistant-Config-Read-Back:** GET auf `TELNYX_ASSISTANT_ID`: `voice_settings.voice`, `api_key_ref`-Name, `greeting`, `external_llm.forward_metadata==true`, `interruption_settings.enable==true` — jede Zeile gegen `buildAssistantConfig` diffen.
- **E7 — Widget-Host:** `MCP_UI_ENABLED` live-Wert; welcher Host (Claude-nativ vs. ChatGPT-skybridge); iframe-DevTools beim 1. Mount (`result` vs. JSON-RPC-`error` auf `ui/initialize`, ausgehandelter `protocolVersion`).
- **E8 — Icon-Quelle:** Connector remove+re-add → Screenshot (trennt Add-Snapshot vs. Live; ein zweiter Diskriminator für icons-vs-Favicon-Herleitung nötig).

---

### 2.5 P4-Evidenz BEREITS ERHOBEN (Browser, Telnyx+ElevenLabs-Portal, 2026-07-11)

Der Agent hat die Telnyx-/ElevenLabs-Portale selbst inspiziert (via Chrome-Extension). Ergebnis — die „stumm"-Diagnose verschiebt sich deutlich:

**Telnyx-Assistant „Hermes" (`assistant-dcf48d08-1d4e-4673-ab94-2681b22d26d4` = TELNYX_ASSISTANT_ID) — Config ist WEITGEHEND KORREKT:**
- Custom LLM aktiv → unser Shim: Base URL `https://vodafone-agent.onrender.com/v1`, Auth=Token, Key-Ref `hermes_shim_secret`, Model `claude-haiku-4-5`, **Forward Metadata = AN** (erklärt die ccid via `extra_metadata`, konsistent mit dem Fix).
- **Voice = ElevenLabs / Key-Ref `elevenlabs_prod` / Model `eleven_flash_v2_5` / Voice „Ela – Empathetic & Warm"** — löst im UI SAUBER auf (kein Slot-/Casing-Fehler). → **Hypothese „Voice-Slot-Drift" WIDERLEGT.**
- **Greeting Mode = „Assistant waits for user"** ← NEU & WICHTIG: der Assistant spricht NICHT proaktiv. Nach der 10-s-Azure-Disclosure wartet er still auf den User. Der Owner wartete vermutlich auch → **stiller Standoff** (kein TTS-Hardfehler nötig, um „nichts gehört" zu erklären).
- Instructions = Platzhalter (Logik im Shim, wie designt); keine Telnyx-seitigen Tools; Langfuse-Tracing aus.

**ElevenLabs-Account „ElevenAgents" (hält den Key hinter `elevenlabs_prod`):**
- Request-Log letzte 7 Tage: **nur Codes 200 / 204 / 404 — KEIN 402 / 429 / 5xx.** Usage: 2.51K Credits verbraucht, Aktivität um den 11.07. → **ElevenLabs ist NICHT durch 402/Guthaben blockiert.** Hypothese „ElevenLabs-402" deutlich GESCHWÄCHT. *(Caveat: Log ist auf „eigene Aktivität" gefiltert — ein separater Telnyx-Key-User würde ggf. nicht erscheinen; Rest-Unsicherheit klein, aber nicht null.)*

**Konsequenz für die Diagnose (aktualisierte Leithypothese der „Stille"):**
Weniger „TTS-Hardfehler/402", mehr **UX-/Logik-Standoff**: Disclosure (Azure, 10 s) → Assistant wartet still (Greeting Mode) → STT triggert auf Echo/Noise/„Hallo?" → 3 schnelle Turns → content-blinder `suppressEndCall` + degenerierte Eingabe → `end_call` nach 9 s. Die **in-our-control-Fixes rücken damit in den Vordergrund**: (a) Greeting/Opening-Handoff (der Assistant ODER unser Opening-Speak MUSS nach der Disclosure aktiv sprechen statt still zu warten — P8 erweitern), (b) Turn-/end_call-Härtung (P7), (c) spec-konformer Stream als Format-Absicherung (P6). Der Restzweifel „hat Telnyx pro Turn wirklich synthetisiert?" bleibt am sichersten über die **Telnyx-Conversation-Transkripte** klärbar (Portal-UI für vergangene Calls nicht gefunden; nächster Zugriff: Langfuse-Tracing aktivieren ODER ein überwachter Test mit Live-Mitschnitt).

**Offene Owner-/Konto-Fakten (klein):** Ob der in `elevenlabs_prod` hinterlegte Key wirklich zum Account „ElevenAgents" gehört (Wert ist maskiert, nicht ausgelesen) — Secret-Parität nur „stimmt: ja/nein" prüfen.

## 3. Die strategische Weiche (OWNER-ENTSCHEIDUNG — Gate für Track A)

**Frage:** Sofort auf die bewährte Budget-Engine zurück (heute telefonierbar, kein Hard-Barge-in) — oder am AI-Assistant-Pfad weiterfixen (Barge-in-Launch-Pflicht, mehr Unbekannte, Vendor-Evidenz nötig)?

| | **Option A — Flag-Flip JETZT** | **Option B — Assistant weiterfixen** |
|---|---|---|
| Aktion | `TELNYX_AI_ASSISTANT_ENABLED=false` | spec-konformer Stream, Guards, Watchdog, dann scharf |
| Telefonierbar | **Heute, in Stunden** | Tage (nach Owner-Evidenz + Fixes) |
| Hard-Barge-in | Nein (Telnyx-Gather-Grenze) | Ja (Launch-Ziel) |
| Code-Risiko | **Nahezu null** (Laufzeit-Flag, byte-identischer bewährter Pfad) | mittel |
| Blocker | keiner | Stille-Wurzel ohne Owner-Portal-Zugriff **unabschließbar** |

**ENTSCHEIDUNG GETROFFEN (Owner, 2026-07-11): Option B — die Wurzel-Lösung.** „Es ist egal ob ich heute nicht telefonieren kann, mach deine beste Lösung, robust für Millionen." Der AI-Assistant-Pfad (Hard-Barge-in) wird richtig repariert; Track A (Flag-Flip) ist **nur noch der Notfall-Fallback**, falls eine Demo/ein Notruf zwischendurch unbedingt telefonieren muss.

**Was das für die Umsetzung heißt:**
- **Track A wird NICHT proaktiv ausgeführt.** Der Budget-Pfad bleibt als jederzeit ziehbarer Notausgang dokumentiert (ein Env-Flag), aber er ist nicht das Launch-Ziel.
- **Track B ist der Kern** und wird nach Industriestandard gebaut: erst Evidenz (P4), dann robuste Fixes mit Tests, dann ein überwachter Verify-Anruf. Kein Scharfstellen vor der Evidenz.
- **Millionen-Skala-Bar:** Jede Phase baut Seams/Guards, die Last tragen (Watchdog/Loop-Guard als Kosten-Notaus, A6-Draining, PII-sichere Observability, Config-Read-Back statt blindem Provisioning) — kein Wegwerf-Code.
- **Der einzige echte externe Engpass ist P4** (Telnyx-Portal-Evidenz). Er ist Voraussetzung, um die „stumm"-Achse abzuschließen — aber die „Selbst-Terminierung"-Achse (P7/P8), die Observability (P5), der spec-konforme Stream (P6, handhabt BEIDE stream-Modi robust), die Durability (P10) und der ganze User-facing-Track (P11–P13) sind **ohne** P4 baubar und laufen sofort parallel.

> **Notfall-Fallback (nur falls zwischendurch zwingend telefoniert werden muss):** `TELNYX_AI_ASSISTANT_ENABLED=false` im Render-Dashboard (No-Call-Fenster) → Budget-Engine. Kein Code-Rollback, jederzeit reversibel. Nicht Teil des Haupt-Fahrplans.

---

## 4. Die Phasen

### 4.0 Abhängigkeitsgraph & Parallelität

```
TRACK 0 (Infra/Safety — ZUERST, Owner):   P1 ─┐        P2 (parallel zu P1)
                                                │
TRACK A (Call jetzt — Owner-Gate §3):           └─▶ P3  (braucht P1 + Owner-Ja)

TRACK B (Assistant — evidenz-gegatet):     P4 (Owner-Spike) ─┬─▶ P6 ─┐
                                            P5 (lean, jetzt) ─┤       ├─▶ P9 (Watchdog)
                                            P7 (lean, jetzt) ─┤       │
                                            P8 (lean, jetzt) ─┘       │
                                                    (scharfstellen erst NACH P4-Evidenz)

TRACK C (User-facing — parallel):          P11 (Spike) ─▶ P12 (lean)   ·   P13 (Owner, unabhängig)

TRACK D (Dauerhaftigkeit — parallel):      P10 (lean, unabhängig)
```

**Sofort parallel startbar (kein echter Anruf nötig):** P1, P2, P5, P7, P8, P10, P11, P13.
**Gate-abhängig:** P3 (P1 + Owner-Ja) · P6/P9 (P4-Evidenz) · P12 (P11-Trace).

---

### TRACK 0 — Infra/Safety (Owner, ZUERST)

#### P1 — Deploy-Sicherheit scharfstellen
- **Typ:** owner-action · **dependsOn:** — · **parallel:** ja
- **Ziel:** Verhindern, dass ein Push (inkl. des Flag-Flips selbst) einen laufenden Call killt.
- **Tasks:** **Owner im Render-Dashboard** (`…/web/srv-d8m0fhflk1mc73bno570/settings` — render-MCP ist für Services read-only, bestätigt 2026-07-11): `Auto-Deploy = Off`, `Health Check Path = /healthz`. Der Agent **verifiziert** danach per `get_service` (NICHT `render.yaml` vertrauen — Dashboard-managed) + `list_deploys` (kein ungewollter Deploy). Prozessregel: Deploys nur manuell im No-Call-Fenster.
- **Acceptance:** `get_service` → `autoDeploy:'no'` UND `healthCheckPath:'/healthz'`; `curl /healthz` live 200. (Reproduzierbar ohne Anruf.)
- **Risiko:** Der Umstellungs-Redeploy selbst muss ins No-Call-Fenster (A6).

#### P2 — hermes-db vor 2026-07-24 retten
- **Typ:** owner-action · **dependsOn:** — · **parallel:** ja
- **Ziel:** Total-Store-Verlust (Calls, Numbers, `tenant_budget`, `subIndex`) am Ablaufdatum abwenden — betrifft **beide** Engines.
- **Tasks:** Manuelles Backup ziehen (Netz). `hermes-db` auf Paid heben ODER auf frische Paid-Instanz migrieren, `DATABASE_URL` updaten. Off-Repo-Reminder für künftige Render-Ablaufdaten.
- **Acceptance:** `get_postgres` → `plan!='free'` bzw. neue Paid-Instanz ohne Ablaufzwang; Backup-Artefakt existiert **vor** der Migration; Boot-Banner nach Swap grün.
- **Risiko:** Connection-String-Swap = kurze Downtime; Datenverlust ohne vorheriges Backup.

---

### TRACK A — Notfall-Fallback (NICHT proaktiv ausführen; §3-Entscheidung = Wurzel-Lösung)

#### P3 — [FALLBACK] Budget-Engine per Flag ziehen — nur im Notfall
- **Typ:** owner-action · **dependsOn:** P1 + akuter Bedarf · **parallel:** ja
- **Ziel:** Notausgang, falls zwischendurch zwingend telefoniert werden muss. **Kein Bestandteil des Haupt-Plans** (Owner: „egal ob heute nicht telefonierbar"). Kein Hard-Barge-in.
- **Tasks:** `TELNYX_AI_ASSISTANT_ENABLED=false` im Render-Dashboard (nur No-Call-Fenster — löst Redeploy aus). Prüfen, dass `ELEVENLABS_PLAY_TTS_ENABLED/API_KEY/VOICE_ID` der Budget-Engine gesetzt sind (sonst Azure-Fallback, non-blocking). Ein Owner-Testanruf; Render-Logs auf `[play-tts] Synth fehlgeschlagen` prüfen (Ela vs. Azure).
- **Acceptance:** **Lokal ohne echten Anruf reproduzierbar:** Server mit `TELNYX_AI_ASSISTANT_ENABLED=false` → Outbound rendert TeXML/Gather, **kein** `originateAiAssistantCall` (Log/curl). `npm test` grün, Boot grün. Owner-Testanruf: KI hörbar.
- **Risiko:** A6 (Flip-Redeploy killt aktiven Call → striktes No-Call-Fenster); Telnyx-Guthaben-Puffer (402 killt Origination still).

---

### TRACK B — Assistant-Pfad (evidenz-gegatet, für Hard-Barge-in)

> **Zwei getrennte Achsen NICHT vermischen:** „stumm" (Output/TTS) und „Selbst-Terminierung" (Turn/`end_call`) können **verschiedene** Wurzeln haben. Ein TTS-Fix behebt das frühe `end_call` nicht und umgekehrt.

#### P4 — Vendor-Evidenz erheben (Format-vs-TTS-Diskriminator) ⭐ GATE
- **Typ:** spike/analyse (Owner liefert Portal-/API-Fakten) · **dependsOn:** — · **parallel:** ja
- **Ziel:** Die ambige Stille-Wurzel VOR jedem Assistant-Final-Fix klären.
- **Tasks (Owner):** E1 (Insights: leere vs. nicht-leere assistant-Message), E2 (stream true/false + Parse-Fehler), E3 (Deepgram-Timing vs. Disclosure = Echo-Verdacht), E4 (STT-Sprache), E5 (ElevenLabs-Usage/402 auf `elevenlabs_prod`), E6 (Assistant-GET-Read-Back diffen).
- **Acceptance:** Dokumentierte Antwort auf den Diskriminator (§2.2); Assistant-Config gegen `buildAssistantConfig` gediffed; klar: Stille bei uns (Format) oder Vendor (402/Voice/Echo).
- **Risiko:** Ohne diese Evidenz verbrennt jeder Assistant-Testanruf.

#### P5 — PII-sichere `messages`-Shape + `speechEmpty`-Diagnose
- **Typ:** phase-impl-lean · **dependsOn:** — · **parallel:** ja (Flag-off = byte-identisch, **jetzt** baubar)
- **Ziel:** Aus UNSEREN Logs „Brain lieferte leeren Text" von „Vendor sprach nicht" trennbar machen — ohne PII.
- **Tasks:** Unter bestehendem default-off-Flag `TELNYX_SHIM_DEBUG_SHAPE`, hinter Bearer-Gate, additiv: `messagesCount`, Rollen-Zählung, letzte-user `contentType`+Länge, `lastUserTextPresent`, `speechEmpty=(turn.speech.length===0)`. Niemals Werte loggen; durch SAFE-1-Leak-Guard absichern.
- **Dateien:** `src/telnyx-llm-shim.js`, `test/telnyx-llm-shim*.test.js`, SAFE-1-Guard-Test.
- **Acceptance:** `node:test` — Flag on emittiert exakt Booleans/Shape, KEIN Text/E.164/Secret; SAFE-1-Guard grün; Flag off → byte-identisch (curl-Smoke).
- **Risiko:** Transkript-/PII-Leak → SAFE-1-Guard ist Pflicht-Gate (Memory `rca-lessons-timezone-and-fixtures`: Agenten-Reports vor Commit auf PII scannen).

#### P6 — `writeFakeStream` OpenAI-spec-konform
- **Typ:** phase-impl-lean · **dependsOn:** P4 (Evidenz E1/E2) · **parallel:** ja
- **Ziel:** Den plausiblen Parse-Drop (content+`finish_reason` im selben Chunk, kein `role`-Delta, `req.body.stream` nie gelesen) als Ursache ausschließen — low-risk.
- **Tasks:** `req.body.stream` honorieren: `false` → plain JSON `chat.completion` (`message.role/content`); `true` → `role`-Chunk, dann content-Chunk(s), dann separater `finish_reason`-Chunk, dann `[DONE]`.
- **Dateien:** `src/telnyx-llm-shim.js`, Shim-Tests.
- **Acceptance:** `node:test` — SSE-Sequenz UND JSON-Branch-Shape assertiert; bestehende Shim-Tests grün; reproduzierbar via curl gegen den Shim-Endpoint (kein echter Anruf).
- **Risiko:** Falls Telnyx laut P4 `stream:false` erwartet, ändert ein reiner SSE-Fix nichts → **P4-Evidenz zuerst**.

#### P7 — Empty-Turn-Guard + content-basierter `suppressEndCall` + gebundener Bootstrap
- **Typ:** phase-impl-lean · **dependsOn:** — · **parallel:** ja (**jetzt** baubar)
- **Ziel:** Frühes/falsches `end_call` im Assistant-Pfad verhindern; Selbst-Terminierung von der Stille-Achse entkoppeln.
- **Tasks:** (a) Leerer/whitespace `callerText` nicht sofort als „Gegenüber macht nicht mit" werten; erst nach N konsekutiven echten Leer-Turns abschließen. (b) `suppressEndCall` content-basiert statt nur „caller-Zeile existiert" (substanzielle Äußerung erforderlich, entschärft R2 + Echo-Verdacht E3). (c) Bootstrap-User-Message an echten Erst-Turn-Zustand binden (nur wenn noch KEINE agent-Zeile), nicht „letzte Zeile != user" (R4).
- **Dateien:** `src/claude.js` (Turn-Logik, `agentTurn`), `test/*claude*` / neue Turn-Tests. **NUR Turn-Logik — Gates (Regel 1) und Disclosure (Regel 2) unberührt.**
- **Acceptance:** `node:test` — spurious/Echo-caller-Zeile gibt `end_call` NICHT frei; Bootstrap feuert genau einmal; Leer-Turn triggert kein `end_call` vor Schwelle. Alles ohne echten Anruf.
- **Caller-Regression-Check (CLAUDE.md „Vor Edits"):** `agentTurn` wird von Budget-Engine UND Shim genutzt — beide Aufrufer testen, Inbound byte-identisch halten.

#### P8 — Anliegen-Vertrag im Assistant-Pfad reparieren
- **Typ:** phase-impl-lean · **dependsOn:** — · **parallel:** ja (**jetzt** baubar; nur relevant bei `call.goal!=leer`)
- **Ziel:** `systemPrompt`-Behauptung („Anliegen wurde gesagt") mit dem tatsächlich Gesprochenen in Einklang bringen (R5).
- **Tasks:** Assistant-Pfad `onAnswered` auf `openingText(call)` (Disclosure+Goal-Brücke) umstellen ODER `systemPrompt` pfadabhängig über ein „goal-gesprochen"-Flag am `call` machen. Contract-Test: bei `call.goal!=leer` wird das Goal VOR dem 1. LLM-Turn gesprochen; Disclosure bleibt erster Satz.
- **Dateien:** `src/telnyx-call-control-ingest.js`, `src/claude.js` (systemPrompt), Contract-Test.
- **Acceptance:** `node:test` — Opening-Speak-Node enthält Goal-Brücke bei gesetztem `call.goal`; **Regel 2:** Disclosure byte-identisch als allererster Satz (Test). Kein echter Anruf.
- **Risiko:** Regel 2 unantastbar.

#### P9 — Dead-Air-/Loop-Watchdog nach `ai_assistant_start`
- **Typ:** phase-impl-lean · **dependsOn:** P4, P5 (Schwellen kalibrieren) · **parallel:** ja
- **Ziel:** Stille TTS-Fehlfunktion und Re-Prompt-Leerlauf-Loops erkennen und den Call kontrolliert beenden (Kosten-Notaus).
- **Tasks:** Zeit-/Event-Watchdog: „keine weiteren Telnyx-Events für N s nach `ai_assistant_start`" als Proxy für stille TTS → kontrollierte Terminierung. Per-Conversation-Loop-Guard (max. Turns bei ausbleibendem realem User-Input) zusätzlich zum per-Minute-Rate-Limiter.
- **Dateien:** `src/telnyx-call-control-ingest.js` / `src/telnyx-llm-shim.js`, Tests.
- **Acceptance:** `node:test` — Watchdog feuert nach N s ohne Event; Loop-Guard greift bei M Leer-Turns/Fenster; keine Fehlauslösung im normalen Fluss.
- **Risiko:** Zu aggressiv killt legitime langsame Turns → N/M evidenz-basiert aus P4/P5 kalibrieren.

---

### TRACK C — User-facing (parallel, unabhängig vom Call-Track)

#### P11 — Widget: Host-Trace erheben BEVOR Code angefasst wird ⭐ GATE
- **Typ:** spike/analyse · **dependsOn:** — · **parallel:** ja
- **Ziel:** Eine Evidenz kollabiert 4–5 Widget-Hypothesen gleichzeitig (Verify-First, CLAUDE.md).
- **Tasks:** `curl /mcp initialize` live: enthält `capabilities.extensions['io.modelcontextprotocol/ui']` + mimeType `text/html;profile=mcp-app`? Render-Env `MCP_UI_ENABLED` live prüfen (**ist er false, sind ALLE anderen Widget-Findings gegenstandslos**). Host bestimmen (Claude-nativ vs. ChatGPT — auf stateless `tools/call` trägt `params.capabilities` nichts → immer mcp-native, R8). Owner: iframe-DevTools/Console beim 1. Mount (`result` vs. JSON-RPC-`error` auf `ui/initialize`, welcher `protocolVersion`). Render-`[mcp]`-Log: Methoden-Sequenz fehlschlagender vs. gelingender Render.
- **Acceptance:** Dokumentiert: `MCP_UI_ENABLED`-Wert, Extension y/n, Host-Identität, initialize-`result`-vs-`error`, ausgehandelter `protocolVersion`. Entscheidung: Ursache bei Flag/Host-Mismatch (R8) oder Contract-Key (→ P12).
- **Risiko:** Ohne echten Host-Trace bleibt jeder Widget-Code-Fix Raten.

#### P12 — Widget-Binding robust + Contract gegen Live-Host gepinnt
- **Typ:** phase-impl-lean · **dependsOn:** P11 · **parallel:** ja
- **Ziel:** First-Call-Fehler beheben, sobald der reale Contract bekannt ist.
- **Tasks:** `toolMeta` zusätzlich in den `tools/call`-Handler-Return spiegeln (EINE Quelle: Definition UND Result tragen die Bindung). Handshake-Toleranz: mehrere `protocolVersion` akzeptieren; tool-result auch ohne vorheriges initialize-result binden (fail-open **nur Anzeige**). Beide `_meta`-Konventionen additiv mitsenden (ignore-if-unknown); bestätigte Keys/mimeType aus P11 in `contract.js` pinnen.
- **Dateien:** `src/mcp-tools.js`, `src/ui/contract.js`, `src/ui/widget-bind.js`, `src/server.js` (uiServerExtension), UI-Tests.
- **Acceptance:** `node:test` — `tools/call`-Result trägt `_meta.ui.resourceUri`; Handshake akzeptiert alternative `protocolVersion`; beide Namespaces im `_meta` präsent. Ohne echten Anruf reproduzierbar.
- **Risiko:** Falscher gepinnter Key/mimeType defeatet die ganze Kette → **nur pinnen, was P11 belegt**.

#### P13 — Branding: Icon-Quelle empirisch klären (KEIN Code)
- **Typ:** owner-action · **dependsOn:** — · **parallel:** ja
- **Ziel:** Die jahrelang unbehobene Icon-Frage über den einzig aussagekräftigen Test klären — **nicht** wieder am Code schrauben (R9: Code ist sauber).
- **Tasks:** Connector in claude.ai komplett entfernen + neu hinzufügen, sofort Icon-Screenshot. Flügel erscheint → Add-Zeitpunkt-Snapshot war die Wurzel (nur Nutzer-Kommunikation). Bleibt Default → Google-Favicon-Cache über Tage per curl nachbeobachten; abschließend via Anthropic klären, ob `serverInfo.icons` überhaupt konsumiert wird. **KEINE Edits an `icons[]`/`BRAND_ASSETS_PREFIX`/favicon.**
- **Acceptance:** Screenshot entscheidet Snapshot-vs-Live; dokumentierte Icon-Quelle.
- **Risiko:** Remove+Re-Add trennt nur Snapshot-vs-Live, NICHT icons-vs-Favicon-Herleitung → ggf. zweiter Diskriminator nötig.

---

### TRACK D — Dauerhaftigkeit (parallel)

#### P10 — A6: Call-State-Rehydrate + Reconcile-Schutz + Deploy-Draining
- **Typ:** phase-impl-lean · **dependsOn:** — · **parallel:** ja
- **Ziel:** Deploys töten laufende Calls nicht mehr — schützt **beide** Engines dauerhaft (Millionen-Skala-Fundament).
- **Tasks:** Read-through-Rehydrate des Call-State im Webhook-Pfad aus dem Store. Reconcile-Flush darf aktive Call-Rows NICHT löschen. Deploy-Draining für aktive Calls.
- **Dateien:** `src/telnyx-call-control-ingest.js`, `src/store/*`, `src/process-guards.js`, Tests.
- **Acceptance:** `node:test` — Call-Row überlebt simulierten Instanzwechsel (Rehydrate aus Store); Reconcile-Flush löscht aktiven Call nicht. Kein echter Anruf (Simulation).
- **Risiko:** Falscher Rehydrate hydriert `tenantId` nicht → **bekannte Landmine I8 → CASCADE-Löschung** (Memory `i8-design-decisions`); Test MUSS `tenantId`-Hydration abdecken.

---

## 5. Globaler Pre-Mortem (1 Jahr später — der Plan ist gescheitert)

| Szenario | Ursache | Mitigation |
|---|---|---|
| **Kosten explodieren** (Tokens + Minuten) | Assistant-Pfad wieder scharf ohne Watchdog/Loop-Guard; nicht-kanonischer Stream → Telnyx re-promptet im 2-s-Takt, jeder Turn kostet | Option A hält Assistant off bis P4-Evidenz + P9; Mid-Call-Kill Pflicht; per-Conversation-Loop-Guard; Telnyx-Guthaben-Puffer + Auto-Recharge |
| **Jemand wird fälschlich angerufen** | Refactoring der Turn-/Prompt-Logik weicht Outbound-Gates auf oder ändert Disclosure | Regel 1/2 unantastbar; P7/P8 fassen NUR Turn-Logik/Opening an; Contract-Test Disclosure byte-identisch erster Satz; Allowlist/Verifikation (Abo+KYC) unberührt |
| **Transkript-/PII-Leak** über neue Observability | P5 `messages`-Shape-Log gibt versehentlich Text/E.164/Secret aus | Nur Booleans/Counts/Typ+Länge; default-off-Flag + Bearer-Gate; SAFE-1-Guard Pflicht-Test; Reports vor Commit auf PII scannen |
| **Total-Store-Verlust am 2026-07-24** | `hermes-db` FREE läuft ab, kein Backup | **P2 sofort:** Backup + Paid/Migration VOR dem Datum; Off-Repo-Cron-Reminder für alle Render-Ablaufdaten |
| **Deploy killt laufenden (Test-)Call** | `autoDeploy=yes` + A6-Lücke; hochfrequente Fix-Pushes während Verify-Anrufen | **P1 ZUERST** (autoDeploy=no + healthCheck); Deploys nur No-Call-Fenster; P10 als dauerhafte Absicherung (mit `tenantId`-Hydration gegen CASCADE) |
| **Testanruf verbrannt**, weil Code-Fix vor Vendor-Evidenz | Assistant-Fixes scharfgestellt, während ElevenLabs-402/Voice-Slot/Deepgram noch kaputt | **P4-Evidenz-Gate** vor Scharfstellen; Diskriminator (§2.2) VOR jedem Code-Fix lesen; zwei Achsen getrennt gaten |
| **Widget/Branding-Churn geht weiter** | Weiter gegen die Blackbox raten statt Host-Trace erfassen | P11/P13 sind **Verify-First** BEVOR Code angefasst wird; Branding-Code ist sauber → keine `icons[]`-Edits ohne neue Evidenz |

---

## 6. Owner-Action-Items (konsolidiert, priorisiert)

**JETZT (blockiert alles / verhindert Katastrophe) — alle im Render-Dashboard, Agent verifiziert nur:**
1. **P1:** No-Call-Fenster → `Auto-Deploy = Off` + `Health Check Path = /healthz` auf `srv-d8m0fhflk1mc73bno570` (Dashboard-Settings). Agent verifiziert per `get_service`.
2. **P2:** `hermes-db` manuelles Backup ziehen UND vor **2026-07-24** auf Paid heben/migrieren (`DATABASE_URL` updaten, Boot grün prüfen); Off-Repo-Reminder anlegen.
3. *(Entfällt als Plan-Schritt — §3-Entscheidung = Wurzel-Lösung.)* **P3 nur im Notfall:** `TELNYX_AI_ASSISTANT_ENABLED=false` → Budget-Engine, falls zwischendurch zwingend telefoniert werden muss.

**Vendor-Evidenz für Track B (P4 — der EINE entscheidende Read zuerst):**
4. Telnyx-Conversation-Insights für `call_mrgnucvyttaz`: **leere vs. nicht-leere** `role:'assistant'`-Message (§2.2 Diskriminator).
5. Telnyx: `stream:true/false` im `/v1/chat/completions`? Parse-Fehler/leerer Content geloggt?
6. Telnyx/Deepgram: Anrufer-Transkript-Timing — Überlappung mit der 10-s-Disclosure (Echo-Verdacht)? STT-Sprache `de` oder `en`?
7. ElevenLabs-Dashboard des Keys hinter Telnyx-Secret `elevenlabs_prod` (**nicht** der Budget-Engine-Key): Plan/Guthaben/402 zur Call-Zeit.
8. Telnyx-Assistant-GET Read-Back (`TELNYX_ASSISTANT_ID`): `voice_settings.voice`, `api_key_ref`-Name, `greeting`, `external_llm.forward_metadata`, `interruption_settings.enable`, Deepgram-Sprache — gegen `buildAssistantConfig` diffen.
9. Telnyx-Kontostand (~3,97 USD) auf Puffer `>>2 USD` laden; Auto-Recharge aktivieren.
10. Secret-Parität EINMALIG: `TELNYX_SHIM_SHARED_SECRET` (Render) == Telnyx-Integration-Secret `hermes_shim_secret` (nur „stimmt: ja/nein", Werte nie kopieren).

**User-facing:**
11. **P11:** `MCP_UI_ENABLED`-Live-Wert bestätigen; beim 1. Widget-Render iframe-DevTools/Console erfassen.
12. **P13:** Hermes-Connector in claude.ai entfernen + neu hinzufügen, Icon-Screenshot.

**Prozess:** Pro Assistant-Fix genau **ein** Owner-Testanruf — aber **erst nach P4-Evidenz**.

---

## 7. Anhang: 5-Why-Ketten der tiefsten Wurzeln

**Warum hörte der Owner nichts?**
1. Weil nach `ai_assistant_start` die Telnyx-interne TTS spricht, nicht unser Speak-Node. → 2. Weil unser Shim nur Text liefert, Telnyx synthetisiert. → 3. Weil Telnyx entweder unseren Text nicht als sprechbaren assistant-Content parst (Format) ODER ElevenLabs 402/Voice-Slot/Deepgram versagt (Vendor). → 4. Weil beide Klassen identisch „`turn_ok` + Stille" erzeugen und aus unseren Logs nicht trennbar sind. → **5. (Wurzel): Der External-LLM-Vertrag + die Vendor-Config wurden nie empirisch beobachtet, bevor der Pfad live ging. Verify-First fehlte.**

**Warum legte Claude nach 3 Turns auf?**
1. `end_call` wurde nicht unterdrückt. → 2. Weil eine `caller`-Zeile existierte (`suppressEndCall==false`). → 3. Weil `suppressEndCall` nur die Existenz einer Zeile prüft, nicht ob es echte Sprache war. → 4. Weil im Assistant-Pfad eine `caller`-Zeile aus Echo/injiziertem Text stammen kann (Deepgram transkribiert evtl. die Azure-Disclosure). → **5. (Wurzel): Der für Gather gebaute Frühauflege-Schutz erbt die Invariante „Zeile == echte Äußerung", die im Assistant-Pfad nicht mehr gilt — content-blind statt content-basiert.**

**Warum blieb Widget/Icon über viele Sessions kaputt?**
1. Fixes behoben Symptome, das nächste tauchte auf. → 2. Weil nie geprüft wurde, was der Host tatsächlich empfängt/rendert. → 3. Weil die MCP-Apps-/Icon-Schnittstelle eine Blackbox ist (fremde Host-UI, nicht selbst beobachtbar). → 4. Weil der Contract hand-nachgebaut und nie gegen einen echten Host-Trace validiert wurde. → **5. (Wurzel): Verstoß gegen „erst Runtime lesen, nie raten" — es wurde gegen die Blackbox geraten statt einmal den echten Host-Output zu erfassen. Genau das dreht P11/P13 um.**

---

*Ende. Nächste Session: §4.0 Graph abarbeiten, pro Code-Phase ein `phase-impl-lean`-Workflow (Phase im per-run-Skript pinnen), parallele Tracks gleichzeitig, Owner-Gates (§3, P4, P11) respektieren.*
