# IEX-R2 — Budget-Engine loeschen, EL-Inbound auf alle Tenants, Kosten-Join

Stand 2026-09-15, nur gelesen (Code-Stand master 2893367). Quellen als `datei#symbol`. Keine Anbieter-,
Prod-DB- oder Render-Lesezugriffe; alles "live" stammt aus `tasks/iel-cutover-protokoll.md`.
Markierungen: **UNBELEGT** = nicht am Code/Beleg gezeigt; **SCHAETZUNG** = Zahl ohne Einzelpruefung.

---

## A. Loeschumfang Budget-Engine

### A0. Zwei Befunde, die den Schnitt bestimmen

1. **Es gibt noch einen Outbound-Budget-Pfad.** `routes/api-calls.js` (Handler `POST /api/calls`,
   `else`-Zweig von `config.voice.elevenLabsOutbound.enabled`): `recordCostProfile(TELNYX_BUDGET)` ->
   `voiceControl().originateCall({url: /voice/outbound})` -> `routes/voice.js` `/voice/outbound`
   (`openingText`, Anrufbeantworter-Erkennung GAP-21) -> `/voice/turn`. Live ist er **tot** (Outbound
   laeuft ueber EL, belegt: Runbook 12 `conv_7001…` direction outbound), aber er ist die heutige
   Bedeutung von `ELEVENLABS_OUTBOUND_ENABLED=false` (Default `false` in `config.js#elevenLabsOutbound`
   und `render.yaml`). Loeschen heisst: "Schalter aus" muss eine neue, fail-closed Bedeutung bekommen
   (Anruf nicht platzieren), sonst ist der Default ein Anrufweg ins Leere.
2. **Der EL-Inbound-Weg haengt heute selbst an der Budget-Engine**: `routes/voice.js#starteRueckfall`
   (Entscheidung `RUECKFALL_STARTEN` aus `elevenlabs/inbound-rueckfall.js#rueckfallEntscheidungFuer`)
   rendert `turnDirectives` -> `/voice/turn`; `/voice/el-rueckfall` fuer Budget-Beine antwortet mit
   `sendFolgeGather`. Die Owner-Entscheidung "Uebergabe-Fehler -> fester Satz + auflegen" muss deshalb
   **zuerst** gebaut werden.

### A1. Tabelle loeschen / bleibt / unklar

**Routen und Einstieg**

| Element | Urteil | Grund / Quelle |
|---|---|---|
| `POST /voice/turn` (`routes/voice.js`), `sendTurnOutcome`, `capFarewellOutcome`, `budgetHangupOutcome`, `noSpeechOutcome` | loeschen | nur Budget-Turn-Loop |
| `POST /voice/outbound` (`routes/voice.js`) | loeschen | nur TeXML-Outbound-Zweig (A0.1) |
| `routes/voice.js#sendBudgetBegruessung`, `INBOUND_PFAD.BUDGET`, `starteRueckfall`, `sendFolgeGather`, `repeatDeliveryXml`-Gather-Zweig | loeschen/ersetzen | durch "Satz + Hangup" (A0.2, B.c) |
| `POST /voice/incoming` | **bleibt** | traegt die sieben Sicherungen (A3) |
| `POST /voice/status` | **bleibt** | Status-Callback des EL-Inbound-Traegerbeins (`startInboundNachlauf`, Abschluss via `terminateAndBillCall`) |
| `POST /voice/el-rueckfall`, `/voice/el-bein` | **bleiben** (aendern) | Dial-Ende/Frist -> Hangup; nur der Rueckfall-Zweig wird "Satz + Hangup" |
| `GET /voice/tts/:token` | **bleibt** | Play-TTS des Pflichtsatzes vor dem Dial (Log `[play-tts] … Pflichtsatz vor dem Dial`, Protokoll Schritt 11) |
| `route-policy.js` Eintraege `/voice/turn`, `/voice/outbound` | loeschen | sonst `test/route-auth-inventory.test.js` rot |
| `routes/api-calls.js` TeXML-`else`-Zweig (`originateCall`, `TELNYX_BUDGET`) | loeschen | A0.1; neue Bedeutung "EL aus = nicht platzieren" |

**Module (src/)** — Importeure aus einem Import-Graphen ueber `src/ scripts/ test/` (nur Produktionsimporteure genannt)

| Modul | Urteil | Produktions-Importeure / Grund |
|---|---|---|
| `speech-chunker.js`, `speech-shape.js`, `thinking-signal.js`, `tool-follow-up.js` | loeschen | nur `claude.js` (Streaming/Denk-Signal/Nachfassen; Rest-Befund R-1 `tasks/inbound-ein-system-stand.md`) |
| `turn-budget.js` | loeschen (Konstante umziehen) | `claude.js`, `boot.js#warnTurnBudgetOverrun`; `PROVIDER_WEBHOOK_HARDCUT_MS` braucht `telephony/webhook-idempotenz.js` weiter |
| `no-speech-escalation.js` | loeschen | nur `routes/voice.js` |
| `call-memory.js` | loeschen | nur `claude.js#callMemorySection` + `state-ops.js` (`MEMORY_MAX_CALLS`); kein EL-Leser — Feature ist live schon weg |
| `research/in-call.js` | loeschen | nur `claude.js`; EL-`look_up` nutzt `research/registry.js` + `lookup-guard.js` (`routes/webhooks-elevenlabs.js`) |
| `telephony/leg-turn-loop.js` | loeschen | nur `routes/voice.js#repeatDeliveryXml` |
| `telephony/sprechpfad.js` | loeschen | `boot.js#inboundSprechpfadBannerLine`, `scripts/inbound-hoerprobe.mjs` |
| `telephony/stt-profile.js`, `telephony/adapters/telnyx/stt-model.js` | loeschen | `config.js#sttProfile`, `boot-guard.js#sttProfileFindings`, `adapters/telnyx/render.js` (Gather) |
| `telephony/answered-by.js` | loeschen | `/voice/outbound` + `webhook-events.js#parseAnsweredBy` (GAP-21) |
| `llm-billing-outage.js` | **unklar** | nur `routes/voice.js` (`/voice/turn`-catch); ob der Guthaben-Alarm fuer Summary/Briefing gebraucht wird, ist Owner-Frage |
| `claude.js` | **aendern** (schrumpft auf ~120 Zeilen) | loeschen: `agentTurn`, `systemPrompt` samt Bausteinen, `openingText`, `toolDefs`/`agentTools`/`execTool`, `callerHasSpoken`, `shouldSuppressEndCall`, `streamSinkFor`, primaerer `llm`-Client. **bleibt:** `summarizeCall` (+`recordedItemsBlock`; `server.js` -> `call-finish.js`), `isSubstantialCallerText` (`inbox-entry.js`), `disclosureSentence` (A2) ; `agentToolNames` (`precall-briefing.js`) braucht eine EL-Werkzeugquelle (**unklar**) |
| `llm.js`, `llm/*` | **bleibt** (aendern) | `createSecondaryLlmClient` fuer Summary (`claude.js`), `opening-line-llm.js`, `precall-briefing.js`; `degradedSpeechFor` + `LLM_UNAVAILABLE`-Sprechsaetze loeschen; DeepSeek/Anthropic-Port unberuehrt |
| `budget-gate.js` | **bleibt** | `server.js`, `webhooks-elevenlabs.js` (look_up), Geld-Wache |
| `call-duration.js`, `telephony/call-lifecycle.js`, `telephony/budget-watchdog.js` | **bleibt** | Notbremse, Cap, Geld-Wache (Regel 1) — auch EL-Inbound (`armMaxDurationTimer`) |
| `telephony/webhook-idempotenz.js` | aendern | `forTurn`/`turnAnchors`/`newTurnToken` weg; `forIncoming`/`forElRueckfall`/`forElBein` bleiben |
| `telephony/voice-render.js` | aendern | `turnDirectives`/`followupTurnDirectives` (Gather) weg; `render` bleibt |
| `telephony/directives.js` | aendern | `gather` weg; `say`/`sayWithVoiceId`/`hangup`/`redirect`/`dialSip` bleiben (`inbound-rueckfall.js`) |
| `telephony/adapters/telnyx/render.js` | aendern | `renderGather`/`gatherPrompt`/STT-Attribute weg; `renderDialSip`/Say/Play bleiben |
| `telephony/adapters/telnyx/voice.js` | aendern | `originateCall` + AMD-Felder (`TEXML_AMD_FIELD`) weg; Hangup/Belege (`assignCostRecords`) bleiben |
| `telephony/adapters/telnyx/webhook-events.js` | aendern | `parseSpeechResult`, `parseAnsweredBy` weg; `parseLifecycleEvent`, `parseSpeakOutcome` bleiben |
| `telephony/inbound-path.js` | aendern | Enum `BUDGET` weg, `ELEVENLABS` bleibt (ggf. `ABGEWIESEN`) |
| `tts/directive-synth.js`, `tts/synth.js`, `tts/store.js`, `adapters/telnyx/elevenlabs-voice.js` | **bleibt** | Pflichtsatz-Synthese (E19) und `elevenlabs/call-locale.js` |
| `consult/in-call.js` | aendern | `decideConsultRequest`/`advanceConsultWait`/`consultAvailableFor`/`CONSULT_WAIT_MS` (Budget-Turn) weg; `GET_CONSULT_TOOL_NAME`, `MAX_IN_CALL_CONSULTS_PER_CALL`, `CONSULT_OPEN_MS` bleiben (EL, `boot.js`, `api-calls.js`) |
| `i18n/prompts/{de,en,fr}.js`, `i18n/locales.js` | aendern | `summaryInput`, `recorded`, `turnControl` (EL-Webhook) bleiben; Situations-/Sprech-/Werkzeugregeln, `followUp`, `turnErrorSpeech`?/`noSpeechReprompt`/`capFarewellSpeech`/`llmDegradedSpeech` weg. `disclosure` **bleibt** |
| `i18n/inbound-notice.js` | aendern | `rueckfallBegruessung` weg; `withInboundNotice`/`begruessungOhnePflichtsatz` bleiben (`greeting-notice-migration.js`, `inbound-initiation.js`) |
| `metrics.js` | aendern | `logTurnGap`, `logSpeechResult`, `recordTurnRendered` weg |
| `store/state-ops.js` + `json.js`/`pg.js`/`store.js` | aendern | `countNoSpeechTurn`, `clearNoSpeechStreak`, `counterpartyMemory` weg; `markInboundElFallback` bleibt als Marker |
| `billing/kostenarten.js` Profile `TELNYX_BUDGET`, `TELNYX_INBOUND_BUDGET` | **bleibt vorerst** | Altzeilen (`legacyKostenprofil`), Schluesselmengen-Riegel, `VOICE_TARIFF_GRUNDBETRAG_CENTS`-Boot-Refusal; erst loeschen, wenn jede Zeile mit diesen Profilen `costTruedAt` hat (Prod-DB-Beleg noetig) |
| `billing/metering.js#billsCalibratedInboundRate`, `config.billing.voiceTariffInboundCents`, `cost-calibration.js#INBOUND_KOSTENPROFILE` | loeschen/aendern | C.3 |
| `config.js` voice: `voiceEngine`, `sttProfile`, `sttSpeechTimeoutSec`, `maxEmptyTurns`, `callerSubstanceMinLen`, `thinkingSignalEnabled`, `toolFollowUpEnabled`; safety `capFarewellLeadMs`; telephony `machineDetection`; tenancy `consultWaitMs` | loeschen | einzige Leser in der Budget-Kette (Grep) |
| `config.js` llm `llmRequestTimeoutMs`/Retry/Breaker | **unklar** | Leser u.a. `llm.js`, `research/in-call.js`, `turn-budget.js`; ob Summary/Briefing sie brauchen, am Client pruefen |
| `mcp-tools.js` / `routes/api-read.js` Feld `voiceEngine` (`get_agent_status`, `z.string()`) | aendern | MCP-Ausgabevertrag — Wert umstellen (z.B. `elevenlabs`) statt Feld entfernen |
| `boot.js`: `Voice-Engine:`-Zeile, `inboundSprechpfadBannerLine`, `thinkingSignalBannerLine`, `warnTurnBudgetOverrun`, `assertSttProfile` | loeschen/aendern | Banner D |

**Skripte**

| Skript | Urteil |
|---|---|
| `scripts/convo-bench.mjs` + `scripts/convo-bench/` (14 Dateien + `scenarios/`), `package.json` `convo-bench` | loeschen (treibt `/voice/turn`, `driver-texml.mjs`) |
| `scripts/inbound-hoerprobe.mjs`, `package.json` `inbound:hoerprobe` | loeschen (Sprechpfad-Klassifikation) |
| `scripts/stt-wer.mjs`, `anruf-unterbrechungen.mjs`, `deepseek-b1-messung.mjs`, `telnyx-call-latency.mjs` | unklar (Messwerkzeuge fuer Gather-STT/Turn-LLM/entfernten Assistant) |

**Tests**: 108 von 694 `test/*.test.js` (+ Helfer/Fixtures) beruehren Budget-Symbole
(`/voice/turn`, `agentTurn`, `/voice/outbound`, `systemPrompt(`, `openingText`, Gather-Direktiven,
Budget-Module). **SCHAETZUNG:** ~50–60 ganz loeschen, Rest anpassen. Keiner traegt ein
`[abgenommen …]`-Siegel aus `test/abnahme-ausgewandert.json` (geprueft, D13 unberuehrt). 7 Dateien
tragen Katalog-IDs der Gates-Bank (`f1-i18n-locale`, `characterization-marking`,
`language-switch-midcall`, `max-duration-live-cap`, `cq-p6-mandate`, `assistant-context-render`,
`cq-p8-briefing`) — je ID entscheiden, nicht pauschal loeschen. Nicht loeschen, sondern migrieren:
`iel-b8-weiche` (sieben Sicherungen vor der Weiche), `test/fixtures/iel-incoming-budget-golden.xml`
(Golden faellt mit dem Budget-Zweig; Ersatz-Golden fuer "nicht registriert").

### A2. Was beim Loeschen NICHT verloren gehen darf

| Invariante | Heutige Stelle | Folge fuer den Schnitt |
|---|---|---|
| Ed25519-Signatur fail-closed | `routes/voice.js` `router.use("/voice")`, `adapters/telnyx/signature.js` | unberuehrt lassen |
| Wiederholungs-Riegel | `webhook-idempotenz.js#forIncoming` | bleibt; Ersatzantwort = leeres Dokument |
| Tenant nur ueber DID nach Signatur | `/voice/incoming` `store.numberRecordByE164` | bleibt, Unrouted-Say+Hangup |
| Kostendecke sperrt Inbound | `/voice/incoming` `store.budgetExceeded` | bleibt VOR der Weiche (Regel 1, E11-Rueckzug) |
| Max-Dauer + Geld-Wache | `brakeSecondsFor` -> `lifecycle.armMaxDurationTimer` (`budget-watchdog.js`); `<Dial timeLimit>` aus `callMaxDurationMs` | bleibt; `capFarewellOutcome` (Abschiedssatz) entfaellt ersatzlos — EL-Cap legt ohne Satz auf |
| Kostenprofil set-once vor dem Sprechen | `store.recordCostProfile` | bleibt |
| Pflichtsatz als erstes Verb | `sendElUebergabe` (`sayWithVoiceId(locale.inboundNotice)`) | bleibt; auch der neue Fehlersatz-Pfad muss ihn nicht wiederholen, aber nie KI-Sprache ohne Kennzeichnung |
| Mid-Call-Decke fuer LLM-Token | heute `claude.js#roundStopReason` im Turn | entfaellt mit dem Turn; EL-Token werden erst im Nachlauf gebucht (`finishCall`), die Geld-Wache rechnet Minuten x Satz — bewusst festhalten |
| Offenlegung Outbound (Regel 2) | EL: `elevenlabs/call-locale.js` (`locale.disclosure(ownerName)` in `firstMessage`), Riegel `convai.js#assertOverrideWhitelisted` | **`claude.js#disclosureSentence` hat keinen EL-Leser** (nur `openingText`/`systemPrompt`). CLAUDE.md Regel 2 nennt aber genau dieses Symbol -> nicht still loeschen: Owner-Entscheidung, ob der Name in CLAUDE.md auf `LOCALES.<lang>.disclosure`/`call-locale.js` umgestellt oder `disclosureSentence` als EINE Quelle fuer `call-locale.js` erhalten wird |

### A3. Phasenschnitt (je einzeln deploybar, Abhaengigkeitsreihenfolge)

| # | Phase | Inhalt | Dateien (SCHAETZUNG src+test) | haengt ab von |
|---|---|---|---|---|
| L0 | Kosten-Join-Rauschen | C.4 | 3 src + 1 Test | – |
| L1 | Uebergabe-Fehler = Satz + Hangup | `starteRueckfall` -> fester Satz (`turnErrorSpeech` oder neuer Locale-Satz) + `<Hangup/>`, Marker `markInboundElFallback` bleibt; `rueckfallBegruessung` weg; `PLAN-SECURITY.md` IEL-B8 | ~4 src + ~4 Tests | – |
| L2 | Inbound-Satz = Outbound-Satz | C.3 | ~5 src/Env + ~4 Tests | – |
| R1 | Registrierung je DID + Weiche "registrierte DIDs" | B.a/B.b | ~9 src + ~5 Tests | L1 |
| R2 | Cutover alle Tenants | nur Betrieb: Registrierungen nachziehen, Scope umstellen, Testanrufe | 0–2 | R1, Beobachtung |
| D1 | TeXML-Outbound entfernen | `api-calls.js` else-Zweig (EL aus = nicht platzieren), `/voice/outbound`, `openingText`, AMD (`answered-by.js`, `voice.js#originateCall`, `webhook-events.js`, `config.machineDetection`), `route-policy.js` | ~8 src + ~7 Tests | – (Outbound-EL live seit 19.08.) |
| D2 | Inbound-Budget-Zweig + `/voice/turn` | `routes/voice.js` Turn-Route + Budget-Weiche (nicht registriert -> Satz+Hangup), `leg-turn-loop.js`, `no-speech-escalation.js`, `llm-billing-outage.js`?, `webhook-idempotenz.js#forTurn`, `inbound-path.js`, `route-policy.js`, Store-No-Speech | ~10 src + Tests in 2 Teilen | R2, D1 |
| D3a | Streaming/Denk-Signal/Nachfassen | `speech-chunker`, `speech-shape`, `thinking-signal`, `tool-follow-up`, `turn-budget`, Config-Schalter, Boot-Zeile | ~8 src + ~10 Tests | D2 |
| D3b | Turn-Schleife in `claude.js` | `agentTurn`/`systemPrompt`/Werkzeuge, `call-memory.js`, `research/in-call.js`, `consult/in-call.js` (Teil), `precall-briefing.js#agentToolNames`-Ersatz | ~7 src; Tests ~30 -> in 2–3 Unterphasen nach Testgruppe (`al-p*`, `cq-p*`/`gq-p*`, `ww-*`/Rest) | D3a |
| D3c | Prompt-Texte | `i18n/prompts/*`, `locales.js`, Sprechsaetze | ~5 src + ~5 Tests | D3b |
| D4 | Render-/STT-Schicht | `voice-render.js`, `directives.js#gather`, `adapters/telnyx/render.js`, `stt-model.js`, `stt-profile.js`, `sprechpfad.js`, `boot.js`/`boot-guard.js`, `voiceEngine` (MCP-Wert) | ~12 src + ~10 Tests | D3c |
| D5 | Werkzeuge + Doku | `scripts/convo-bench*`, `inbound-hoerprobe.mjs`, `package.json`, `.env.example`, `render.yaml`, README/ONBOARDING, `PLAN-SECURITY.md`; Memory | Skripte ~17, Doku ~8 | D4 |
| D6 | Katalog-Altprofile | `TELNYX_BUDGET`/`TELNYX_INBOUND_BUDGET` aus `kostenarten.js`, `legacyKostenprofil`, Sweep-Set | ~5 src + Tests | Prod-DB-Beleg "alle gesettlet" |

Hinweis Testbank: CLAUDE.md-Invariante "beide Laeufe zusammen = ungefilterter Bestand" gilt je Phase
neu gemessen; die Gesamtzahl sinkt gewollt — im Merge-Commit die neuen Zahlen nennen.

---

## B. Rollout auf alle Tenants

### B.a Allowlist "alle" ohne fail-open

Heute: `elevenlabs/inbound-path-decision.js#inboundElPathFor` = `enabled === true` UND
`tenantIstGepinnt(tenantId, ELEVENLABS_INBOUND_TENANT_IDS)` UND `inboundElAccessDefects(...)` leer.
Leere Liste = niemand (`config.js#elevenLabsInbound.tenantIds`). Die Tenant-Frage beweist nichts ueber
die DID: eine gepinnte Tenant-DID ohne Inbound-Registrierung scheitert erst am Dial (404/407, heute
Budget-Rueckfall; nach L1 Satz+Hangup).

| Option | Bewertung |
|---|---|
| Wildcard `*` in der Tenant-Liste | abgelehnt — genau das fail-open-Muster aus `streaming-armierung-allowlist`; ein Tippfehler oeffnet alles |
| Skript synchronisiert alle Tenant-IDs in die Env | fail-closed, skaliert nicht (jeder Neukunde = Env + Deploy; bis dahin kein EL-Inbound) |
| **Empfehlung:** Beleg je DID + expliziter Scope-Enum | neues Feld am Nummern-Datensatz (z.B. `elInboundTrunkBelegtAt`, additiv in `db/schema.sql`/`pg.js`/`json.js`/`state-ops.js`), gesetzt NUR nach PATCH + Lese-Beleg (`has_auth_credentials`, `allowed_numbers == [DID]`, Muster `iel-geheimnisse-setzen.mjs#meldeRegistrierungsBeleg`). Weiche: `enabled` UND Zugang vollstaendig UND (`scope=allowlist` -> Tenant gepinnt / `scope=registrierte_dids` -> Beleg an genau dieser DID). Unbekannter Scope-Wert = Boot-Refusal. Kein Weg, auf dem eine DID ohne Beleg den Dial bekommt |

### B.b Registrierung mit Digest: Bestand und Neu

- **Bestand:** der SIP-Zugang ist EIN gemeinsamer Wert fuer alle DIDs (`config.js#elevenLabsInbound.sipUser/sipPassword`).
  `scripts/iel-geheimnisse.mjs setzen --nummer=…` erzeugt bei JEDEM Lauf frische Geheimnisse
  (`iel-geheimnisse-setzen.mjs#erzeugeGeheimnisse`), verteilt an Render + Workspace-Secret + jede
  genannte Registrierung (`trunkKoerper`: `credentials`, `allowed_numbers:[nummer]`,
  `allowed_addresses`) und verweigert Registrierungen mit Zugang ausserhalb der Liste
  (`fremdeZugaenge`, "halbe Rotation"). Fuer den Bestand also: EIN Lauf mit ALLEN aktiven DIDs
  (`--nummer` mehrfach), danach Deploy. Voraussetzung je DID: genau EINE Registrierung
  (`ordneNummernZu`) — Bestand laut Inventar: 3 Registrierungen (…1188, …4874, …8341); ob …4874/…8341
  aktive Tenant-DIDs sind: **UNBELEGT**.
- **Neue Nummern:** `onboarding.js#registriereNummerFailSoft` -> `nummern-registrierung.js#makeElSipRegistrar.ensureRegistration`
  legt nur `outbound_trunk_config` an und kehrt bei vorhandener Registrierung ohne Aenderung zurueck;
  aktiv nur mit `PROVISIONING_ENABLED` + `ELEVENLABS_OUTBOUND_ENABLED` + `ELEVENLABS_NUMBER_REGISTRATION_ENABLED`
  (`sipRegistrarWennAktiv`; Live-Wert der dritten Env **UNBELEGT**). Das Skript kann hier nicht helfen
  (es rotiert alles). Noetig: ein serverseitiger Schritt `ensureInboundTrunk` (PATCH ueber
  `convai.js#patchPhoneNumber` mit dem Zugang aus dem Prozess + Lese-Beleg -> Feld aus B.a), fail-soft
  wie die Registrierung, plus Nachhol-Modus in `scripts/el-nummern-registrierung.mjs` bzw. ein
  Reparaturlauf im Server. **Sicherheitsrelevant:** neuer Transportweg des SIP-Passworts
  (Server -> ElevenLabs), bisher nur Skript-Prozess (E16) -> `PLAN-SECURITY.md` IEL-B8 ergaenzen.

### B.c DIDs ohne EL-Registrierung

Heute (Schalter an, Tenant nicht gepinnt): Budget (`routes/voice.js#inboundPfadFuer`). Gepinnt, aber
Registrierung/Digest fehlt: Dial 404/407 -> `<Redirect>` -> `RUECKFALL` -> Budget (Spec 3.2).
Nach Budget-Loeschung braucht jede der beiden Lagen eine definierte Antwort:
Vorschlag `INBOUND_PFAD.ABGEWIESEN` = alle sieben Sicherungen, dann fester Satz + `<Hangup/>`.
Offen (Owner): Call-Datensatz anlegen (Kosten des Kurzbeins gebucht, "verpasster Anruf" sichtbar)
oder wie `inbound_unrouted` ohne Call. Boot-Sonde: Anzahl aktiver DIDs ohne Beleg (Erweiterung von
`inbound-path-decision.js#inboundElAllowlistProbeLine`); fatal nur, wenn `scope=registrierte_dids`
und 0 belegte DIDs (sonst sperrt ein Neukunde den Boot). Hinweis: ein gescheiterter Uebergang
erzeugt keinen Inbox-Eintrag (`inbox-entry.js#qualifiesAsInboxEntry` braucht Anrufer-Substanz) — der
Owner erfaehrt vom verpassten Anruf heute nichts.

### B.d `callerId` / `allowed_numbers`

`elevenlabs/inbound-rueckfall.js#elUebergabeDirektiven`: `uri: elSipUri({did: call.to, token: call.streamToken})`,
`callerId: call.to`. Absender des Kindbeins ist also immer die angerufene DID des Anrufs; ElevenLabs
prueft `allowed_numbers=[DID]` gegen From ([M1] J6: sonst 404) und ordnet ueber den URI-User der
Registrierung zu ([M1] F-A). Gilt fuer jede DID, solange ihre eigene Registrierung `allowed_numbers`
genau mit ihrer E.164 traegt; die Init-Zuordnung prueft zusaetzlich `called_number == call.to`
(`routes/webhooks-elevenlabs-init.js`). Voraussetzung, dass Telnyx eine Tenant-DID als callerId
akzeptiert: fuer …1188 belegt, fuer andere DIDs **UNBELEGT** (gleiche Connection angenommen).

### B.e Mehrere DIDs / Laender

`MAX_NUMBERS_PER_TENANT=1` (`.env.example`, `config.js#maxNumbersPerTenant`): eine DID je Tenant.
Der Mechanismus ist ohnehin je DID (URI, `allowed_numbers`, Beleg-Feld), mehrere DIDs brauchen nichts
Neues. Sprache: Pflichtsatz-Stimme aus `inboundElLocaleOf` je `call.language` (de/en/fr), Agent-Sprache
per Init-Override. Ob der EL-Agent fuer `fr`/`en` inbound gleich gut klingt: **UNBELEGT** (Memory
`el-agent-ist-im-kern-englisch`: Presets decken nur `first_message`). Offen vor breiter Freischaltung:
Per-IP-Limiter vor `/webhooks/elevenlabs/init` (Spec 9, E11) und M8/R-B (fremder INVITE) — die
Angriffsflaeche waechst mit jeder Registrierung mit Inbound-Trunk; das akzeptierte Restrisiko in
`PLAN-SECURITY.md` IEL-B9 gilt fuer EINE DID und ist neu zu bewerten.

---

## C. Kosten-Join-Befund

### C.1 Was verworfen wird

`elevenlabs/outbound.js#persistProviderResult` ruft fuer JEDEN EL-Nachlauf (auch Inbound:
`awaitAndPersistInboundElResult`, `finishFromConversation`) `store.recordSipCallId(callId,
conversation.metadata.phone_call.call_id)`. `store/state-ops.js#recordSipCallId` prueft mit
`telephony/sip-call-id.js#isTelnyxSipCallId` (Praefix `otb_`) und loggt sonst
`console.error("[join-schluessel] verworfen grund=keine_telnyx_sip_call_id …")`; `sipCallId` bleibt
`null`. Auf dem Dial-Weg ist `call_id` die SIP-Call-ID des INVITE, den **Telnyx** an ElevenLabs
schickt (UUID) — kein Wert aus Telnyx' `detail_records.sip_call_id` (der fuehrt `otb_…` nur fuer
EL-originierte Beine). Zusaetzlich schreibt `elevenlabs/kosten-beleg.js#recordElevenLabsKostenBelege`
bedingungslos `recordTelnyxSipErwartet` — eine `telnyx_sip`-Zeile `erwartet`, obwohl das Profil
`TELNYX_INBOUND_EL_CONVAI` diesen Traeger ausdruecklich NICHT fuehrt (`billing/kostenarten.js`,
Kommentar IE3). Zaehlt nirgends (`kosten-deckung.js#istAngelegt`, `offeneTraeger` filtert Pflicht),
ist aber eine Karteileiche je Anruf.

### C.2 Folgen

| Achse | Wirkung | Quelle |
|---|---|---|
| (a) Live-Buchung / Geld-Wache | **keine.** Minuten x `callTariffCentsPerMin(call)`; liest `direction`, `costProfile`, `to`, `from`, nie `sipCallId` | `billing/metering.js#callTariffCentsPerMin`, `reconcileVoiceBudget` in `finishCall`, `budget-watchdog.js` |
| (b) Sweep-Zuordnung | **keine.** Leg-Referenz ist `call.twilioSid` (= `CallSid` des Traegerbeins, `v3:`-Token, gesetzt in `/voice/incoming`) vor `sipCallId`; Stufe 1 Anker `call_control_id`, Stufe 2 `telnyx_session_id` spannt das Dial-Kindbein mit auf | `billing/call-leg-ref.js#legRefOfCall`, `adapters/telnyx/voice.js` `ANCHOR_ID_FIELDS`/`SESSION_ID_FIELDS`; [M1] F-D: Kindbein hat "gleiche `telnyx_session_id` wie das TeXML-Elternbein", `call-control` 0,002 USD/min |
| (b) Settlement | laeuft, aber nur Nachbuchen: `pflichttypen: PFLICHTTYPEN_UNGEMESSEN` -> `telnyx_call_records` bleibt vorlaeufig -> `vollBelegt=false` -> keine Erstattung (L7); Abschluss nach Frist ueber `cost-truing.js#schliesseFaelligeOffene` -> `setteleAnruf` | `kostenarten.js`, `kosten-projektion.js#settlementProjektion` |
| `belegUnbeschaffbarAmAnruf` | nicht betroffen (prueft nur `EL_CONVAI_SIP`) | `billing/kosten-abschluss.js` |

Wird ein Inbound-EL-Anruf je gesettlet? **Am Code ja** (Kandidat, weil `twilioSid` gesetzt und
`endedAt` aus dem Nachlauf); **am Live-Anruf `call_mu2dlfnebk9c` UNBELEGT** (Protokoll Schritt 13:
Buchung/Kostenprofil OFFEN, keine Prod-DB).

Korrekter Join-Schluessel auf dem Dial-Weg: **der vorhandene** — `twilioSid` (Elternbein-`call_control_id`)
als Anker plus `telnyx_session_id` fuer das Kindbein (Memory "LCT-Kette": Join = call_control_id +
telnyx_session_id). `sip_telnyx_call_control_id` (Kindbein-ID in den EL-Variablen, [M1] F-B) waere
nur als Kontrollwert nuetzlich, nicht als Schluessel. Die UUID ist fuer die Telnyx-Rechnung wertlos.

### C.3 Minutensatz Inbound-EL live und "Outbound-Satz fuer ALLE"

- Code: `metering.js#billsCalibratedInboundRate(call)` = `direction==="inbound" && costProfile !== TELNYX_INBOUND_EL_CONVAI`;
  sonst `tariffCentsPerMin(call.to, call.from)` (`outbound-gates.js`: Inland 20 nur wenn BEIDE
  Nummern dieselbe `VOICE_TARIFF_DOMESTIC_PREFIXES`-Vorwahl haben, sonst Default 30). EL-Inbound zahlt
  also den Outbound-Satz — **am Code belegt**; live-Dashboard-Werte **UNBELEGT** (render.yaml: 20/30/6,
  aber Dienst ist Dashboard-verwaltet). …1188 (+1) mit deutschem Anrufer -> 30 ct/min. Die Notbremse
  (`brakeSecondsFor`) nutzt denselben Satz.
- Widerspruch im Bestand: `cost-calibration.js#INBOUND_KOSTENPROFILE` vergleicht
  `TELNYX_INBOUND_EL_CONVAI` im Tarifpaar-Waechter weiter gegen `voiceTariffInboundCents` (6) — die
  Boot-Warnung "Tarifpaar … route=telnyx_inbound_el_convai" misst gegen den falschen Satz.
- Sauberster Ausdruck (Phase L2): `billsCalibratedInboundRate` und `voiceTariffInboundCents`
  (`VOICE_TARIFF_INBOUND_CENTS`) entfernen -> `callTariffCentsPerMin(call) = tariffCentsPerMin(call.to, call.from)`
  fuer jede Richtung (EINE Regel, isDomesticLeg ist symmetrisch); `INBOUND_KOSTENPROFILE` entfernen
  (Waechter vergleicht alle Routen gegen den Leg-Satz); `cost-ledger-map.js`-Text, `.env.example`,
  `render.yaml`. Folge fuer Noch-Budget-Tenants bis R2: 6 -> 20/30 ct/min, kuerzere Notbremse — Owner
  hat das entschieden. Tests: KV-P2-/KS-P2-Satztests umschreiben.

### C.4 Minimaler Fix (Phase L0)

Katalog als Quelle: Join-Schluessel und `telnyx_sip`-Erwartung nur fuer Profile, deren Pflicht-Traeger
`TELNYX_SIP` enthalten.

```
// elevenlabs/outbound.js#persistProviderResult
const fuehrtTelnyxSip = pflichtTraegerFuerProfil(kostenprofilFuerAnruf(store.getCall(callId)))
  .includes(KOSTENART.TELNYX_SIP);
if (fuehrtTelnyxSip) store.recordSipCallId(callId, conversation.metadata?.phone_call?.call_id);
recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar, erwarteTelnyxSip: fuehrtTelnyxSip });
```

(`kosten-beleg.js#recordElevenLabsKostenBelege`: `recordTelnyxSipErwartet` nur bei
`erwarteTelnyxSip`.) Alternative mit gleichem Effekt: Feld `telnyxSipJoin` in
`nachlauf-politik.js` (HEUTIGE true, INBOUND_EL false) — schwaecher, weil die Profil-Wahrheit dann
zweimal steht.
Test (neu, z.B. `test/iex-l0-inbound-el-join.test.js`): (1) Inbound-EL-Call (`TELNYX_INBOUND_EL_CONVAI`,
`twilioSid` gesetzt) + Conversation mit UUID-`call_id` -> kein `[join-schluessel]`-console.error,
`sipCallId === null`, keine `telnyx_sip`-Belegzeile, `elevenlabs_convai`-Zeile vorhanden,
`legRefOfCall(call) === twilioSid`; (2) Positiv-Kontrolle Outbound-EL (`EL_CONVAI_SIP`) mit `otb_…`
-> `sipCallId` gesetzt, `telnyx_sip` `erwartet` wie heute; (3) Outbound-EL mit Fremdform -> Log
bleibt (Waechter unveraendert).

---

## D. Offene Reste

### D.1 Referenzen auf die Budget-Engine ausserhalb src/

| Ort | Stellen |
|---|---|
| Boot-Banner | `boot.js`: `Voice-Engine: budget`, `inboundSprechpfadBannerLine` ("Inbound-Sprechpfad: play_tts …"), `thinkingSignalBannerLine`, `warnTurnBudgetOverrun` ("Konfig-Warnung: Turn-Budget"), `assertSttProfile`; Tarifpaar-Warnung (C.3) |
| `.env.example` (17 Treffer) | Kopf "Gespraechslogik (Budget-Engine)", `MACHINE_DETECTION_*`, `ELEVENLABS_PLAY_TTS_ENABLED`-Kommentar, `THINKING_SIGNAL_ENABLED`, `TOOL_FOLLOW_UP_ENABLED`, `VOICE_TARIFF_INBOUND_CENTS` (+ `VOICE_ENGINE=budget`-Kommentar), `STT_PROFILE`, `STT_SPEECH_TIMEOUT_SEC`, `MAX_EMPTY_TURNS`, `CALLER_SUBSTANCE_MIN_LEN`, `CAP_FAREWELL_LEAD_MS`, `CONSULT_WAIT_MS`, `telnyx_inbound_budget` |
| `render.yaml` (10) | Play-TTS-Block "in der Budget-Engine" + `inbound:hoerprobe`-Runbook, `THINKING_SIGNAL_ENABLED`, "LLM-Resilienz (Budget-Engine)", `MACHINE_DETECTION_*`, `VOICE_TARIFF_INBOUND_CENTS`; Render-Dashboard-Werte muessen separat entfernt werden (Dienst != Blueprint) |
| `package.json` | `convo-bench`, `inbound:hoerprobe` |
| `README.md` (9) | Architektur-Skizze Gather/Say, "Budget-Engine"-Abschnitt, `VOICE_ENGINE=budget`, Kosten-/Latenz-Zeilen, STT-Zeile, `src/claude.js`-Beschreibung |
| `ONBOARDING.md` | `src/claude.js Gespraechslogik (Budget-Engine)` |
| `CLAUDE.md` (Owner-Text) | Architektur "Voice-Engine `budget` … Default"; "Vor Edits: … Tools werden von der Budget-Engine genutzt!"; Regel 2 OC "EL-Weg wie Budget-/Telnyx-Weg"; Regel 2 nennt `disclosureSentence` (A2); "Wurzel statt Symptom" (curl auf `/voice/*`, bleibt gueltig) |
| `PLAN-SECURITY.md` (22) | Budget-Mid-Call-Pruefung (~Z. 1051–1072), Werkzeug-Grenzen (~1357/1380), Re-Attach `/voice/turn` (~1729/1750), REPLAY-Anker `/voice/turn` (~3582–3721), IEL-B8 Rueckfall-Abschnitt (~4156–4195) |
| `PLAN-INBOUND-PARITAET.md` (49), `docs/RUNBOOK-TELNYX-ASSISTANT.md`, `docs/architektur/02-telephony.dot` (untrackt) | historische Plaene/Diagramme |
| `route-policy.js`, `test/route-auth-inventory.test.js` | Eintraege `/voice/turn`, `/voice/outbound` |
| MCP-Ausgabe | `get_agent_status` Feld `voiceEngine` (`mcp-tools.js`, `i18n/mcp-texts.js`) |

### D.2 Veraltende Memory-/Tasks-Dokumente

- Memory (Budget-Turn als Gegenstand): `telnyx-budget-stt-bugfix`, `stt-flux-english-root-cause`,
  `stt-wer-measurement-method`, `stt-modellwahl-seam`, `doppelte-stt-turns`, `denk-signal-reichweite`,
  `streaming-armierung-allowlist`, `barge-in-telnyx-texml-limitation`, `barge-in-solution-options`,
  `call-quality-chain`, `call-quality-round2`, `convo-bench-bestandsdefekte`, `al-d3-tool-decision-open`,
  `place-call-objective-limit` (75-Zeichen-Kappe = `claude.js#OPENING_GOAL_MAX_CHARS`),
  `telnyx-provider-nudge-root-cause`, `pauschale-haltefrist-bestraft-die-mehrheit`,
  `outbound-dialog-fixed-live`, `stabilize-launch-plan` ("Weiche = Flag-Flip Budget-Engine"),
  `voice-stack-strategy`, `play-tts-elevenlabs-chain` (teilweise: Pflichtsatz bleibt),
  `in-call-research-is-mandatory`, `live-auf-deepseek`/`anbieter-port-plan` (LLM nur noch Nachlauf/Briefing),
  `kosten-vollstaendigkeit-inbound-luecke`, `inbound-ein-system-kette`, `iel-inbound-elevenlabs-live`
  ("Budget-Engine noch Rueckfall"), sowie die Ketten-/Design-Notizen `p3b-r-*`, `p6a-design-decisions`,
  `conversation-quality-*`, `assistant-conversation-fix-*`, `elevenlabs-telnyx-tts-impl`, `eval-eigener-voice-stack`.
  Allgemeine Lehren (`bench-must-reproduce-defect`, `calibration-scope-lesson`) bleiben.
- Tasks: `tasks/iel-spec.md` (3.2/5 Rueckfall auf Budget), `tasks/iel-r2-inventar.md` Teil A,
  `tasks/inbound-ein-system-stand.md` (IE6-S3), `tasks/kickoff-inbound-*.md`, `tasks/gq-chain-state.md`,
  `tasks/al-env-changes.md`, `tasks/iel-r4-aufgabe-kosten.md`, `PLAN-ANRUFDEFEKTE.md`, `tasks/todo.md`,
  `tasks/lessons.md` (Eintraege mit Turn-Bezug).

---

## Harte Risiken (Pre-Mortem)

1. **Kein Rueckfall mehr:** EL-Ausfall/Digest-Drift/Registrierung fehlt = jeder Inbound-Anruf endet mit
   einem Satz; ohne D1-Neubedeutung ist `ELEVENLABS_OUTBOUND_ENABLED=false` ein Anrufweg ins Leere.
   Gegenmittel: Sonde "DIDs ohne Beleg", Alarm auf `[el-rueckfall] … auflegen`-Rate, verpasste Anrufe sichtbar machen.
2. **Angriffsflaeche R-B/M8 waechst mit jeder Inbound-Registrierung**; Per-IP-Limiter am Init-Webhook
   fehlt; akzeptiertes Restrisiko in `PLAN-SECURITY.md` IEL-B9 gilt nur fuer eine DID.
3. **Gemeinsamer SIP-Zugang:** Rotation = alle DIDs + Deploy; serverseitiger PATCH (B.b) ist ein neuer
   Geheimnis-Transportweg.
4. **Regel 2 Namensbindung:** `disclosureSentence` hat keinen EL-Leser, CLAUDE.md nennt ihn — ohne
   Owner-Entscheidung weder loeschen noch umbenennen.
5. **Tarif L2** hebt Inbound fuer Noch-Budget-Tenants sofort von 6 auf 20/30 ct/min und verkuerzt
   deren Notbremse.
6. **Loesch-Kosten:** 108 Testdateien beruehrt; `claude.js` hat 53 Test-Importeure. D3b nur in
   Unterphasen nach Testgruppe, sonst wiederholt sich der 755/375-Mio-Token-Lauf.
7. **Altprofile** `TELNYX_BUDGET`/`TELNYX_INBOUND_BUDGET` zu frueh aus dem Katalog = Boot-Refusal
   (Grundbetrag-Karte) bzw. falsches Settlement-Soll fuer Altzeilen.
