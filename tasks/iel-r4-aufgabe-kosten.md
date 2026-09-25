# IEL-R4 — Inbound-Aufgabe am selben EL-Agenten, Kosten-Paritaet, Nachlauf

Recherche-Agent IEL-R4, 2026-09-14. Nur lesend (Code, Repo-Doku, EL-Doku/OpenAPI, zwei lesende GETs).
Baut auf `tasks/iel-r1-fakten.md` (R1) und `tasks/iel-r2-inventar.md` (R2) auf; dort Belegtes wird nur referenziert.

Quellen-Kuerzel (neu):
- **[EL-OVR]** https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides (`.md`, Kopie aus R1)
- **[EL-OAS]** https://api.elevenlabs.io/openapi.json (Kopie aus R1), Schema-Namen genannt
- **[EL-WF]** https://elevenlabs.io/docs/eleven-agents/customization/agent-workflows.md (2026-09-14)
- **[GET-A2]** `GET /v1/convai/agents/<ELEVENLABS_AGENT_ID>` 2026-09-14, gefiltert auf `platform_settings.auth/call_limits/overrides`, `tool_ids`, `built_in_tools`
- **[GET-C]** `GET /v1/convai/conversations/<id>` 2026-09-14 (ein Gespraech des Live-Agenten, 136 s), nur `metadata.cost*`/`charging`
- **[TPL]** `elevenlabs/agent_configs/outbound-agent.template.json`

---

## 1. Inbound-Aufgabe am selben Agenten

### Ausgangslage (belegt)
- Prompt [TPL] `agent.conversation_config.agent.prompt.prompt` (7740 Zeichen) ist statisch-englisch mit fest
  verdrahteten Outbound-Saetzen: "You are an AI phone assistant **calling on behalf of** {{owner_name}}",
  "You are calling {{callee}} right now. **You are the caller.**", "Your task: {{objective}}…".
- Etabliertes Muster **Block-Variable**: `constraints`, `background`, `callee_timezone`, `callee_relation` tragen ""
  oder einen fertigen Block mit fuehrendem Zeilenumbruch; "" laesst den Prompt "EXAKT den heutigen Text rendern"
  (`src/elevenlabs/outbound.js#calleeRelationText`, Kommentar; leere Werte "erprobt").
- "der Anbieter loest keine Platzhalter INNERHALB eines Variablenwerts auf" (`src/i18n/prompts/en.js:37-39`,
  Code-Kommentar, keine Messung zitiert) -> ein injizierter Block muss Literalwerte tragen.
- EL verwirft nirgends referenzierte Variablen (Memory `elevenlabs-verwirft-unreferenzierte-variablen`,
  gemessen 2026-09-11 an `tenant_token`).
- Inbound-Aufgabentext existiert bereits als Quelle: `i18n/prompts/<lang>.js#situationInbound({call, owner})`,
  Leser `src/claude.js:165` (Budget-Engine).

### a) Override `agent.prompt.prompt` (per Init-Webhook)
| Fakt | Quelle |
|---|---|
| Freigabe-Schalter: `platform_settings.overrides.conversation_config_override.agent.prompt.prompt` (live `false`) | [GET-A2]; [EL-OAS] `PromptAgentAPIModelOverrideConfig` |
| Freigabe allein aendert nichts fuer Gespraeche ohne Override: "When overrides are enabled for a field, providing an override is still optional. If not provided, the agent will use the default values" | [EL-OVR] |
| Override **ersetzt** den Prompt ("completely replacing system prompts"); Doku empfiehlt stattdessen Dynamic Variables | [EL-OVR] Kopf |
| **Werkzeuge je Gespraech: ja, `agent.prompt.tool_ids`** (Freigabe `…agent.prompt.tool_ids`, live `false`); "Tool and knowledge base overrides **replace** the default arrays for that conversation" | [EL-OAS] `PromptAgentAPIModelOverride` (`prompt, llm, tool_ids, native_mcp_server_ids, knowledge_base`); [EL-OVR] |
| `built_in_tools` (end_call, language_detection, voicemail_detection) sind **nicht** im Override-Schema | [EL-OAS] `PromptAgentAPIModelOverride`; live-Liste [GET-A2] |
| Outbound-Code sendet nie `prompt`/`tool_ids`: Weisse Liste wirft vor dem Netz (`agent.language`, `tts.voice_id`, `agent.first_message` nur Owner/Sprachabweichung) | `src/elevenlabs/convai.js#OVERRIDE_ALLOWED_LEAF_PATHS`, `#assertOverrideWhitelisted`, `#startOutboundCall` |
| Freigabe ist pushbar: Besitzfeld `conversation_config_override_erlaubnisse` (Art `wert`, ganzes Objekt) | [TPL] `_besitz.felder`; `scripts/push-elevenlabs.mjs#istSchreibbar` |
| **Nebenwirkung Angriffsflaeche:** `platform_settings.auth.enable_auth=false` live; Schema: "If set to true, starting a conversation with an agent will require a signed token"; `agent_concurrency_limit=-1`, `daily_limit=100000`. Heute sind `first_message`/`language`/`voice_id` bereits freigegeben | [GET-A2]; [EL-OAS] `AuthSettings` |

Outbound-Auswirkung: laut Doku keine (Default greift). Byte-Identitaet des Outbound-Koerpers bleibt (Code unveraendert).
Risiko ausserhalb Outbound: wer die Agent-ID kennt, koennte ohne signiertes Token ein (Web-)Gespraech mit
beliebigem Prompt/Werkzeugsatz starten — Kosten auf dem EL-Konto. Unsere Werkzeug-Webhooks lehnen solche Aufrufe
weiter ab (Bindung an aktiven Anruf, `routes/webhooks-elevenlabs.js#activeCallBoundTo`).
**UNBELEGT -> M-R4-1** (ob ein Start ohne Token fuer diesen Agenten tatsaechlich Overrides annimmt).
**UNBELEGT -> M-R4-2** (ob der Init-Webhook-Weg `prompt`/`tool_ids` annimmt; R1 c5 nennt nur `first_message, language, prompt`).
**UNBELEGT -> M-R4-3** (bleiben `built_in_tools` bei `tool_ids`-Override erhalten?).

### b) Prompt-Verzweigung ueber Variable im gemeinsamen Prompt
| Fakt | Quelle |
|---|---|
| Keine Freigabe noetig; Variablen gehen ueber `dynamic_variables` (Outbound: `startCallBody`, Inbound: Webhook-Antwort) | `outbound.js#dynamicVariables`; R1 c5 |
| Webhook-Antwort muss "every custom dynamic variable the agent defines" enthalten -> Inbound muesste auch die 14 Outbound-Variablen liefern (Werte "" bzw. passend) | [EL-PERS] via R1 c5 |
| Outbound muss eine NEU im Prompt referenzierte Variable zusaetzlich senden: neuer Schluessel in `dynamicVariables` -> Anfragekoerper nicht mehr byte-identisch zur Fixture `test/fixtures/el-anrufstart-fremdziel.json` (Leser `test/callee-is-owner-elevenlabs.test.js`); gerenderter Prompt bleibt identisch, wenn der Outbound-Wert "" ist bzw. dem heutigen Text entspricht | `outbound.js#startCallBody` (Kommentar "byte-identisch zum Bestand") |
| Fehlt die Variable bei Outbound: first_message-Fall = Abbruch 1008 nach 1 s (gemessen); Prompt-Fall **UNBELEGT (R1 M10)**; Placeholders greifen laut Doku nicht in Produktion | R1 e1–e3 |
| Reihenfolge, die das Fehlen ausschliesst: erst Code deployen, der die Variable sendet (unreferenziert = verworfen, harmlos), dann Prompt pushen | Memory `elevenlabs-verwirft-unreferenzierte-variablen`; Push-Ablauf s. e) |
| Zwei Bauformen: (i) additiv `inbound_block` ("" bei Outbound) — die fest verdrahteten Outbound-Saetze ("You are the caller", `{{objective}}`) stuenden dann auch im Inbound-Prompt; (ii) die outbound-spezifischen Abschnitte selbst wandern in eine Variable (`task_block`), die BEIDE Richtungen fuellen | Prompt-Text [TPL]; Bewertung der Wirkung aufs Modell **UNBELEGT -> M-R4-4** (Bench/Test) |

Outbound-Auswirkung: Koerper aendert sich um einen Schluessel; Verhalten bleibt gleich, solange der Outbound-Wert
den heutigen Text reproduziert und die Deploy-Reihenfolge eingehalten wird.

### c) `take_message` als EL-Webhook-Werkzeug
| Fakt | Quelle |
|---|---|
| Vorlage existiert: `POST /webhooks/elevenlabs/consult` und `/lookup`, EIN Router | `src/routes/webhooks-elevenlabs.js#makeElevenLabsWebhookRoutes` |
| Auth-Reihenfolge: Header `x-hermes-tool-token` safeEqual gegen `ELEVENLABS_TOOL_TOKEN` (leer = alles 403) -> Bindung `conversation_id` (Body, `dynamic_variable: system__conversation_id`) == `call.elevenlabsConversationId` && `status=active` -> `tenant_token` (Body, `dynamic_variable: tenant_token`; `tenantTokenVerdict`, FEHLT toleriert solange `elevenLabsTenantTokenRequired` aus) -> Faehigkeit -> `blockingBudgetAxis` -> Wirkung | `#handleConsult`, `#boundCallFor`, `#activeCallBoundTo`; `src/elevenlabs/tenant-tool-token.js` |
| Oeffentliche Route braucht Eintrag + Begruendung | `src/route-policy.js:123/138`; Absolute Regel 3 |
| Inbound-Bindung: `call.elevenlabsConversationId` muss VOR dem ersten Werkzeugaufruf stehen; Quelle waere `conversation_id` im Init-Webhook-Request (R1 c4) -> `store.recordElevenlabsConversationId` (set-once). Zuordnung Webhook-Request -> unser Call-Datensatz ueber `called_number`/`caller_id`/`call_sid`/`sip_headers`: **UNBELEGT (R1 M7)** | `outbound.js#originateCall` (heutiger einziger Schreiber) |
| Wirkung Budget-Engine heute: `store.addActionItem(call.id, message, "todo")` | R2 A3 (`claude.js#execTool`) |
| Werkzeug am Agenten = Eintrag in `conversation_config.agent.prompt.tool_ids` (live 2 IDs) -> **fuer jedes Outbound-Gespraech sichtbar** (LLM-Werkzeugliste aendert sich, Modell koennte es rufen) | [GET-A2]; [EL-OAS] `tool_ids` "A list of IDs of tools used by the agent" |
| Vorhandene Absicherungsmuster gegen falsche Richtung: Prompt-Tor per Variable (`consult_available` "available/unavailable") + Richtungspruefung im Webhook (`call.direction === "outbound"` in `consultAllowed`) | Prompt [TPL] Zeilen "REACHING YOUR PRINCIPAL…: {{consult_available}}"; `webhooks-elevenlabs.js#consultAllowed` |
| Alternative ohne Outbound-Sichtbarkeit: Werkzeug nur per `tool_ids`-Override im Inbound-Gespraech (setzt a)-Freigabe `tool_ids` voraus; ersetzt das Array) | [EL-OVR] |
| Nur-Werkzeug-Variablen muessen in der Werkzeug-Definition referenziert sein, sonst kommen sie nie an | Memory `elevenlabs-verwirft-unreferenzierte-variablen` |
| Anlage/Aenderung von Werkzeugen: **kein produktives Skript**; `POST /v1/convai/tools` nur in Spikes (`scripts/spike1-setup.mjs:167`, `spike1-b.mjs:244/289`); `push-elevenlabs.mjs` schreibt `tools` (Art `namen`) und `werkzeug_*` (Art `texte`, ohne Schreibweg) NICHT | `scripts/push-elevenlabs.mjs#istSchreibbar`; [TPL] `_besitz.felder` |
| Ohne Werkzeug existiert ein Nachlauf-Weg: Data-Collection `next_steps` -> Action Item (richtungsneutral im Code, braucht Ergebnisabruf) | `outbound.js#nextStepActionItemOf`, `#persistCollectedFields` |

### d) Bestehender Owner-Anruf-Pfad (OC)
Ja — es gibt bereits den Mechanismus "je Anruf Eroeffnung + Prompt-Baustein am selben Agenten austauschen", nur fuer Outbound:
- Entscheidung einmal vor dem Waehlen, unveraenderlich am Datensatz (`call.calleeIsOwner`, `src/callee-is-owner.js`, ausgewertet in `routes/api-calls.js`).
- **Prompt-Baustein per Variable:** `callee_relation` = "" oder Block `EN_PROMPT.calleeRelation({owner, disclosure})` direkt hinter der PERSONA-Zeile (`outbound.js#calleeRelationText`; Position im Prompt [TPL] Zeichen 189).
- **Eroeffnung per Override:** `agent.first_message` = Owner-Eroeffnung (`#ownerFirstMessage`) bzw. Pflichtsatz bei Sprachabweichung (`#perCallFirstMessage`); Schluessel sonst weggelassen (`#conversationConfigOverride`).
- **Werkzeug-Tor per Variable:** `consult_available=unavailable` im Owner-Fall (`#originateCall`, Kommentar OC-P2).
- **Waechter vor dem Netz:** `convai.js#assertOverrideWhitelisted` (first_message nur bei `calleeIsOwner` oder Sprachabweichung), `#assertDisclosureCarried` (startsWith Pflichtsatz).
- Uebertragbarkeit: die Init-Webhook-Antwort hat dieselbe Form `conversation_initiation_client_data` (R1 c5) — die Bausteine sind Modul-Funktionen in `outbound.js` (nicht exportiert: `dynamicVariables`, `conversationConfigOverride`, `startCallBody`); die Waechter haengen an `startOutboundCall` und liefen fuer eine Webhook-Antwort nur, wenn sie dort ebenfalls aufgerufen werden.

### e) Agent-Konfiguration im Repo / Rollout
- Quelle der Wahrheit fuer **besessene** Felder: [TPL] `_besitz.felder` (u.a. `prompt`, `first_message`, `language`, `language_presets_offenlegung`, `conversation_config_override_erlaubnisse`, `tools`, `data_collection`, `max_duration_seconds`). Nicht besessen u.a. `tts.voice_id`, Placeholders (`_besitz._nicht_besessen`).
- Lesend: `npm run elevenlabs:drift` (`scripts/check-elevenlabs-drift.mjs`, `scripts/lib/elevenlabs-agent-lesen.mjs`).
- Schreibend: `npm run elevenlabs:push -- --felder=<feld> --ausfuehren` -> GET Live, Besitz-Vergleich, `PATCH /v1/convai/agents/<id>` nur abweichender, gewaehlter, schreibbarer Pfade, danach erneuter GET + ROT bei unerwarteter Abweichung (PATCH ersetzt Dict-/Listenfelder) (`scripts/push-elevenlabs.mjs` Kopf, Riegel 1–7). Schreibbar nur Art `wert` bzw. mit `schreibweg` (`#istSchreibbar`).
- **Nicht** ueber das Skript: Werkzeuge (s. c), Agent-Schalter `platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook` (kein Besitzfeld in [TPL]), Workspace-Webhook-URL (R1 f4: kein Skript). **Schreibweg dafuer UNBELEGT -> M-R4-5** (Dashboard oder manueller GET->PATCH wie Memory beschreibt).
- Vorlage traegt noch den veralteten Kopfhinweis "Es existiert noch KEIN ElevenLabs-Agents-Abo" ([TPL] `_wichtiger_hinweis_NICHT_HOCHLADEN`) — widerspricht dem Live-Betrieb.

### f) Weitere Option (nur Doku, weitgehend unbelegt): Agent-Workflow
[EL-OAS] kennt `WorkflowOverrideAgentNodeModel` (`additional_prompt`, `additional_tool_ids`, `conversation_config`) und
`WorkflowExpressionConditionModel` (`expression`). [EL-WF]: "Use expressions to create conditional logic based on variables";
Subagent "System Prompt: Append or override". Ob eine Kante am Gespraechsstart vor `first_message` auf eine dynamische
Variable verzweigt und wie ein Workflow Outbound veraendert: **UNBELEGT -> M-R4-6**.

---

## 2. Kosten

### Outbound EL heute (Tenant-Achse)
| Stufe | Buchung | Quelle |
|---|---|---|
| Vor dem Dial | Gate-Kette inkl. Kostendecke + Vorab-Reserve | `routes/api-calls.js` (`runOutboundGates`, `reserveCents`), R2 B1 |
| Eroeffnungszeile | LLM-Token `bookTokenUsage` | `src/elevenlabs/opening-line-llm.js:142` |
| Waehrend | kein Turn-Loop; Geld-Wache (15 s) auf gebucht + Live-Minuten x `callTariffCentsPerMin`; Werkzeuge pruefen `blockingBudgetAxis`; `look_up` bucht Suchgebuehr | `billing/metering.js#liveVoiceSpendCents`; `call-lifecycle.js` `budgetAxis.arm`; `webhooks-elevenlabs.js` (`bookLookupSearchFee`) |
| Ende | `reconcileVoiceBudget`: Minuten (ceil, Anker aus `call_duration_secs`) x `tariffCentsPerMin(to, from)` = `VOICE_TARIFF_DOMESTIC_CENTS` (20, Ziel UND Absender +49/+33/+44) sonst `VOICE_TARIFF_DEFAULT_CENTS` (30) | `metering.js#callTariffCentsPerMin`, `#reconcileVoiceBudget`; `telephony/outbound-gates.js#tariffCentsPerMin`; `config.js:1022/1034` |
| Nachlauf (Settlement) | Belegsumme (`elevenlabs_convai` = `metadata.cost_fiat` via KV2-4 + `telnyx_sip` via KV2-5) gegen Schaetzung: **Nachbuchen bedingungslos**, Erstattung nur bei vollem Buch; Verzug `COST_TRUING_DELAY_MINUTES=30`, Frist `COST_SETTLE_DEADLINE_HOURS=48` | `billing/cost-truing.js#setteleAnruf`, `#sweepDarfKorrigieren`; `billing/kostenarten.js` Profil `EL_CONVAI_SIP`; `.env.example:494/544` |
| EL-LLM-Token | **nicht** einzeln live; enthalten in `cost_fiat`: Beispiel 136 s -> `cost_fiat` 0,342 USD = `llm_charge` 810 + `call_charge` 909 Credits (LLM claude-sonnet-5 inkl. Cache-Write) | [GET-C] |
| Messwerte | EL `cost_fiat` 11,81 US-ct/min Schnitt (8 Anrufe); p95 Vollkosten Route `el_convai_sip` 15,76 US-ct/min -> 15 EUR-ct Untergrenze | `kostenarten.js:221`; `config.js:1063`, `VOICE_TARIFF_FULL_COST_FLOOR_CENTS=15` |

### Inbound Budget-Engine heute
Minuten x `VOICE_TARIFF_INBOUND_CENTS` (6; kalibriert an 1,87 US-ct/min, Budget-Engine, US-DID, EIN Anruf) + LLM-Token live je
Runde + Summary-Token (R2 A5; `config.js:1036-1055`, `.env.example:581`, `render.yaml:443`).

### Paritaetische Buchung fuer Inbound-EL (belegte Bausteine, Luecken)
- `callTariffCentsPerMin` unterscheidet **nur die Richtung** -> ein Inbound-EL-Anruf bekaeme live, am Ende und in der Reserve-freien
  Decke 6 ct/min, gegen gemessen ~10,9 EUR-ct/min Schnitt (11,81 USD x 0,92) bzw. p95 14,5 (`metering.js:45-47`; Werte oben).
  Die Gate-Achse laege damit bis zum Settlement unter den Ist-Kosten; es gibt auf dem EL-Weg keine Live-Tokenbuchung, die das
  ausgleicht (Budget-Engine hat sie).
- Settlement-Profil existiert: `TELNYX_INBOUND_EL_CONVAI` mit Traegern `elevenlabs_convai` (KV2-4) + `telnyx_call_records` (KV2-5g),
  `pflichttypen` UNGEMESSEN -> keine Erstattung, Nachbuchen moeglich (`kostenarten.js:419-440`). **Aber:** der einzige KV2-4-Schreiber
  ist `outbound.js#persistProviderResult` (braucht Ergebnisabruf), und Reifung/Nachlauf/Unbeschaffbar-Praedikate pruefen
  hart `=== EL_CONVAI_SIP` (`billing/el-reifung.js:57`, `billing/nachlauf-phasenschnitt.js:37/123`, `billing/kosten-abschluss.js:68`).
- Paritaet zum Outbound-EL hiesse belegt: (1) Minutensatz je **Profil** statt je Richtung, mindestens die Vollkosten-Untergrenze der
  EL-Route (Outbound-Inland 20 >= 15); (2) EL-Beleg (`cost_fiat`, inkl. LLM) ueber denselben KV2-4-Weg; (3) Settlement mit
  Nachbuchen. Welche Zahl gilt, ist Owner-Entscheidung (O10, R2 D2); `VOICE_TARIFF_GRUNDBETRAG_CENTS` wird heute nirgends gebucht,
  nur im Tarifpaar-Report gelesen (`billing/cost-calibration.js:411`).
- Wo die Decke greift: vor dem Anruf `/voice/incoming` `budgetExceeded` (R2 A1 #4); waehrend der Bruecke nur die Geld-Wache
  (`BUDGET_WATCHDOG_INTERVAL_MS=15000`, `render.yaml:572`), die ueber `terminateActiveCall` beendet; bei einem Datensatz mit
  `providerCallSid`/`callControlId` gewinnt `hangUpAction` (Telnyx-Elternbein) und `elevenLabsHangUpAction` laeuft NICHT
  (`call-lifecycle.js:219` `??`; `call-termination.js#hangUpAction`). Wirkung auf die Bruecke: **UNBELEGT (R2 F-C)**.
- Buchungsanker: Outbound zieht `answeredAt` aus `call_duration_secs` des EL-Gespraechs nach (`outbound.js#applyAnsweredAnchor`).
  Beim Inbound beginnt unser Telnyx-Bein VOR der Uebergabe (Pflichtsatz) -> EL-Dauer < Carrier-Dauer; welcher Anker gilt, ist
  offen. **UNBELEGT -> M-R4-7** (Differenz Elternbein vs. `call_duration_secs`).

---

## 3. Nachlauf Outbound-EL und Uebertragbarkeit

| Punkt | Befund | Quelle |
|---|---|---|
| Ausloeser | `originateCall` -> nach Start-Antwort `recordElevenlabsConversationId`, `markAnswered`, `scheduleResultPoll` | `outbound.js#originateCall` (1705-1706) |
| Takt | `setTimeout(resultPollMs)`, `ELEVENLABS_RESULT_POLL_MS` Default 5000, min 100, max 60000 | `outbound.js#scheduleResultPoll`; `config.js:814` |
| Ende-Erkennung | `conversation.status` in `done|failed` -> `finishFromConversation` (persist -> `endCallRecord` -> Anker -> `terminateAndBillCall(hangUp:null)` -> `finishCall`) | `#pollConversationResult`, `#finishFromConversation` |
| Wiederholung/Grenzen | voruebergehende Fehler: weiter pollen; 401/404 3x in Folge -> Aufgabe (`PERMANENT_ERROR_STREAK_LIMIT`); Zeitgrenze = min(Frist, 600 s) (`callUnderProviderCap`) -> `finishExpiredPoll`; GET-Timeout 120 s (`convai.js#REQUEST_TIMEOUT_MS`), Abbruchpfad 10 s | `outbound.js:147/166/186/209`, `#permanentErrorStreakExceeded` |
| Neustart | `rearmActiveConversationPolls`: jeder `status=active` Call MIT `elevenlabsConversationId` — richtungsneutraler Filter | `outbound.js:1415-1419` |
| Kapselung | `pollConversationResult`/`finishFromConversation` sind Closure-privat; Fabrik gibt nur `originateCall`, `endActiveCall`, `rearmActiveConversationPolls` zurueck | `outbound.js:1709-1713` |

Uebertragbar auf Inbound, wenn `conversation_id` aus dem Init-Webhook kommt: Bindung (`recordElevenlabsConversationId`),
Poll-Schleife, Boot-Re-Arm und `persistProviderResult` (Transkript, Summary, Data-Collection, `sip_call_id`, EL-Beleg) arbeiten
nur mit `callId` + `conversationId` — sofern der Webhook-Request unserem Call-Datensatz zugeordnet werden kann (R1 M7).
Nicht direkt uebertragbar: Start-Zeitpunkt (kein Start-Response; Poll muesste im Webhook-Handler beginnen), Reihenfolge gegen
`/voice/status` des Elternbeins (R2 C "Reihenfolge-Luecke"; `billedAt` bucht einmal, aber `finishCall` liefe ggf. vor dem
Transkript), `hangUpAction ?? elevenLabsHangUpAction` (s. 2) und der Buchungsanker (M-R4-7).

---

## Offene Messfragen (neu, R4)
- **M-R4-1** Nimmt der Live-Agent (`enable_auth=false`) Gespraechsstarts ohne signiertes Token mit Overrides an?
- **M-R4-2** Akzeptiert die Init-Webhook-Antwort `agent.prompt.prompt` und `agent.prompt.tool_ids` (bei Freigabe) — und was passiert ohne Freigabe (Fehler/Stille)?
- **M-R4-3** Bleiben `built_in_tools` (end_call, voicemail_detection, language_detection) bei einem `tool_ids`-Override erhalten?
- **M-R4-4** Verhaltenswirkung einer Block-Variable fuer die Inbound-Aufgabe (Bauform i vs. ii) — Bench/`run-tests`, nicht Produktion.
- **M-R4-5** Schreibweg fuer Agent-Schalter `enable_conversation_initiation_client_data_from_webhook`, Workspace-Webhook-URL und neue Werkzeuge (kein Repo-Skript).
- **M-R4-6** Kann ein Agent-Workflow am Gespraechsstart per Variable verzweigen, ohne Outbound zu veraendern?
- **M-R4-7** Differenz Telnyx-Elternbein-Dauer vs. EL `call_duration_secs` bei Inbound (Buchungsanker, Unterbuchung).
- Weiter offen aus R1: M6 (Outbound unveraendert bei Webhook an), M7 (Request-Form/Zuordnung), M8 (Timeout/Fehlerbild), M10 (fehlende Prompt-Variable), M11 (first_message-Override vs. Preset).
