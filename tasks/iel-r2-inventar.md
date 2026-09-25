# IEL-R2 — Inventar Inbound (Budget-Engine) vs. ElevenLabs-Pfad

Stand 2026-09-14, nur gelesen. Quellen als `datei#symbol`. Anbieter-Werte: `GET /v1/convai/agents/<id>`,
`GET /v1/convai/conversations?agent_id=…&page_size=1` und `GET …/conversations/<id>` (nur
Feldnamen erhoben), 2026-09-14. Keine Nummern, keine Secrets.

---

## Teil A — Heutiger Inbound-Pfad (Budget-Engine)

### A1. Sicherungen vor dem Gespraech (`POST /voice/incoming`)

Die "sieben" stammen aus `PLAN-INBOUND-PARITAET.md` 1.3. Am Code nachgezaehlt: **sieben wirksame
Sicherungen**, aber nicht exakt die Plan-Liste — Plan-Nr. 6 (Kostenprofil) sperrt nichts, dafuer ist
seit IE2 die Geld-Wache dazugekommen. Dazu der Fehlerpfad.

| # | Sicherung | Quelle | Blockiert | Fehlerverhalten |
|---|---|---|---|---|
| 1 | Ed25519-Signaturpruefung | `routes/voice.js#makeVoiceRoutes` (`router.use("/voice")`), `telephony/adapters/telnyx/signature.js#verifyInboundSignature` | unsignierte/gefaelschte Webhooks, Zeitstempel ausserhalb `REPLAY_WINDOW_S` (300 s) | **fail-closed** 403; fehlender Key/Sig/Body = `false`. Bypass nur `SKIP_TWILIO_SIGNATURE_CHECK` (`config.js#skipTwilioSignatureCheck`, Default `false`) |
| 2 | Wiederholungs-Riegel | `telephony/webhook-idempotenz.js#makeWebhookIdempotenz` (`forIncoming`, Anker `in:<CallSid>`) | doppelte Call-Anlage bei Anbieter-Retry | verwirft nie; Wiederholung bekommt dieselbe Antwort bzw. `routes/voice.js#repeatDeliveryXml` (pfadgerecht via `telephony/leg-turn-loop.js#legRunsOurTurnLoop`) |
| 3 | Tenant-Aufloesung ueber angerufene DID (nach der Signatur) | `store/state-ops.js#numberRecordByE164` (nur `status=active`, exakter E.164) | unbekannte/inaktive Nummer | **fail-closed**: Audit `inbound_unrouted`, `<Say>` + Hangup, kein Call, kein Default-Tenant |
| 4 | pro-Tenant-Kostendecke (auch Inbound) | `store/state-ops.js#budgetExceeded` → `liveBudgetExceeded`/`tenantSpendOrDeny` | Anruf bei erschoepfter Decke | **fail-closed**: `locale.budgetExhaustedHangup` + Hangup; korrupter Bucket sperrt (`denyCorruptUsage`) |
| 5 | Max-Dauer-Notbremse (Zeit-Achse) | `routes/voice.js#brakeSecondsFor` → `call-duration.js#emergencyBrakeSeconds`; `telephony/call-lifecycle.js#armMaxDurationTimer` → `terminateCappedCall` | Anruf ueber Restguthaben-Minuten + 1 min Puffer, absolut `store/defaults.js#MAX_CALL_DURATION_CAP_S` (1800 s) | unaufloesbares Guthaben → absolute Obergrenze (nie unbegrenzt); Boot-Re-Arm `rearmActiveCallTimers` |
| 6 | Geld-Wache (IE2, mid-call) | `telephony/budget-watchdog.js#makeBudgetWatchdog`, armiert in `call-lifecycle.js#armMaxDurationTimer` (`budgetAxis.arm`) | laufender Anruf, sobald `budget-gate.js#blockingBudgetAxis` sperrt (gebucht + Live-Minuten aller Legs) | Takt `config.safety.budgetWatchdogIntervalMs` (15 s; **0 = aus**, Env-Hebel); gescheiterte Runde wird neu gestellt; Beenden ueber `terminateActiveCall` |
| 7 | Inbound-Pflichtsatz (KI + Transkription), gerendert, nie gepromptet | `i18n/inbound-notice.js#withInboundNotice` + `INBOUND_NOTICES` (de/en/fr), Aufruf in `routes/voice.js` `/voice/incoming` | — (Regel-2-Analogie, GAP-14) | wird **nicht** vorangestellt, wenn das Greeting schon KI- UND Transkriptions-Marker traegt (`hasInboundNotice`) |
| – | Kostenprofil (Plan-Nr. 6) | `store.recordCostProfile(…, KOSTENPROFIL.TELNYX_INBOUND_BUDGET)` | nichts; steuert Beleg-Sweep und `legRunsOurTurnLoop` | — |
| – | Fehlerpfad | `routes/voice.js` `/voice/incoming` catch | Haengen bis Provider-Timeout | `turnErrorSpeech` + Hangup |

Nicht auf Inbound: `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit (nur `telephony/outbound-gates.js`).
Rate-Limit ist fuer `/voice` ausgenommen (`app.js`, `VOICE_PATH_PREFIX`). Route-Policy:
`route-policy.js#PUBLIC_ROUTES` (`VOICE_SIGNATURE_REASON`).

### A2. Tenant, Sprache, Begruessung

| Schritt | Quelle | Befund |
|---|---|---|
| Tenant | `state-ops.js#numberRecordByE164` | `tenantId` aus dem Nummern-Datensatz |
| Sprache | `state-ops.js#resolveCallLanguage` | `settings.language` → `number.language` → `tenant.defaultLanguage` → `DEFAULT_LANGUAGE` |
| Begruessung | `i18n/greeting-catalog.js#greetingForLanguage(ctx.settings.greeting, language)`, `{owner}` → `ctx.ownerName` | gespeicherte Vorlage in Anrufsprache |
| Pflichtsatz | `withInboundNotice(greeting, localeFor(language).inboundNotice)` | vorangestellt, Transkript-Zeile `agent` |
| Ausspielung | `telephony/voice-render.js#turnDirectives` → `<Gather>` mit Prompt; `tts/directive-synth.js#synthesizeDirectiveAudio` | bei `ELEVENLABS_PLAY_TTS_ENABLED` (live an, Kickoff 3.1) `<Play>` (`promptAudioUrl`, `/voice/tts/:token`); sonst bzw. bei Synth-Fehler/Kontingent Azure-`<Say>` |

### A3. Werkzeuge im Inbound-Gespraech

| Werkzeug | Wirkung | Quelle |
|---|---|---|
| `take_message` | `store.addActionItem(call.id, message, "todo")`, dedupliziert | `claude.js#toolDefs`, `#execTool` |
| `end_call` | Satz + Hangup; unterdrueckt bis Anrufer sprach bzw. `maxEmptyTurns` | `claude.js#toolDefs`, `#shouldSuppressEndCall` |
| `get_consult` | **inbound gesperrt** (`call.direction === "outbound"`) | `consult/in-call.js#consultAvailableFor` |
| `look_up` | **inbound gesperrt** | `research/in-call.js#lookupProviderFor` |
| Kalender | kein Werkzeug; Inbound-Prompt: Terminwunsch als Nachricht, kein Kalender | `claude.js#execTool` (Kommentar P1b), `i18n/prompts/*.js#situationInbound` |

Turn-Loop: `routes/voice.js` `/voice/turn` → `claude.js#agentTurn`; vor jeder Modellrunde
`claude.js#roundStopReason` (Geld-Achse) ; `capFarewellOutcome`, `budgetHangupOutcome`, `noSpeechOutcome`.

### A4. Nachlauf

| Schritt | Quelle | Befund |
|---|---|---|
| Transkript | `store.addTranscript` in `/voice/incoming` und `agentTurn` | laufend waehrend des Gespraechs |
| Status-Callback | `routes/voice.js` `/voice/status` | Lookup ueber `CallSid` (`state-ops.js#getCall` matcht `twilioSid`); `completed|busy|no-answer|failed|canceled` → `call-termination.js#persistEndWithReason` + `terminateAndBillCall` (`hangUp:null`) → `finishCall` |
| Hangup | Modell `end_call` → `[Say, Hangup]` (`sendTurnOutcome`); Cap/Geld → `call-lifecycle.js#terminateActiveCall` → `call-termination.js#hangUpAction` (Telnyx `endCall(twilioSid)`) | |
| Zusammenfassung | `telephony/call-finish.js#finishCall` → `claude.js#summarizeCall` (nur `allowSummaries`, bucht Token) | danach `purgeTranscript` (ausser Diagnose-Retention) |
| Benachrichtigung | `finishCall`: `store.addNotification`; SMS `sms-summary.js#planSummarySms` → `messaging(provider).sendSms` (Ziel private Nummer, Opt-in, Tagescap); Mail `sendSummaryMails` | live SMS-Fehler 40305 (Kickoff 3.2, eigener Befund) |
| Inbox / `check_inbox` | `inbox-entry.js#qualifiesAsInboxEntry` (inbound, completed, `allowSummaries`, Anrufer-Substanz im Transkript) → `store.markInboxEntry` im `finally` | Qualifikation VOR Purge |

### A5. Kosten und Max-Dauer

| Kostenart | Buchung auf Tenant-Achse | Quelle |
|---|---|---|
| LLM-Token je Modellrunde | ja, live je Runde | `llm-usage.js#bookTokenUsage` (`store.trackUsage`) aus `claude.js` |
| LLM-Token Zusammenfassung | ja | `claude.js#summarizeCall` → `bookTokenUsage` |
| Carrier-Minuten | ja, am Ende: Minuten × `billing/metering.js#callTariffCentsPerMin` (inbound = pauschal `voiceTariffInboundCents`, Default 6) | `metering.js#reconcileVoiceBudget`; live mitgezaehlt in `liveVoiceSpendCents` |
| TTS-Zeichen (Play) | **nein**, nur plattformweit | `tts/directive-synth.js#synthToServeUrl` (`store.recordTtsCharacters`, "kein Gate liest es") |
| SMS | Usage-Event | `call-finish.js#finishCall` (`USAGE_EVENT_KIND.SMS`) |
| Ist-Kosten Telnyx | Beleg-Sweep KV2-5g | `billing/kostenarten.js` Profil `TELNYX_INBOUND_BUDGET` |

Nebenbefund: Kommentar in `routes/voice.js#brakeSecondsFor` ("Satz des EIGENEN DID-Landes") passt
nicht zum Code (`callTariffCentsPerMin` pauschal inbound).

---

## Teil B — Outbound ueber ElevenLabs (`config.voice.elevenLabsOutbound.enabled`)

### B1. Call-Datensatz und Anrufstart

| Schritt | Quelle |
|---|---|
| Einstieg `POST /api/calls` (`internalOnly`), Gate-Kette `runOutboundGates` VOR allem | `routes/api-calls.js` |
| Sprache: Wunsch oder `resolveCallLanguage`; Offenlegungssprache aus Ziel | `api-calls.js`, `elevenlabs/outbound.js#callLocaleOf` → `elevenlabs/call-locale.js` |
| Eroeffnungszeile vorab (LLM, fail-closed) | `api-calls.js` → `elevenlabs/opening-line.js#fetchOpeningLine` |
| `store.createCall` (outbound, from/to, goal, openingLine, briefing, constraints, context, mandate, language, maxDurationS, tenantId, provider, reserveCents, diagnostic, calleeIsOwner) | `api-calls.js` |
| Kostenprofil `EL_CONVAI_SIP`, dann `originateCall`, dann `armMaxDurationTimer(call, null)`, `armReserveReleaseTimer` | `api-calls.js` |
| Koerper `POST /v1/convai/sip-trunk/outbound-call`: `agent_id`, `agent_phone_number_id`, `to_number`, `conversation_initiation_client_data.dynamic_variables` (14 + `tenant_token`), `conversation_config_override` (`agent.language`, `first_message` nur Owner-Fall oder Sprachdivergenz, `tts.voice_id`) | `outbound.js#startCallBody`, `#dynamicVariables`, `#conversationConfigOverride`, `#perCallFirstMessage` |
| Waechter vor dem Netz: Override-Weissliste + Pflichtsatz getragen | `elevenlabs/convai.js#assertOverrideWhitelisted`, `#assertDisclosureCarried` |
| Bindung: `conversation_id` aus der Start-Antwort → `store.recordElevenlabsConversationId`; `markAnswered`; `scheduleResultPoll` | `outbound.js#originateCall` |

### B2. ElevenLabs-Werkzeuge

| Werkzeug | Endpunkt | Auth / Zuordnung | Quelle |
|---|---|---|---|
| `get_consult` | `POST /webhooks/elevenlabs/consult` | Header `x-hermes-tool-token` safeEqual gegen `ELEVENLABS_TOOL_TOKEN` (leer = alles abgelehnt) → Call ueber `conversation_id` == `call.elevenlabsConversationId` + `status=active` → `tenant_token` (`tenant-tool-token.js#tenantTokenVerdict`; FEHLT toleriert solange `elevenLabsTenantTokenRequired` aus) → Faehigkeit (outbound) → `blockingBudgetAxis` | `routes/webhooks-elevenlabs.js#activeCallBoundTo`, `#boundCallFor`; `route-policy.js` |
| `look_up` | `POST /webhooks/elevenlabs/lookup` | wie oben + Recherche-Gate (outbound), Deckel, Egress-Filter | dieselbe Datei `#handleLookup` |
| `end_call`, `language_detection`, `voicemail_detection` | eingebaut, kein Webhook | — | `elevenlabs/agent_configs/outbound-agent.template.json`; live bestaetigt (GET 2026-09-14) |
| (kein `take_message`) | — | Ersatz: Data-Collection `next_steps` → Action Item | `outbound.js#nextStepActionItemOf`, `#persistCollectedFields` |

### B3. Nachlauf

| Punkt | Befund | Quelle |
|---|---|---|
| Mechanik | **Polling**, kein Post-Call-Webhook (keine Route in `src/`; live `post_call_webhook_id` nicht gesetzt, Init-Webhook nicht gesetzt) | `outbound.js#pollConversationResult` (Takt `resultPollMs`, Default 5000), `#rearmActiveConversationPolls` |
| Auth | API-Key ausgehend; keine eingehende Signatur noetig | `convai.js#fetchConversation` |
| Transkript, Zusammenfassung, Befund | `persistProviderResult`: Zeilen → `addTranscript`; `analysis.transcript_summary` → `recordProviderCallResult`; Data-Collection; `sip_call_id`; Absender; EL-Kostenbeleg | `outbound.js#persistProviderResult`, `elevenlabs/kosten-beleg.js` |
| Ende | `finishFromConversation` → `endCallRecord` → Antwort-Anker aus `call_duration_secs` → `terminateAndBillCall` → `finishCall` (ueberspringt `summarizeCall`, weil `call.summary` gesetzt) | `outbound.js#finishFromConversation`, `call-finish.js#finishCall` |
| Benachrichtigung | derselbe `finishCall` (Notification, SMS, Mail) | `call-finish.js` |
| Kosten Tenant-Achse | Minuten × Outbound-Satz (`callTariffCentsPerMin`); EL-Token/Minuten nicht einzeln, Ist ueber KV2-4-Beleg/Truing | `metering.js#reconcileVoiceBudget`; Profil `EL_CONVAI_SIP` |
| Max-Dauer | Anbieter `max_duration_seconds=600` (je Anruf nicht uebersteuerbar); Poll-Obergrenze `ELEVENLABS_PROVIDER_MAX_DURATION_S`; unser Cap → `call-termination.js#elevenLabsHangUpAction` → `outbound.js#endActiveCall` (Abruf, dann DELETE — ob die Leitung faellt: **unbelegt**, `convai.js#endConversation`); Geld-Wache armiert | `outbound.js`, `call-lifecycle.js` |

---

## Teil C — Luecken fuer einen EINGEHENDEN Anruf am EL-Agenten

Annahme K1 (Kickoff): `/voice/incoming` bleibt Einstieg, danach SIP-Uebergabe. Regel-Spalte:
R1 = Gates/Kostendecke/Max-Dauer/Signatur, R2 = Offenlegung, R3 = Auth/route-policy.

| Funktion (Teil A) | Gegenstueck EL-Pfad, inbound-tauglich? | Was fehlt / zu bauen | Regel |
|---|---|---|---|
| Signaturpruefung | bleibt am Webhook (K1) | nichts, solange Uebergabe NACH `router.use("/voice")` | R1 |
| Replay-Riegel | vorhanden: `legRunsOurTurnLoop` kennt `TELNYX_INBOUND_EL_CONVAI` (leeres Dokument) | Profil muss VOR der Antwort gesetzt sein | R1 |
| Tenant-Aufloesung | bei uns vorhanden; **Agent erfaehrt den Tenant nicht** | Transportkanal fuer Tenant-Kontext an den Agenten: `X-`Header → nur `sip_*` (B3), `attributes_to_headers` (ungemessen), Init-Webhook (neue oeffentliche Route) | R3 (falls Webhook) |
| Kostendecke vor Anruf | bleibt | nichts | R1 |
| Kostendecke mid-call | Budget: je Modellrunde; EL: nur Geld-Wache (15 s) | Beenden durch die Wache geht ueber `hangUpAction(twilioSid)` am Elternbein — Wirkung waehrend der Bruecke **unbelegt (F-C)** | R1 |
| Kostenbuchung | Minuten × `voiceTariffInboundCents` (6 ct), keine Token | Tarif pro Profil fehlt: `callTariffCentsPerMin` unterscheidet nur Richtung; EL-Inbound kostet laut Plan O10 ~14–16 US-ct/min → Unterbuchung der Decke. Profil `TELNYX_INBOUND_EL_CONVAI` + Boot-Riegel existieren, Pflichttypen ungemessen (F-D) | **R1** |
| Max-Dauer | `armMaxDurationTimer` greift (Call-Datensatz entsteht bei uns) | keine Dial-Direktive (`directives.js#DIRECTIVE` ohne DIAL/SIP); `<Dial timeLimit>` nicht gebaut; Hangup-Wirkung am Elternbein unbelegt (F-C); EL-Deckel 600 s fix | **R1** |
| Pflichtsatz | `withInboundNotice` bleibt gerendert | Agent spricht seine `first_message` (= Outbound-Offenlegung, Variablen `owner_name`, `opening_line`) → Doppelansage bzw. 1008-Stille ohne Variablen; `first_message`-Override live erlaubt, aber nur ueber API-Start/Init-Webhook, nicht ueber SIP | **R2** |
| Sprache/Stimme | `resolveCallLanguage` bei uns | `agent.language`/`tts.voice_id` pro Anruf nur per Override-Kanal (s.o.); M17/O12 offen; unser Satz (Play-TTS) vs. Agentenstimme (O2) | R2 (Sprache des Pflichtsatzes) |
| Inbound-Aufgabe (Nachricht aufnehmen, kein Kalender) | Agent-Prompt ist outbound (objective/callee/mandate) | Inbound-Aufgabe muss in denselben Agenten (Variablen oder Prompt-Zweig) — keine Grundlage im Code | — |
| `take_message` | kein Werkzeug; `next_steps` → Action Item nur ueber Provider-Ergebnis | Abhaengig von Korrelation (naechste Zeile) | — |
| `get_consult`/`look_up` | inbound gesperrt (Webhook prueft Richtung) und Bindung braeuchte `elevenlabsConversationId` | Prompt-Variablen `consult_available`/`lookup_available` muessen "unavailable" ankommen (Kanal fehlt); O4 offen | R3 (Webhook-Bindung) |
| Transkript | nur ueber `persistProviderResult` nach Abruf per `conversation_id` | **Korrelation Inbound-Call ↔ EL-Gespraech fehlt**: kein Start-Response, kein Post-Call-/Init-Webhook. Anbieter liefert Felder `direction`, `start_time_unix_secs` (Liste) und `metadata.phone_call.{call_sid, call_id, sip_header_dynamic_variables}` — Befuellung bei Inbound unbelegt (F-B). Post-Call-Webhook waere neue Route | R3 (falls Webhook) |
| Zusammenfassung | `analysis.transcript_summary` (Sprache: Memory `el-agent-ist-im-kern-englisch`, nicht neu gemessen) | haengt an Korrelation | — |
| Anrufende → `finishCall` | `/voice/status` des Elternbeins kommt weiter | **Reihenfolge-Luecke:** `finishCall` liefe beim Status-Callback, BEVOR das EL-Transkript da ist → Transkript enthaelt nur unsere Begruessung → `summarizeCall` auf Begruessung, `qualifiesAsInboxEntry` false, SMS/Mail mit leerem Inhalt. Braucht: Abschluss erst nach Provider-Ergebnis (Muster `finishFromConversation`) | R1 (Buchung genau einmal, `billedAt`) |
| SMS/Mail/Notification | `finishCall` richtungsneutral | nichts ausser Reihenfolge oben | — |
| `check_inbox` | `qualifiesAsInboxEntry` braucht Anrufer-Zeilen zum `finishCall`-Zeitpunkt | haengt an Korrelation + Reihenfolge | — |
| Hangup nach Agent-`end_call` | TeXML setzt nach `<Dial>` fort | Folge-Verb/`action`-URL nach Dial, Fehlerfall **unbelegt (F-F)** | R1 |
| Poll-Re-Arm nach Deploy | nur mit `elevenlabsConversationId` | haengt an Korrelation | R1 (Cap-Buchung) |
| Schalter | `config.voice.elevenLabsInbound.enabled` existiert, einziger Leser Boot-Riegel (`boot.js#assertLatentCostPaths`) | Sprechpfad (IE5) nicht gebaut; `.env.example`/`render.yaml` pruefen | — |

---

## Teil D — Offene Owner-Entscheidungen (Inbound ueber ElevenLabs)

### D1. Die Eroeffnungsfrage (IE5 / Befund B-2)

Wortlaut (`tasks/inbound-ein-system-stand.md`, "Neue Praemisse fuer IE5"):
> K1 braucht also zusaetzlich zu F-A…F-F eine Antwort auf "wie beginnt der eine Agent ein
> Inbound-Gespraech ohne Outbound-Eroeffnung" — `attributes_to_headers`, der
> Initiations-Webhook oder eine zweite Agenten-Konfiguration. Das ist eine Owner-Frage, bevor
> IE5 gebaut wird.

Bereits beantwortet? **Teilweise.** Option 3 ("zweite Agenten-Konfiguration", `tasks/ie1-messbericht.md`
B-2: "am Owner-Massstab … fragwuerdig; Owner-Frage") widerspricht der Owner-Vorgabe "derselbe Agent,
der Outbound fuehrt" (`tasks/kickoff-inbound-wie-outbound.md` §1) und "EIN Ort, an dem Gespraechslogik
lebt" (`tasks/kickoff-inbound-ein-system.md` §1). Zwischen Option 1 und 2 ist nichts entschieden;
Kickoff §5.2 macht daraus erst eine Recherche.

### D2. Owner-Tabelle `PLAN-INBOUND-PARITAET.md` §6 (nur inbound-relevant)

| # | Wortlaut (gekuerzt, erste Zeile) | Stand |
|---|---|---|
| O1 | "`ELEVENLABS_PLAY_TTS_ENABLED` live auf `true` (IP4)." | erledigt: live an (Kickoff 3.1) |
| O2 | "Mit welchem TTS-Modell unser eine gerenderte Satz synthetisiert wird, gemessen gegen das Modell des Agenten (M4)." | offen |
| O4 | "Bleibt das Richtungs-Gate fuer `get_consult`/`look_up`?" | offen |
| O5 | "Braucht Inbound Spracherkennung im Gespraech?" | offen |
| O8 | "Den Telnyx-AI-Assistant-Pfad ersatzlos entfernen (IE6 Stufe 1)" | erledigt (IE6-S1 live) |
| O9 | "Die Gespraechslogik der Budget-Engine entfernen (IE6 Stufe 3)" | beantwortet: ja, "erst ganz am Ende" nach Owner-Testanruf (Kickoff-wie-outbound §1) |
| O10 | "Den Inbound-Schalter aus IE5 scharfstellen und die Kosten pro Inbound-Minute akzeptieren: gemessen ~14–16 US-Cent/min auf dem EL-Weg gegen 1,87 auf der Budget-Engine" | teilweise: Owner stellt Schalter selbst an (Kickoff §5.5); Kostenakzeptanz nicht ausdruecklich |
| O11 | "Die einseitige Anbieter-Abhaengigkeit akzeptieren (Pre-Mortem Q8)" | implizit durch EIN-System-Entscheidung, nicht ausdruecklich |
| O12 | "Welche Stimm-Kennung gilt (M19)" | offen |

Zusaetzlich blockierend (Kickoff-wie-outbound §5.1): wie echte Testanrufe laufen duerfen (Permission-Regel oder Owner per `!`).

### D3. IE1 F-A…F-F (`PLAN-INBOUND-PARITAET.md`, IE1-Tabelle)

| ID | Kurzdefinition |
|---|---|
| F-A Agenten-Zuordnung | INVITE an `sip:+<Test-DID>@sip.rtc.elevenlabs.io:5060` erreicht den an dieser Nummer haengenden Agenten. |
| F-B Variablenkanal | selbst gesetzter `X-`Header kommt als dynamic variable an — per TeXML-`<Dial><Sip>` oder Call-Control-`dial` mit `custom_headers`; bestimmt die Bauform von IE5. |
| F-C Elternbein-Griff | nach dem Bridge wirkt Hangup ueber `callControlId`/`providerCallSid` und/oder `<Dial timeLimit>` beendet die Bruecke; mindestens eins belegt. |
| F-D Zweites Bein und Abrechnung | ob der Dial ein zweites, separat abgerechnetes Telnyx-Bein erzeugt und unter welchem `record_type`. |
| F-E Nummer doppelt belegbar | ob dieselbe Nummer `inbound_trunk_config` und `outbound_trunk_config` traegt, ohne die `outbound_trunk`-Projektion zu verlieren (nur Testnummer). |
| F-F Fehlerfall der Uebergabe | was passiert, wenn der Dial scheitert; ob die `<Dial action>`-URL im Fehlerfall gerufen wird und die Antwort den Anrufer noch erreicht. |

Stand laut `tasks/ie1-messbericht.md`: F-E teilweise belegt (B-3: eine Registrierung traegt beide
Richtungen; PATCH-Wirkung unbelegt), F-A…F-D und F-F nicht gemessen.
