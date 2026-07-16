# PLAN-SERVER-SLIM.md — Verhaltenserhaltende Zerlegung von `src/server.js`

Datum: 2026-07-16
Autor: Safety-Reviewer (Pflicht-Pre-Mortem nach CLAUDE.md)
Ausgangslage: `src/server.js` = 2244 Zeilen, keine `export`s, kein Importeur ausserhalb des Prozess-Starts.

---

## Ziel

`src/server.js` von 2244 auf eine ~180-Zeilen **Kompositionswurzel** verduennen, die den
Objektgraphen sichtbar baut (Singletons + Factory-Instanzen), ihn in Router-/Wiring-Factories
injiziert und die Boot-/Middleware-Reihenfolge in benannten Registrar-Funktionen ausdrueckt
statt in Zeilenposition. **Rein verhaltenserhaltend**: byte-identische HTTP-Antworten
(Pfade/Status/Shapes/Audit-Events), byte-identische Middleware-/Mount-/Boot-Reihenfolge,
byte-identische Boot-Log-Zeile. Keine Features, keine Verhaltensaenderung.

Einzige Aussen-Schnittstelle von `server.js` ist **HTTP + eine Boot-Log-Zeile**
(`Hermes Gateway laeuft auf http://localhost:${port}`). Solange (a) Pfade/Status/Shapes/Audit,
(b) Mount-Reihenfolge und (c) Boot-Gate-Sequenz byte-identisch bleiben, ist jedes Verschieben
interner Symbole beobachtbar folgenlos.

---

## Nicht-Ziele

- **Keine** G30-Intra-Funktions-Splits (`finishCall`, `/api/onboard`, `/api/calls`,
  `/voice/incoming` in Teilfunktionen) und **kein** G5-1-Dedup (`attachOrHangup`). Sie
  verduennen `server.js` nicht (die Funktion sitzt dann schon im Zielmodul) und wuerden
  "reine Verschiebung" mit Logik-Umbau vermengen -> die Byte-Garantie waere weg. Bewusst
  Folgearbeit INNERHALB der neuen Heimatmodule.
- **Keine** Aenderung an `src/bridge.js` (HEIKLE STELLE Barge-in/Call-Ende). Nur die
  Uebergabe `attachMediaBridge(httpServer, callFinish.finishCall)` wandert nach `boot.js`;
  die injizierte `finishCall`-Referenz bleibt identisch.
- **Keine** Aenderung an bestehenden `test/*.test.js` (waere Verhaltensaenderung durch die
  Hintertuer). Pro Helfer-/Safety-Phase HOECHSTENS EIN neuer Freeze-/Charakterisierungs-Test
  (Muster `outbound-gates-order.test.js`).
- **Keine** neue Env-Var — auch nicht optional: PX (`BODY_LIMIT`->`config.bodyLimit`) ist per
  Owner-Entscheid Q3 gestrichen; die Konstante wandert in P15 unveraendert mit.
- **Kein** Track-B-Infra-Rename (`vodafone-agent`).
- **Keine** neue Dependency; ESM ohne Build-Step bleibt.

---

## Zielarchitektur — Modul-Landkarte

### Neue Module (jeweils Factory `makeX(deps)` oder `wireX({app,...})`, kein `server.js`-Import)

| Datei | Zustaendigkeit | ~LOC | Phase |
|---|---|---|---|
| `src/billing/metering.js` | `makeMetering({store,config})` -> `voiceMinutesOf`, `recordVoiceMinuteMeter`, `reconcileOutboundVoiceBudget`, `recordNumberMonthMeter` | ~80 | P1 |
| `src/tts/directive-synth.js` | `makeDirectiveSynth({config,ttsStore})` -> `synthesizeDirectiveAudio`/`withPlayAudio`/`synthToServeUrl`, fail-safe Azure-`<Say>` | ~70 | P2 |
| `src/telephony/voice-render.js` | `makeVoiceRender({config})` -> `render`, `turnDirectives`, `sayInCallVoice`, `followupTurnDirectives`, `streamDirectives` | ~95 | P3 |
| `src/telephony/call-finish.js` | `makeCallFinish({store,config,metering,messaging,summarizeCall,planSummarySms,audit})` -> `{finishCall, releaseReserve}` | ~150 | P4 |
| `src/telephony/call-lifecycle.js` | `makeCallLifecycle({store,config,finishCall,releaseReserve,voiceControl,terminateAndBillCall,hangUpAction,billThunk,reattachActiveCallCore,...})` -> Cap-/Reserve-/Reattach-/Rearm-Timer | ~140 | P5 |
| `src/worker/provisioning-orchestrator.js` | `makeProvisioningOrchestrator({store,config,queue,billing,metering,numberProvisioning,handleProvisionJob,resolveProvisionRetry,...})` -> enqueue/trigger/drain(single-flight)/redrive/reconcile | ~210 | P6 |
| `src/routes/api-billing.js` | `makeBillingRoutes(deps)` -> `/api/billing/flush-meters|setup-checkout|checkout-return` | ~90 | P7 |
| `src/routes/api-tenant-write.js` | `makeTenantWriteRoutes(deps)` -> `/api/settings`, `/api/action-items/:id/toggle`, `/api/calendar` | ~80 | P8 |
| `src/routes/api-calls.js` | `makeCallRoutes(deps)` -> `POST /api/calls`, `/api/calls/:id/cancel`, `contextReceivedMeta` | ~180 | P9 |
| `src/routes/api-onboard.js` | `makeOnboardRoutes(deps)` -> `/api/onboard`, `/api/onboard/retry`, `geoLookup`-Singleton, Reason-Maps | ~200 | P10 |
| `src/routes/voice.js` | `makeVoiceRoutes(deps)` -> `/voice/tts/:token`, `/voice`-Sig-MW, 5 Webhooks, `inboundAssistantHandoffXml` | ~380 | P11 |
| `src/routes/mcp.js` | `makeMcpRoutes(deps)` -> `POST/GET/DELETE /mcp` (stateless) | ~90 | P12 |
| `src/routes/stripe-webhook.js` | `makeStripeWebhookRoute(deps)` -> `POST /webhooks/stripe` (HMAC fail-closed) | ~60 | P13 |
| `src/wiring/web-login.js` | `wireWebLogin({app,...})` -> OIDC/Portal/Accounts/Sessions/AuditStore + `/auth`, `/api/portal/state`, Admin-/Self-Service-Mounts + Stripe-Webhook-Mount + Release-Reconcile-Scheduler | ~180 | P13 |
| `src/wiring/auth-gate.js` | `makeAuthGate({config,audit,isTrustedLocalCaller,safeEqual,BRAND_ASSETS_PREFIX,paths})` -> Basic-Auth-Gate mit Exemption-Liste | ~70 | P14 |
| `src/app.js` | `buildApp(deps)` -> Registrar-Kette in sichtbarer Reihenfolge | ~200 | P15 |
| `src/boot.js` | `bootServer(deps)` -> store.load, Retention, Boot-Gates, listen+Banner, attachMediaBridge, reconcile, Graceful-Shutdown | ~130 | P15 |

### Geaenderte Datei

| Datei | nachher | ~LOC |
|---|---|---|
| `src/server.js` | Kompositionswurzel: process-guards zuerst, Singletons + Factory-Instanzen (P1-P6) konstruieren, `deps` buendeln, `const { app } = await buildApp(deps)`, `await bootServer({ app, ...deps })`. Kein Handler, keine Middleware-Logik. | ~180 |

### Bewusst NICHT angefasst
`bridge.js`; `claude.js`; `telephony/adapters/*`; Store-Fassade; `billing/stripe.js|webhook.js|card-setup.js|meter.js`; `worker/provisioning.js`; `web-auth.js`; `config.js`/`.env`;
`conversationWatchdog`-Konstruktion (bleibt Root, geteilt von Shim + Call-Control-Ingest);
die Boot-Log-Zeile; alle Safety-Gates.

---

## Invarianten (Checkliste — VOR jedem Phasen-Merge pruefen)

Jede Phase ist eine **reine Verschiebung**. Kein Merge, wenn eine dieser Invarianten
verletzt ist. Pro Phase sind die *load-bearing* Invarianten unter "Risiken" benannt.

- **INV-1 (rawBody-Naht):** `express.urlencoded` UND `express.json` tragen `verify: captureRawBody`
  und sind VOR jeder Route registriert. `captureRawBody`-Praedikat
  (`req.path.startsWith("/voice") || req.path === STRIPE_WEBHOOK_PATH`) bleibt byte-identisch.
  `STRIPE_WEBHOOK_PATH` ist **EINE** gemeinsame Konstante, injiziert in captureRawBody (app.js),
  Auth-Gate (P14) und Stripe-Route (P13). Bricht das -> Twilio-HMAC + Telnyx-Ed25519 + Stripe-HMAC
  laufen ins Leere (fail-closed 403).
- **INV-2 (Middleware-/Mount-Reihenfolge, byte-identisch):**
  `securityHeaders` -> Rate-Limit-Wrapper (skip `/voice*` + `isTrustedLocalCaller`) ->
  `urlencoded(verify)` -> `json(verify)` -> Body-Parser-Fehler-MW ->
  Pre-Auth-Public (`/healthz`, `/api/plans`, `registerWellKnown`, `POST /v1/chat/completions`,
  `GET /`-Redirect) -> `wireWebLogin` (guardedBoot, nur pg+sessionSecret) ->
  `express.static(webDistDir)` (nur WEB_DIST_DIR) -> **AUTH-GATE** ->
  `express.static(publicDir)` -> Voice-Router -> API-Router (calls, cancel, read, tenant-write,
  profiles, billing, onboard) -> MCP-Router -> `errorHandler` (LETZTES `app.use`).
- **INV-3 (Auth-Exemption-Set, eingefroren):** Reihenfolge im Auth-Gate exakt:
  `CUSTOMER_PORTAL_PATH` (nur unter selfService+multiTenant) -> `/voice*` -> `/mcp*` ->
  `/.well-known*` -> `STRIPE_WEBHOOK_PATH` -> `/healthz` -> `BRAND_ASSETS_PREFIX*` ->
  `/favicon.ico` -> `isTrustedLocalCaller` -> `safeEqual`. **Keine** heute hinter der Gate
  liegende Route darf davor mounten.
- **INV-4 (Voice-Signatur fail-closed):** `app.use("/voice", sig)` unveraendert, Skip NUR ueber
  `config.skipTwilioSignatureCheck`. `GET /voice/tts/:token` ist VOR der Sig-MW registriert
  (sonst wird PII-Audio signaturpflichtig -> 403).
- **INV-5 (Boot-Gate-Sequenz):** `store.load()` -> `runRetention()` + Interval ->
  `assertConfig()` (exit1) -> `fakeOriginateBootBlocked` (exit1) -> `hasActiveNumber` (exit1) ->
  `rearmActiveCallTimers()` **NACH allen exit1-Gates, unmittelbar VOR listen** ->
  `app.listen(config.port, banner)` -> `reconcileOrphanedProvisioning()` (im listen-Callback) ->
  `attachMediaBridge(httpServer, callFinish.finishCall)` -> `SIGTERM/SIGINT` -> `gracefulShutdown`.
  **Kein Gate nach `rearm` darf `process.exit(1)` rufen** (sonst teilgebuchter Zombie).
- **INV-6 (Boot-Log-Zeile):** `\n  Hermes Gateway laeuft auf http://localhost:${port}` wortwoertlich,
  genau 1 Treffer, erst NACH vollem Boot (Test-Kontrakt `test/helpers.js:805`).
- **INV-7 (EINE Instanz je Singleton):** `provisioningQueue`, `requestTenant/requireTenant`,
  `outboundGates`, `conversationWatchdog`, `ttsStore`, `geoLookup`,
  `runProvisioningDrainExclusive` (Single-Flight), `callFinish` (finishCall/releaseReserve),
  `lifecycle`, `metering`, `directiveSynth`, `voiceRender`, `provisioning` — je EINMAL in der
  Wurzel konstruiert und injiziert. Keine Factory baut ihre eigene zweite Instanz.
- **INV-8 (/mcp stateless):** `McpServer` + `StreamableHTTPServerTransport` werden INNERHALB des
  Handlers pro Request gebaut (`sessionIdGenerator: undefined`), `res.on("close")`-Cleanup;
  kein Hoisting/Caching ueber Requests.
- **INV-9 (Safety-Gates unangetastet):** Outbound-Gate-Kette = EIN eingefrorenes Array
  (outbound-gates-order); `disclosureSentence` fest verdrahtet; Max-Dauer = EINZIGER
  Terminalisierungspfad (`terminateCappedCall`->`terminateAndBillCall`); Budget-Schnittmenge
  (`budgetExceeded && globalBudgetExceeded`) unveraendert.
- **INV-10 (kein Export, Kindprozess-Boot):** `server.js` bleibt export-frei; PORT=0 + DATA_DIR-
  Override + Owner-Nummer-Seed bleiben der Testkontrakt.
- **INV-11 (guardedBoot ist fail-OPEN):** Der gesamte Web-Login/Portal/Stripe-Webhook/
  Self-Service-Block laeuft in `guardedBoot`, das Exceptions **verschluckt** (loggt
  `[boot] ... deaktiviert`, returnt `false`). Ein Verdrahtungsfehler in P6/P13 crasht also NICHT,
  sondern **deaktiviert die Routen lautlos** (404) — und die json-Backend-Mehrheit der Suite
  sieht das nicht. Jede Aenderung im Block wird gegen die pg+sessionSecret-Happy-Path-Tests
  verifiziert UND darf im Happy-Pfad die Zeile `deaktiviert` NICHT erzeugen. Ab P13 zusaetzlich
  (Owner-Entscheid Q1): positiver Marker `[boot] Web-Login aktiv` im Erfolgsfall, per Spawn-Test
  asserted.

**Globale Verifikation je Phase** (nicht wiederholt): `node --check` fuer neue Datei + `src/server.js`;
volle `npm test` gruen; `grep -c "^export" src/server.js` = 0; Boot-Log-Zeile genau 1 Treffer,
wortwoertlich; `git diff --stat` zeigt Netto-Reduktion in `server.js`. Der Voll-Last-Flake
`p5-gate-proof` (~12%) gilt nur als echt rot, wenn die betroffene Datei ISOLIERT
(`node --test test/<datei>.test.js`) rot bleibt.

---

## Reihenfolge-Begruendung (Risiko-Minimierung)

1. **Leaf-zuerst entlang des DAG (P1-P5):** `metering -> call-finish -> call-lifecycle` (linear,
   kein Zyklus, kein Lazy-Thunk, weil `call-lifecycle` `finishCall`/`releaseReserve` fertig
   injiziert bekommt). `directive-synth`/`voice-render` haengen an nichts Neuem. Diese Extraktionen
   ent-risiken die spaeten Route-Phasen: bei P11 sind alle Voice-Helfer schon injizierbare Deps.
2. **Orchestrator vor Konsumenten (P6 vor P10/P13):** `triggerTenantProvisioning` wird von Onboard,
   Web-Login und Stripe-Webhook gebraucht; als injizierte Instanz VOR L286 konstruiert behebt es
   zugleich die Vorwaerts-Referenz (heute Funktions-Hoisting).
3. **Route-Gruppen aufsteigend nach Blast-Radius (P7->P11).** Charakterisierungs-Luecken (flush-meters,
   action-items) werden VOR P7/P8 geschlossen.
4. **Safety-Naehte spaet, aber vor dem Capstone (P13/P14).** guardedBoot-Block wird GENAU EINMAL
   angefasst (Stripe-Webhook + Wiring zusammen).
5. **Wurzel-Umformung zuletzt (P15, committed).** Hoechster Blast-Radius, kleinster Diff, wenn fast
   alle Fachlogik weg ist.

**Abbruch-Sicherheit:** Nach jeder Phase ist `server.js` echt duenner, jede Domaene hat eine
getestete Heimat, keine Zwischenstufe weicht ein Safety-Gate auf oder aendert HTTP-Verhalten.
Stopp nach P6 = alle HTTP-freien Fach-Domaenen ausgelagert. Stopp nach P13 = Wurzel ohne
Fachlogik in Routen.

---

## Phasen

### P0-pre (empfohlen, 2 Mini-PRs) — Charakterisierungs-Tests fuer HTTP-blinde Routen
**Grund (Pre-Mortem h):** `POST /api/action-items/:id/toggle` und `POST /api/billing/flush-meters`
haben KEINEN HTTP-Test (grep bestaetigt). Ihr Move (P7/P8) waere sonst nicht byte-beweisbar.
- **P0a:** Spawn-Test `test/api-flush-meters.test.js`: ohne `PAYMENT_ENABLED` -> `404
  {"error":"metering disabled (PAYMENT_ENABLED)"}` (fail-closed); mit `PAYMENT_ENABLED` (stub
  billing) -> `200 {sent,failed}`, KEIN Secret/Event-Inhalt.
- **P0b:** Spawn-Test `test/api-action-items-toggle.test.js`: fehlende id -> `404 {"error":"not found"}`;
  vorhandenes Item -> `200` mit getoggeltem Item.
- **Verifikation:** beide neuen Tests gruen GEGEN den unveraenderten `server.js` (beweist, dass sie
  das Ist-Verhalten pinnen, nicht ein Wunsch-Verhalten).
- **Risiko:** niedrig. Falls der Owner die Charakterisierung lieber in P7/P8 buendelt: siehe
  Offene Frage Q2.

### P1 — `billing/metering.js` (Leaf, pure)
- **Scope:** L1035-1088 (`MS_PER_MINUTE`, `voiceMinutesOf`, `recordVoiceMinuteMeter`,
  `reconcileOutboundVoiceBudget`, `recordNumberMonthMeter`). `tariffCentsPerMin`/
  `holdAmountForCountry`/`USAGE_EVENT_KIND` importiert das Modul selbst.
- **Verdrahtung:** `const metering = makeMetering({ store, config })` in der Wiring-Region
  (~nach `outboundGates`). `finishCall` (noch inline) ruft `metering.recordVoiceMinuteMeter`/
  `.reconcileOutboundVoiceBudget`; `runProvisioningDrain` (noch inline) ruft
  `metering.recordNumberMonthMeter`.
- **Ergebnis:** `grep -c "function voiceMinutesOf" src/server.js` = 0; Voice-Minuten-Buchung +
  number_month-Meter unveraendert.
- **Verifikation:** `node --test test/finishcall-billing-once.test.js test/outbound-reconcile-finishcall.test.js test/usage-event-meter.test.js test/f2-p8-cost-cap.test.js test/bk3-auto-provision.test.js`. Empfohlen: Unit-Test importiert `makeMetering` direkt.
- **Risiken/Gegenmassnahme:** Geld-Pfad (INV-9). **Die Gating-Bedingung `if (config.paymentEnabled)
  recordVoiceMinuteMeter` bleibt beim AUFRUFER (`finishCall`), wandert NICHT ins Modul** —
  `reconcileOutboundVoiceBudget` laeuft immer, `recordVoiceMinuteMeter` nur im Payment-Pfad.
  Cents bleiben Ganzzahl.

### P2 — `tts/directive-synth.js` (Leaf, pure, Hot-Path)
- **Scope:** L644-680 (`synthesizeDirectiveAudio`, `withPlayAudio`, `synthToServeUrl`).
- **Verdrahtung:** `const directiveSynth = makeDirectiveSynth({ config, ttsStore })` direkt nach
  `ttsStore`. Die 6 Aufrufstellen (L893, 903, 967, 976, 991, 1031) ->
  `directiveSynth.synthesizeDirectiveAudio(...)`.
- **Ergebnis:** Flag-aus/Nicht-Telnyx/Synth-Fehler -> Direktivenliste unveraendert (Azure-`<Say>`
  byte-identisch); `<Play>` + Einmal-Token weiter korrekt.
- **Verifikation:** `node --test test/voice-play-tts.test.js test/telnyx-play-render.test.js test/directive-render.test.js test/tts-store.test.js test/tts-synth.test.js`.
- **Risiken/Gegenmassnahme:** Hot-Path. `fetch` bleibt das Node-Globale (nicht importiert, sonst
  driftet der Timeout-Pfad). `ttsStore` = die EINE Instanz (INV-7). Byte-Gate: `voice-play-tts`
  spawnt + pinnt `<Play>` + Einmal-Token.

### P3 — `telephony/voice-render.js` (pure Render-Helfer)
- **Scope:** L596 (`render`), L614-636 (`turnDirectives`, `sayInCallVoice`, `followupTurnDirectives`),
  L695-707 (`streamDirectives`). **Nicht** `inboundAssistantHandoffXml` (macht I/O -> bleibt bis P11,
  importiert `render` von hier).
- **Verdrahtung:** `const voiceRender = makeVoiceRender({ config })`; `voiceRenderer`, Direktiven
  (`gatherD/redirectD/sayD/streamD`), `localeFor`, `MEDIA_PATH`, `DEFAULT_PROVIDER` importiert die
  Factory selbst. Wurzel destrukturiert die 5 Funktionen; Aufruf-Sites bleiben wortgleich.
- **Ergebnis:** TwiML/TeXML-Snapshots unveraendert.
- **Verifikation:** `node --test test/directive-render.test.js test/turn-fallback-locale.test.js test/g3-speech-timeout.test.js test/outbound-first-gather.test.js test/telnyx-render.test.js test/telnyx-stream-render.test.js test/disclosure-outbound.test.js`.
- **Risiken/Gegenmassnahme:** `turnDirectives` liest `config.publicUrl` -> die Factory muss `config`
  schliessen, NICHT zur Import-Zeit einfrieren. Gate: die Render-Snapshot-Tests.

### P4 — `telephony/call-finish.js` (`finishCall` + `releaseReserve`)
- **Scope:** L768-772 (`releaseReserve`), L1092-1181 (`finishCall`).
- **Verdrahtung:** `const callFinish = makeCallFinish({ store, config, metering, messaging,
  summarizeCall, planSummarySms, audit })` -> `{ finishCall, releaseReserve }`. Alle 6
  `finishCall`-Aufrufstellen (L742, 1245, 1260, 1391, 1440, 2207) nutzen `callFinish.finishCall`
  (via `billThunk(callFinish.finishCall, ...)` wo zutreffend).
- **Ergebnis:** `finishCall` bucht genau EINMAL ueber Prozessgrenzen (`billedAt`); SMS-Dedup
  (`summarySmsSentAt`) + Transkript-Purge unveraendert; `releaseReserve` intra-modul aufgerufen.
- **Verifikation:** `node --test test/finishcall-billing-once.test.js test/f2-sms-summary-plan.test.js test/f2-p9-dedup-persist.test.js test/outbound-reserve-release-success.test.js test/graceful-shutdown.test.js`.
- **Risiken/Gegenmassnahme:** `finishCall` wird an `attachMediaBridge` UND `makeCallControlIngest`
  gereicht — die **Referenz-Identitaet** (dieselbe gebundene Funktion) muss erhalten bleiben
  (EINE `callFinish`-Instanz, Wurzel-Scope, INV-7). `call._finished`/`billedAt`-Guards wandern
  unveraendert mit.

### P5 — `telephony/call-lifecycle.js` (Cap-Timer + Reattach + Rearm)
- **Scope:** L711-762 (`callMaxDurationMs`, `terminateCappedCall`, `scheduleMaxDurationEnd`,
  `armMaxDurationTimer`), L779-782 (`armReserveReleaseTimer`), L918-925 (`reattachActiveCall`-Wrapper),
  L2103-2124 (`rearmActiveCallTimers`).
- **Verdrahtung:** `const lifecycle = makeCallLifecycle({ store, config, finishCall:
  callFinish.finishCall, releaseReserve: callFinish.releaseReserve, voiceControl,
  terminateAndBillCall, hangUpAction, billThunk, reattachActiveCallCore, cappedEndedAtMs,
  classifyCallTime, ... })` — konstruiert NACH `callFinish` (linearer DAG, KEIN Lazy-Thunk).
  Voice-Handler + `/api/calls` + Boot + Ingest -> `lifecycle.armMaxDurationTimer` /
  `.armReserveReleaseTimer` / `.reattachActiveCall` / `.rearmActiveCallTimers`.
- **Ergebnis:** DAG `metering->call-finish->call-lifecycle` geschlossen; keine Timer-Definition mehr
  in `server.js`.
- **Verifikation:** `node --test test/max-duration-live-cap.test.js test/max-duration-rearm.test.js test/max-duration-pure.test.js test/reattach-active-call.test.js test/store-pg-reattach-active-call.test.js test/outbound-reserve-backstop.test.js`.
- **Risiken/Gegenmassnahme:** **Absolute Regel Max-Dauer (INV-9).** `terminateCappedCall` muss weiter
  ZUERST den Provider-Leg beenden (awaited), DANN buchen — die Sequenz liegt in
  `terminateAndBillCall` (unangetastet). `max-duration-rearm` + `-live-cap` beweisen den EINZIGEN
  Terminalisierungspfad. `rearmActiveCallTimers` bleibt Boot-only (INV-5).

### P6 — `worker/provisioning-orchestrator.js`
- **Scope:** L1792-1995 (`queueProvisioning`, `triggerTenantProvisioning`, `runProvisioningDrain`,
  `runProvisioningDrainExclusive`, `redriveProvisioningJobs`, `closeSettledProvisioningJobs`,
  `reconcileOrphanedProvisioning`).
- **Verdrahtung:** `const provisioning = makeProvisioningOrchestrator({ store, config, queue:
  provisioningQueue, billing: stripeBilling, metering, numberProvisioning, handleProvisionJob,
  resolveProvisionRetry, ...store-ops })`. Der `makeSingleFlight`-Wrapper lebt IM Factory-Scope =
  EIN Guard pro Prozess (INV-7). **Konstruktions-Ort (kritisch): VOR L286** (guardedBoot-Block),
  weil `triggerTenantProvisioning` dort bei L418 (self-service) + L457 (stripe-webhook) gebraucht
  wird. `provisioningQueue` + `metering` (P1) liegen davor.
- **PFLICHT-Schritt in DIESEM PR:** die zwei guardedBoot-Aufrufstellen L418 (`provision:
  triggerTenantProvisioning`) und L457 (`provision: triggerTenantProvisioning`) auf
  `provision: provisioning.triggerTenantProvisioning` umstellen. Sonst ReferenceError/TDZ, der NUR
  im pg+sessionSecret-Boot feuert — und wegen INV-11 (guardedBoot verschluckt) LAUTLOS die Routen
  deaktiviert.
- **Ergebnis:** Vorwaerts-Referenz von L418/L457 ist eine injizierte Dep statt einer ~1400 Zeilen
  entfernten hoisted-Definition.
- **Verifikation:** `node --test test/prov01-drain-singleflight.test.js test/prov01-boot-reconcile.test.js test/prov01-retry-redrive-http.test.js test/provisioning-worker.test.js test/onboarding-route.test.js test/p2-onboard-retry.test.js test/p3-payment-webhook.test.js`. **Plus PFLICHT pg+session Happy-Path (INV-11):** `node --test test/single-origin-auth.test.js test/self-service-flag-gate.test.js test/self-service-mirror-hydration.test.js test/web-auth-pg.test.js` — und stderr der Spawns enthaelt NICHT `deaktiviert`.
- **Risiken/Gegenmassnahme:** **Doppelkauf** (INV-7): Single-Flight-`const` = EINE Instanz;
  `prov01-drain-singleflight` beweist genau-einmal-Kauf. **TDZ/Fail-Open** (Pre-Mortem 1+2):
  guardedBoot-Call-Sites im selben PR umstellen; pg-Happy-Path als Pflicht-Gate.

### P7 — `routes/api-billing.js`
- **Scope:** L1514-1575 (`flush-meters`, `CARD_ON_FILE_STATUS`, `setup-checkout`, `checkout-return`).
- **Verdrahtung:** `app.use(makeBillingRoutes({ config, store, audit, billing: stripeBilling,
  flushMeters, bindCardFromSession, startCheckoutWithStaleCustomerHeal, tenant: { requireTenant } }))`
  an bisheriger Mount-Position (HINTER Auth-Gate, INV-2).
- **Ergebnis:** Drei `/api/billing/*`-Routen weg; `PAYMENT_ENABLED`-404-Gate byte-identisch.
- **Verifikation:** `node --test test/api-flush-meters.test.js` (P0a) `test/billing-setup-checkout-route.test.js test/bk2-checkout-return-plan.test.js test/billing-card-setup.test.js test/w4-self-service-subscribe.test.js`.
- **Risiken/Gegenmassnahme:** `requireTenant` = die EINE Wurzel-Instanz (INV-7, 403 bei
  `TENANT_REJECT`). Mount HINTER Auth-Gate (INV-2/INV-3).

### P8 — `routes/api-tenant-write.js`
- **Scope:** L1464-1504 (`/api/settings`, `/api/action-items/:id/toggle`, `/api/calendar`);
  `invalidText` importiert das Modul.
- **Verdrahtung:** `app.use(makeTenantWriteRoutes({ store, config, audit, tenant: { requireTenant },
  internalIdentity, OWNER_ID }))` — exakt das `makeReadRoutes`-Muster.
- **Ergebnis:** Drei Schreib-Routen verschoben; `requireTenant`-403 + `allowBooking`-403 unveraendert.
- **Verifikation:** `node --test test/api-action-items-toggle.test.js` (P0b) `test/i6-write-scope.test.js test/audit.test.js test/tenant-settings-calendar-map.test.js test/api.test.js`.
- **Risiken/Gegenmassnahme:** Reihenfolge im `/api/calendar`-Handler (`requireTenant` VOR
  `allowBooking`-Recht VOR Text-/Datums-Validierung) bleibt exakt. Mount HINTER Auth-Gate.

### P9 — `routes/api-calls.js` (Outbound-Money-Path)
- **Scope:** L1276-1284 (`contextReceivedMeta`), L1287-1418 (`POST /api/calls`), L1421-1445
  (`/api/calls/:id/cancel`). **Reine Verschiebung — G30-4-Split ist Folgearbeit.**
- **Verdrahtung:** `app.use(makeCallRoutes({ store, config, audit, outboundGates, voiceControl,
  originateAiAssistantCall, terminateAndBillCall, hangUpAction, billThunk, finishCall:
  callFinish.finishCall, arm: { armMaxDurationTimer: lifecycle.armMaxDurationTimer,
  armReserveReleaseTimer: lifecycle.armReserveReleaseTimer }, tenant: { requestTenant,
  tenantOwnsCall }, internalIdentity, OWNER_ID, isTrunkZeroFormatError, E164_FORMAT_ERROR, normNum }))`.
- **Ergebnis:** Vollstaendige Outbound-Gate-Kette unveraendert (`for (gate of outboundGates)`);
  Origination-Zweig (Telnyx-Assistant vs. TeXML) + Fehler-Settlement identisch.
- **Verifikation:** `node --test test/outbound-reserve-concurrency-http.test.js test/outbound-frozen.test.js test/kyc-gate-outbound.test.js test/w5-abo-allowlist-gate.test.js test/onboarding-outbound.test.js test/place-call-error.test.js test/e164-trunk-zero-reject.test.js test/outbound-gates-order.test.js`. SMOKE: `SKIP_TWILIO_SIGNATURE_CHECK=true FAKE_ORIGINATE=true` starten, `curl -sX POST localhost:$PORT/api/calls -H 'content-type: application/json' -d '{}'` -> `400`.
- **Risiken/Gegenmassnahme:** **Absolute Regel Safety-Gates (INV-9).** Gate-Schleife +
  `armMaxDurationTimer(call,null)` (C-Telnyx) bzw. `armMaxDurationTimer(call,tw.sid)` (TeXML)
  exakt an denselben Punkten (kein Cap-Verlust); `outboundGates` = EIN gepinntes Array. Der
  Fehlerpfad (terminateAndBillCall + providerStatus-Kategorisierung, kein Secret-Leak) wandert
  unveraendert. Mount HINTER Auth-Gate.

### P10 — `routes/api-onboard.js` (haengt an P6)
- **Scope:** L1584-1740 (`ONBOARD_REASON_STATUS`, `geoLookup`-Singleton, `POST /api/onboard`),
  L1751-1790 (`RETRY_REASON_STATUS/MESSAGE`, `POST /api/onboard/retry`).
- **Verdrahtung:** `app.use(makeOnboardRoutes({ store, config, audit, provisioning, validIdentity,
  checkSubAlreadyMerged, normalizePrivateNumber, registerTenant, setTenantGeo, requestNumber,
  resolveOnboardCountry, languageForCountry, tenantIdForSubject, shouldPersistProvisionResult,
  KYC_OUTBOUND_MIN, geoLookupAdapter, PROVIDER }))`. `provisioning` aus P6.
- **Ergebnis:** Onboard-/Retry-Routen verschoben; Dry-Run vs. Queue + `runProvisioningDrainExclusive`
  -Anstoss nach der Response unveraendert.
- **Verifikation:** `node --test test/onboarding-route.test.js test/f1-geo-onboard.test.js test/onboarding-identity.test.js test/onboard-persist-failure.test.js test/p2-onboard-retry.test.js`.
- **Risiken/Gegenmassnahme:** Der `withStoreLock`-kritische Abschnitt (load->registerTenant->
  setTenantGeo->requestNumber->save, KEIN fremdes `await` dazwischen) + Nummern-Caps
  (Kosten-Notbremse) + `persist_error`->503 wandern unveraendert. `geoLookup` = EINE Instanz.

### P11 — `routes/voice.js` (hoechstes Einzel-Risiko)
- **Scope:** L549-559 (`/voice/tts/:token`), L561-591 (`app.use("/voice", sig-MW)`), L784-807
  (`INBOUND_ASSISTANT_HANDOFF`, `inboundAssistantHandoffXml`), L816-906 (`/voice/incoming`),
  L927-993 (`/voice/turn`), L995-1033 (`/voice/outbound`), L1183-1248 (`/voice/status`), L1255-1267
  (`/voice/call-control`) -> EIN Router. **G5-1-Dedup ist Folgearbeit.**
- **Verdrahtung:** `app.use(makeVoiceRoutes({ store, config, audit, voiceRender, directiveSynth,
  lifecycle, finishCall: callFinish.finishCall, ttsStore, webhookEvents, agentTurn, callerHasSpoken,
  openingText, metrics, degradedSpeechFor, callFailureReason, terminateAndBillCall, billThunk,
  providerFromHeaders, inboundSignatureVerifier, localeFor, makeCallControlIngest, watchdog:
  conversationWatchdog, startInboundAiAssistant, inboundCallControlId, voiceControl,
  SPEAK_OUTCOME, DEFAULT_PROVIDER, PROVIDER }))`.
- **Interne Router-Reihenfolge (safety-tragend, Kommentar Pflicht, INV-4):** zuerst
  `router.get("/voice/tts/:token")`, dann `router.use("/voice", sig-MW)`, dann die 5 Webhooks.
  Mount an bisheriger Position (nach Auth-Gate, dessen `/voice*`-Ausnahme greift).
- **Ergebnis:** Alle `/voice/*` aus `server.js` weg; `/voice`-Signatur fail-closed unveraendert;
  TTS-Token weiter VOR der Signatur.
- **Verifikation:** volle `npm test` + isoliert `node --test test/voice-signature.test.js test/voice-signature-403-log.test.js test/inbound-routing.test.js test/voice-incoming-catch-path.test.js test/voice-status-lifecycle.test.js test/voice-unknown-call-log.test.js test/telnyx-p8-inbound.test.js test/telnyx-event-ingest-route.test.js test/disclosure-outbound.test.js test/graceful-shutdown.test.js`. SMOKE (siehe Anhang).
- **Risiken/Gegenmassnahme:** **Absolute Regel 1+3 (INV-3/INV-4).** Wuerde `router.use("/voice", sig)`
  VOR die TTS-Route geschoben, wuerde PII-Audio signaturpflichtig (403, tote Audio). De-riskt durch
  P2/P3/P4/P5 (alle Voice-Helfer bereits extrahiert). `bridge.js` unberuehrt.

### P12 — `routes/mcp.js`
- **Scope:** L1997-2069 (`POST /mcp` mit `mcpAuth`, `GET/DELETE /mcp` 405).
- **Verdrahtung:** `app.use(makeMcpRoutes({ config, store, requestTenant, mcpAuth, registerTools,
  McpServer, StreamableHTTPServerTransport, uiServerExtension, HERMES_SERVER_INFO, hashEmail,
  ANON_IDENTITY }))`. Stateless (`sessionIdGenerator: undefined`) + `res.on("close")`-Cleanup
  unveraendert; pro Request frischer Server+Transport (INV-8).
- **Ergebnis:** `/mcp`-Trio verschoben; GET/DELETE -> 405.
- **Verifikation:** `node --test test/oauth.test.js test/mcp-tools.test.js test/mcp-ui.test.js test/request-tenant.test.js test/am6-oauth-tenant.test.js`. SMOKE: `curl -s -o /dev/null -w '%{http_code}' -X GET localhost:$PORT/mcp` -> `405`.
- **Risiken/Gegenmassnahme:** **INV-8:** `McpServer`+Transport INNERHALB des Handlers; kein Hoisting.
  `/mcp` bleibt Auth-Gate-exempt (Gate ruft `next()`), `mcpAuth` fail-closed. Mount HINTER Auth-Gate.

### P13 — `wiring/web-login.js` + `routes/stripe-webhook.js` (EIN Anfassen des guardedBoot-Blocks)
- **Scope:** L264-280 (`RELEASE_RECONCILE_INTERVAL_MS`, `scheduleReleaseReconcile`), L282-462
  (kompletter `guardedBoot`-Block) -> `wireWebLogin(...)`; der inline Stripe-Webhook-Handler
  (L432-461) -> `makeStripeWebhookRoute(...)`.
- **Verdrahtung:** Wurzel behaelt Bedingung + `guardedBoot`:
  `if (config.sessionSecret && config.storeBackend === "pg") await guardedBoot("Web-Login/Portal",
  () => wireWebLogin({ app, config, store, audit, provision: provisioning.triggerTenantProvisioning,
  releaseReconcile: { runReleaseReconcile, numberProvisioning, releaseGraceMs: config.releaseGraceMs },
  stripeWebhookPath: STRIPE_WEBHOOK_PATH, ... }))`. `wireWebLogin` konstruiert `portalRunner/oidc/
  accounts/sessions/auditStore/portalStore` und mountet in UNVERAENDERTER Reihenfolge, inkl.
  `app.post(STRIPE_WEBHOOK_PATH, makeStripeWebhookRoute({ config, store, audit, accounts, sessions,
  billing: stripeBilling, provision: provisioning.triggerTenantProvisioning, verifyStripeSignature,
  applyStripeWebhookSerialized }))`.
- **Ergebnis:** `guardedBoot`-Aufruf bleibt in der Wurzel (Boot-Orchestrierung sichtbar), der
  ~180-Zeilen-Koerper ist raus; Konstruktion/Anwendung getrennt. `STRIPE_WEBHOOK_PATH` bleibt EINE
  gemeinsame Konstante (INV-1), an captureRawBody + Auth-Gate + Stripe-Route gereicht.
- **Verifikation:** `node --test test/web-auth.test.js test/web-auth-middleware.test.js test/portal-route.test.js test/portal-rls-killer.test.js test/stripe-webhook-signature.test.js test/stripe-webhook-race.test.js test/single-origin-auth.test.js test/self-service-flag-gate.test.js test/admin-approval.test.js test/boot-guard.test.js test/boot-decoupling.test.js`. **PFLICHT (INV-11 + Owner-Entscheid Q1):** `wireWebLogin` loggt im Erfolgsfall den positiven Marker `[boot] Web-Login aktiv` (eigene Zeile; INV-6-Kontraktzeile byte-identisch). Der pg+session Happy-Path-Spawn asserted den Marker UND das Fehlen von `deaktiviert`.
- **Risiken/Gegenmassnahme:** **Fail-Open-Falle (Pre-Mortem 1, INV-11):** der ganze Block bleibt
  IN `guardedBoot` (Portal-pg-Fehler darf Telefonie nicht toeten, boot-decoupling beweist es), VOR
  der Basic-Auth gemountet; `applyTenantIdentity` fail-open, Stripe-Webhook HMAC fail-closed
  (Signatur VOR JSON-Parse) — beide Semantiken exakt. Weil guardedBoot Fehler verschluckt, ist die
  pg-Happy-Path-Verifikation Pflicht.

### P14 — `wiring/auth-gate.js` (Kern-Safety-Naht)
- **Scope:** L494-543 (Basic-Auth-Gate mit gesamter Ausnahmeliste).
- **Verdrahtung:** `app.use(makeAuthGate({ config, audit, isTrustedLocalCaller, safeEqual,
  BRAND_ASSETS_PREFIX, paths: { STRIPE_WEBHOOK_PATH, CUSTOMER_PORTAL_PATH } }))` an bisheriger
  Position; danach `express.static(config.publicDir)`.
- **Ergebnis:** Die Auth-Exemption-Liste ist ein einzeln unit-testbares Modul.
- **Verifikation:** `node --test test/headers.test.js test/security.test.js test/rate-limit.test.js test/single-origin-serving.test.js test/auth-mcp-bypass.test.js test/profiles.test.js test/mcp-server-icon.test.js`. **Empfohlen (Pflicht-Neu-Test):** friert das Exemption-Set + Reihenfolge ein (INV-3): `CUSTOMER_PORTAL_PATH` unter Flags -> `/voice` -> `/mcp` -> `/.well-known` -> Stripe-Webhook -> `/healthz` -> `BRAND_ASSETS_PREFIX` -> `/favicon.ico` -> `isTrustedLocalCaller` -> `safeEqual`.
- **Risiken/Gegenmassnahme:** **Absolute Regel 3 (INV-3).** Eine ausgelassene Exemption oeffnet das
  Dashboard ODER blockt einen Provider. Reihenfolge 1:1; `safeEqual` timing-sicher unveraendert.

### P15 — Kompositionswurzel: `app.js` + `boot.js` (Capstone, committed — NICHT optional)
- **Scope:** Verbleibendes in `server.js`: Global-MW (L166-211), Pre-Auth-Public (L218-259 inkl.
  Telnyx-Shim-Mount `POST /v1/chat/completions` + Landing-Redirect `GET /`), Static-Serving
  (L465-492), Boot-Sequenz (L2081-2244). Aufteilen in:
  - `src/app.js`: `installGlobalMiddleware`, `registerPublicRoutes` (inkl. Shim-Mount via
    `makeTelnyxLlmShim` — Handler liegt bereits extern, kein eigenes Modul), `registerStaticServing`,
    `installAuthGate` als benannte Registrar-Funktionen; `buildApp(deps)` ruft sie + `wireWebLogin`
    + alle Router-Mounts (P7-P13) + `registerMcp` + `errorHandler` in EINER sichtbaren Reihenfolge
    (exakt INV-2).
  - `src/boot.js`: `bootServer(deps)` — `store.load`, `runRetention`+Interval, Boot-Gate-Kette
    (`assertConfig`->`fakeOriginateBootBlocked`->`hasActiveNumber`->`lifecycle.rearmActiveCallTimers`
    ->`app.listen`), Banner (INV-6), `attachMediaBridge(httpServer, callFinish.finishCall)`,
    `provisioning.reconcileOrphanedProvisioning`, Graceful-Shutdown.
  - `src/server.js`: process-guards-Import zuerst, `conversationWatchdog`/`ttsStore`/`geoLookup`/
    `requestTenant`/`outboundGates`/`provisioningQueue` + Helfer-Factories (P1-P6) konstruieren,
    `deps` buendeln, `const { app } = await buildApp(deps)`, `await bootServer({ app, ...deps })`.
- **Ergebnis (deterministisch):** `wc -l src/server.js` < 300; `grep -c "app.post\|app.get\|app.use"
  src/server.js` = 0; `grep -F "laeuft auf http://localhost" src/boot.js` = 1.
- **Verifikation:** **volle** `npm test` + gezielt `node --test test/boot-decoupling.test.js test/boot-failclosed.test.js test/boot-prod-footguns.test.js test/graceful-shutdown.test.js test/root-redirect.test.js test/render-owner-autoseed.test.js test/single-origin-boot-guard.test.js test/single-origin-serving.test.js test/max-duration-rearm.test.js test/telnyx-shim-route.test.js test/telnyx-assistant-route-drift.test.js`. Basic-Auth-Stichprobe: `/healthz`, `/favicon.ico`, `/webhooks/stripe`, `/mcp`, `/voice` nicht-401; `/api/state` ohne Auth = 401.
- **Risiken/Gegenmassnahme:** **Hoechster Blast-Radius (INV-2/INV-5/INV-6).** Ein vertauschter
  `register*`-Aufruf macht eine Route ungeschuetzt (Regel 3); `rearmActiveCallTimers()` MUSS NACH
  allen `process.exit(1)`-Gates und unmittelbar VOR `app.listen` laufen; kein Gate danach darf
  `exit(1)` rufen. Die stdout-Boot-Zeile byte-genau und erst nach vollem Boot.
  **Relativordnung `buildApp` (Wiring+Routen) vollstaendig awaiten, DANN `bootServer`
  (store.load+Gates+listen)** — nicht `store.load` vorziehen (Pre-Mortem 11). **Separater
  Safety-Review (Opus) Pflicht.**

### PX — ENTFAELLT (Owner-Entscheid Q3, 2026-07-16)
`BODY_LIMIT` bleibt eine benannte Konstante und wandert in P15 unveraendert nach `app.js`.
Die Verschiebung nach `config.bodyLimit` (inkl. `.env.example`, BASE_ENV-Nachzug nach Lehre
test-base-env-drift, `render.yaml`-Check) kann spaeter als eigener Mini-PR kommen, falls der
Wert je konfigurierbar sein muss.

---

## Pre-Mortem-Befunde (Annahme: das Refactoring ging schief, Produktionsverhalten aenderte sich unbemerkt)

### BEHOBEN (durch Plan-Haertung entschaerft)

1. **[KRITISCH] guardedBoot ist fail-OPEN (Angriffsflaeche c+g).** `boot-guard.js` verschluckt jede
   Exception im Web-Login/Portal/Stripe-Webhook/Self-Service-Block (loggt `deaktiviert`, returnt
   `false`). Ein Verdrahtungsfehler in P6/P13 wuerde NICHT crashen, sondern die Routen LAUTLOS auf
   404 setzen — und weil dieser Block nur bei `pg + sessionSecret` laeuft, sieht die json-Backend-
   Mehrheit der Suite nichts. Folge im schlimmsten Fall: bezahlte Signups provisionieren keine
   Nummer mehr (Stripe-Webhook tot). *Gegenmassnahme:* INV-11; P6/P13 verifizieren PFLICHT gegen die
   pg+session Happy-Path-Tests (`single-origin-auth`, `web-auth-pg`, `portal-route`,
   `self-service-*`, `stripe-webhook-*`) und duerfen im Erfolgsfall kein `deaktiviert` loggen.

2. **[KRITISCH] TDZ durch Hoisting->const (Angriffsflaeche d).** `triggerTenantProvisioning` ist heute
   eine hoisted `function`, im guardedBoot-Block (L418/L457, textuell VOR der Definition) nutzbar.
   P6 macht daraus eine `const`-Factory-Instanz. Wird die Instanz nicht VOR L286 konstruiert und die
   zwei Call-Sites nicht im selben PR umgestellt -> ReferenceError, der nur im pg+session-Boot feuert
   und (dank Befund 1) verschluckt wird. *Gegenmassnahme:* P6 PFLICHT-Schritt "Call-Sites umstellen +
   vor L286 konstruieren" + pg-Happy-Path-Gate.

3. **[KRITISCH] rawBody-Naht bricht Signaturpruefungen (Angriffsflaeche a).** `verify: captureRawBody`
   an urlencoded+json (L201-205) ist die Wurzel fuer Twilio-HMAC (L568), Telnyx-Ed25519 und
   Stripe-HMAC (L434). Jede Umsortierung der Body-Parser, ein Verlust des `verify`-Hooks oder eine
   Divergenz der `STRIPE_WEBHOOK_PATH`-Konstante bricht ALLE drei fail-closed (403 = tote Webhooks).
   *Gegenmassnahme:* INV-1 (Parser + verify vor jeder Route; STRIPE_WEBHOOK_PATH als EINE injizierte
   Quelle). Gate: `voice-signature*`, `telnyx-signature`, `telnyx-event-ingest-route`,
   `stripe-webhook-signature/-race`.

4. **Basic-Auth-Exemption-Regression (Angriffsflaeche b+c).** Eine API-Route, die vor die Auth-Gate
   gemountet wird, ist offen; eine ausgelassene Exemption blockt einen Provider. *Gegenmassnahme:*
   INV-2/INV-3; P14 Einfrier-Test (Exemption-Set + Reihenfolge); P15 Stichprobe (nicht-401 fuer
   healthz/favicon/webhook/mcp/voice, 401 fuer /api/state).

5. **/voice/tts vor Signatur-MW (Angriffsflaeche a+c).** Wird die `/voice`-Signatur-MW vor die
   TTS-Route sortiert, wird PII-Audio signaturpflichtig (Telnyx kann nicht signieren -> 403, tote
   Audio). *Gegenmassnahme:* INV-4; P11 interne Router-Reihenfolge + Pflicht-Kommentar +
   `voice-play-tts`.

6. **Doppelte Singletons/Timer (Angriffsflaeche d).** Zwei Single-Flight-Guards = Doppelkauf; zwei
   Queues/Watchdogs = Split-Brain. *Gegenmassnahme:* INV-7; P6 Single-Flight im Factory-Scope;
   `prov01-drain-singleflight` beweist genau-einmal-Kauf; `conversationWatchdog` bleibt EINE
   Wurzel-Instanz (Shim + Ingest).

7. **finishCall-Referenz-Identitaet (Angriffsflaeche d).** `finishCall` geht an `attachMediaBridge`
   UND `makeCallControlIngest`; die In-Memory-Guards (`call._finished`) verlangen dieselbe
   Funktions-Instanz. *Gegenmassnahme:* EINE `callFinish`-Instanz (INV-7); `finishcall-billing-once`,
   `graceful-shutdown`, `telnyx-p6-*`.

8. **/mcp-Statelessness (Angriffsflaeche f).** Ein "optimierendes" Hoisten von `McpServer`/Transport
   aus dem Handler wuerde den stateless Streamable-HTTP-Vertrag brechen. *Gegenmassnahme:* INV-8;
   `oauth`, `mcp-ui`, `request-tenant`.

9. **Boot-Gate-Ordnung (Angriffsflaeche e).** `rearmActiveCallTimers()` vor einem exit1-Gate wuerde
   einen Zombie teilbuchen, bevor der Boot abbricht. *Gegenmassnahme:* INV-5; `max-duration-rearm`,
   `boot-failclosed`, `boot-decoupling`.

10. **HTTP-Testluecken (Angriffsflaeche h).** `POST /api/action-items/:id/toggle` und
    `POST /api/billing/flush-meters` haben KEINEN HTTP-Test (grep bestaetigt) — ihr Move waere nicht
    byte-beweisbar. *Gegenmassnahme:* P0a/P0b Charakterisierungs-Spawn-Tests VOR P7/P8, gegen den
    unveraenderten `server.js` gruen.

11. **Top-Level-await-Reihenfolge (Angriffsflaeche d+e).** Heute laeuft `store.load()` (L2082) NACH
    dem awaited guardedBoot-Block; `scheduleReleaseReconcile` feuert bereits vor store.load. Ein
    Vorziehen von `store.load` im Umbau koennte diese Relativordnung aendern. *Gegenmassnahme:*
    `buildApp` (Wiring+Routen) vollstaendig awaiten, DANN `bootServer` (store.load+Gates+listen) —
    Relativordnung wie heute (P15).

### AKZEPTIERT (bewusst, mit Begruendung)

- **A1 — Suite-Voll-Last-Flake `p5-gate-proof` (~12%).** Vorbestehend, dokumentiert. Gate-Protokoll:
  rot nur echt, wenn die Datei isoliert rot bleibt.
- **A2 — G30-Intra-Splits + G5-1-Dedup bleiben Folgearbeit.** Sie verduennen `server.js` nicht und
  wuerden die Byte-Garantie unterlaufen. Optional INNERHALB der neuen Heimatmodule nach Extraktion.
- **A3 — `attachMediaBridge`-Uebergabe wandert nach boot.js.** `bridge.js` selbst (HEIKLE STELLE)
  unberuehrt; die injizierte `finishCall`-Referenz bleibt identisch.
- **A4 — Telnyx-Shim ohne eigene Phase.** Handler liegt extern (`telnyx-llm-shim.js`); nur der Mount
  wandert nach `registerPublicRoutes` (P15). Drift via `telnyx-assistant-route-drift.test.js`.
- **A5 — PX (BODY_LIMIT->config) optional.** Einzige Env-Var-Flaeche; nur mit BASE_ENV-Nachzug.

---

## Owner-Entscheidungen (2026-07-16)

Alle fuenf offenen Fragen sind vom Owner entschieden — der Plan ist damit bindend.

- **Q1 — JA, positiver Boot-Marker:** P13 fuehrt `[boot] Web-Login aktiv` als eigene Log-Zeile im
  Erfolgsfall von `wireWebLogin` ein; die INV-6-Kontraktzeile bleibt byte-identisch. Der
  pg+session Happy-Path-Spawn asserted den Marker UND das Fehlen von `deaktiviert` — die
  fail-open-Unsichtbarkeit (Pre-Mortem 1) ist damit dauerhaft geschlossen, nicht nur waehrend
  des Umbaus.
- **Q2 — Eigene Mini-PRs:** P0a/P0b landen als separate PRs VOR P7/P8 auf master, damit die
  Charakterisierungs-Tests beweisbar das ALTE Verhalten festnageln (Test lief gruen gegen
  unveraenderten `server.js`, bevor verschoben wird).
- **Q3 — PX entfaellt:** `BODY_LIMIT` bleibt benannte Konstante und wandert in P15 unveraendert
  nach `app.js`. Null neue Env-Var-Flaeche im gesamten Vorhaben.
- **Q4 — `src/wiring/` bestaetigt:** Kompositions-Glue (web-login, auth-gate) bekommt eine eigene
  benannte Heimat; `routes/` bleibt rein fuer Router-Factories (eine Datei = ein Router).
- **Q5 — P15 committed bestaetigt:** kein Stopp nach P13/P14; Zielbild ist der ~180-LOC-Root.
  Separater Opus-Safety-Review vor dem P15-Merge bleibt Pflicht.

### Ausfuehrungsmodell (Owner-Entscheid 2026-07-16)

**EINE Session fuehrt ALLE Phasen aus.** Ein Lean-Lead startet pro Phase genau einen
phase-impl-lean-Workflow (sequenziell P0a -> P0b -> P1 -> ... -> P15), merged nach PASS selbst
auf master, prueft vor jedem Merge die Invarianten-Checkliste und stoppt fail-closed beim
ersten nicht heilbaren Rot. Der Lead liest NIE Quellcode oder Diffs — nur diesen Plan,
kompakte Workflow-Returns, Testresultate und Reports; dadurch waechst sein Kontext langsam.
Kompaktierungs-Risiko bewusst akzeptiert: alles Entscheidungsrelevante liegt auf Platte
(dieser Plan, die Phasen-Reports, der Git-Stand) und wird nach einer Kompaktierung neu von
Platte gelesen. Modelle: Opus = Phasen-Plan + Safety-Review, Sonnet = Impl/Audit/Fix/Report,
Subagenten erben nie das Lead-Modell. Session-Kickoff-Prompt:
`tasks/prompt-server-slim-session.md`.

---

## Anhang — SMOKE-Rezept (isoliertes DATA_DIR, seed-gebunden; nur P9/P11/P12/P15)

```bash
export DATA_DIR="$(mktemp -d)"
STORE_BACKEND=json DATA_DIR="$DATA_DIR" npm run bootstrap-tenant -- +493000000000 telnyx
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true DASHBOARD_PASSWORD=x \
  STORE_BACKEND=json DATA_DIR="$DATA_DIR" npm start &
curl -s localhost:3999/healthz                                         # {"ok":true}
curl -s localhost:3999/api/plans                                       # Katalog, keine PII
curl -s -o /dev/null -w '%{http_code}' -X GET localhost:3999/mcp       # 405
curl -s -X POST localhost:3999/voice/incoming \
  -d 'To=+493000000000&From=+491700000000&CallSid=CAtest'              # TeXML <Gather>
```

`npm test` bleibt in jeder Phase das primaere, deterministische Gate; SMOKE ergaenzt nur Phasen,
die oeffentliche Routen beruehren.
