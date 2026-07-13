# PLAN-TELNYX-AI-ASSISTANT.md

Migration der Live-Voice-Schicht von der halb-duplexen Budget/TeXML-Engine auf **C-Telnyx** (Telnyx AI Assistant als voll-duplexer Turn-Taking-Layer), damit die KI im Anruf per **Sprache sofort unterbrechbar** wird (Hard-Barge-in = Launch-Pflicht). Das Claude-Brain, die Ela-Stimme, der Offenlegungssatz und die komplette Safety-Gate-Kette bleiben in-house; Telnyx mietet nur STT/VAD/TTS/Barge-in und ruft unser Brain ueber einen OpenAI-kompatiblen Custom-LLM-Shim.

> **Finalisiert nach adversarialem Red-Team (2026-07-07).** Neun code-belegte Befunde (8x S1, 1x S3) wurden eingearbeitet: eine neue Phase (P4.5 Event-Ingest), zwei umgewidmete Phasen (P6 Boot-Re-Arm-Scope, P8 Inbound-Budget), verpflichtende statt optionale Mid-Call-Enforcement, per-Call-gebundene Shim-Auth mit 404-bis-Cutover, empirische Disclosure-Verifikation und eine Lead-Ausnahme fuer Regel-1-Phasen. Details in Abschnitt 8 (Red-Team-Changelog).

---

## 0. Nicht-Verhandelbares (Guardrails)

Diese Regeln stehen ueber jeder Phase. Jede Phase, die eine davon verletzt, ist ein S1-Blocker im Review.

### 0.1 Regel 1 — Safety-Gates + neuer Origination-Pfad + Mid-Call-Kill (Minuten UND Tokens)

Der neue Call-Control-Origination-Pfad fuer `ai_assistant_start` MUSS an **genau derselben Stelle** eingehaengt werden, an der heute `voiceControl().originateCall()` sitzt (`server.js:1643`), NACH der vollstaendigen Pre-Dial-Gate-Kette (`server.js:1431-1641`). Es darf **kein zweiter Origination-Einstieg** entstehen. Die Kette in Reihenfolge, die unangetastet vorgeschaltet bleibt:

- Gate 0: `OUTBOUND_FROZEN` (`server.js:1448-1453`)
- Gate 1: Tenant-Identitaet/`TENANT_REJECT` (`server.js:1467-1470`)
- Gate 2: KYC (`server.js:727-734`, aufgerufen `1493`)
- Gate 3: Identitaets-/ownerName-Gate (`server.js:1509-1519`)
- Gate 4: Denylist Notruf+Premium/IRSF (`server.js:632-633`, `762-767`)
- Gate 5: E.164-Format (`server.js:768`)
- Gate 6: Land-Gate (`server.js:646-652`, `769-774`)
- Gate 7: globales Stundenlimit (`server.js:657-658`, `775-780`)
- Gate 8: pro-Nutzer-Stundenlimit (`server.js:660-666`, `781-786`)
- Gate 9: per-(Tenant,Ziel)-Cooldown (`server.js:676-681`, `787-792`)
- Gate 10: Verifikations-/Allowlist-Gate (`server.js:700-720`)
- Gate 11: Budget global ∩ pro-Tenant (`state-ops.js:1274-1276`, `1410-1412`, aufgerufen `server.js:1571`) — **beide bleiben parallel**
- Gate 12: Minuten-Kontingent (`server.js:746-753`, `1581`)
- Gate 13: atomare Budget-Reserve `tryReserveOutboundBudget` unter `withStoreLock` (`state-ops.js:1448-1456`, `server.js:1596-1611`)

**Zwei Kosten-Achsen, nicht eine.** Die Vorab-Reserve (Gate 13) deckt AUSSCHLIESSLICH Telefonie-Minuten: `reserveCents = tariffCentsPerMin(to) × ceil(maxDur/60)` (`state-ops.js`, code-verifiziert). **LLM-Tokenkosten liegen ausserhalb dieser Reserve** — sie laufen NACHtraeglich pro Roundtrip ueber `store.trackUsage(...)` in den Budget-Bucket (`claude.js:401`) und werden nur pre-dial beim NAECHSTEN Origination gegen den Cap geprueft (`budgetExceeded`/`reserveExceedsBudget` sind pre-dial). In der heutigen Budget-Engine begrenzt der server-dirigierte Turn-Loop den Token-Verbrauch implizit. Bei C-Telnyx feuert der Shim pro Turn Claude-Calls, **ohne** dass irgendein Mechanismus die Tokenkosten mid-call gegen den Cap prueft. Deshalb gilt fuer C-Telnyx verbindlich:

- **Mid-Call-Budget-Enforcement (Minuten + Tokens) ist NICHT optional** — es ist Regel-1-Pflicht. Umgesetzt in P6 (siehe dort) durch EINEN der drei Wege, Owner entscheidet in P0/P6: (i) verpflichtender Watchdog (`setInterval`), der laufenden Verbrauch inkl. Tokens gegen den effektiven Cap prueft und bei Ueberschreitung hart auflegt; ODER (ii) die Reserve wird um eine konservative Token-Kostenschaetzung fuer die Max-Dauer erhoeht (Worst-Case-Vorab-Reserve auch fuer Tokens); ODER (iii) der Shim prueft `budgetExceeded` bei JEDEM Turn und liefert bei Ueberschreitung eine Abschluss-Ansage + triggert Call-Control-Hangup.
- Ein "akzeptiertes Risiko: nur Vorab-Reserve" ist fuer C-Telnyx **falsch formuliert und nicht zulaessig**, weil es nur die Minuten-Achse abdeckt. Jede Restriktion braucht explizites Owner-Sign-off mit korrekter Trennung Minuten ≠ Tokens.

**Max-Dauer-Cap muss den neuen ID-Typ kennen — auch nach Deploy.** Der Max-Dauer-Timer (`armMaxDurationTimer` → `scheduleMaxDurationEnd` → `terminateCappedCall`, `server.js:924-955`) ist out-of-band (`setTimeout` + Provider-Hangup) und bleibt der verlaessliche Zeit-Deckel. ABER: nach jedem SIGTERM/Deploy wird er von `rearmActiveCallTimers` (`server.js:2361`) und `reattachActiveCall` (`server.js:1074`, `telephony/reattach.js`) rekonstruiert — und beide (a) early-returnen heute nur bei `voiceEngine === "realtime"` (`server.js:2362`), waehrend C-Telnyx auf `voiceEngine === "budget"` mit orthogonalem Flag laeuft, laufen also durch, und (b) rufen `scheduleMaxDurationEnd(call, call.twilioSid, ...)` bzw. `terminateCappedCall(call.id, call.twilioSid, ...)` (`server.js:2371/2374`) mit `call.twilioSid` gegen den TeXML-Hangup-Endpunkt. Fuer einen Call-Control-Call ist `twilioSid` keine `call_control_id` und der TeXML-Hangup ist der falsche Endpunkt → der Boot-Recovery-Hangup schlaegt still fehl, der Call laeuft bis zum Telnyx-Limit. Deshalb:

- Die `call_control_id` MUSS als **eigenes Feld** im persistierten Call-Record liegen (NICHT `twilioSid` ueberladen), damit Boot-Recovery die ID-Form kennt.
- `rearmActiveCallTimers` UND `reattachActiveCall`/`reattach.js` MUESSEN in P6-Scope: die Engine-/ID-Verzweigung darf NICHT auf `voiceEngine` haengen, sondern auf dem neuen Flag bzw. der Praesenz von `call.callControlId`.

### 0.2 Regel 2 — Offenlegung als deterministischer Speak-Node, empirisch verifiziert

Der Offenlegungssatz (`disclosureSentence(call)`, `claude.js:171`, Name gebunden aus `store.tenantContext(...).ownerName`, Anti-Spoofing) bleibt der **allererste** Satz jedes Outbound-Calls und wird als **deterministischer Telnyx-Speak-Node** gesprochen, BEVOR `ai_assistant_start` den Assistant anhaengt — NICHT ins System-Prompt des Custom-LLM gezogen, NICHT ins Modell-Ermessen. `openingText`/`disclosureSentence` sind bereits reine Text-Generierung (`bridge.js:176` teilt sie schon heute zwischen zwei Engines) — direkt wiederverwendbar.

**Die Reihenfolge haengt an zwei Bedingungen, die BEIDE empirisch verifiziert werden muessen (nicht nur im Offline-Test):**

1. `ai_assistant_start` wird erst auf das `speak.ended`-Event des Disclosure-Nodes gefeuert — nicht fire-and-forget direkt nach dem Speak-Command (sonst spricht die KI ueber/vor der Disclosure). Das setzt den Event-Ingest-Handler (P4.5) voraus.
2. Der Telnyx-Assistant hat KEINE eigene Greeting/first-message, die vorprescht (P7 deaktiviert sie explizit).

Ein Offline-Test kann nur asserten, dass der CODE `speak` vor `start` ausgibt — NICHT, dass Telnyx die Reihenfolge einhaelt. Deshalb ist die Disclosure-Reihenfolge ein hartes **P0-Akzeptanzkriterium (Nr. 4)** UND ein **P11-Live-Kriterium**.

### 0.3 Regel 3/4 — Auth fail-closed + Secrets + Angriffsflaeche-Minimierung

- Der neue Custom-LLM-Shim-Endpunkt (`/v1/chat/completions`-kompatibel) ist ein **neuer Endpunkt, der Kosten ausloest** (jeder Aufruf = LLM-Tokens) und Transkript-Fragmente empfaengt/mutiert. Er ist eine echte neue Angriffsflaeche — die "byte-identisch bis Aktivierung"-Behauptung gilt fuer den Live-CALL-Pfad, NICHT fuer die Existenz des Endpunkts. Deshalb drei Schichten:
  1. **Existenz hinter demselben Flag** (`TELNYX_AI_ASSISTANT_ENABLED`, Default aus): der Endpunkt antwortet **404** bis zum Cutover. Die Angriffsflaeche steht nicht monatelang (P1-Merge bis P11) offen im Internet.
  2. **Per-Call-Bindung statt globalem Secret**: ein pro-Call kurzlebiges Token, generiert bei `ai_assistant_start` und an genau diesen `callId`/`tenantId` gebunden. KEIN einzelnes globales Shared-Secret, das jeden `callId` adressieren darf (sonst kann, wer das Secret kennt, durch Enumerieren fremde Tenant-Calls lesen/mutieren → Cross-Tenant-Leak, und beliebig oft Claude triggern → unbegrenzte Tokenkosten). Ob Telnyx BYO-LLM ein per-Call-Secret/Header setzen kann, ist **offene Frage #2** (bis geklaert: Default = pro-Call-Token, das der Shim gegen den Store-Call-Record prueft; faellt Telnyx darauf zurueck, dass es nur einen statischen Header setzen kann, MUSS die Korrelation `callId` trotzdem gegen den Store validiert + rate-limitiert werden).
  3. **Rate-/Budget-Gate direkt am Shim**: jeder Shim-Turn prueft `budgetExceeded` (Regel 1) und ist rate-begrenzt pro `callId`.
- Die Inbound-Signaturpruefung (`server.js:479-489`, Telnyx Ed25519, `signature.js:40-56`) darf NICHT implizit wegfallen, weil ein neuer Endpunkt vor `app.use("/voice", ...)` registriert wird. Neuer Pfad = dieselbe fail-closed-Pruefung explizit neu verdrahtet. Das gilt auch fuer den **Call-Control-Event-Ingest** (P4.5): eingehende `call.answered`/`speak.ended`/`call.hangup`-Webhooks sind Ed25519-signiert und fail-closed zu pruefen.
- Secrets nur ueber `.env`/Render-Dashboard; `assertTelnyxOk` (`errors.js`) bleibt die einzige Fehler-Parse-Stelle (nie Raw-Body/Key loggen).

### 0.4 Haus-Konventionen (bindend fuer jede Phase)

- **Deutsch-ohne-Umlaute in JEDEM Code/Kommentar** (ue/oe/ae ausgeschrieben). Prosa in Doku darf Umlaute.
- **Tests-Pflicht**: neues Verhalten braucht `node:test`, offline, ohne `.env`, beide Backends (json + pglite). Jede neue config-Env-Var MUSS mit neutralem fail-closed Default in `BASE_ENV` (`test/helpers.js:36ff`) nachgezogen werden, sonst leakt lokales `.env` in Spawn-Tests (Baseline lokal rot/CI gruen).
- **Env zentral**: jede neue Var in `src/config.js` (`numEnv` fuer Zahlen, `=== "true"` fuer Flags), dokumentiert in `.env.example` UND `render.yaml` (`sync: false` fuer Secrets). Sicherheitsrelevante Flags durch `assertConfig()` (`config.js:575-656`) und `productionFootguns()` (`config.js:547-573`).
- **Deploy-Split**: Render deployt vom **upstream**-Remote (`jonas986`), nicht `origin`. `git push origin` bewirkt live NICHTS — zusaetzlich `git push upstream master`. Service ist Dashboard-managed: render.yaml-Edit allein setzt keine Live-Env, Owner setzt Werte im Dashboard. Live-Commit per `[boot]`-Banner verifizieren.
- **Clean-Code hartes Gate**: S1 (Korrektheit/Sicherheit/Tests) oder S2 (Duplizierung) nicht leer = Blocker. Magic Numbers (ausser 0/1/-1) → `config.js`. Money at rest = Ganzzahl-Cents.

---

## 1. Architektur Vorher / Nachher

### 1.1 Heute (VOICE_ENGINE=budget, halb-duplex)

Der **Server dirigiert jeden Turn**. Ablauf pro Aeusserung:

1. Telnyx TeXML `<Gather>` sammelt STT, POSTet an `/voice/turn` (`server.js:1084-1185`).
2. Server ruft `agentTurn(call, callerText)` (`claude.js:357`) → Tool-Loop bis 4 Roundtrips gegen `llm.complete` (`llm.js:188`) → `{ speech, endCall }`.
3. Server rendert `<Say>`/`<Play>` (Ela via `renderPlay`, vorab-synthetisierte mp3, `render.js:79-87`) + naechstes `<Gather>`.
4. Barge-in strukturell unmoeglich: `<Gather>` stoppt Wiedergabe nur bei DTMF, nie bei Sprache.

Origination: **nur TeXML** (`POST /v2/texml/calls/{connection_id}`, `voice.js:40-53`). Kein Call-Control-Client im Repo (Grep `call_control`/`/v2/calls`/`ai_assistant` = keine Treffer ausser einem WS-Feldnamen-Fallback in `media.js:22`). Call-Ende, Reserve-Settlement und Abrechnung haengen am server-sichtbaren TeXML-Turn-/Status-Callback-Fluss.

### 1.2 Nachher (C-Telnyx, voll-duplex)

Die **Telnyx-Runtime dirigiert den Turn** (STT via Flux, VAD, TTS, Barge-in). Hermes steckt an fuenf Stellen ein:

- **Brain-Shim** (NEU, in-house): Telnyx BYO-LLM ruft unseren `/v1/chat/completions`-kompatiblen Endpunkt pro Turn; der Shim ruft intern den `agentTurn`-Kern und streamt die Antwort zurueck.
- **Call-Control-Event-Ingest** (NEU, in-house, P4.5): ein signaturgepruefter Handler fuer die eingehenden Call-Control-Webhooks (`call.answered`, `speak.ended`, `call.hangup`, ai_assistant-Events), der die event-getriebene Zustandsmaschine faehrt und auf die bestehenden `finishCall`/`releaseReserve`/Timer-Pfade mappt.
- **Ela-Stimme**: bleibt (Owner-Direktive), vermutlich als "bring your own voice" **im Telnyx-Assistant-Builder** referenziert — NICHT ueber den heutigen TeXML-`<Say>`/`<Play>`-Renderer.
- **Disclosure**: deterministischer Speak-Node vor `ai_assistant_start`, gegatet auf `speak.ended`.
- **Gates**: unveraendert vor der Origination (`server.js:1431-1641`); Origination selbst wird Call-Control statt TeXML.

Ablauf (event-getrieben, NICHT synchron): Server originiert via Telnyx Call Control (Gates laufen vorher) → auf `call.answered`-Webhook spricht der Server einen deterministischen Disclosure-Speak-Node → auf `speak.ended`-Webhook feuert `ai_assistant_start` → Telnyx faehrt Turns voll-duplex, ruft pro Turn den Shim → auf `call.hangup`-Webhook settelt der Server Reserve/Abrechnung/Timer.

**Was wegfaellt / sich verschiebt:**

- Der server-dirigierte `/voice/turn`-Loop entfaellt fuer C-Telnyx-Calls.
- Der eigene Vorab-Synth-Pfad (`renderPlay` + Play-TTS-Seam) wird fuer C-Telnyx-Calls **nicht** genutzt (Ela ueber den Assistant-Voice-Slot). Bleibt fuer die Budget-Engine bestehen (Rollback-Pfad, Abschnitt 7).
- `armReserveReleaseTimer`/`releaseReserve` (`server.js:961-975`) bleiben als reiner Store-Mechanismus providerunabhaengig — **ABER** sie sind nur dann korrekt getriggert, wenn das Terminal-Event (`call.hangup`) ueber den neuen Event-Ingest (P4.5) verdrahtet ist. Ohne diesen Handler feuern `releaseReserve`/`finishCall` nie → Reserve leakt, Ist-Minuten werden nie gebucht, Tenant-Budget bleibt gesperrt. Die Behauptung "byte-identisch nutzbar" gilt erst NACH P4.5.

---

## 2. Pre-Mortem (Gesamtplan)

Ein Jahr in der Zukunft, die Migration ist gescheitert. Fuer jede Achse: Ursache + Gegenmassnahme.

### (a) Barge-in doch nicht sauber — falscher Weg committet

**Was passiert war:** C-Telnyx voll integriert (Wochen Arbeit, Live-Cutover), dann im echten Anruf: Flux stoppt die Wiedergabe eben doch nicht sofort (Barge-in nur doku-, nie empirisch belegt). Launch-Pflicht verfehlt.

**Gegenmassnahme:** **Phase 0 (De-Risking-Spike)** vor jeder In-Live-Integration. Rot = C-Telnyx wird nicht committet, Fallback C-ElevenLabs (Shim aus P1 bei beiden Wegen identisch, nicht verloren).

### (b) Ein Safety-Gate faellt im neuen Origination-Pfad still weg — ungewollter/teurer Anruf

**Was passiert war:** Call-Control-Origination als **separater** Codepfad gebaut (statt an `server.js:1643`), dabei Reserve (Gate 13) oder Land-Gate uebersprungen. Bug/Prompt-Injection loeste teuren Auslandsanruf aus.

**Gegenmassnahme:** Regel 1 (0.1). Neuer `startAssistant`/`originateViaCallControl` haengt an **exakt** `server.js:1643`, HINTER der kompletten Kette. Review-Safety prueft explizit die vollstaendige Gate-Kette (0-13). Spawn-Test mit `fakeOriginate` (`registry.js:29-40`, hinter allen Gates), der jedes Gate einzeln rot prueft.

### (c) Mid-Call-Budget/Dauer greift nicht mehr — Kostenexplosion (Minuten UND Tokens)

**Was passiert war (drei ineinandergreifende Wurzeln):**
1. Ein Call haengt (Telnyx-Bug, Endlosschleife, Nutzer legt nicht auf). Der Server sieht keinen Turn mehr; frueher haette der Turn-Loop das gemerkt.
2. `terminateCappedCall` rief den TeXML-Hangup mit `call.twilioSid` gegen einen Call-Control-Call → falscher Endpunkt/ID, Hangup schlug fehl.
3. Nach einem Deploy rekonstruierte `rearmActiveCallTimers`/`reattachActiveCall` den Timer wieder mit `twilioSid` + TeXML-Endpunkt (early-return nur auf `voiceEngine==="realtime"`, greift bei C-Telnyx NICHT) → der Cap war nach jedem Deploy orphant. Genau im Cutover-Fenster (viele Deploys) tickte die Bombe.
4. Parallel: die Vorab-Reserve deckt nur MINUTEN; der Shim verbrannte pro Turn Token-Budget weit ueber den Tenant-Cap, ohne dass etwas mid-call prueft.

**Gegenmassnahme:** P6 nimmt `terminateCappedCall`, `scheduleMaxDurationEnd`, `cancel_call`, **`rearmActiveCallTimers` UND `reattachActiveCall`/`reattach.js`** in Scope; die ID-/Engine-Verzweigung haengt am neuen Flag bzw. an `call.callControlId` (eigenes persistiertes Feld), NICHT an `voiceEngine`. `endCall` wird Call-Control-faehig. Mid-Call-Enforcement fuer Minuten UND Tokens ist verpflichtend (Regel 1, einer der drei Wege in 0.1). Tests: (i) aktiven C-Telnyx-Call persistieren → Neustart simulieren → assert Call-Control-Hangup mit `call_control_id`; (ii) Timer feuert → Call-Control-Hangup; (iii) Budget-Cap mid-call ueberschritten → Abschluss-Ansage + Hangup.

### (d) Latenz Claude-Shim killt Barge-in-Gefuehl UND sprengt Telnyx' Request-Timeout

**Was passiert war:** Barge-in funktionierte, aber die erste Antwort-Silbe kam mit Sekunden Verzoegerung (kein Streaming, `agentTurn` bis 4 Roundtrips × `llmRequestTimeoutMs=3500` + Retry). Schlimmer: bei einem Tool-Use-Turn (>15s Worst-Case) ueberschritt der Shim das **Telnyx-seitige Custom-LLM-Request-Timeout** → der Assistant brach/wiederholte den Turn oder haengte stumm. Nicht nur "Gefuehl", sondern harter Korrektheitsfehler.

**Gegenmassnahme:** Zwei Achsen.
1. **Latenz-Gefuehl:** Fake-Stream zuerst (P3a-Framing), echtes Streaming (P3b) nur falls P0 Latenz als Blocker zeigt.
2. **Timeout-Korrektheit:** P0 misst ZUSAETZLICH die Worst-Case-Tool-Loop-Latenz gegen das (erst zu ermittelnde) Telnyx-Request-Timeout (offene Frage #11). Gegenmassnahmen falls zu langsam: `agentTurn`-Roundtrip-Cap fuer C-Telnyx senken (`claude.js:391`), frueh ein Fueller-/Keepalive-Token streamen, oder Timeout-Verlaengerung in der Assistant-Config falls konfigurierbar.

### (e) Live-Cutover killt laufende Calls (Deploy-Risiko, STATUS A6)

**Was passiert war:** Cutover-Deploy schickte SIGTERM in aktive Calls; neuer Prozess bootete mit noch nicht gesetzten Env-Vars → C-Telnyx-Calls schlugen fehl.

**Gegenmassnahme:** Engine-Selektor ist ein Flag (`TELNYX_AI_ASSISTANT_ENABLED`, Default aus), byte-identisch im Live-Call-Pfad bis aktiviert. Cutover = Owner setzt Flag im Dashboard NACH verifiziertem Deploy. Boot-Re-Arm (Befund (c).3) macht laufende Calls deploy-fest. Rollback = Flag aus.

### (f) Event-Ingest-Zustandsmaschine fehlt — Disclosure-Race + Reserve-Leak (NEU aus Red-Team)

**Was passiert war:** Niemand baute den Handler fuer die eingehenden Call-Control-Webhooks. Folge: `ai_assistant_start` feuerte fire-and-forget → KI sprach ueber die Disclosure (Regel 2 gebrochen); und `call.hangup` wurde nie verarbeitet → `releaseReserve`/`finishCall` feuerten nie, Reserven leakten, Minuten wurden nie gebucht, Tenant-Budgets blieben gesperrt.

**Gegenmassnahme:** Eigene Phase **P4.5 (Call-Control-Event-Ingest)** VOR P5. Signaturgepruefter (Ed25519, fail-closed) Handler, der `answered`/`speak.ended`/`hangup` auf die bestehenden `finishCall`/`releaseReserve`/Timer-Pfade mappt und die Disclosure→Assistant-Sequenz gatet.

### (g) Shim monatelang als offene Angriffsflaeche — Toll-/Token-Fraud + Cross-Tenant (NEU aus Red-Team)

**Was passiert war:** Der Shim war ab P1-Merge live erreichbar (Monate vor Cutover), abgesichert nur durch EIN globales Shared-Secret. OpenAI-Chat-Format traegt keine `callId`; die Korrelation war spoofbar. Ein Secret-Leak erlaubte unbegrenztes Claude-Triggern (Token-Fraud ohne Budget-Gate) und `callId`-Enumeration (Cross-Tenant-Lesen/Mutieren via `addTranscript`/`execTool`).

**Gegenmassnahme:** Regel 3 (0.3): Endpunkt-Existenz hinter dem Flag (404 bis Cutover), per-Call kurzlebiges Token statt globalem Secret, Rate-/Budget-Gate direkt am Shim.

---

## 3. Phasen-Uebersicht

Legende: WT = Worktree noetig (Agent checkt eigenen Branch aus / parallel-faehig). OG = Owner-gated. R1 = Regel-1-Phase (verschaerftes Review + Lead-Ausnahme, siehe 5.5). Verifikation immer offline `node:test` beide Backends, sofern nicht anders vermerkt.

| Phase | Titel | Ziel (1 Satz) | Abhaengt von | Parallel? | WT | OG | R1 | Deterministisches Ergebnis (checkbar) |
|---|---|---|---|---|---|---|---|---|
| **P0** | De-Risking-Spike | Empirisch belegen: Barge-in + Ela + Custom-LLM + Disclosure-Reihenfolge + Latenz auf unserem Stack. | — | nein | nein | **ja** | — | 4 Akzeptanzkriterien + 2 Latenz-Messungen gruen/rot dokumentiert |
| **P1** | Brain-Shim (OpenAI-kompat, Fake-Stream) | `/v1/chat/completions`-Endpunkt in-house, der `agentTurn` kapselt; Existenz + Auth hinter Flag, 404 bis Cutover. | — (parallel zu P0) | mit P0 | ja | nein | ja | Shim liefert gueltige Completion; 404 bei Flag aus; 403 ohne per-Call-Token; Bestandssuite gruen |
| **P2** | Resilienz-Bruecke im Shim | Shim liefert immer gueltige Degradations-Response, nie roher 5xx/Hang. | P1 | nein | ja | nein | — | Fake-`llm` wirft beide Fehlerklassen → gueltiger Body statt Crash |
| **P3a** | Tool-Calling-Bruecke + out-of-band end_call | Tool-Calls inkl. Store-Seiteneffekte; `end_call` beendet den Call real via Call-Control. | P1, P4 (fuer end_call-Hangup) | nein | ja | nein | ja | Turn erzwingt `take_message` → `addActionItem`; `end_call` → Call-Control-Hangup gefeuert |
| **P3b** | Echter Streaming-Seam (bedingt) | `llm.js` optional `stream:true` — NUR falls P0-Latenz Blocker. | P0-Messung, P1 | nein | ja | nein | — | Stream-Chunks; Retry nur vor erstem Chunk; Tool-Loop weiter "voll warten". Deferred wenn P0 ok |
| **P4** | Call-Control-Adapter (Telnyx) | `originateCall`/`endCall`/`startAssistant` als Call-Control-Variante (`/v2/calls`, `call_control_id`). | P0 gruen | mit P7 | ja | nein | ja | Adapter trifft Call-Control-Endpunkte mit `call_control_id`; TeXML byte-identisch daneben |
| **P4.5** | Call-Control-Event-Ingest | Signaturgepruefter Handler fuer answered/speak.ended/hangup → mappt auf finishCall/releaseReserve/Timer + Disclosure-Sequenz. | P4 | nein | ja | nein | **ja** | Ed25519-Signatur fail-closed; `call.hangup` → `releaseReserve`+`finishCall`; `speak.ended` gatet `ai_assistant_start` |
| **P5** | Origination-Integration + Gate-Beweis | Neuer Pfad an `server.js:1643` hinter kompletter Gate-Kette; Disclosure-Speak-Node vor `ai_assistant_start`. | P4, P4.5 | nein | ja | nein | **ja** | Jedes Gate (0-13) blockt auch C-Telnyx; Disclosure ist erster Speak-Node, gegatet auf speak.ended |
| **P6** | Max-Dauer + Boot-Re-Arm + Mid-Call-Kill | Alle Timer-Callsites (inkl. rearm/reattach) Call-Control-faehig; verpflichtendes Mid-Call-Enforcement (Minuten+Tokens). | P4, P4.5, P5 | nein | ja | nein | **ja** | `terminateCappedCall`/`rearmActiveCallTimers`/`reattachActiveCall` treffen Call-Control-Hangup mit `call_control_id`; Budget-Cap mid-call → Hangup |
| **P7** | Assistant-Provisioning/Config | Skript/Doku: Assistant anlegen (Ela-Voice, Custom-LLM-URL, `interruption_settings`, KEINE eigene Greeting). | P0 gruen | mit P4 | ja | teilw. | — | Config reproduzierbar; IDs in Env; Greeting/first-message deaktiviert |
| **P8** | Inbound-Pfad + Inbound-Budget-Gate | Inbound per Assistant, Signatur erhalten, MIT globalem∩Tenant-Budget-Check beim Answer. | P4, P4.5, P5, P6 | nein | ja | nein | **ja** | Inbound ohne Signatur → 403; Budget-Cap ueberschritten → Ablehnung; korrigierter Max-Dauer-Pfad |
| **P9** | Engine-Flag/Selektion | `TELNYX_AI_ASSISTANT_ENABLED` schaltet Pfad; ALLE `voiceEngine`-Verzweigungsstellen mit-beruecksichtigt. | P5, P6 | nein | ja | nein | ja | Flag aus = byte-identisch Budget; alle rearm/reattach/cap-Stellen kennen das Flag |
| **P10** | Observability + Tests + Doku | Metriken (Time-to-first-Token), `PLAN-SECURITY.md`, `README`, `.env.example`, `render.yaml`, `BASE_ENV`. | alle Code-Phasen | mit P9 | ja | nein | — | Alle neuen Env-Vars an 4 Orten; `productionFootguns` deckt neue Gate-Flags |
| **P11** | Live-Cutover | Owner setzt Flag nach verifiziertem Deploy; Barge-in + Ela + Disclosure-Reihenfolge im echten Call bestaetigt. | P0-P10 | nein | ja | **ja** | ja | `[boot]`-Banner neuer Commit; Live-Call: Barge-in + Ela + Disclosure-erst; Rollback-Drill |

**Harte Reihenfolge:** P0 gated P4-P11. P1 → P2. P4 → P4.5 → P5 → P6. P3a haengt an P1 UND P4 (weil `end_call` den Call-Control-Hangup braucht). P8 nach P5+P6. P9 nach P5+P6. P11 zuletzt.

---

## 4. Phasen-Details

### P0 — De-Risking-Spike (Owner-gated, faesst Live NICHT an)

- **Ziel:** Empirisch entscheiden, ob C-Telnyx der richtige Weg ist, BEVOR Integrationscode entsteht.
- **Betroffene Dateien:** keine im Repo (manuelle Telnyx-Portal-/API-Konfiguration + Wegwerf-Testanruf). Optional ein Spike-Skript unter `scripts/` (nicht Teil von `npm test`, analog `scripts/telnyx-ws-echo.mjs`).
- **4 Akzeptanzkriterien (alle muessen gruen sein):**
  1. **Barge-in sofort?** Der Angerufene redet waehrend die KI spricht → die KI verstummt hoerbar sofort (`user_interrupt_start`/`agent_audio_stopped` empirisch, nicht nur Doku).
  2. **Ela hoerbar UND Angerufener gleichzeitig gehoert?** Ela kommt raus UND der Inbound-Track wird NICHT suppressed (der bekannte Fehler des Live-Relay-Wegs, `render.js:60-65`, A/B-belegt 2026-07-06).
  3. **Custom-LLM + 1 Webhook-Tool feuert?** Der Assistant ruft den externen `/v1/chat/completions` und ein definiertes Tool loest einen Webhook aus.
  4. **Disclosure ZUERST?** Ein deterministischer Speak-Node spricht die Disclosure vollstaendig, BEVOR der Assistant (mit deaktivierter Greeting) irgendetwas sagt — empirisch am echten Call verifiziert (Regel 2).
- **2 Latenz-Messungen:** (i) erste-Silbe-Latenz mit Claude (entscheidet ueber P3b); (ii) **Worst-Case-Tool-Loop-Latenz** (4 Roundtrips) gegen das Telnyx-Custom-LLM-Request-Timeout (offene Frage #11 — Timeout zuerst ermitteln).
- **Abhaengigkeiten:** keine. **Parallel/WT:** nein (Owner-Arbeit).
- **Pre-Mortem:** Risiko (a). Rot = Fallback C-ElevenLabs, P1-Shim bleibt.
- **Deterministisches Ergebnis:** Protokoll mit 4 Ja/Nein + 2 Latenz-Zahlen + ermitteltes Telnyx-Timeout.
- **Review-Gate:** kein Code → Owner-Freigabe ist das Gate.

### P1 — Brain-Shim (OpenAI-kompatibel, Fake-Stream) — R1

- **Ziel:** In-house `/v1/chat/completions`-Endpunkt, der den Kern von `agentTurn` kapselt. Bei C-Telnyx UND C-ElevenLabs identisch.
- **Betroffene Dateien:** NEU `src/telnyx-llm-shim.js`; Route-Registrierung in `src/server.js` (VOR keiner Gate-Umgehung); `src/config.js` (Flag + Auth-Mechanismus); Reuse `agentTurn`/`execTool` aus `claude.js:357/288`, `llm.complete` aus `llm.js:188`.
- **Was gebaut wird:** Adapter, der eingehendes OpenAI-Chat-Format auf den `call`-Kontext mappt und `await` den `agentTurn`-Kern aufruft, dann die volle `resp` als **1 SSE-Chunk + `data: [DONE]`** framt (Fake-Stream, keine `llm.js`-Aenderung).
- **Sicherheit (Regel 3, verpflichtend):**
  - **404 bei Flag aus** — Existenz hinter `TELNYX_AI_ASSISTANT_ENABLED`. Kein monatelanges offenes Endpunkt-Fenster.
  - **Per-Call-Token** statt globalem Secret; `403` ohne gueltiges, an den `callId` gebundenes Token (bis offene Frage #2 geklaert: Token gegen Store-Call-Record validieren).
  - **Budget-/Rate-Gate pro Turn** direkt am Shim (`budgetExceeded`).
- **Kritische Fallstricke (aus Recherche):** `call` ist eine **lebende Store-Referenz**, kein DTO — der zustandslose HTTP-Request MUSS bei jedem Aufruf `store.getCall(callId)` frisch ziehen. `store.tenantContext(callId→tenantId)` liefert Settings+Kalender+Identitaet. `config` ist Modul-global. `toolDefs` ist settings-abhaengig (nicht statisch cachen). Transkript-Persistenz + `trackUsage`/`meterAiTokens` laufen pro Roundtrip.
- **Abhaengigkeiten:** keine. **Parallel/WT:** ja, parallel zu P0.
- **Pre-Mortem:** Risiko (d) — Fake-Stream entkoppelt Latenz. Risiko (g) — Angriffsflaeche minimiert (404+per-Call-Token+Budget-Gate).
- **Deterministisches Ergebnis:** POST → gueltige Shape; Flag aus → 404; kein/fremdes Token → 403; Bestandssuite gruen.
- **Review-Gate:** dual, R1. Safety: kein Gate-Bypass, 404-bis-Cutover, per-Call-Bindung, kein Secret-Leak. Clean-Code: `execTool`-Wiederverwendung (S2!), keine Magic Numbers.

### P2 — Resilienz-Bruecke im Shim

- **Ziel:** Der Shim liefert IMMER eine gueltige Response, nie einen rohen Hang.
- **Betroffene Dateien:** `src/telnyx-llm-shim.js`; Referenzmuster `server.js:1120-1144` (CP4-Degradations-Catch).
- **Was gebaut wird:** `try/catch`: `err instanceof LlmUnavailableError` (`llm.js:46-52`) → lokalisierte Degradations-Response (analog `locale.llmDegradedSpeech`). Nicht-transiente Fehler (4xx/Auth) → eigener Catch-All. Nie 5xx ohne Body.
- **Abhaengigkeiten:** P1. **Parallel/WT:** WT, seriell nach P1.
- **Deterministisches Ergebnis:** Fake-`llm` wirft beide Klassen → assert gueltiger Body statt Crash.
- **Review-Gate:** dual. Safety: kein Secret in Degradations-Body.

### P3a — Tool-Calling-Bruecke + out-of-band `end_call` — R1

- **Ziel:** Tool-Calls inkl. Store-Seiteneffekte; `end_call` beendet den Call REAL.
- **Betroffene Dateien:** `src/telnyx-llm-shim.js`; `execTool` (`claude.js:288-323`), `toolDefs` (`claude.js:215-268`); Call-Control-`endCall` aus P4.
- **Was gebaut wird:** Der volle `agentTurn`-Loop laeuft **im Shim** (Store-Seiteneffekte MUESSEN in-house bleiben — `execTool` schreibt synchron: `addCalendarEvent`/`addActionItem`/`findConflict`); nach aussen geht nur der finale Text. `suppressEndCall` (`claude.js:380-381`, aus `transcript.some(role==="caller")`) laeuft gegen den **frischen** Store-Stand.
  - **`end_call` (Befund 6):** In der Budget-Engine rendert der SERVER den Hangup aus `{speech, endCall}`. Bei C-Telnyx gibt es keinen Text-Rueckkanal fuer "leg auf". Deshalb setzt der Shim `end_call` als **out-of-band Call-Control-Hangup** (`/v2/calls/{call_control_id}/actions/hangup`, aus P4) um, gekeyt auf die aus dem Shim-Request gethreadete `call_control_id`. Store-Seiteneffekt (finish) UND realer Hangup — beides.
- **Abhaengigkeiten:** P1 UND P4. **Parallel/WT:** WT, seriell.
- **Pre-Mortem:** doppelter Store-Write bei Shim-Retry / veralteter Transkript-Stand. Gegenmassnahme = `store.getCall` frisch + Idempotenz. `end_call` ohne realen Hangup = Kostenleck.
- **Deterministisches Ergebnis:** Turn erzwingt `take_message` → `addActionItem`; `end_call` → Call-Control-Hangup gefeuert; `end_call` im ersten Outbound-Turn unterdrueckt.
- **Review-Gate:** dual, R1. Safety: Store-Writes tenant-korrekt, kein Cross-Tenant-Leak, `end_call` terminiert real.

### P3b — Echter Streaming-Seam (bedingt, deferred wenn P0-Latenz ok)

- **Ziel:** Time-to-first-Token senken, falls P0 Latenz als Blocker zeigt.
- **Betroffene Dateien:** `src/llm.js` (`create`, `withRetry:121-137`, `makeBreaker:84-115`, `isTransient:58-71`, `metrics.llmCall:216-232`); Shim.
- **Was gebaut wird:** `params.stream:true`, AsyncIterator. **Retry nur VOR erstem Chunk** (danach Doppel-Audio-Risiko). Breaker-Erfolg = Stream sauber beendet. Neue Metrik Time-to-first-Token. **Tool-Loop bleibt "voll warten"** pro Roundtrip (`claude.js:407-434`). Interagiert mit `end_call` (Befund 6): der out-of-band Hangup darf erst nach vollstaendigem Text-Flush feuern.
- **Abhaengigkeiten:** P0-Messung, P1. **Parallel/WT:** WT, seriell.
- **Pre-Mortem:** Retry nach erstem Chunk → doppelte Sprache. Gegenmassnahme = Retry-Gate vor erstem Chunk. Deferred wenn Fake-Stream + Haiku reichen.
- **Review-Gate:** dual, hohe Sorgfalt (`llm.js` = Hot-Path beider Engines — grep alle Caller).

### P4 — Call-Control-Adapter (Telnyx) — R1

- **Ziel:** Origination + Hangup + `startAssistant` ueber Call-Control statt TeXML.
- **Betroffene Dateien:** `src/telephony/adapters/telnyx/voice.js` (neue Methoden neben `originateCall`/`endCall:29-70`, gleiches inline-`fetch`+`config`-Muster, `assertTelnyxOk` aus `errors.js`); `ports.js` (VoiceControl-Vertrag um `startAssistant` erweitern, `ports.js:42-47`); `registry.js:41-44`.
- **Was gebaut wird:** `originateViaCallControl` (`POST /v2/calls`, liefert `call_control_id`), `endCall` Call-Control-Variante (`/v2/calls/{call_control_id}/actions/hangup`), `startAssistant` (`ai_assistant_start`). **Zentrale Seam-Entscheidung** (faellt VOR Impl): neue Methoden im bestehenden VoiceControl-Adapter (Empfehlung a, provider-neutraler Vertrag) vs. eigener enger Port (b). Die `call_control_id` wird als eigenes persistiertes Call-Feld gefuehrt (Grundlage fuer P6-Boot-Recovery).
- **Abhaengigkeiten:** P0 gruen. **Parallel/WT:** WT, parallel zu P7 (disjunkte Dateien).
- **Pre-Mortem:** falsche ID/Endpunkt beim Hangup → Kostenexplosion (Risiko c). Gegenmassnahme = expliziter Test der ID-Form.
- **Deterministisches Ergebnis:** gemockter `fetch` → assert URL/Body/`call_control_id`; TeXML byte-identisch daneben. Kein Netz.
- **Review-Gate:** dual, R1. Safety: `endCall` trifft korrekten Endpunkt.

### P4.5 — Call-Control-Event-Ingest (NEU, Befund f) — R1

- **Ziel:** Der signaturgepruefte Handler fuer die eingehenden Call-Control-Webhooks, der die event-getriebene Zustandsmaschine faehrt. OHNE diese Phase gibt es keine Disclosure-Sequenz und kein Call-End-Settlement.
- **Betroffene Dateien:** `src/server.js` (neuer/erweiterter Webhook-Handler unter `/voice/*`-Praefix, damit Ed25519 greift, `signature.js:40-56`); Mapping auf bestehende `finishCall`/`releaseReserve`/`armReserveReleaseTimer`/Timer-Pfade (`server.js:961-975`).
- **Was gebaut wird:** Parser fuer die Call-Control-Event-Shapes (`call.answered`, `speak.ended`, `call.hangup`, ai_assistant-Events) — deren JSON unterscheidet sich von den TeXML-Status-Callbacks. Zustandsmaschine:
  - `call.answered` → Disclosure-Speak-Node abfeuern.
  - `speak.ended` (des Disclosure-Nodes) → `ai_assistant_start` (gatet Regel 2).
  - `call.hangup` → `finishCall` + `releaseReserve` + Ist-Minuten buchen + Timer clearen (verhindert Reserve-Leak / gesperrtes Tenant-Budget).
- **Sicherheit:** Ed25519-Signaturpruefung fail-closed, explizit neu verdrahtet (Regel 3).
- **Abhaengigkeiten:** P4. **Parallel/WT:** WT, seriell (server.js).
- **Pre-Mortem:** Risiko (f). Gegenmassnahme = dieser Handler; `armReserveReleaseTimer`/`finishCall` sind erst NACH dieser Phase byte-identisch nutzbar.
- **Deterministisches Ergebnis:** Event ohne gueltige Signatur → 403; `call.hangup`-Fixture → `releaseReserve`+`finishCall` gerufen; `speak.ended`-Fixture → `ai_assistant_start` gefeuert (nicht davor).
- **Review-Gate:** dual, R1. Safety: fail-closed Signatur, kein verwaister Reserve-Pfad, Disclosure-Gate korrekt.

### P5 — Origination-Integration + Gate-Beweis — R1

- **Ziel:** Neuer Pfad an `server.js:1643` HINTER der kompletten Gate-Kette; Disclosure-Speak-Node vor `ai_assistant_start`.
- **Betroffene Dateien:** `src/server.js` (Einhaengung an `1643`, NICHT separater Pfad); `disclosureSentence`/`openingText` (`claude.js:171-198`, Wiederverwendung); Reserve/Timer-Armierung unveraendert; nutzt P4.5-Ingest fuer die Sequenz.
- **Was gebaut wird:** Verzweigung am Origination-Punkt: Flag an → Call-Control-Originate + (via P4.5) Disclosure-Speak-Node auf `answered` + `ai_assistant_start` auf `speak.ended`; Flag aus → bestehendes TeXML byte-identisch.
- **Abhaengigkeiten:** P4, P4.5. **Parallel/WT:** WT, seriell (server.js — Barriere).
- **Pre-Mortem:** Gate-Bypass (Risiko b). Beweis: Spawn-Test mit `fakeOriginate`, der jedes Gate 0-13 einzeln rot prueft.
- **Deterministisches Ergebnis:** jedes Gate blockt auch C-Telnyx (403/Deny); Disclosure ist erster Speak-Node (Reihenfolge assert, Sequenz gegen P4.5).
- **Review-Gate:** dual, R1, **maximale Safety-Sorgfalt**. S1 wenn irgendein Gate umgangen.

### P6 — Max-Dauer + Boot-Re-Arm + Mid-Call-Kill (Befunde 1+3) — R1

- **Ziel:** Kosten-Deckel (Minuten UND Tokens) greift auch ohne server-sichtbare Turns und ueberlebt Deploys.
- **Betroffene Dateien:** `src/server.js` (`terminateCappedCall:924-941`, `scheduleMaxDurationEnd:946-948`, `cancel_call:1710-1715`, **`rearmActiveCallTimers:2361`**, **`reattachActiveCall:1074`**), `src/telephony/reattach.js`; nutzt Call-Control-`endCall` aus P4.
- **Was gebaut wird:**
  1. **Alle Timer-Callsites** rufen fuer C-Telnyx-Calls das Call-Control-`endCall` mit `call.callControlId` (EIN Adapter, EINE Quelle, G5). Das schliesst `rearmActiveCallTimers` UND `reattachActiveCall`/`reattach.js` ein — deren Engine-/ID-Verzweigung haengt am neuen Flag bzw. an `call.callControlId`, **NICHT** an `voiceEngine === "realtime"` (heute early-return, greift bei C-Telnyx nicht → orphant Cap nach jedem Deploy, Befund 1).
  2. **Mid-Call-Enforcement verpflichtend** (Regel 1, Minuten UND Tokens): einer der drei Wege aus 0.1 (Watchdog / Token-Reserve / Per-Turn-`budgetExceeded`-Check im Shim), Owner-Entscheidung. NICHT "optional/deferred".
- **Abhaengigkeiten:** P4, P4.5, P5. **Parallel/WT:** WT, seriell (server.js).
- **Pre-Mortem:** Risiko (c). Gegenmassnahme = korrigierte ID/Endpunkt an ALLEN Callsites inkl. Boot-Recovery + verpflichtendes Mid-Call-Enforcement.
- **Deterministisches Ergebnis:** (i) aktiven C-Telnyx-Call persistieren → Neustart simulieren → assert `rearmActiveCallTimers`/`reattachActiveCall` treffen Call-Control-Hangup mit `call_control_id`; (ii) Timer feuert → Call-Control-Hangup; (iii) Budget-Cap mid-call ueberschritten → Abschluss-Ansage + Hangup; (iv) `cancel_call` desgl.
- **Review-Gate:** dual, R1, maximale Safety-Sorgfalt. Safety: idempotenter Hangup (`billedAt`-Guard erhalten), Boot-Recovery deploy-fest.

### P7 — Assistant-Provisioning/Config (Owner-abhaengig, teilw. WT)

- **Ziel:** Der Telnyx-Assistant ist reproduzierbar konfiguriert — inkl. deaktivierter eigener Greeting (Regel 2).
- **Betroffene Dateien:** NEU `scripts/telnyx-assistant-provision.mjs` (nicht Teil von `npm test`); Doku.
- **Was gebaut wird:** Skript/Runbook: Ela-Voice-Slot (bring your own voice), Custom-LLM-URL (`PUBLIC_URL/<shim-route>`), `interruption_settings`, **Greeting/first-message deaktiviert** (nur der deterministische Disclosure-Speak-Node spricht zuerst — Befund 5), Disclosure-Handling als Call-Flow-Node NICHT im Assistant-Prompt. IDs → Env (P10).
- **Abhaengigkeiten:** P0 gruen. **Parallel/WT:** teils WT, parallel zu P4.
- **Pre-Mortem:** Disclosure im Modell-Ermessen ODER Assistant-Greeting prescht vor (Regel 2). Gegenmassnahme = Speak-Node + Greeting aus.
- **Deterministisches Ergebnis:** Config reproduzierbar; IDs dokumentiert; Greeting nachweislich aus. **Owner-abhaengig** (Portal/Guthaben).
- **Review-Gate:** Doku-Review + Safety (Disclosure-Node, Greeting aus).

### P8 — Inbound-Pfad + Inbound-Budget-Gate (Befund 8) — R1

- **Ziel:** Inbound per AI-Assistant, Signatur erhalten, MIT Budget-Gate — Inbound laeuft NICHT durch die Origination-Kette und hat keine Vorab-Reserve.
- **Betroffene Dateien:** `src/server.js` (`/voice/incoming`-Aequivalent, Signatur `479-489`); nutzt korrigierten Max-Dauer-Pfad aus P6.
- **Was gebaut wird:** Inbound-Answer → **Budget-Gate** (globaler∩Tenant-Cap-Check via `budgetExceeded`, Ablehnung bei Ueberschreitung — sonst Toll-Fraud-Vektor: wiederholte Anrufe, KI redet unbegrenzt) → Disclosure (falls anwendbar) → `startAssistant`. Ed25519-Signatur greift ueber `/voice/*`-Praefix, sonst explizit neu verdrahten. Max-Dauer-Timer aus P6 (korrigierte ID).
- **Abhaengigkeiten:** P4, P4.5, P5, P6. **Parallel/WT:** WT, seriell (server.js).
- **Pre-Mortem:** Signatur faellt weg (Regel 3) ODER Inbound ohne Budget-Gate (Regel 1, Befund 8). Gegenmassnahme = beides getestet.
- **Deterministisches Ergebnis:** Inbound ohne Signatur → 403; Budget-Cap ueberschritten → Ablehnung; mit → Assistant-Start.
- **Review-Gate:** dual, R1. Safety: fail-closed Signatur + Inbound-Budget-Gate.

### P9 — Engine-Flag/Selektion — R1

- **Ziel:** Ein Flag schaltet den Pfad; ALLE Auswertungsstellen ergaenzt.
- **Betroffene Dateien:** `src/config.js` (`TELNYX_AI_ASSISTANT_ENABLED`, Default `"false"`); `src/server.js` (ALLE Verzweigungsstellen, die heute auf `voiceEngine` schauen: `1040`, `1166`, `1657`, `2362` (rearm), `2442`, plus `reattach.js`); `registry.js:37-40`.
- **Was gebaut wird:** **eigenes orthogonales Flag** (nicht dritter `VOICE_ENGINE`-Wert), weil Engine-Achse (budget/realtime) und Origination-Art (TeXML/Call-Control) orthogonal sind. **Kritisch (Befund 1/Red-Team-Solide):** ueberall, wo heute `voiceEngine`-Checks sitzen, muss das neue Flag MIT-beruecksichtigt werden — sonst laeuft C-Telnyx-Logik faelschlich durch die `voiceEngine==="budget"`-Zweige (v.a. Boot-Re-Arm). Flag aus = byte-identisch.
- **Abhaengigkeiten:** P5, P6. **Parallel/WT:** WT, seriell (server.js/config.js).
- **Pre-Mortem:** Flag schaltet stumm ein Gate ab, ODER eine `voiceEngine`-Stelle vergessen. Gegenmassnahme = `productionFootguns` fail-closed + Flag-Matrix-Test an ALLEN Stellen.
- **Deterministisches Ergebnis:** Flag-Matrix-Test an allen Auswertungsstellen (inkl. rearm/reattach); Flag aus = Bestandssuite gruen.
- **Review-Gate:** dual, R1. Safety: Default fail-closed, `assertConfig`-Eintrag, keine `voiceEngine`-Stelle vergessen.

### P10 — Observability + Tests + Doku

- **Ziel:** Alle neuen Env-Vars/Flags dokumentiert, Metriken, Sicherheits-Doku.
- **Betroffene Dateien:** `.env.example`, `render.yaml` (`sync:false` Secrets), `test/helpers.js` `BASE_ENV` (neutrale Defaults — Drift-Regel!), `PLAN-SECURITY.md`, `README.md`, `config.js` (`assertConfig`/`productionFootguns`), Metrik-Seam (Time-to-first-Token).
- **Was gebaut wird:** jede neue Var an 4 Orten; `assertConfig`-Pflichtpruefung bei aktivem Flag; `productionFootguns` fuer Gate-Flags; Sicherheits-Doku fuer Origination-Pfad + Custom-LLM-Endpunkt + Event-Ingest + Inbound-Budget-Gate.
- **Abhaengigkeiten:** alle Code-Phasen. **Parallel/WT:** WT, mit P9.
- **Deterministisches Ergebnis:** `grep`-Check je Var an 4 Orten nicht leer; `assertConfig`-Test.
- **Review-Gate:** dual. Safety: PLAN-SECURITY.md aktualisiert (Pflicht bei Security-Aenderungen).

### P11 — Live-Cutover (Owner-gated) — R1

- **Ziel:** C-Telnyx live, Barge-in + Ela + Disclosure-Reihenfolge im echten Call bestaetigt.
- **Betroffene Dateien:** keine (Code deployt inaktiv; hier nur Flag-Schaltung + `git push upstream master`).
- **Ablauf:** Code deployen (upstream), `[boot]`-Banner-Commit verifizieren, DANN Owner setzt `TELNYX_AI_ASSISTANT_ENABLED=true` + IDs/Secrets im Dashboard. Owner-Testanruf: Barge-in + Ela + kein Track-Suppress + **Disclosure ZUERST** bestaetigt (Regel 2, Live-Kriterium). Rollback-Drill: Flag aus → Budget-Engine.
- **Abhaengigkeiten:** P0-P10. **Parallel/WT:** nein. **Owner-abhaengig: ja.**
- **Pre-Mortem:** Risiko (e). Gegenmassnahme = Code inaktiv deployt, Flag nach Verifikation, Boot-Re-Arm deploy-fest (P6), Rollback = Flag aus.
- **Deterministisches Ergebnis:** Live-Call-Protokoll (Barge-in ja, Ela ja, Disclosure-erst ja); Rollback getestet.
- **Review-Gate:** Owner-Freigabe.

---

## 5. Orchestrierungs-Modell

### 5.1 Lead = reiner Orchestrator, bleibt <100k Tokens (mit Ausnahme fuer R1-Phasen, siehe 5.5)

- **EINE Session** ist der Lead: sie liest bei Nicht-R1-Phasen NIE Code. Pro Phase startet sie genau EINEN `phase-impl-lean`-Lauf und bekommt nur den Postage-Stamp-Return (`phaseId`, `finalBranch`, `gate` PASS/BLOCKED, `testPassCount`, `filesTouched` ≤40, `fixRounds`, `remainingBlockers`, `reportPath`, `summary` ≤600 Zeichen).
- **Per-run gepinntes Skript gegen Args-Misfire:** vor jedem Lauf editiert der Lead NUR den `PHASE_CONFIG`-Block in `tasks/wf-phase-impl-lean.js` (phaseId/phaseTitle/branch/planDoc/specFile hart gebacken). Kein generischer roher `args`-Aufruf. Der Lead prueft den echten Git-Stand selbst.
- **Merge im Lead:** merged den zurueckgegebenen `finalBranch` (kann `BRANCH-fixN` sein), NICHT blind `BRANCH`. Jede Phase in frischer Session.
- Der Lead schreibt pro Phase eine Spec (`tasks/<phase>-spec.md`, Format: Scope / NICHT in Scope / Invarianten+Safety / deterministisch pruefbare Checks / Reiner-Refactor-Hinweis).

### 5.2 Modell-Politik pro Sub-Agent

Subagenten erben NIE das Lead-Modell (Fable). Explizit pro `agent()`-Call gepinnt:
- **Opus** = Plan + Safety-Review.
- **Sonnet** = Implementierung + Clean-Code-Audit + Self-Fix + Report.

### 5.3 Konkrete Reihenfolge inkl. Parallel-Bloecke

```
[Owner]      P0 De-Risking-Spike  ─── gated alles ab P4 ───┐
[parallel]   P1 Shim (Agent)  ──┐  (P0=Owner, P1=neue Datei: echt parallel)
                                 │
             ── Barriere: Merge P1 ──
             P2 (WT) ─ seriell   [P3a haengt an P1 UND P4 -> spaeter; P3b nur falls P0-Latenz rot]
                                 │
             ── warte auf P0 gruen ──   (rot => STOP, Fallback C-ElevenLabs)
                                 │
[parallel]   P4 Call-Control-Adapter (WT)  ║  P7 Provisioning (WT)   (disjunkte Dateien)
                                 │
             ── Barriere: Merge P4 (+P7) ──
             P4.5 Event-Ingest (WT, server.js)   ─ seriell ─┐
             P3a Tool+end_call (WT, Shim)        ─ seriell ─┤ (haengt an P4; Shim-Datei, parallel zu server.js moeglich, aber sicher seriell)
             P5 Origination+Gate-Beweis (WT)     ─ seriell ─┤
             P6 Max-Dauer+Rearm+Kill (WT)        ─ seriell ─┤  (alle server.js => keine Parallelitaet)
             P8 Inbound+Budget (WT)              ─ seriell ─┤
             P9 Engine-Flag (WT)                 ─ seriell ─┘
                                 │
[parallel]   P10 Doku+Tests+Obs (WT)   (config.js-Beruehrung => nach P9 mergen)
                                 │
[Owner]      P11 Live-Cutover  (Flag im Dashboard, Testanruf inkl. Disclosure-Reihenfolge, Rollback-Drill)
```

Alle server.js-anfassenden Phasen (P4.5, P5, P6, P8, P9) sind **seriell** mit Merge im Lead zwischen jeder. Worktree-Isolation gilt trotzdem je Lauf.

### 5.4 Wann der Lead auf den Owner wartet

- **Vor P4:** bis P0-Spike gruen (Owner-Testanruf inkl. Disclosure-Kriterium). Rot = Kette stoppt, Umschwenk auf C-ElevenLabs.
- **P7:** Owner-Telnyx-Portal-Zugriff/Guthaben.
- **P11:** Owner setzt Live-Flag + IDs, fuehrt Live-Testanruf + Rollback-Drill.

### 5.5 Lead-Ausnahme fuer Regel-1-Phasen (Befund 9)

Fuer R1-Phasen (P1, P3a, P4, P4.5, P5, P6, P8, P9, P11) reicht `gate=PASS` allein NICHT fuer den Merge. Genau bei diesen Phasen materialisiert sich Pre-Mortem (b)/(c)/(f)/(g) ueber den Prozess: verfehlt der Safety-Sub-Agent ein umgangenes Gate oder den `rearmActiveCallTimers`-Pfad, gibt es sonst keine zweite Instanz. Deshalb:

- Der Lead (Opus) liest bei R1-Phasen den **Safety-Review-Abschnitt** des Reports (NICHT den ganzen Code — sprengt <100k nicht) ODER startet einen zweiten unabhaengigen Safety-Pass mit der konkreten Checklist:
  - Laufen ALLE Gates 0-13 auch fuer den C-Telnyx-Pfad?
  - Kennen `rearmActiveCallTimers` UND `reattachActiveCall` die `call_control_id` (nicht `twilioSid`)?
  - Haengt keine Engine-Verzweigung faelschlich an `voiceEngine`?
  - Ist der Shim 404 bei Flag aus + per-Call-gebunden + Budget-gegatet?
  - Feuert `call.hangup` → `releaseReserve`+`finishCall`? Gatet `speak.ended` das `ai_assistant_start`?
  - Hat Inbound (P8) ein Budget-Gate?
- Erst nach gruener Checklist merged der Lead.

---

## 6. Offene Fragen / Unbekannte

1. **Exakter Custom-LLM-Contract (Telnyx BYO-LLM):** Request/Response-Format am `/v1/chat/completions`? Streaming zwingend? Felder (`tools`, `tool_calls`)? → **P0-Spike** + Telnyx-Doku.
2. **Auth des Shim-Endpunkts / Per-Call-Bindung:** Kann Telnyx BYO-LLM ein per-Call-Secret/Header setzen (dann echte per-Call-Bindung) oder nur einen statischen Header (dann Korrelation `callId`→Store validieren + rate-limitieren)? Signiert Telnyx per Ed25519 (`TELNYX_PUBLIC_KEY` wiederverwendbar)? → **P0/P1**; bis geklaert: 404 bei Flag aus + per-Call-Token gegen Store.
3. **Existiert ein Call-Control-Client?** Nein (Grep bestaetigt). `ai_assistant_start`/`/v2/calls` komplett neu. Endpunkt-/Payload-Schema → **P4**.
4. **Eigene Connection-ID fuer Call Control** getrennt von `TELNYX_CONNECTION_ID` (TeXML-App)? Vermutlich ja. → **P4/P7**, empirisch im Portal.
5. **Tool-Calling ueber Custom-LLM:** Loop komplett im Shim (empfohlen, in-house Store-Seiteneffekte) oder Telnyx erwartet OpenAI-`tool_calls` + eigene Webhook-Tools? → **P0-Kriterium 3** + **P3a**.
6. **Call-Control-Event-Shapes:** Exaktes JSON von `call.answered`/`speak.ended`/`call.hangup`/ai_assistant-Events (unterscheidet sich von TeXML-Callbacks)? → **P0/P4.5** gegen Telnyx-Doku.
7. **Echte Latenz erste Silbe mit Claude:** reicht Fake-Stream + Haiku oder braucht es P3b? → **P0-Messung**.
8. **Ela-Voice-Referenzierung im Assistant:** kann der Voice-Slot die bestehenden `ELEVENLABS_*`-Credentials nutzen oder braucht es eine eigene Telnyx-Integration-Secret-Referenz? → **P0/P7**.
9. **Track-Suppress-Risiko:** suppresst der AI-Assistant-Weg den Inbound-Track (wie der Live-Relay-Weg, `render.js:60-65`)? → **P0-Kriterium 2**.
10. **Kann der Assistant seine eigene Greeting/first-message vollstaendig deaktiviert werden** (Regel-2-Voraussetzung)? → **P0-Kriterium 4** + **P7**.
11. **Telnyx Custom-LLM Request-Timeout:** wie lang darf ein Shim-Turn dauern, bevor Telnyx abbricht/wiederholt? Sprengt der 4-Roundtrip-Tool-Loop (>15s Worst-Case) das Timeout? → **P0-Messung** (Timeout zuerst ermitteln); Gegenmassnahmen: Roundtrip-Cap senken / Keepalive-Token / Timeout-Config.
12. **Mid-Call-Enforcement-Weg:** Watchdog (`setInterval`) vs. Token-Vorab-Reserve vs. Per-Turn-`budgetExceeded`-Check im Shim — welcher? Liefert Telnyx Kosten-Events pro Call (fuer Watchdog)? → **Owner-Entscheidung in P0/P6** (verpflichtend, nicht optional).
13. **`interruption_settings`-Tuning** — Env-konfigurierbar oder fest in Assistant-Config? → **P7**.

---

## 7. Rollback / Kill-Switch

- **Primaerer Kill-Switch:** `TELNYX_AI_ASSISTANT_ENABLED=false` im Render-Dashboard. Sofortiger Ruckfall auf die budget/TeXML-Engine — der bestehende Pfad (`/voice/turn`, `renderPlay`/Play-TTS Ela, `originateCall` TeXML) bleibt byte-identisch erhalten, nur verzweigt.
- **Global-Not-Aus bleibt daneben scharf:** `OUTBOUND_FROZEN` (`config.js:280`, `server.js:1448-1453`) friert JEDEN Outbound unabhaengig vom Engine-Flag — auch C-Telnyx.
- **Byte-Identitaet des Live-CALL-Pfads bis Aktivierung:** bei Flag aus laeuft der Call-Pfad exakt wie heute (gruene Baseline). **Achtung Nuance (Befund g):** der Shim-Endpunkt EXISTIERT dann zwar im Code, antwortet aber **404** (Existenz hinter dem Flag) — er ist keine offene Angriffsflaeche zwischen P1-Merge und Cutover.
- **Cutover-Sicherheit (Risiko e):** Code inaktiv deployt; Flag schaltet erst NACH `[boot]`-Banner-Verifikation. Rollback = Flag aus, kein Redeploy. Boot-Re-Arm (P6) macht laufende Calls deploy-fest.
- **Deploy-Rollback (harter Fall):** `git revert` des Cutover-Commits + `git push upstream master`. Der Flag-Weg ist schneller und bevorzugt.
- **Fallback-Weg bei P0-rot:** Schwenk auf C-ElevenLabs (ElevenLabs Conversational AI). Der Brain-Shim P1-P3 ist bei beiden Wegen identisch, nicht verloren — nur P4-P8 (Call-Control/Event-Ingest/Assistant-Provisioning) waeren neu auf ElevenLabs auszurichten.

---

## 8. Red-Team-Changelog (was gegenueber dem Entwurf geaendert wurde)

Alle neun Befunde wurden nach eigener Code-Verifikation als valide bestaetigt (u.a. `rearmActiveCallTimers:2362` early-return nur auf `voiceEngine==="realtime"` + `call.twilioSid` an `2371/2374`; `reserveCents` telefonie-only; `trackUsage` post-roundtrip an `claude.js:401`).

1. **Boot-Re-Arm orphant den Cap (S1):** P6 nimmt `rearmActiveCallTimers` UND `reattachActiveCall`/`reattach.js` in Scope; `call_control_id` als eigenes persistiertes Feld; Verzweigung am Flag/`callControlId`, NICHT an `voiceEngine`. P9 verpflichtet, ALLE `voiceEngine`-Stellen mit-zu-beruecksichtigen.
2. **Fehlender Event-Ingest (S1):** neue Phase **P4.5** vor P5; "byte-identisch"-Behauptung fuer `finishCall`/`releaseReserve` auf "erst nach P4.5" korrigiert (Abschnitt 1.2).
3. **Token-Kosten ausserhalb der Reserve (S1):** Regel 1 (0.1) trennt Minuten ≠ Tokens; Mid-Call-Enforcement in P6 verpflichtend statt optional; Pre-Mortem (c) umgeschrieben.
4. **Shim-Angriffsflaeche (S1):** Regel 3 (0.3) + P1: 404 bei Flag aus, per-Call-Token statt globalem Secret, Budget-/Rate-Gate am Shim; Pre-Mortem (g); Rollback-Nuance (Abschnitt 7).
5. **Disclosure nie empirisch verifiziert (S1):** Regel 2 (0.2) + P0-Kriterium 4 + P11-Live-Kriterium; P7 deaktiviert Assistant-Greeting.
6. **`end_call` beendet Call nicht (S1):** P3a setzt `end_call` als out-of-band Call-Control-Hangup um (haengt jetzt an P4).
7. **Tool-Loop-Latenz sprengt Telnyx-Timeout (S2):** offene Frage #11 + P0 misst Worst-Case-Tool-Loop-Latenz + Timeout; Pre-Mortem (d) erweitert.
8. **Inbound ohne Budget-Gate (S2):** P8 umgewidmet zu "Inbound-Pfad + Inbound-Budget-Gate".
9. **Lead rubber-stampt R1-Phasen (S3):** Abschnitt 5.5 (Lead-Ausnahme + Safety-Checklist) + R1-Spalte in der Phasen-Tabelle.
