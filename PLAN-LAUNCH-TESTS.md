# PLAN-LAUNCH-TESTS

**Zweck:** Vollstaendiger Pre-Launch-Testplan fuer Hermes (Telefon-KI-Agent, Node/ESM, Render, Multi-Tenant, Stripe, MCP-Connector, Website sundartha.com). Jeder Test ist ausfuehrbar (Kommando, curl oder konkreter Klickpfad).

**Stand:** 2026-07-02

**Ausfuehrungsreihenfolge (verbindlich):**
1. **auto** zuerst — `npm test` und die genannten `npm test -- test/<datei>` laufen ohne Netz/ohne .env. Alles Rote hier stoppt, bevor irgendetwas Live angefasst wird.
2. **lokal** danach — Server lokal (`PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`) + curl-Reproduktionen. Kein echter Anruf, kein echtes Geld.
3. **live** zuletzt — Prod/Render, echte Anrufe (Kosten!), echtes Stripe (Testkarten), claude.ai-Connector, Render-Dashboard-Verifikation.

**Abbruchkriterium:** **Jeder rote P0 = Launch-Stopp.** Kein Go-Live, solange auch nur ein P0 offen/rot ist. P1 offen = bewusste Owner-Freigabe mit Notiz erforderlich. P2 = nach Launch nachziehbar.

**Legende Typ:** `auto` = node:test | `lokal` = lokaler Server + curl | `live` = Prod/echter Call/echtes Stripe/claude.ai/Render-Dashboard.

---

## Launch-Blocker (P0) auf einen Blick

Alle P0 MUESSEN gruen sein. Reihenfolge = auto -> lokal -> live.

**auto (zuerst):**
- [ ] OUT-01 Wahlziel-Normalisierung deterministisch
- [ ] OUT-02 Offenlegungssatz erster Satz (beide Engines) + Identitaets-Gate
- [ ] OUT-03 Toll-Fraud-Riegel: Absender = eigene aktive DID, sonst Reject
- [ ] OUT-05 Concurrency-Budget-Race (N parallele place_call gegen knappen Cap)
- [ ] IN-01 Signatur-Dispatch fail-closed (Twilio HMAC / Telnyx Ed25519)
- [ ] IN-02 Inbound-Routing fail-closed + Anti-Spoof-Reihenfolge
- [ ] IN-03 Max-Dauer-Timer feuert und beendet den Call
- [ ] MCP-02 OAuth-Tenant-Isolation (sub fehlt/audience/exp)
- [ ] MCP-03 Prod-Gate killt localhost-Socket-Bypass
- [ ] AUTH-01 Cross-Tenant-Isolation aller Lesepfade (MULTI_TENANT=true)
- [ ] AUTH-02 isTrustedLocalCaller-Regression (Loopback+XFF nicht vertrauen)
- [ ] AUTH-03 Cross-Tenant IDOR auf Calls/Transkripte -> 404
- [ ] CFG-01 Boot-Prod-Footguns (Boot-Refusal)

**lokal:**
- [ ] OUT-04 Eingegebene Ziffern == gewaehlte Ziffern (End-to-End lokal)
- [ ] PROV-01 Provisioning-Crash-Recovery (Job-Verlust + Retry-Reparatur)
- [ ] SMS-01 SMS-Trigger E2E + Fehlerpfad ohne Sturm (finishCall)

**live:**
- [ ] MCP-01 /mcp fail-closed ohne gueltiges Token
- [ ] IN-09 Provider-Webhook-Signatur fail-closed (live)
- [ ] AUTH-04 Oeffentliche /api/* ohne Auth + DASHBOARD_PASSWORD gesetzt
- [ ] BILL-01 Stripe Live/Test-Key-Konsistenz + Webhook-Endpoint
- [ ] PROV-02 PAYMENT_ENABLED + PROVISIONING_ENABLED live konsistent
- [ ] PROV-03 Telnyx-Guthaben ausreichend + 402-Diagnosepfad
- [ ] STORE-01 hermes-db Free-Tier-Ablauf 2026-07-24 geklaert
- [ ] STORE-02 Killer-Test RLS unter echtem Postgres/pgBouncer
- [ ] WEB-01 Split-Origin-Check: sundartha.com bedient /api same-origin
- [ ] WEB-02 Legal-Seiten (Impressum/Datenschutz/AGB) rechtsverbindlich
- [ ] DEPLOY-01 Prod-Boot-Verifikation (isProduction=true, Secrets gesetzt)
- [ ] DEPLOY-02 Deploy-Ziel-Verifikation (upstream-Push, Commit-SHA live)
- [ ] DEPLOY-03 Live-Env-Drift render.yaml vs. Render-Dashboard
- [ ] DEPLOY-04 A6-Repro: Deploy waehrend aktivem Call
- [ ] DEPLOY-05 Telnyx-Carrier-Kosten hart gedeckelt + Kosten-Env plausibel
- [ ] LIVE-01 E2E-Happy-Path Bezahl -> Nummer -> Anruf (echter Testkunde)
- [ ] LIVE-02 Echter Outbound-Testanruf: Ziel/Offenlegung/Absender-DID

---

## OUT — Telefonie Outbound + Gate-Kette

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| OUT-01 | P0 | auto | Wahlziel-Normalisierung deterministisch (LLM-Ziffern-Drift Wurzelfix) | `npm test -- test/dial-target-normalization.test.js test/e164-trunk-zero-reject.test.js` — Faelle: privateNumber(+49) vor US-DID(+1) loest `0176..`->`+49176..`; kein Heimatland (nur US-DID) -> unveraendert -> 400; `00 49 176..`->`+49176..` mit Trunk-0-Recheck auf normalisiertem Ergebnis; +33/+44 analog | Alle gruen. Nationale 0 nur bei ableitbarem +49/+33/+44 aufgeloest, sonst 400 (kein Raten). geprueft==gewaehlt | [ ] |
| OUT-02 | P0 | auto | Offenlegung erster Satz in BEIDEN Engines + Identitaets-Gate | `npm test -- test/disclosure-outbound.test.js test/disclosure-regression.test.js test/outbound-identity-gate.test.js` | Offenlegung allererster Satz (Budget openingText UND Realtime-Opener), byte-identisch, ownerName voll gebunden; leerer ownerName -> 403 grund=keine_identitaet am Producer, kein `..von .`-Leak | [ ] |
| OUT-03 | P0 | auto | Toll-Fraud-Riegel: from = eigene aktive DID, sonst Reject | `npm test -- test/outbound-tenant.test.js` | from == eigene aktive Store-Nummer; Tenant ohne aktive Nummer -> outboundFrom null -> 403, KEIN Fallback auf fremde DID; globale Budget-Schnittmenge bleibt | [ ] |
| OUT-04 | P0 | lokal | End-to-End: eingegebene Ziffern == gewaehlte Ziffern | `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`; POST /api/calls (loopback, interner Tenant-Header) je einmal mit `0176..` und `+49176..` + objective; im Log/Audit das normalisierte `to` gegen Eingabe abgleichen (Originate darf offline mit 500 enden — das `to` steht VOR dem Dial fest) | Gewaehltes `to` zeichengenau erwartet; keine Regeneration. Nationale 0 nur bei gesetzter DE-privateNumber aufgeloest, sonst 400 | [ ] |
| OUT-05 | P0 | auto | Concurrency-Budget-Race: N parallele place_call gegen knappen Cap | Neuer Test `test/outbound-budget-concurrency.test.js`: Server PORT=0 + DATA_DIR-Temp; Tenant mit costEur knapp unter Cap seeden (nur 1 Call passt); K=5 place_call via `Promise.all`; analog gegen globalBudgetExceeded mit 2 Tenants. `npm test -- test/outbound-budget-concurrency.test.js` | Genau 1x 200/queued, K-1x 402. HEUTE erwartbar ROT (Reserve landet nicht atomar im Bucket) -> Fix vor Launch: Reserve atomar buchen / `withStoreLock` um Check+Reserve | [ ] |
| OUT-06 | P1 | auto | Gate-Ketten-Kernsuite (Reihenfolge load-bearing) | `npm test -- test/outbound-frozen.test.js test/kyc-gate-outbound.test.js test/outbound-reserve-gate.test.js test/outbound-per-target-cap.test.js test/outbound-premature-close.test.js test/f1-p8-outbound-lang.test.js` | Alle gruen: FROZEN/KYC/Identitaet/Reserve/per-Target-Cap/Premature-Close/Sprachaufloesung greifen in korrekter Reihenfolge | [ ] |
| OUT-07 | P1 | auto | Denylist/Land/Premium/Emergency inkl. normalisierter Formen | `npm test -- test/number-gate.test.js`; ergaenzen: (a) Premium in Trunk-0-Form (`+490900..`) -> 403 grund=denylist NICHT 400; (b) 110/112/911/999 exakt -> 403; (c) Land ausserhalb ALLOWED_COUNTRY_CODES -> 403 grund=land | Notruf/Premium 403 auch in Trunk-0-Form; Land-Schnittmenge global∩Profil kann nur weiter einschraenken | [ ] |
| OUT-08 | P1 | auto | OUTBOUND_FROZEN Kill-Switch fail-closed ohne Bypass | `npm test -- test/outbound-frozen.test.js` | frozen=true -> 403 GANZ VORN (vor Tenant-Aufloesung), kein Originate, auch unrestricted-Profil hebt es NICHT auf; Default false -> byte-identisch | [ ] |
| OUT-09 | P1 | lokal | Gate-Ketten-Smoke lokal: Budget=0 / Stundenlimit / Ziel-Cap | `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true MAX_BUDGET_EUR=0 npm start`, curl POST /api/calls -> 402 kein Originate; wiederholen mit `MAX_CALLS_PER_HOUR=1` (2. Call 429) und kleinem `PER_TARGET_CALL_CAP` (Wiederhol-Call 429) | Jede Kosten-Notbremse blockt fail-closed VOR dem Dial | [ ] |
| OUT-10 | P1 | auto | Mid-Call maxDur-Klemme + kein 2. Call am Cap | node:test: place_call mit `max_duration_s=100000` -> maxDurationS auf 300 geklemmt (Math.min); zweiter Test: costEur exakt am Cap -> naechster place_call 402. `npm test -- test/outbound-tenant.test.js test/tenant-budget-cap.test.js` + neuer clamp-Fall | maxDurationS <=300; am Cap keine weiteren Calls. Mid-Call-Ueberzug (bis ~5 Min/Call) als bekanntes Restrisiko dokumentiert | [ ] |
| OUT-11 | P1 | auto | cancel_call Tenant-Scoping (404) + Idempotenz | `npm test -- test/i6-write-scope.test.js`; ergaenzen: cancel auf bereits terminierten Call -> idempotente 200 mit Alt-Status (kein Fehler, kein doppeltes endCall) | Fremde call_id -> 404 (kein Existenz-Leck), kein endCall-Seiteneffekt; terminaler Call -> idempotent | [ ] |
| OUT-12 | P2 | lokal | Heimatland-Praezedenz gegen Owner-US-DID | `npm test -- test/dial-target-normalization.test.js` mit Fall: US-DID(+1) aktiv + KEINE privateNumber -> homeCountryCode null -> `0176..` unveraendert -> 400 (kein +1176..-Fehlanruf); mit DE-privateNumber -> `+49176..` | Solange Owner-DID US ist und keine passende privateNumber gesetzt -> nationale 0 abgelehnt statt geraten | [ ] |
| OUT-13 | P2 | auto | Reserve-Tarif vollstaendig fuer alle freigegebenen Laender | `npm test -- test/f2-p8-cost-cap.test.js test/outbound-reserve-gate.test.js`; fuer jede Vorwahl in ALLOWED_COUNTRY_CODES tariffCentsPerMin>0 asserten; Tarif-Tabelle manuell gegen Telnyx-Preisliste abgleichen | Kein freigegebenes Land hat Tarif 0/fehlend -> Worst-Case-Reserve nie unterschaetzt | [ ] |

---

## IN — Telefonie Inbound (Budget-Engine)

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| IN-01 | P0 | auto | Signatur-Dispatch fail-closed (Twilio HMAC / Telnyx Ed25519) | `npm test -- test/signature-dispatch.test.js test/voice-signature.test.js test/telnyx-signature.test.js` | Manipulierter Body/fehlender Key/Replay-Fenster (300s, zu alt ODER Zukunft) -> false/403; kein erkennbarer Provider-Header -> 403, NICHT Twilio-Default (kein fail-open) | [ ] |
| IN-02 | P0 | auto | Inbound-Routing fail-closed + Anti-Spoof-Reihenfolge | `npm test -- test/inbound-routing.test.js` | Unbekannte/fehlende To -> 200 hoeflicher Hangup, KEIN Call-Record, Audit inbound_unrouted; gespoofte To OHNE Signatur -> 403 BEVOR To gelesen; Budget ueberschritten -> Hangup vor createCall | [ ] |
| IN-03 | P0 | auto | Max-Dauer-Timer feuert und beendet den Call | Neuer Test mit fake timers (`mock.timers`): Call status=active + provider im Store, `armMaxDurationTimer`, Zeit ueber maxDurationS vorspulen, asserten dass `voiceControl(provider).endCall(sid)` genau einmal laeuft. `npm test -- test/max-duration-timer.test.js` | endCall wird nach Ablauf ueber den korrekten Provider gerufen. Rot = einziger harter Telnyx-Cap kaputt = launch-blockierend | [ ] |
| IN-04 | P1 | auto | Unbekannte/tote callId in /voice/turn -> Hangup + Warn-Log | `npm test -- test/voice-unknown-call-log.test.js test/turn-fallback-locale.test.js` | Unbekannte callId (Deploy killt in-memory Call) -> Hangup MIT Warn-Log, NICHT stumm; Fallback-Locale nach Richtung/Sprache korrekt | [ ] |
| IN-05 | P1 | auto | LLM-Breaker deckelt Retries (kein Retry-Sturm) | `npm test -- test/llm.test.js` — Faelle: nach llmBreakerThreshold transienten Fehlern -> outcome breaker-open, attempts:0; pro Turn max. `max` Retries | Retries pro Turn hart begrenzt, Breaker oeffnet und unterdrueckt Folgecalls -> kein token-/kostenmultiplizierender Sturm | [ ] |
| IN-06 | P1 | auto | ElevenLabs-TTS env-gated vs. Azure-Fallback (Twilio unberuehrt) | `npm test -- test/telnyx-elevenlabs-inbound.test.js test/g2-opening-turn.test.js` | apiKeyRef+voiceId leer -> Azure byte-identisch; Twilio-Zweig komplett unberuehrt; halb-konfiguriert (nur eins gesetzt) -> sauberer Azure-Fallback statt Crash | [ ] |
| IN-07 | P2 | lokal | Fremder/kaputter Provider-Payload -> kein Crash | `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`; curl POST /voice/turn und /voice/status mit weder-Twilio-noch-Telnyx-Body (Fuzzing) | Ueberall definierter Fallback, NIE 500/Crash in extractSpeech/extractLifecycleEvent | [ ] |
| IN-08 | P2 | auto | extractSpeech-Praezedenz SpeechResult vs. Transcript | Neuer Test: Telnyx-Body mit SpeechResult UND Transcript gleichzeitig/widerspruechlich; leere Speech beim ALLERERSTEN Turn (noch kein caller-Transcript) | Definierte Feld-Praezedenz; leere Speech ohne caller-Transcript -> weitergathern, kein unnoetiger LLM-Call | [ ] |
| IN-09 | P0 | live | Provider-Webhook-Signatur fail-closed (live) | `curl -i -X POST https://<prod>/voice/incoming -d 'To=%2B49..&From=%2B49..'` (ohne Signatur); dann mit manipulierter Signatur; dann ohne erkennbaren Provider-Header | Alle drei -> 403 vor jeder Verarbeitung; unbekannter Header faellt NICHT auf Twilio-Default; kein Call-Record, kein Claude-Turn | [ ] |

---

## SMS — Summary-SMS-Versand

Ausloeser: `finishCall()` in src/server.js (nur status=completed + Transkript, nach Summary), Entscheidung in src/sms-summary.js (planSummarySms), Versand ueber messaging(call.provider).sendSms(). Ziel ist IMMER die eigene Tenant-Privatnummer (kein Fremdziel), Riegel: Opt-In, SEND_SMS_SUMMARY, DAILY_SMS_CAP (Default 20/24h), restart-fester Dedup-Marker.

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| SMS-01 | P0 | lokal | SMS-Trigger E2E + Fehlerpfad ohne Sturm (`finishCall`) | `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`; Inbound-Testcall bis `status=completed` mit Transkript treiben (Pattern wie OUT-04: `/voice/incoming` -> `/voice/turn` -> `/voice/status`); `TELNYX_API_KEY`/`TWILIO_*` bewusst ungueltig setzen, damit `sendSms` fehlschlaegt; danach denselben `/voice/status`-Callback ein zweites Mal posten (Provider-Retry simulieren) | Log zeigt GENAU EINEN `sendSms`-Versuch + `[sms] ...`-Catch-Log, kein Crash, kein Retry-Loop; zweiter Callback loest KEINE zweite SMS aus; Notification+Summary bleiben trotz SMS-Fehler erhalten | [ ] |
| SMS-02 | P1 | auto | Budget-/Land-Gate-Luecke bei Summary-SMS explizit sperren/dokumentieren | Neuer Fall in `test/f2-sms-summary-plan.test.js`: Fake-Store mit Budget bereits ueberschritten uebergeben -> pruefen, dass `planSummarySms` das GAR NICHT liest (`send=true` trotz Budget-Ueberschreitung); `npm test -- test/f2-sms-summary-plan.test.js` | Test macht heutiges Verhalten sichtbar: SMS-Versand ist NICHT an den Euro-Budget-Notaus gekoppelt, nur `DAILY_SMS_CAP`; Owner-Entscheidung noetig ob das fuer Launch reicht | [ ] |
| SMS-03 | P1 | auto | Provider-Dispatch + PII-freier Skip-Audit | `npm test -- test/telephony-contract.test.js`; ergaenzen: `messaging(call.provider)` liefert fuer `"telnyx"` UND `"twilio"` den passenden Adapter (kein Twilio-Default-Leak bei SMS); Audit-String `sms_summary_skipped` (Format `call=<id> reason=<reason>`) auf Abwesenheit von Telefonnummer/Transkript pruefen | Richtiger Provider-Adapter je Call; Skip-Audit bleibt PII-frei | [ ] |

---

## MCP — MCP-Server, Tools, MCP-Auth

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| MCP-01 | P0 | live | /mcp fail-closed ohne gueltiges Token | `curl -i -X POST https://<prod>/mcp -H 'Content-Type: application/json' -d '{}'` (ohne Authorization); dann falscher Bearer; dann echter Connector-Token | Ohne/falscher Token -> 401; nur gueltiger Token erreicht die Tools; kein Socket-Bypass in Prod | [ ] |
| MCP-02 | P0 | auto | OAuth-Tenant-Isolation: sub fehlt / audience / abgelaufen | `npm test -- test/am6-oauth-tenant.test.js test/oauth.test.js test/tenant-resolver-parity.test.js` | req.auth ohne sub -> TENANT_REJECT (NIE Owner); audience-Mismatch -> 401; exp Vergangenheit -> 401; kein fail-open | [ ] |
| MCP-03 | P0 | auto | Prod-Gate killt localhost-Socket-Bypass | `npm test -- test/auth-mcp-bypass.test.js test/single-origin-auth.test.js` | legacyLocalBypass haengt an config.isProduction (RENDER_EXTERNAL_URL); in Prod-Erkennung KEIN Bypass | [ ] |
| MCP-04 | P1 | auto | MCP-Tools degradierte/Fehlerpfade Kernsuite | `npm test -- test/mcp-tools.test.js test/mcp-ui.test.js` | Degradierte api-Antwort -> Fehlermeldung statt Crash; Handler-Throw -> isError; Whitelist-Grenzen pro Tool (kein PII-Leak); Dauer-Monotonie | [ ] |
| MCP-05 | P1 | live | OAuth-Consent + Token-Widerruf gegen echten WorkOS-IdP | claude.ai Custom-Connector einrichten (OAuth-Redirect/Consent), place_call testen; danach Session/Token in WorkOS widerrufen und erneut MCP-Tool aufrufen; Issuer pruefen (Production vs. Staging-AuthKit) | Login/Consent funktioniert; nach Widerruf scheitert naechster /mcp-Call; Issuer ist Production vor echtem Dauerbetrieb | [ ] |
| MCP-06 | P1 | auto | get_transcript waehrend status=active vs. outputSchema | node:test: place_call -> sofort get_transcript (Call noch active); pruefen dass der Hinweispfad KEIN zod-outputSchema-Failure des SDK ausloest (TRANSCRIPT_OUTPUT verlangt result_summary) | Hinweismeldung ohne SDK-Validierungsfehler; Live-Client sieht Hinweis, keinen Fehler | [ ] |
| MCP-07 | P2 | auto | MCP 404/Fehlerpfad reicht keinen rohen Gateway-Text/Stack durch | node:test: get_call_status/get_transcript/cancel_call mit nie-existenter call_id (`call_doesnotexist`); zusaetzlich fetch-Fehler (ECONNREFUSED) simulieren | errText generisch, ohne internen Pfad/Store-Struktur/Stack; isError=true; kein Crash | [ ] |
| MCP-08 | P2 | auto | list_action_items Tenant-Scoping | Neuer Test: 2 Tenants mit Action-Items; als Tenant A `list_action_items` -> darf nur A sehen | Action-Items je Tenant gefiltert (nicht global ueber /api/state.actionItems) | [ ] |
| MCP-09 | P2 | live | MCP-Auth-Prod-Konfiguration verifizieren | Render-Dashboard: MCP_AUTH + MCP_AUTH_TOKEN-Zustand; config.isProduction ueber RENDER_EXTERNAL_URL bestaetigen; externer curl gegen /mcp ohne Token; Connector-Token gegen Dashboard-Wert abgleichen | legacyLocalBypass live AUS; /mcp ohne Token -> 401; Connector-Token == Dashboard-Wert (Rotation bricht Connector still) | [ ] |

---

## UI — MCP-UI-Widgets (Chat-Widgets)

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| UI-01 | P1 | auto | Widget-Suite: Stufe0/1/Fallback/Whitelist/Poll/Groessenbudget | `npm test -- test/mcp-ui.test.js test/mcp-ui-w1-bind.test.js test/mcp-ui-w1-call-widget.test.js test/mcp-ui-widget-i18n.test.js test/mcp-server-icon.test.js` | Alle 5 Widgets Text-Fallback (Stufe 0) vorhanden; Poll/Terminal/Bruecken-Kandidaten/Fallback-Timeout/Cancel korrekt; Whitelist blockt PII; 260KB-Budget call.html eingehalten; i18n de/en/fr Paritaet | [ ] |
| UI-02 | P1 | auto | XSS: boesartiges Transkript durch call.html-Poll-Pfad | Neuer Test: Transkript-Zeile/Name = `<img src=x onerror=alert(1)>`, `</div><script>..`, `'`, `"` durch get_transcript+get_call_status (call.html renderTranscriptLines, eigene Slot-Fuellung); statisch: kein innerHTML mit Nutzerdaten in call.html | Payload nur als sichtbarer Text (textContent), kein DOM-Node/Event/alert; call.html-Slot-Fuellung neutralisiert Sonderzeichen | [ ] |
| UI-03 | P1 | live | Live-Widget-Rendering in claude.ai | Echter place_call aus claude.ai -> EINE Live-Karte (kein Karten-Spam); sichtbar alle 8s pollen; Statuswechsel dialing->in_progress->completed; Transkript-Zeilen live | Karte rendert mit Wing-Canvas/HUD-Ring, pollt sichtbar, kein Karten-Spam, Statusuebergaenge sauber | [ ] |
| UI-04 | P2 | live | Fallback-Verhalten bei Host ohne Bruecke | In einem Host ohne die 3 Bruecken-Kandidaten place_call ausloesen | Karte bleibt lesbar bei 'Connecting' (kein Crash/Endlos-Spinner); bewusst kein Diagnose-Text (Owner-Entscheidung) — als UX-Restrisiko notieren | [ ] |
| UI-05 | P2 | live | Mehrsprachigkeit + Icon/Branding im echten Host | DE/FR/EN-Karten via window.openai.locale/navigator.language gegenchecken; initialize-Icon in Claude Desktop/claude.ai sichtbar | Locale-Erkennung korrekt; Server-Icon wird angezeigt | [ ] |

---

## CFG — Config, Boot-Guards, globale Safety-Gates

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| CFG-01 | P0 | auto | Boot-Prod-Footguns (Boot-Refusal) | `npm test -- test/boot-prod-footguns.test.js test/config-failclosed.test.js` | Bei gesetztem RENDER_EXTERNAL_URL fuehren DASHBOARD_PASSWORD fehlt / MCP_AUTH=off / SKIP_TWILIO_SIGNATURE_CHECK=true / http-OAuth-Issuer / STORE_BACKEND!=pg jeweils zu Boot-Refusal (Exit-Code); numerische Fatals (NaN/negativ) klemmen | [ ] |
| CFG-02 | P1 | lokal | RENDER_EXTERNAL_URL-Footgun-Guard (assertConfig) | Lokal Boot mit `RENDER_EXTERNAL_URL=https://x SKIP_TWILIO_SIGNATURE_CHECK=true` -> Boot-Refusal; Gegenprobe OHNE RENDER_EXTERNAL_URL -> Boot erlaubt (lokal) | Prod-erkannt -> Refusal bei jeder Footgun; lokal ohne Prod-Signal kein False-Positive | [ ] |
| CFG-03 | P2 | auto | PAYMENT_ENABLED-ohne-PROVISIONING Warn-Assertion | Neuer Test: Boot mit PAYMENT_ENABLED=true + PROVISIONING_ENABLED=false -> assert dass die Warn-Zeile `[Konfiguration] PAYMENT_ENABLED ohne PROVISIONING_ENABLED` erscheint (aktuell nur console.error, kein Boot-Stop) | Warnung erscheint zuverlaessig (Grundlage fuer Owner-Sichtbarkeit) | [ ] |
| CFG-04 | P2 | auto | Env-Var-Vollstaendigkeit config.js vs .env.example vs render.yaml | `grep -oE 'process\.env\.[A-Z_]+' src/config.js \| sort -u`, gegen .env.example und render.yaml-Keys abgleichen | Keine in config.js gelesene Pflicht-Var fehlt in .env.example UND render.yaml (Drift-Guard, existiert heute nicht) | [ ] |

---

## AUTH — Web-Auth, Sessions, Multi-Tenant-Isolation

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| AUTH-01 | P0 | auto | Cross-Tenant-Isolation aller Lesepfade (MULTI_TENANT=true) | node:test analog `test/read-scope-tenant.test.js`: Server PORT=0, STORE_BACKEND=json, MULTI_TENANT=true; Tenant A+B seeden (je 1 Call inkl. Transkript/Action-Item/Notification/privateNumber); als A abrufen: /api/state, list_calls, list_action_items, get_transcript(B), get_call_status(B), GET+POST cancel /api/calls/:B-id | KEIN Feld von B in einer A-Antwort; get_transcript/status/GET/cancel auf B -> 404 (kein Existenz-Leck); /api/state.calls/actionItems/notifications nur A | [ ] |
| AUTH-02 | P0 | auto | isTrustedLocalCaller-Regression: Loopback + X-Forwarded-For nicht vertrauen | `npm test -- test/request-tenant.test.js test/request-tenant-unit.test.js test/resolve-tenant.test.js`; Request mit Loopback-Socket UND XFF plus gefaelschtem X-Internal-Tenant/-Identity auf /api/state + Schreib-Endpunkt; Gegenprobe Loopback OHNE XFF | Mit XFF: KEIN Basic-Auth-Bypass, X-Internal-* ignoriert (Reject/401); ohne XFF: In-Process-Pfad byte-identisch offen | [ ] |
| AUTH-03 | P0 | auto | Cross-Tenant IDOR auf Calls/Transkripte -> 404 statt 403 | `npm test -- test/read-scope-tenant.test.js test/i6-write-scope.test.js` | GET /api/calls/:id und POST /api/calls/:id/cancel mit fremder Call-ID -> 404, KEIN endCall-Seiteneffekt gegen Twilio/Telnyx | [ ] |
| AUTH-04 | P0 | live | Oeffentliche /api/* ohne Auth + DASHBOARD_PASSWORD gesetzt | `curl -i https://<prod>/api/state` (ohne Credentials/Cookie); Render-Dashboard: DASHBOARD_PASSWORD gesetzt bestaetigen; lokal Gegenprobe: Boot mit RENDER_EXTERNAL_URL + leerem DASHBOARD_PASSWORD | Live 401 (nicht 200 mit Daten); DASHBOARD_PASSWORD vorhanden; lokaler Boot mit leerem Passwort in Prod-Sim -> Boot-Refusal | [ ] |
| AUTH-05 | P1 | auto | Web-Auth OIDC/Session Kernsuite | `npm test -- test/web-auth.test.js test/web-auth-middleware.test.js test/admin-approval.test.js test/i9-self-service.test.js` | CSRF/nonce/PKCE/Recovery-Guard; kein Cookie/invalidiert/abgelaufen/suspended/unbekannt korrekt behandelt; admin suspend invalidiert alle Sessions; Self-Service fail-closed 401/403 | [ ] |
| AUTH-06 | P1 | auto | Admin-Allowlist nur bei email_verified===true | `npm test -- test/web-auth.test.js test/web-auth-middleware.test.js` | Payload mit email_verified='true' (String)/1/fehlend -> email:null -> KEINE Admin-Rechte; nur boolean true schaltet frei | [ ] |
| AUTH-07 | P1 | auto+live | Session-Cookie-Attribute + CSRF Self-Service | auto: mintSession Set-Cookie-Header inspizieren; Cross-Site-POST gegen /api/self-service/settings + /private-number. live: DevTools -> Application -> Cookies | Cookie traegt HttpOnly + Secure + SameSite=Lax; state-aendernde POST-Routen gegen Cross-Site geschuetzt | [ ] |
| AUTH-08 | P2 | live | Parallele Login-Flows / Session-Race im selben Browser | Zwei Tabs gleichzeitig /auth/login, beide Callbacks abschliessen; manipuliertes vs. fehlendes oauth_state/oidc_nonce durchspielen | Kein Cross-Login/keine fremde Session; falsch signiertes state/nonce -> 400, fehlendes -> Recovery-Redirect | [ ] |

---

## BILL — Billing: Stripe, Plans, Quota, Metering

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| BILL-01 | P0 | live | Stripe Live/Test-Key-Konsistenz + Webhook-Endpoint | Render-Dashboard: STRIPE_SECRET_KEY, STRIPE_STARTER_PRICE_ID, STRIPE_BUSINESS_PRICE_ID, STRIPE_WEBHOOK_SECRET-Praefixe (live_ vs test_); Stripe-Konsole (passender Mode): Webhook auf /webhooks/stripe registriert + Secret uebereinstimmend | Alle Keys im selben Mode (fuer echten Launch live_); Price-IDs existieren im Mode; Webhook-Endpoint registriert (sonst faellt der Lifecycle-Zweitpfad aus) | [ ] |
| BILL-02 | P1 | auto | Billing-Kernsuite Subscribe/Hold-Capture/Quota/Provision | `npm test -- test/billing-subscribe.test.js test/billing-hold-capture.test.js test/billing-setup-checkout-route.test.js test/b1b-quota-gate.test.js test/b2-quota-gate.test.js test/bk3-auto-provision.test.js test/bk5-smoke-e2e.test.js` | Subscribe-Gates (unknown_plan/no_card/already_subscribed/Idempotency); Hold-vor-Order/Capture-vor-Active/Rollback inkl. Orphan-Log; Minuten-Gate + Owner-Ausnahme; E2E Subscribe->Provision->Quota | [ ] |
| BILL-03 | P1 | auto | Stripe-Webhook-Signatur fail-closed | `npm test -- test/w5-billing-revoke.test.js` (bzw. stripe-webhook-signature/p3-payment-webhook) | Webhook ohne/mit falscher Signatur -> abgewiesen; kein Activate/Suspend durch gefaelschten Event; kein Cross-Tenant-Suspend (kein Treffer -> stilles Ignorieren) | [ ] |
| BILL-04 | P1 | auto | Metering-Konsistenz: Ledger-Cents vs. costEur-Float ohne Drift | `npm test -- test/usage-event-meter.test.js`; erweitern: 10000 kleine Buchungen, Ledger-Summe (Ganzzahl Cents) gegen aggregierte costEur*100 exakt (Toleranz 0) | Ledger-Cents und costEur-Ableitung exakt gleich; sonst driften Stripe-Metering und Budget-Gate | [ ] |
| BILL-05 | P1 | live | Karten-Ablehnung (off_session) liefert verstaendliche UX statt 502 | Subscribe-Flow im Browser mit Stripe-Testkarten `4000000000000002` (declined) und `4000002500003155` (3DS) durchklicken | Klare handlungsfaehige Meldung ('Karte abgelehnt/Auth noetig') statt generischem billing_unavailable/502; fehlt -> Support-Skript vorbereiten | [ ] |
| BILL-06 | P1 | live | Abo-Suspend/Kuendigung waehrend laufendem Call + Kuendigungspfad | Laufenden Testcall starten; parallel customer.subscription.deleted-Webhook an /webhooks/stripe simulieren; separat tenant.html auf sichtbaren Kuendigungs-/Karte-aendern-Pfad pruefen | Dokumentiertes Verhalten (Call laeuft bis maxDur weiter, Gate nur am naechsten place_call) bewusst als akzeptiertes Risiko; Selbstbedienungs-Kuendigungspfad vorhanden oder Support-Prozess definiert | [ ] |
| BILL-07 | P2 | auto | Minuten-Quota-Gate am Start + Perioden-Fallback | node:test: Tenant knapp unter Kontingent -> place_call erlaubt aber Budget/Duration-Cap greift; period.js-Test fuer Subscriber ohne currentPeriodStart (false->true-Flip) | Start-Gate greift exakt an der Grenze (used>=included); Perioden-Fallback sauber; Mid-Call-Ueberziehung als Restrisiko dokumentiert | [ ] |

---

## PROV — Onboarding + Nummern-Provisioning

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| PROV-01 | P0 | lokal | Provisioning-Crash-Recovery: Job-Verlust zwischen enqueue und drain + Retry | `PORT=3999 STORE_BACKEND=json PROVISIONING_ENABLED=true npm start`; POST /api/onboard fuer neuen Tenant; Prozess SOFORT nach Response mit `kill -9` beenden (vor Drain); neu starten; Nummer-Zustand pruefen; POST /api/onboard/retry {tenantId} | WUNSCH: retry repariert die haengende Nummer ODER klare handlungsfaehige Meldung. HEUTE erwartet: 409/already_provisioned (occupiesCapacity zaehlt 'requested' als belegt) = BUG, muss rot sein bis Recovery-Pfad existiert | [ ] |
| PROV-02 | P0 | live | PAYMENT_ENABLED ohne PROVISIONING_ENABLED = kein stiller Geld-Blindgang | Render-Dashboard: PAYMENT_ENABLED und PROVISIONING_ENABLED live auslesen (nicht render.yaml); Boot-Log auf die Warn-Zeile pruefen | Fuer echten Launch mit Nummernkauf: BEIDE true. Warn-Zeile im Boot-Log -> Geld-Pfad ist Blindgang (Kunde zahlt, bekommt nie Nummer) -> Launch blockieren | [ ] |
| PROV-03 | P0 | live | Telnyx-Guthaben ausreichend + 402-Diagnosepfad | Telnyx-Portal: Konto-Guthaben pruefen (Faustregel >$2 pro erwartetem Nummernkauf, Puffer fuer Launch-Volumen); optional lokal orderNumber gegen 402-Mock | Guthaben ausreichend; ein 402 landet im Render-Log klar erkennbar (nicht als nackter 500); kein leeres Konto zum Launch (historische Root-Cause 'Abo ohne Nummer') | [ ] |
| PROV-04 | P1 | auto | Provisioning-State-Machine Kernsuite | `npm test -- test/bk3-auto-provision.test.js` (Caps global/tenant, Dry-Run vs. Kauf, Hold/Capture/Rollback, doppeltes Drain=kein Doppelkauf, Worker-Zustandscheck REQUESTED, Webhook-Idempotenz, Persist-Failure -> 503) | Alle gruen; State-Machine + Idempotenz solide | [ ] |
| PROV-05 | P1 | lokal | Resolve-Timeout-Orphan bei Regulatory-Pending (+49) | provisionNumber/resolveNumberId gegen Telnyx-Mock: orderNumber ok, resolveNumberId dauerhaft 'pending' bis Poll-Erschoepfung (8x1s); Number-Status/Hold-Storno/Owner-Sichtbarkeit pruefen | Number -> 'failed', Hold storniert, Fall im Owner/Dashboard-View sichtbar (nicht nur Log); fehlendes releaseNumber (providerNumberId unbekannt) als akzeptiertes Restrisiko dokumentieren | [ ] |
| PROV-06 | P1 | auto | Doppel-Onboard-Race: kein Doppel-Nummernkauf | Integrationstest: zwei parallele POST /api/onboard fuer denselben neuen Tenant (direkter Onboard-Pfad, nicht Webhook) | Genau EINE Nummer angefragt; zweiter Request idempotent abgewiesen (heute fehlt tenantHasLiveNumber-Gate im requestNumber-Pfad -> Test deckt Luecke auf) | [ ] |
| PROV-07 | P1 | live | FORCE_NUMBER_COUNTRY vs. Ziel-Region + echte Zustellung | Render-Dashboard: FORCE_NUMBER_COUNTRY und ALLOWED_COUNTRY_CODES live lesen; frisch provisionierte Nummer der Launch-Region echt anrufen (Klingelton) + Outbound in die Region | Absender-Land passt zur Ziel-Region (kein strukturelles US-DID->DE bei DE-Launch); Anruf klingelt zuverlaessig | [ ] |
| PROV-08 | P2 | live | maxNumbers-Cap: Wert + verstaendliche Ablehnung | MAX_NUMBERS live gegen erwartetes Launch-Volumen pruefen; optional Test: 429 global_cap liefert verstaendliche Meldung | Cap ausreichend hoch; Ablehnung verstaendlich statt nacktem 429 | [ ] |

---

## STORE — Store (JSON+Postgres), RLS, DSGVO

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| STORE-01 | P0 | live | hermes-db Free-Tier-Ablauf 2026-07-24 geklaert | Render-MCP: get_postgres / list_postgres_instances fuer hermes-db -> Plan-Status + Ablaufdatum | Bezahlter Plan ODER dokumentierte Migration/Backup vor 2026-07-24; kein drohender Datenverlust im Launch-Fenster | [ ] |
| STORE-02 | P0 | live | Killer-Test: RLS-Isolation unter echtem Postgres/pgBouncer | `docs/RELEASE-GATE-killer-test.md` fahren: 2 reale Tenants, ~50 parallele Requests, injizierte Txn-Fehler; zusaetzlich Query auf calls/transcript_segment OHNE gesetzten app.current_tenant-GUC; DB-Rolle auf NOBYPASSRLS pruefen (`SELECT rolbypassrls`) | Kein Cross-Tenant-Zeilenleck unter Last; Query ohne GUC -> 0 Zeilen (FORCE RLS greift); DB-Rolle non-superuser + NOBYPASSRLS | [ ] |
| STORE-03 | P1 | auto | Store-pg + RLS + DSGVO + Retention Kernsuite | `npm test -- test/store-pg.test.js test/store-pg-rls.test.js test/f2-p10-dsgvo-export-erase.test.js test/tenant-erasure-pg.test.js test/store-purge.test.js test/retention.test.js test/store-integrity.test.js` | Parity json/pg + Re-Hydrierung (tenantId gesetzt); RLS Cross-Tenant-Write-Block; Export/Erase-Scope-Konsistenz; Purge; Retention (0=aus); withStoreLock kein Lost-Update | [ ] |
| STORE-04 | P1 | live | DSGVO-Erase (Art.17) Cascade auf Prod-Postgres | Test-Tenant mit >=1 Call inkl. Transkript/Action-Item/Notification/privateNumber auf Prod; Erase-Script gegen tenant_id fahren; `SELECT count(*)` auf call, transcript_segment, action_item, notification WHERE tenant_id=<x>; privateNumber pruefen | Alle Zaehler = 0, privateNumber entfernt; kein verwaister transcript_segment; Script-Rueckgabe stimmt mit geloeschten Zeilen | [ ] |
| STORE-05 | P1 | live | Roh-Transkript-Purge nach Summary (Mirror + pg) | Test-Call bis Ende + Summary; danach call.transcript im Store und transcript_segment-Zeilen des Calls in pg pruefen | call.transcript geleert, keine transcript_segment-Zeilen mehr; nur Summary bleibt | [ ] |
| STORE-06 | P1 | live | Live-Migrationsstand Prod-DB vs. src/db/schema.sql | Render-MCP query: SELECT-Check auf erwartete Spalten/Policies (z.B. failure_reason, context, tenant_budget) + FORCE RLS auf allen Tabellen | Prod-Schema == Repo-Stand; kein vergessenes migrate.js; FORCE ROW LEVEL SECURITY auf allen 10+ Tabellen aktiv | [ ] |
| STORE-07 | P2 | live | Fehlgeschlagener Flush (Silent-Failure-Fenster) beobachten | Waehrend Testanruf DATABASE_URL kurz kappen/DB pausieren; pruefen ob Call zu Ende laeuft und ob nach Wiederherstellung Daten fehlen | Datenverlust-Fenster quantifiziert; fire-and-forget-Flush (catch->console.error, kein Retry/Alert) als bekanntes Risiko dokumentiert | [ ] |

---

## WEB — Website apps/web (sundartha.com)

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| WEB-01 | P0 | live | Split-Origin-Check: sundartha.com bedient /api same-origin | `curl -i https://sundartha.com/api/self-service/state` (ohne Cookie); im Browser DevTools-Network beim 'Sign in'-Klick den Ziel-Origin ablesen; DNS/TLS sundartha.com vs. app.sundartha.com im Render-Dashboard | 401 (same-origin, korrekt) statt 404 (split-origin -> Login/Subscribe/App tot). Bei 404: kompletter Money-/Auth-Funnel defekt -> Blocker | [ ] |
| WEB-02 | P0 | live | Legal-Seiten (Impressum/Datenschutz/AGB) rechtsverbindlich | impressum/datenschutz/agb.astro im Live-HTML pruefen: 'Platzhalter-Fassung' entfernt; echte Anbieterkennzeichnung (TMG/DDG), echte Datenschutzerklaerung (Art.13 DSGVO: Transkripte+Zahlungsdaten), echte AGB inkl. Widerrufsrecht (Abo-Fernabsatz) | Kein 'Platzhalter'-Text mehr; rechtsverbindlicher Inhalt vorhanden. Abmahnrisiko sofort ab Live-Gang -> Blocker | [ ] |
| WEB-03 | P1 | auto | apps/web Build + Link-Suite + Chrome-/Sprach-Marker | `cd apps/web && PUBLIC_GATEWAY_URL=https://app.sundartha.com npm run build && npm test` (links/pages/subscribe/api) | Build fail-closed ohne PUBLIC_GATEWAY_URL; kein toter Anker; kein Markenrot; Marketing=en/Legal=de; Pricing zeigt USD aus Katalog | [ ] |
| WEB-04 | P1 | auto+live | Preis-Katalog-Drift + echte Stripe-Betraege | auto: `npm test -- test/plans-catalog.test.js` (Marketing-Spiegel==Backend-SSoT, Price-Config-Key je Slug). live: Stripe-Dashboard STRIPE_STARTER_PRICE_ID=499 Cent, STRIPE_BUSINESS_PRICE_ID=999 Cent im richtigen Mode | Katalog byte-identisch; Live-Price-IDs zeigen auf genau 499/999 Cent (Owner-Verantwortung, kein Test faengt Betrag) | [ ] |
| WEB-05 | P2 | live | og:image/Social-Preview | og:title/description in echten Clients (WhatsApp/Slack/LinkedIn/X) pruefen | Vorschau sinnvoll; fehlendes og:image als bekannte Luecke fuer Launch-Post notieren | [ ] |

---

## DASH — Dashboards + Self-Service-Portal

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| DASH-01 | P1 | auto | Self-Service Login-Gate + Scope + Portal-RLS Kernsuite | `npm test -- test/i9-self-service.test.js test/portal-rls-killer.test.js test/api-read-parity.test.js` | 401/403/404 bei Flag aus; Settings/private-number Whitelist + Land-Gate; Quota Cross-Tenant-Isolation; Portal-RLS Tenant-Isolation + Rollback bei Query-Fehler | [ ] |
| DASH-02 | P1 | auto | tenant.html XSS / esc() Frontend (jsdom) | Neuer jsdom-Test: Call mit Namen/Goal/Transkript = `<img src=x onerror=alert(1)>`, `'`, `"` durch renderCalls/planCard/esc(); statisch pruefen kein innerHTML mit Nutzerdaten | Payload nur als Text; esc() neutralisiert Sonderzeichen; heute KEIN Frontend-Testnetz -> Regressionsluecke schliessen | [ ] |
| DASH-03 | P1 | live | Self-Service Live-Sichtcheck + Cookie-Verhalten | Echter Login-Roundtrip (WorkOS/OIDC) im Browser -> tenant.html zeigt Daten; DevTools -> Cookies (SameSite/Secure/HttpOnly); esc()-Rendering bei echten Sonderzeichen aus echten Calls; Mobile/Responsive | Login funktioniert, Daten korrekt gescopt, Cookie-Attribute gesetzt, kein XSS bei echten Anrufer-Namen | [ ] |

---

## DEPLOY — Deployment / Render / Env-Drift / Betrieb

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| DEPLOY-01 | P0 | live | Prod-Boot-Verifikation: isProduction=true + Secrets gesetzt | Nach Launch-Deploy [boot]-Banner (Render-MCP get_deploy + list_logs): keine Footgun-/'nur localhost'-Zeile, keine Boot-Refusal; parallel Env-Auszug: RENDER_EXTERNAL_URL, DASHBOARD_PASSWORD, MCP_AUTH, MCP_AUTH_TOKEN, STORE_BACKEND=pg, DATABASE_URL, TELNYX_*, STRIPE_* gesetzt | Boot sauber, isProduction=true wirksam; alle Pflicht-Secrets gesetzt. Fehlendes RENDER_EXTERNAL_URL -> NICHT launchen | [ ] |
| DEPLOY-02 | P0 | live | Deploy-Ziel-Verifikation: gewuenschter Commit laeuft live | `git rev-parse HEAD` notieren; `git push upstream master` (NICHT nur origin — Render deployt upstream jonas986); nach Deploy [boot]-Banner 'deployed commit=<SHA>' gegen HEAD abgleichen | Banner-SHA == gewuenschter Commit. Abweichung = Deploy auf altem Code/falschem Remote -> Blocker | [ ] |
| DEPLOY-03 | P0 | live | Live-Env-Drift render.yaml vs. Render-Dashboard | Render-MCP get_service + Env-Auszug fuer vodafone-agent; gegen config.js-Pflicht-Vars pruefen: STORE_BACKEND=pg, MULTI_TENANT (siehe AUTH-01/09), SELF_SERVICE_ENABLED, MCP_UI_ENABLED, GEO_ENABLED, METRICS_ENABLED, autoDeploy, healthCheckPath, SKIP_TWILIO_SIGNATURE_CHECK != true | Keine Prod-Footgun aktiv, keine stille Abweichung; render.yaml ist dashboard-managed = NICHT die Live-Wahrheit | [ ] |
| DEPLOY-04 | P0 | live | A6-Repro: Deploy waehrend aktivem Call | Echten Inbound/Outbound-Testcall halten; waehrenddessen No-Op-Deploy (upstream) ausloesen; Deploy via list_deploys beobachten; am Telefon pruefen ob Call weiterlaeuft; `SELECT id,status FROM call WHERE id='<callId>'` | AKTUELL BEKANNT ROT (A6 offen: neue Instanz kennt in-memory-State nicht, Reconcile-Flush loescht pg-Row). Bis Fix: harter Deploy-Freeze bei aktivem Traffic als P0-Auflage am Launch-Tag | [ ] |
| DEPLOY-05 | P0 | live | Telnyx-Carrier-Kosten hart gedeckelt + Kosten-Env plausibel | Telnyx-Konsole: Prepaid mit hartem Spend-Limit (KEIN unbegrenztes Postpaid/Auto-Recharge); Render-Dashboard: MAX_BUDGET_EUR, MAX_CALLS_PER_HOUR, PER_TARGET_CALL_CAP, MAX_CALL_DURATION_S gegen reale Telnyx-Rate plausibilisieren | Reale Carrier-Ausgaben unabhaengig vom App-Budget hart gedeckelt; alle Kosten-Env gesetzt und konservativ. Ohne harte Telnyx-Deckelung ist das App-Budget kein Schutz gegen Kostenexplosion | [ ] |
| DEPLOY-06 | P1 | live | Free-Tier-Spindown / Cold-Start-Latenz beim ersten Webhook | Plan-Typ via get_service bestaetigen; Service ~15min in Ruhe lassen; ersten Inbound-Testanruf/curl gegen /voice/incoming zeitlich messen gegen Provider-Timeout (~10-15s) | Antwortzeit deutlich unter Provider-Timeout; sonst bezahlter Plan oder Keep-Alive-Poller gegen /healthz | [ ] |
| DEPLOY-07 | P1 | live | preDeploy-Bootstrap + Boot-Guard | Deploy-Log auf tatsaechliche preDeployCommand-Ausfuehrung (bootstrap-tenant) durchsuchen; [boot]-Banner: KEINE Zeile 'Keine aktive Nummer im Store'; hasActiveNumber bestaetigen | Owner-Nummer geseedet, Boot-Guard passiert. Fehlen (Free-Plan hat evtl. kein preDeploy) -> exit(1)-Bootschleife = Total-Ausfall | [ ] |
| DEPLOY-08 | P1 | live | Readiness statt nur Liveness nach Deploy | Nach Deploy /healthz (200) beobachten UND zusaetzlich DB-abhaengige Route treffen (z.B. /api/plans bzw. Self-Service-Read mit Session); [boot]-Log auf DB-Fehler/Breaker-Open | DB-Route liefert echte Daten (200); /healthz allein NICHT als Deploy-Abnahme akzeptieren (reine Liveness, meldet 200 auch bei kaputter DATABASE_URL) | [ ] |
| DEPLOY-09 | P1 | live | OUTBOUND_FROZEN Wirksamkeit real (Boot-Read-Semantik) | Dashboard OUTBOUND_FROZEN=true setzen, Service NEU STARTEN/redeployen; Boot-Banner 'Outbound: EINGEFROREN' pruefen; place_call aus claude.ai -> 403; danach false + Restart, Banner 'aktiv' | Flag greift erst NACH Neustart; Runbook-Notiz: OUTBOUND_FROZEN ist KEIN Live-Runtime-Toggle — Restart noetig, im Notfall einplanen | [ ] |
| DEPLOY-10 | P1 | auto+live | Log-Scan auf Secrets/PII | auto: Grep ueber src/ auf `console.*` mit ganzem err-Objekt / req.body / transcript / to+from. live: list_logs-Stichprobe auf Telefonnummern/Transkript-Fragmente/`sk_`/Bearer/Ed25519, gezielt Fehlerpfade (Provisioning-402, Signaturfehler, Provider-4xx) provozieren | Kein Log-Call mit vollem err-Objekt/Body/Transkript; Live-Logs ohne Secrets; Telnyx-Inventarnummer-Echo als dokumentiertes akzeptiertes Restrisiko | [ ] |
| DEPLOY-11 | P2 | live | Launch-Tag-Beobachtungsprozess (Ersatz fuer fehlendes Alerting) | Vor Launch definierten Log-Poll-Rhythmus festlegen (list_logs auf ERROR/'Boot abgebrochen'/Breaker-Open/Budget-Guard); regelmaessiger /healthz+DB-Route-Check waehrend des Launch-Fensters | Aktiver menschlicher Wach-Prozess laeuft; kein Code-Alarm existiert -> einzige Ausfall-Erkennung | [ ] |

---

## OBS — Metrics / Observability

src/metrics.js schreibt NUR strukturierte console.log-Zeilen hinter METRICS_ENABLED (Default false); es existiert KEINE /metrics-HTTP-Route. PII-Whitelist bereits gut getestet (test/l0-metrics.test.js).

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| OBS-01 | P1 | lokal | Kein oeffentlich erreichbarer Metrics-Endpunkt (Regressions-Riegel) | `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`; `curl -i localhost:3999/metrics localhost:3999/api/metrics localhost:3999/debug/metrics` (mit UND ohne Basic-Auth) | Alle 404 (heute existiert keine Route, src/metrics.js schreibt nur stdout); falls spaeter ergaenzt: MUSS hinter Basic-Auth (Regel 3) | [ ] |
| OBS-02 | P2 | auto | METRICS_ENABLED-Default aus bleibt konsistent (config + Deploy) | `npm test -- test/l0-metrics.test.js`; zusaetzlich `grep -n METRICS_ENABLED src/config.js .env.example render.yaml` | Bestehende Suite gruen; Default false bestaetigt in config.js, kein committeter Prod-Override in render.yaml (Live-Wert separat via DEPLOY-03 aus dem Dashboard) | [ ] |

---

## DEP — Dependencies / Supply-Chain

9 direkte Prod-Deps, engines node >=22 <23, .nvmrc=22, package-lock.json (v3) committed. `npm audit --omit=dev` am 2026-07-02: 0 Vulnerabilities.

| ID | Prio | Typ | Test | Schritte/Kommando | Erwartet | [ ] |
|----|------|-----|------|-------------------|----------|-----|
| DEP-01 | P1 | lokal | Prod-Dependency-Audit sauber + Lockfile vorhanden | `npm audit --omit=dev` und `test -f package-lock.json && echo lockfile-ok` | 0 Vulnerabilities (Stand 2026-07-02 bestaetigt, vor Launch frisch laufen lassen); package-lock.json committed | [ ] |
| DEP-02 | P2 | lokal | Sauberer Clean-Install auf dem Render-Build-Pfad (`npm install`) | In FRISCHEM Checkout/Worktree (nicht im aktiven Arbeitsbaum): `rm -rf node_modules && npm install && npm test` | Laeuft fehlerfrei durch; klaert, ob der beobachtete lokale `UNMET DEPENDENCY`/`node_modules/node_modules`-Drift nur diese Arbeitskopie betrifft oder strukturell ist | [ ] |
| DEP-03 | P2 | live | Node-Runtime auf Render == .nvmrc/engines-Pin | Render-MCP get_service/list_logs fuer den Web-Service: tatsaechliche Node-Version aus Build-Log gegen .nvmrc(=22)/package.json engines(`>=22 <23`) abgleichen | Live-Runtime laeuft auf Node 22.x, keine stille Render-Default-Abweichung | [ ] |

---

## Live-Testtag — geordneter Ablauf

> **Kosten-Hinweis:** Echte Anrufe verursachen Carrier-Kosten (Telnyx/Twilio). Stripe im Test-Mode ist kostenlos (Testkarten), ein echter Live-Charge kostet echtes Geld. Nummernkauf (PROVISIONING_ENABLED=true) belastet das Telnyx-Konto. Halte Testanrufe kurz, nutze eigene Nummern als Ziel, und stelle vor dem Tag DEPLOY-05 (harte Kostendeckel) sicher.

Reihenfolge (erst Vorbereitung, dann echte Transaktionen):

1. **Infra-Vorpruefung (kein Traffic):** DEPLOY-01, DEPLOY-02, DEPLOY-03, STORE-01, STORE-02, STORE-06, PROV-02, PROV-03, BILL-01, WEB-01, WEB-02, AUTH-04, MCP-01, IN-09.
2. **Kill-Switch & Kosten-Gates real:** DEPLOY-05, DEPLOY-09 (OUTBOUND_FROZEN true -> place_call 403 -> wieder false).
3. **Echter Inbound-Call:** auf jede aktive Nummer (DE/FR/EN) anrufen — Klingeln, Begruessung, STT-Erkennung, Antwort. (deckt IN-01/02 live ab)
4. **Echter Outbound-Call mit Disclosure-Hoerprobe (LIVE-02):** aus claude.ai place_call an eigene Test-/Owner-Nummer; pruefen: (1) klingelt beim ERWARTETEN Ziel (keine Ziffernverschiebung), (2) ERSTER gesprochener Satz ist die Offenlegung mit vollem ownerName, (3) angezeigte From-Nummer == Tenant-DID (NIE Privatnummer); optional cancel_call mitten im Klingeln.
5. **A6-Reproduktion (DEPLOY-04):** waehrend eines aktiven Calls einen No-Op-Deploy ausloesen und Verhalten am Telefon + pg-Row beobachten. Falls rot: Deploy-Freeze-Policy fuer den restlichen Launch-Tag.
6. **MCP in claude.ai (UI-03, MCP-05):** Custom-Connector einrichten (OAuth-Consent), place_call -> EINE Live-Karte, sichtbares Pollen, Transkript live; Token-Widerruf testen.
7. **Subscribe mit Stripe-Testkarte (LIVE-01, BILL-05):** frischen Test-Tenant via WorkOS -> Login -> Karte erfassen (Checkout) -> Abo buchen -> Rueckkehr /app zeigt AKTIVE Nummer + Quota; danach Ablehnungs-/3DS-Karten (`4000000000000002`, `4000002500003155`) fuer UX.
8. **Dashboard (DASH-03):** tenant.html Live-Sichtcheck (Layout, esc()-Rendering echter Anrufer-Namen, Cookie-Attribute, Mobile).
9. **DSGVO live (STORE-04, STORE-05):** Erase-Script + Purge gegen Test-Tenant auf Prod, Cascade per Query verifizieren.
10. **Abschluss:** DEPLOY-08 (Readiness), DEPLOY-10 (Log-Scan), DEPLOY-11 (Beobachtungsprozess aktiv).

**LIVE-01** und **LIVE-02** sind P0 (siehe P0-Checkliste) und werden hier im Ablauf ausgefuehrt.

---

## Bekannte offene Punkte / bewusst akzeptiert

| # | Punkt | Launch-blockierend? | Notiz |
|---|-------|---------------------|-------|
| 1 | **A6: Call-State ueberlebt Zero-Downtime-Deploy nicht** (in-memory-State weg, Reconcile-Flush loescht pg-Row) | **JA** (organisatorisch) | Kein Fix gemergt. Bis dahin: harter Deploy-Freeze bei aktivem Traffic (DEPLOY-04). |
| 2 | **hermes-db Free-Tier laeuft 2026-07-24 ab** | **JA** | Auf bezahlten Plan migrieren (STORE-01). |
| 3 | **Killer-Test (RLS unter echtem pgBouncer) nie gefahren** | **JA** bei MULTI_TENANT=true | Muss vor Multi-Subscriber-Betrieb laufen (STORE-02). |
| 4 | **Legal-Seiten sind Platzhalter** | **JA** | TMG/DDG-Impressumspflicht ab Live-Gang (WEB-02). |
| 5 | **Split-Origin-Unklarheit sundartha.com** | **JA** bis verifiziert | Live pruefen (WEB-01). |
| 6 | **Budget-/Reserve-Race bei parallelen place_call** (Reserve nicht atomar im Bucket) | **JA** | Fix: atomare Reservierung (OUT-05). |
| 7 | **Stripe Live/Test-Key-Verwechslung** nicht per Boot-Guard abgesichert (nur Praesenz geprueft) | **JA** manuell | Praefix live_/test_ im Dashboard verifizieren (BILL-01). |
| 8 | Mid-Call kein Re-Check (Budget/Minuten/KYC/Suspend nur am Producer) — laufender Call bis maxDur (max 300s) | NEIN (akzeptiert) | Bis ~5 Min Ueberzug/Call moeglich; dokumentiert (OUT-10, BILL-06/07). |
| 9 | Telnyx TimeLimit 'unbestaetigt' — In-Memory-setTimeout ist einziger harter Cap | NEIN (mit IN-03+DEPLOY-05) | Verhaltenstest + harte Telnyx-Deckelung mitigieren. |
| 10 | Kein automatisches Monitoring/Alerting im Repo | NEIN (mit DEPLOY-11) | Menschlicher Wach-Prozess am Launch-Tag Pflicht. |
| 11 | IRSF-Premium-Blockliste bewusst unvollstaendig ('Beifang') | NEIN (akzeptiert) | Hauptschutz = Kosten-/Land-Achse. |
| 12 | Kein Self-Call-Gate (Tenant ruft eigene DID) | NEIN (akzeptiert) | Kein funktionaler Schaden; Verhalten ungetestet. |
| 13 | OAuth-Token keine Revocation im /mcp-Pfad (gilt bis exp) | NEIN (akzeptiert) | TTL klein halten; WorkOS-Session-Revoke (MCP-05). |
| 14 | Full-Mirror-Flush (gesamter State pro save()) — Skalierungsrisiko | NEIN (fuer kleinen Launch) | Als Tech-Debt festhalten, kollidiert mit Millionen-Vision. |
| 15 | JSON-Store Single-Instance-Annahme (withStoreLock nur In-Process) | NEIN (heute 1 Instanz) | Bei Skalierung auf >1 Instanz erst pg/File-Lock. |
| 16 | fire-and-forget pg-Flush (catch->console.error, kein Retry/Alert) | NEIN (akzeptiert) | Silent-Failure-Fenster; STORE-07 quantifiziert. |
| 17 | Telnyx-Realtime-Engine dormant (VOICE_ENGINE=realtime unverifiziert) | NEIN (nur bei Fehlkonfig) | NICHT versehentlich aktivieren; Env pruefen (DEPLOY-03). |
| 18 | adminEmails-Vergleich ohne timingSafeEqual | NEIN (akzeptiert) | Sehr kleines theoretisches Risiko; bewusst festhalten. |
| 19 | US-DID->DE-Zustellung intermittent (Infra, kein Gate-Bug) | NEIN | Bei DE-Launch DE-DID nutzen (PROV-07). |
| 20 | Karten-Ablehnung -> generischer 502 statt sprechender UX | NEIN (P1-Verbesserung) | Support-Skript vorbereiten (BILL-05). |
| 21 | Summary-SMS NICHT an Euro-Budget-Notaus gekoppelt (planSummarySms prueft weder budgetExceeded noch globalBudgetExceeded; einziger Riegel DAILY_SMS_CAP=20/Tag; SMS_COST_CENTS=0 per Default -> reale SMS-Kosten laufen am Stripe-Meter vorbei) | NEIN (akzeptiert — Ziel ist immer die EIGENE Tenant-Nummer) | Vor Launch SMS_COST_CENTS auf realen Tarif setzen (sonst Revenue-Leak); Luecke sichtbar via SMS-02. |
| 22 | Lokaler node_modules-Drift (npm ls meldet UNMET DEPENDENCY + extraneous node_modules/node_modules; Laufzeit ok, npm audit sauber) | NEIN | Vor Launch Clean-Install aus frischem Checkout bestaetigen (DEP-02). |

---

*Ende PLAN-LAUNCH-TESTS. Reihenfolge auto -> lokal -> live einhalten. Jeder rote P0 = Launch-Stopp.*
