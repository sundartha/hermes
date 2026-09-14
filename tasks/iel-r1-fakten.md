# IEL-R1 — Fakten: Inbound ueber den ElevenLabs-Agenten (SIP)

Recherche-Agent IEL-R1, 2026-09-14. Nur lesend. Keine Anrufe, keine schreibenden API-Anfragen.
Bereits im Kickoff (`tasks/kickoff-inbound-wie-outbound.md` 3.4/3.5) Belegtes wird nur zitiert.

Quellen-Kuerzel (alle abgerufen 2026-09-14):
- **[EL-SIP]** https://elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking (`.md`-Fassung)
- **[EL-PERS]** https://elevenlabs.io/docs/eleven-agents/customization/personalization
- **[EL-TWP]** https://elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization
- **[EL-DV]** https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables
- **[EL-OVR]** https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides
- **[EL-OAS]** https://api.elevenlabs.io/openapi.json (Schema-Namen jeweils genannt)
- **[TX-DIAL]** https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/dial
- **[TX-SIP]** https://sip.telnyx.com/ und https://developers.telnyx.com/docs/voice/sip-trunking/routing/failover-and-retries
- **[LK]** https://docs.livekit.io/reference/telephony/sip-api/ (nur Analogie, s. a)
- **[GET-A]** `GET /v1/convai/agents/<ELEVENLABS_AGENT_ID>` (2026-09-14, gefiltert)
- **[GET-WS]** `GET /v1/convai/settings` (2026-09-14, gefiltert)

---

## a) Zuordnung INVITE -> Agent, Voraussetzungen

1. INVITE-Ziel: `sip:<Kennung>@sip.rtc.elevenlabs.io:5060` (TCP) bzw. 5061 (TLS); UDP "experimental".
   Die Kennung ist "typically a phone number in E.164 format", darf aber "any string value" sein;
   ohne Kennung vor dem `@` wird nicht geroutet ("the identifier is required to route the call
   properly"). [EL-SIP] Abschnitt SIP URI Format / Transport.
2. Zuordnung ueber die **importierte Nummer**: "the phone number format must be consistent between
   your SIP URI and your imported phone number configuration … Mismatched formats will prevent
   proper call routing" (mit/ohne `+` muss exakt passen). Der Agent haengt an der Registrierung
   ("Assigning Agents to Phone Numbers"). [EL-SIP] FAQ "Do I need to match the leading + format".
   -> Der Request-URI-User-Teil wird gegen `phone_number` der Registrierung abgeglichen.
   **Ob der `To`-Header statt/zusaetzlich zaehlt: UNBELEGT -> Messfrage M1.**
3. Registrierungs-Felder `inbound_trunk_config`: `allowed_addresses` (IP/CIDR), `allowed_numbers`
   ("List of phone numbers that are allowed to use the trunk"), `media_encryption` (Default
   `allowed`), `credentials{username,password}`, `remote_domains`, `attributes_to_headers`.
   [EL-OAS] `InboundSIPTrunkConfigRequestModel`. GET liefert statt Passwort `has_auth_credentials`
   + `username` [EL-OAS] `GetPhoneNumberInboundSIPTrunkConfigResponseModel`.
4. **Bedeutung von `allowed_numbers` ist bei ElevenLabs nicht dokumentiert.** Die EL-Beschreibungen
   von `allowed_addresses`/`allowed_numbers` sind wortgleich mit LiveKit; dort heisst
   `allowed_numbers` "Phone numbers that are allowed to dial in … only accepts calls **from** the
   numbers in the list" (Anrufer-Filter), die angerufene Nummer steht in `numbers` [LK]. Das
   Fehler-Webhook-Schema von EL fuehrt ein `twirp_code` (LiveKit-RPC-Stil). Analogie, KEIN Beleg.
   Folge, falls die Analogie gilt: die heutige …0177-Registrierung (`allowed_numbers=[eigene
   Nummer]`, Kickoff 3.5) wuerde jeden fremden Anrufer abweisen. **UNBELEGT -> Messfrage M2** (= M20).
5. Unsere Registrierungen legen bewusst **kein** `inbound_trunk_config` an
   (`src/elevenlabs/nummern-registrierung.js` Kopfkommentar + `registrierungsKoerper`, nur
   `outbound_trunk_config` an `sip.telnyx.com`/tcp/PCMU). Stand live: Kickoff 3.5.
6. Was bei Nichttreffer passiert (SIP-Antwortcode 404/403?): [EL-SIP] Troubleshooting nennt
   dazu nichts. **UNBELEGT -> M1.**

## b) Trunk-Authentifizierung, Telnyx-Seite

1. EL inbound: Digest (username/password) ODER ACL nach Signalisierungs-Quell-IP; Doku empfiehlt
   Digest ("strongly recommended"). [EL-SIP] "How SIP trunking works" Punkt 3, "Authentication".
   Hinweis: der Dashboard-Text zu "SIP Trunk Username/Password" steht im Outbound-Abschnitt; die
   API haelt Inbound-Credentials getrennt (`inbound_trunk_config.credentials`) [EL-OAS].
2. Ob EL bei gesetzten Inbound-Credentials mit 401/407 challengt: Doku nennt 401/407 nur allgemein
   als "authentication is required" (https://elevenlabs.io/docs/eleven-agents/phone-numbers/sip-reference).
   **Ablauf mit Telnyx UNBELEGT -> M3.**
3. Telnyx TeXML `<Sip>`-Attribute: `username` ("Username to use for SIP authentication"),
   `password`, `statusCallback*`, `url`/`method`, `machineDetection*`, `sipRegion` (US, Europe,
   Canada, Australia, Middle East; Default US). **Kein** dokumentiertes Attribut fuer
   Custom-Header oder Transport. [TX-DIAL] "Sip Attributes".
   Ob Telnyx damit auf eine EL-Digest-Challenge antwortet und ob `;transport=tcp` in der URI
   beachtet wird (EL: UDP nur experimentell): **UNBELEGT -> M3/M4.**
4. Telnyx-Signalisierungs-IPs laut [TX-SIP] sip.telnyx.com: US `192.76.120.10`, `64.16.250.10`;
   Europe `185.246.41.140`, `185.246.41.141`; Canada `192.76.120.31`, `64.16.250.13`; Australia
   `103.115.244.145/146`; Middle East `185.246.42.128/129`. **Widerspruch in Telnyx' eigener Doku:**
   die Seite failover-and-retries nennt fuer EU `5.172.39.10`/`5.172.39.25`, Kanada
   `193.108.220.10/25`, Australien `103.135.104.10/25`. Welche Quell-IP ein TeXML-`<Dial><Sip>`
   (mit `sipRegion`) tatsaechlich benutzt: **UNBELEGT -> M5.** Eine ACL waere erst nach dieser
   Messung belastbar; heute steht …0177 auf `0.0.0.0/0` (Kickoff 3.5).
5. EL-Gegenrichtung (fuer BYE/REFER): EL-Server wechseln ("SIP requests may come from different IP
   addresses"); statische IPs nur Enterprise (`sip-static.rtc.elevenlabs.io`, /24). [EL-SIP].
   BYE von unserer Seite muss an die `Contact`-Adresse aus dem 200 OK, sonst 481. [EL-SIP].

## c) Conversation-Initiation-Client-Data-Webhook

1. **Wann:** "runs for a new inbound conversation on Twilio voice, Exotel, **SIP trunk**, WhatsApp,
   or Twilio SMS when initiation client data is not already present." [EL-PERS]
2. **Outbound:** "Outbound Twilio voice, Exotel, SIP, and WhatsApp calls trigger it **only if the
   outbound request did not include `conversation_initiation_client_data`**." [EL-PERS]
   Unser Outbound sendet dieses Objekt IMMER (`src/elevenlabs/outbound.js:startCallBody`,
   `conversation_initiation_client_data: { dynamic_variables, conversation_config_override }`).
   -> Laut Doku aendert das Einschalten den Outbound NICHT. **Am Live-Agenten ungemessen -> M6.**
3. **Ebene:** URL + Header-Secrets auf **Workspace**-Ebene (Agents settings), Einschalter auf
   **Agent**-Ebene (Security-Tab "Fetch initiation client data from a webhook"). [EL-PERS]
   API: Workspace `conversation_initiation_client_data_webhook{url, request_headers}`, Header-Werte
   `string` oder `ConvAISecretLocator` [EL-OAS] `ConversationInitiationClientDataWebhook`;
   Agent `platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook`
   [EL-OAS] `ConversationInitiationClientDataConfig-Input`.
   Live: Workspace-Webhook `null` [GET-WS]; Agent-Schalter `false`,
   `platform_settings.workspace_overrides.conversation_initiation_client_data_webhook=null` [GET-A].
   Da die URL workspace-weit gilt, betrifft sie jeden Agenten des Workspace, der den Schalter anhat.
4. **Request (POST):** `caller_id`, `called_number`, `agent_id`, `call_sid`, `conversation_id`;
   "SIP calls may also include `call_id` and `sip_headers`". [EL-PERS] Form von `sip_headers`
   (Liste? Map? nur `X-`?): **UNBELEGT -> M7.**
5. **Response:** Objekt der Form `conversation_initiation_client_data`
   (`type`, `dynamic_variables`, `conversation_config_override.agent.{first_message,language,prompt}`,
   `tts.voice_id`, …; max. 256 KB). "Include every custom dynamic variable the agent defines.
   Overrides are optional and must be enabled in Security." `system__*` nicht setzbar. [EL-PERS]
6. **Override-Freigaben live** [GET-A] `platform_settings.overrides.conversation_config_override`:
   `agent.first_message=true`, `agent.language=true`, `tts.voice_id=true`; `agent.prompt.prompt=false`,
   `tts.model_id=false`, `asr.keywords=false`, `conversation.max_duration_seconds=false`.
   Nicht freigegebenes Override: Doku sagt "For most fields, **an error will be thrown**"
   (ausser `asr.keywords`, still ignoriert) [EL-OVR]. **Widerspruch** zum Code-Kommentar
   `src/elevenlabs/convai.js` (Weisse Liste: "ignoriert … STILL"). Unser Code bricht ohnehin vorher ab.
7. **Authentifizierung:** nur konfigurierte Request-Header/Secrets ("Implement authentication
   using request headers") [EL-TWP] Security. Eine HMAC-Signatur ist fuer diesen Webhook **nicht
   dokumentiert** (die Doku zu Post-Call-Webhooks ist ein getrennter Mechanismus [EL-PERS]).
8. **Timeout / Fehler:** "A failed or timed-out webhook **can prevent the conversation from
   starting**." [EL-PERS]; "responds within a reasonable timeout period" [EL-TWP].
   **Zahlwert des Timeouts und exaktes Fehlerbild (Stille? BYE? SIP-Code?): UNBELEGT -> M8.**
   (Die 10 s aus Drittquellen betreffen Post-Call-Webhooks, nicht diesen.)
9. **Preview/Tests:** "Preview conversations … do not trigger conversation initiation webhooks"
   [EL-PERS].

## d) `attributes_to_headers` und `X-`-Header

1. **Eingehend (Header -> Variable), automatisch, keine Konfiguration:** "Custom SIP `X-` headers
   from inbound SIP trunking calls are automatically exposed as dynamic variables". Normalisierung:
   `X-` weg, lowercase, `-` -> `_`, Praefix `sip_`: `X-Contact-ID` -> `{{sip_contact_id}}`. Nutzbar
   "in agent prompts, first messages, and tools"; sichtbar im Gespraechsverlauf, Tab Phone Call.
   [EL-SIP] "Inbound custom headers as dynamic variables".
2. Reserviert: `X-Call-ID` -> `system__call_sid`, `X-Caller-ID` -> `system__caller_id`; Custom-Header
   koennen diese nicht ueberschreiben. [EL-SIP]. Fallback `sip.twilio.callSid`. [EL-SIP]
   -> Ein Header kann **keine** unserer 14 Namen (`owner_name` …) direkt fuellen, nur `sip_*`.
3. **`attributes_to_headers` ist die GEGENRICHTUNG:** Variable -> Header **auf dem BYE**, das EL am
   Gespraechsende sendet; Wert = Endwert der Variablen; auf `inbound_trunk_config` oder
   `outbound_trunk_config`. Beispiel `"disposition_code": "X-Disposition"` -> `X-Disposition: resolved`.
   [EL-SIP] "BYE headers from dynamic variables".
   **Damit ist Weg 1 aus `tasks/ie1-messbericht.md` B-2 ("Header auf NICHT-`sip_`-Variablen")
   durch die Doku widerlegt.**
4. Telnyx-Seite: TeXML `<Sip>` hat kein dokumentiertes Custom-Header-Attribut [TX-DIAL]. Call
   Control `dial`/`refer` haben `custom_headers` (X-Header in den INVITE)
   (https://support.telnyx.com/en/articles/16666680-custom-sip-x-header-propagation-on-telnyx;
   https://developers.telnyx.com/api-reference/call-commands/sip-refer-a-call). Ob TeXML
   URI-Header (`sip:…?X-Foo=bar`) mitschickt: **UNBELEGT -> M9.**

## e) Fehlende dynamic variable

1. Gemessen (Spike 2, 2026-08-14, `tasks/spike2-messung.jsonl` Zeilen 7/8/12): Outbound per
   SIP-API ohne Variablen -> `termination_reason` "Missing required dynamic variables **in first
   message**: {'owner_name'}", Code 1008, Gespraechsdauer 1 s. Damals **ohne** Placeholders.
2. Doku nennt kein Verhalten fuer fehlende Variablen in Prompt oder Werkzeugen ([EL-DV]
   Troubleshooting nur "Variables not replacing"). Webhook-Doku verlangt aber "every custom
   dynamic variable the agent defines" [EL-PERS]. **Prompt-/Werkzeug-Fall UNBELEGT -> M10.**
3. `dynamic_variable_placeholders`: "the placeholder used during testing"; "Use the Dynamic
   Variables placeholders … while testing in Preview. **Those placeholders are not used in
   production inbound conversations.**" [EL-DV], [EL-PERS]. -> Laut Doku helfen sie im echten
   Inbound nicht. Live gibt es sie heute fuer 4 Variablen (Kickoff 3.4); ob sie inzwischen den
   1008 bei Outbound/SIP verhindern: **UNBELEGT -> M10.**
4. Sprach-Presets live [GET-A] `conversation_config.language_presets`: `de` und `fr` tragen
   `overrides.agent.first_message` (147/128 Zeichen, Variablen `owner_name`, `opening_line`), `es`
   keine. -> Ein Inbound mit `agent.language=de` ohne eigenes `first_message`-Override zoege den
   deutschen **Outbound**-Offenlegungssatz. Ob ein `conversation_config_override.agent.first_message`
   Vorrang vor dem Preset-`first_message` hat: Code setzt es voraus
   (`src/elevenlabs/outbound.js:perCallFirstMessage`, Lage 2); einen Messbeleg habe ich nicht
   gefunden. **-> M11.**

## f) Unser Code heute (Outbound)

1. Endpunkt `POST /v1/convai/sip-trunk/outbound-call` (`src/elevenlabs/convai.js:OUTBOUND_CALL_PATH`),
   Koerper `agent_id`, `agent_phone_number_id` (Tenant-DID-Registrierung, `absenderFuerAnruf`),
   `to_number`, `conversation_initiation_client_data{dynamic_variables, conversation_config_override}`
   (`src/elevenlabs/outbound.js:startCallBody`). Schema kennt zusaetzlich `telephony_call_config`
   [EL-OAS] `Body_Handle_an_outbound_call_via_SIP_trunk…`.
2. Override: nur `agent.language`, `tts.voice_id` (Weisse Liste
   `convai.js:OVERRIDE_ALLOWED_LEAF_PATHS`) plus `agent.first_message` nur bei Owner-Ziel oder
   abweichender Offenlegungssprache (`OVERRIDE_FIRST_MESSAGE_LEAF_PATHS`,
   `outbound.js:perCallFirstMessage`/`conversationConfigOverride`). Verbotener Pfad -> Abbruch vor Netz.
3. Variablen (`outbound.js:dynamicVariables`, Eingaben aus `originateCall`):

   | Variable | Quelle | referenziert live in [GET-A] |
   |---|---|---|
   | `owner_name` | `store.tenantContext(tenantId).ownerName`, sonst `offenlegung.disclosureOwnerFallback` | first_message, Prompt, de/fr-Preset |
   | `opening_line` | `verifiedOpeningLine({call, locale})` | first_message, de/fr-Preset |
   | `callee` | `call.to` | Prompt |
   | `objective` | `call.goal` | Prompt |
   | `constraints` | `constraintsText(call.constraints)` | Prompt |
   | `background` | `backgroundText({context, briefing})` | Prompt |
   | `mandate` | `mandateText(call.mandate)` | Prompt |
   | `owner_timezone` | `callTimeContext(...).ownerZone` (`store.tenantTimezone`) | Prompt |
   | `callee_timezone` | `calleeTimezoneText(time)` | Prompt |
   | `today` | `time.today` | Prompt |
   | `callee_relation` | `calleeRelationText` ("" ausser Owner-Ziel) | Prompt |
   | `consult_available` | `consultAllowedForCall` -> `available`/`unavailable` | Prompt |
   | `lookup_available` | `lookupAvailableFor` -> `available`/`unavailable` | Prompt |
   | `voicemail_line` | `voicemailText({owner, offenlegung, openingLine})` | Built-in `voicemail_detection` |
   | `tenant_token` (15.) | `tenantToolToken({secret: ELEVENLABS_TOOL_TOKEN, tenantId})` | Werkzeuge `get_consult`, `look_up` (per `dynamic_variable`), NICHT im Prompt |

   -> Der Agent referenziert **15** Variablen (14 in Agent-JSON + `tenant_token` in beiden
   Webhook-Werkzeugen; dazu `system__conversation_id`). Kickoff 3.4 nennt 14.
4. Skripte/Code mit Schreibzugriff auf ElevenLabs (NICHT ausgefuehrt):
   - `scripts/push-elevenlabs.mjs` (`npm run elevenlabs:push`): `PATCH /v1/convai/agents/<id>`,
     einzige Agent-Schreibstelle; Trockenlauf Default, schreibt nur mit `--ausfuehren` + `--felder`.
   - `scripts/el-nummern-registrierung.mjs` (`npm run elevenlabs:nummern`): `--anlegen --ja-wirklich`
     -> `POST /v1/convai/phone-numbers`; `--pruefen` nur lesend.
   - `src/onboarding.js:196` `sipRegistrar.ensureRegistration` -> automatisches Anlegen der
     Nummernregistrierung beim Onboarding (`nummern-registrierung.js`, ohne `inbound_trunk_config`).
   - `scripts/elevenlabs-key-setzen.mjs`: `POST /v1/convai/tools` mit `{}` als Rechte-Probe, schreibt `.env`.
   - Spikes mit Schreibaufrufen: `scripts/spike1-setup.mjs`, `spike1-lab.mjs`, `spike1-b.mjs`, `spike2-sip.mjs`.
   - Nur lesend: `scripts/check-elevenlabs-drift.mjs` (haengt an `lib/elevenlabs-agent-lesen.mjs`).
   - Workspace-Settings (`PATCH /v1/convai/settings`) schreibt heute KEIN Skript (grep `convai/settings` in `src/`,`scripts/`: kein Treffer).

## g) Test ohne echten Anruf

1. `POST /v1/convai/agents/{agent_id}/simulate-conversation` (+ `/stream`): **deprecated**, Koerper
   `simulation_specification{simulated_user_config, dynamic_variables, tool_mock_config,
   partial_conversation_history}`, `new_turns_limit`; **kein** `conversation_config_override`-Feld.
   [EL-OAS] `Body_Simulates_a_conversation…`, `ConversationSimulationSpecification`.
2. Nachfolger: `POST /v1/convai/agent-testing/create` + `POST /v1/convai/agents/{id}/run-tests`
   (`tests`, `agent_config_override`, `branch_id`, `repeat_count`); Testtypen `llm|tool|simulation`,
   je mit `dynamic_variables`. [EL-OAS] `RunAgentTestsRequestModel`; `elevenlabs/tests/README.md`
   (dort: "Es existiert noch kein ElevenLabs-Agents-Abo" — Aktualitaet ungeprueft).
3. Beides sind POSTs (hier nicht ausgefuehrt) und laufen nicht ueber SIP/Telefonie: sie belegen
   weder INVITE-Zuordnung noch Webhook-Aufruf (Preview/Tests triggern den Webhook laut [EL-PERS]
   nicht). Ob sie bei fehlender Variable ebenfalls mit 1008 abbrechen und ob sie Kosten erzeugen:
   **UNBELEGT -> M12.**
4. `GET /v1/convai/phone-numbers/{id}/sip-messages` existiert [EL-OAS] (Diagnose der SIP-Nachrichten
   je Registrierung). Lesender Abruf fuer …0177 am 2026-09-14: **HTTP 403 mit HTML-Seite** (kein
   JSON-Fehler). Ursache (Rechte/Plan/Sperre) **UNBELEGT -> M13.**

---

## Offene Messfragen

- **M1** Trifft ein INVITE `sip:+<E.164>@sip.rtc.elevenlabs.io` den Agenten ueber den Request-URI-User-Teil (oder den `To`-Header)? SIP-Antwort bei Nichttreffer?
- **M2** Ist `allowed_numbers` ein Anrufer-(From-)Filter (LiveKit-Analogie)? Dann weist …0177 fremde Anrufer ab. (= M20)
- **M3** Antwortet TeXML `<Sip username password>` korrekt auf eine EL-Digest-Challenge (401/407)?
- **M4** Welcher Transport geht bei TeXML `<Sip>` raus (UDP?), und wird `;transport=tcp` beachtet?
- **M5** Quell-IP(s) von TeXML `<Dial><Sip>` je `sipRegion` (die Telnyx-Doku widerspricht sich bei EU/CA/AU).
- **M6** Bleibt der Outbound byte-/verhaltensgleich, wenn Workspace-Webhook-URL + Agent-Schalter an sind (Doku: ja, weil wir `conversation_initiation_client_data` senden)?
- **M7** Genaue Form von `sip_headers`/`call_id` im Webhook-Request bei SIP-Inbound.
- **M8** Webhook-Timeout in Sekunden und Fehlerbild fuer den Anrufer bei 5xx/Timeout/ungueltiger Antwort.
- **M9** Kommen X-Header aus TeXML `<Sip>` (URI-Header) bei EL als `sip_*` an?
- **M10** Bricht EL auch bei fehlender Prompt-/Werkzeug-Variable ab, und greifen die heutigen Placeholders ausserhalb von Preview?
- **M11** Schlaegt `conversation_config_override.agent.first_message` das Preset-`first_message` von `de`/`fr`?
- **M12** Brechen Simulation/`run-tests` bei fehlender Variable mit 1008 ab, und was kosten sie?
- **M13** Warum liefert `GET …/sip-messages` 403 (HTML)?
