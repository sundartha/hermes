# Server-Slim Phase P15 — Report

**Ziel:** Kompositionswurzel extrahieren (Capstone) — `src/app.js` (Express-App-Aufbau: Middleware/Routen-Mounts als benannte Registrar-Funktionen + `buildApp(deps)`) und `src/boot.js` (Boot-Sequenz: Store-Load, DSGVO-Retention, fail-closed Boot-Gates, Listen+Banner, Audio-Bridge, Graceful-Shutdown als `bootServer(deps)`) aus `src/server.js` herausziehen; `server.js` bleibt nur noch die Kompositionswurzel, die die P1-P6-Instanzen konstruiert und `buildApp`+`bootServer` aufruft.
**Gate:** PASS
**finalBranch:** `phase/slim-p15-composition-root`
**headCommit (Impl):** `8db33c73b42b00bcad36ee96caa27e3d89e846ac`

---

## 1. Plan (gekuerzt)

### Verifizierter Ist-Stand

`wc -l src/server.js` = **641** (Plan-Doc nennt veraltete 2244 — P1-P14 sind bereits gemerged: `metering/callFinish/lifecycle/provisioning/outboundGates/requestTenant` + alle `routes/*` + `wiring/web-login.js` + `wiring/auth-gate.js` existieren bereits). `src/app.js`/`src/boot.js` existierten **noch nicht**. Die Boot-Log-Zeile `Hermes Gateway laeuft auf http://localhost` steht genau **1x**, in `src/server.js:578`. Whitebox-Quelltext-Tests, die `src/server.js` lesen: nur zwei relevant — `test/telnyx-assistant-route-drift.test.js` (grept den Shim-Mount, **muss** mechanisch nachziehen) und `test/call-termination-order.test.js:274` (grept die `call-termination.js`-Importzeile, bleibt gruen). `test/process-guards.test.js:81` (erste Importzeile = `process-guards`) bleibt gruen. `createTtsStore`/`makeConversationWatchdog`/`makeDirectiveSynth`/`makeVoiceRender` haben keine Seiteneffekte bei Konstruktion (Timer nur pro-`put`, `console`/`setTimeout` nur in Methoden) — Hochziehen in die Konstruktionsregion beobachtbar folgenlos.

### Design-Entscheidungen

**Import-vs-Inject-Split** (folgt der `wiring/web-login.js`-Konvention): reine Factories/Helfer/Konstanten/Adapter-Singletons werden direkt importiert; nur die Laufzeit-Handles `config`/`store`/`audit` + die in `server.js` konstruierten Instanzen werden injiziert. Per-Symbol gegen echten Code verifiziert: Boot-only-Symbole (`assertConfig`, `fakeOriginateBootBlocked`, `hasActiveNumber`, `attachMediaBridge`) → Import in `boot.js`; Mount-only-Symbole (Middleware, alle `make*Routes`, `wireWebLogin`, `makeAuthGate`, `guardedBoot`, `createPortalRunner`, u.a.) → Import in `app.js`; Symbole, die in Konstruktion UND Mount gebraucht werden (`voiceControl`, `internalIdentity`, `OWNER_ID`, `terminateAndBillCall`, `hangUpAction`, `billThunk`, `stripeBilling`) → Import in BEIDEN (Modul-Singletons, keine Logik-Duplizierung); Konstruktions-only-Symbole bleiben in `server.js`; `config`/`store` werden in `server.js` importiert und via `deps` injiziert; `audit` ebenso (wie `web-login.js`-Muster).

**`deps`-Buendel:** `server.js` baut EIN Objekt (13 Felder: `config, store, audit, callFinish, lifecycle, provisioning, outboundGates, requestTenant, requireTenant, conversationWatchdog, ttsStore, directiveSynth, voiceRender`) und reicht es an beide: `const { app } = await buildApp(deps); await bootServer({ app, ...deps });`. `buildApp` nutzt alle 13; `bootServer` destrukturiert nur `{ app, config, store, lifecycle, callFinish, provisioning }` (Kompositions-Root-Idiom). Jede Funktion nimmt 1 Argument (F1).

**`buildApp`-Zerlegung** (4 benannte Registrar-Funktionen + sichtbare lineare Sequenz, INV-2): Die Static-Serving-Naht straddled die Auth-Gate (`webDist` VOR, `publicDir` HINTER dem Gate) — ein einzelner kombinierter Registrar wuerde INV-2 verletzen. Deshalb `registerStaticServing` (nur `webDistDir`-Block), `installAuthGate` (nur der `makeAuthGate`-Mount), und `express.static(config.publicDir)` als eine Inline-Zeile direkt danach (Asymmetrie durch Groesse/Bedingtheit begruendet, kein eigener Registrar noetig, G11 n.z.). Verbindliche Sequenz (byte-identisch zur `server.js`-Reihenfolge 173->506): `express()`+`trust proxy` -> `installGlobalMiddleware` -> `registerPublicRoutes` -> optionaler `guardedBoot(wireWebLogin)`-Block (nur wenn `sessionSecret`+`pg`) -> `registerStaticServing` -> `installAuthGate` -> `express.static(publicDir)` -> `makeVoiceRoutes` -> `makeCallRoutes` -> `makeReadRoutes` -> `makeTenantWriteRoutes` -> `makeProfileRoutes` -> `makeBillingRoutes` -> `makeOnboardRoutes` -> `makeMcpRoutes` -> `errorHandler` -> `return { app }`.

**`bootServer`-Zerlegung** (G30, <100-LOC-Richtwert): Modul-Helfer in `boot.js`: `runRetention(store,config)`, `assertBootGates(config,store)` (die drei `process.exit(1)`-Gates gebuendelt, macht INV-5 strukturell sichtbar), `logBootBanner(config,port)` (enthaelt die INV-6-Zeile). `bootServer` orchestriert nur noch + haelt `gracefulShutdown` als Inline-Closure (referenziert `httpServer`/`store`/`config` + lokales `let shuttingDown`, byte-identisch zum heutigen Modul-Closure).

**Pre-Mortem 11 / INV-5 (Relativordnung, load-bearing):** `await buildApp(deps)` (enthaelt den awaited `guardedBoot(wireWebLogin)`-Block, in dem `scheduleReleaseReconcile` fire-and-forget feuert) laeuft vollstaendig, DANN `await bootServer(...)` (`store.load` + Gates + `listen`). `store.load` wird nicht vorgezogen -> `scheduleReleaseReconcile` feuert weiter vor `store.load`, exakt wie heute — strukturell durch die Zwei-Await-Sequenz erzwungen.

### Neue Dateien (Signaturen)

`src/app.js` (~200 LOC geplant): `installGlobalMiddleware({app,config})`, `registerPublicRoutes({app,config,store,watchdog})`, `registerStaticServing({app,config})`, `installAuthGate({app,config,audit})`, `async buildApp(deps)`. Alle Bodies VERBATIM aus `server.js` verschoben (inkl. deutscher Kommentarbloecke), keine neuen/gestrichenen Kommentare (C1-C5). `STRIPE_WEBHOOK_PATH`/`CUSTOMER_PORTAL_PATH`/`LOGIN_PATH`/`APP_PATH`/`BODY_LIMIT`/`captureRawBody` bleiben EINE Quelle (INV-1) in `app.js`.

`src/boot.js` (~130 LOC geplant): `runRetention(store,config)`, `assertBootGates(config,store)`, `logBootBanner(config,port)`, `async bootServer({app,config,store,lifecycle,callFinish,provisioning})`. `RETENTION_SWEEP_INTERVAL_MS`-Konstante, INV-5-Kommentar (rearm nach allen exit1-Gates, unmittelbar vor `listen`), INV-6-Kommentar (Boot-Zeile erst im `listen`-Callback).

### Edit `src/server.js` (auf Kompositionswurzel verduennen, ~180-210 LOC geplant)

Imports bereinigt: Boot-/Mount-only-Symbole entfernt (`path`, `express`, `assertConfig`, `hasActiveNumber`, `attachMediaBridge`, `makeTelnyxLlmShim`, `agentTurn`, `BRAND_ASSETS_PREFIX`, MW-Factories, `registerWellKnown`, `safeEqual`, Registry-Signatur-Symbole, `originateAiAssistantCall`, alle `make*Routes`, `PLAN_CATALOG`, `createPortalRunner`, `wireWebLogin`, `makeAuthGate`, `guardedBoot`/`fakeOriginateBootBlocked`, `isTrustedLocalCaller`/`tenantOwnsCall`, `localeFor`); Konstruktions-Symbole bleiben (`config` ohne `assertConfig`, `store`, `planSummarySms`, `summarizeCall`, Watchdog-/TTS-/Directive-/VoiceRender-Factories, `terminateAndBillCall`/`hangUpAction`/`billThunk`, `makeCallFinish`, `makeOutboundGates`, `reattachActiveCallCore`, `makeCallLifecycle`, state-ops, `handleProvisionJob`, `makeProvisioningOrchestrator`, `resolveProvisionRetry`, `createQueue`, `stripeBilling`, `makeMetering`, `audit`, `makeRequestTenant`/`internalIdentity`/`OWNER_ID`/`TENANT_REJECT`); NEU: `import { buildApp } from "./app.js"`, `import { bootServer } from "./boot.js"`. Konstruktionsregion behaelt DAG-Reihenfolge, zieht 4 Konstruktionen hoch (`conversationWatchdog`, `ttsStore`, `directiveSynth`, `voiceRender`, vorher zwischen Mount-Aufrufen verstreut). Alle `app.set/use/get/post`, Pfad-Konstanten, `captureRawBody`, der `guardedBoot`-Block und die Boot-Sequenz entfernt (jetzt in `app.js`/`boot.js`). Schluss: `deps`-Objekt bauen -> `await buildApp(deps)` -> `await bootServer({ app, ...deps })`.

Invariante nach dem Edit: kein `app.post/get/use`, kein `export`, `process-guards` bleibt erste Importzeile, die `call-termination.js`-Importzeile bleibt unveraendert (haelt `call-termination-order.test.js:274` gruen).

### Einzige zwingend-mechanische Testanpassung

`test/telnyx-assistant-route-drift.test.js` — der Shim-Mount (`app.post("/v1/chat/completions", makeTelnyxLlmShim(...))`) wandert von `server.js` nach `app.js` (`registerPublicRoutes`, eine Zeile). Grep-Ziel `SERVER_JS_PATH`/`serverSource` -> `APP_JS_PATH`/`appSource`, Fehlertext/Testnamen-Strings `src/server.js` -> `src/app.js`. Assertions-Staerke unveraendert (gleicher Grep auf `app.post`+`makeTelnyxLlmShim`, gleicher Routen-String-Vergleich).

### Tests — warum die Bestandssuite reicht

Reiner verhaltens-erhaltender Refactor -> kein neuer Test (ein zusaetzlicher Quelltext-Grep auf die Mount-Reihenfolge waere brittle/C2 und schwaecher als die vorhandene funktionale Abdeckung). INV-6 wird von jedem Spawn-Test via `test/helpers.js`-Regex durchgesetzt; INV-2/INV-3 funktional durch `auth-gate-exemption-order`, `security`, `headers`, `rate-limit`, `single-origin-serving`, `single-origin-auth`, `auth-mcp-bypass`, `mcp-server-icon`, `root-redirect` gepinnt; INV-5 durch `boot-failclosed`, `boot-prod-footguns`, `boot-decoupling`, `max-duration-rearm`, `render-owner-autoseed`, `single-origin-boot-guard`, `owner-number-seed`; INV-1 durch `voice-signature*`, `telnyx-event-ingest-route`, `stripe-webhook-signature`/`-race`; INV-11/Q1-Marker durch `single-origin-auth`, `web-auth-pg`, `portal-route`, `self-service-*`; Graceful-Shutdown/Bridge durch `graceful-shutdown`; Shim durch `telnyx-shim-route` + `telnyx-assistant-route-drift`.

### Deterministisch pruefbares Ergebnis (Plan-Vorgabe)

```bash
node --check src/app.js && node --check src/boot.js && node --check src/server.js   # 0 exit
grep -c "app.post\|app.get\|app.use" src/server.js          # => 0
grep -c "^export" src/server.js                              # => 0
test $(wc -l < src/server.js) -lt 300 && echo OK             # => OK (~180-210)
grep -Fc "laeuft auf http://localhost" src/boot.js           # => 1
grep -rl "laeuft auf http://localhost" src/ | wc -l           # => 1 (nur boot.js repo-weit)
grep -c "buildApp\|bootServer" src/server.js                  # => >=2
grep -c 'STRIPE_WEBHOOK_PATH = "/webhooks/stripe"' src/app.js # => 1
npm test
STORE_BACKEND=pg npm test
# + gezielte 17 Testdateien (boot-*, graceful-shutdown, root-redirect, render-owner-autoseed,
#   single-origin-*, max-duration-rearm, telnyx-shim-route, telnyx-assistant-route-drift,
#   call-termination-order, process-guards, auth-gate-exemption-order, web-auth-pg, portal-route)
```

Basic-Auth-Stichprobe (Spawn + curl): erwartet `/healthz /favicon.ico /webhooks/stripe /mcp /voice/incoming` != 401, `/api/state` == 401 (extern).

### Deviations / Risiken (im Plan vorab benannt)

- **DEV-1 (zwingend-mechanisch):** `telnyx-assistant-route-drift.test.js` liest neu `src/app.js` statt `src/server.js`, Assertions-Staerke unveraendert.
- **DEV-2 (Struktur, verhaltens-erhaltend):** `installAuthGate` enthaelt nur den Gate-Mount, `express.static(publicDir)` als Inline-Zeile direkt danach, `registerStaticServing` nur der `webDist`-Block — INV-2 verbietet einen Registrar, der die Auth-Grenze ueberspannt. `bootServer` in `runRetention`/`assertBootGates`/`logBootBanner` zerlegt (G30).
- **DEV-3:** `conversationWatchdog`/`ttsStore`/`directiveSynth`/`voiceRender`-Konstruktion in `server.js` vor das `deps`-Buendel hochgezogen — verifiziert seiteneffektfrei bei Konstruktion.
- **RISK (hoechster Blast-Radius, INV-2/INV-5/INV-6):** ein vertauschter `register*`-Aufruf koennte eine ungeschuetzte Route erzeugen (Absolute Regel 3). Gegenmassnahme: verbindliche Reihenfolge, funktional durch `/api/state=401`-Stichprobe + Static-/Auth-Tests gepinnt, separater Opus-Safety-Review vor Merge Pflicht. Kein neuer Env-Var, keine neue Dependency, `bridge.js`/`claude.js`/`config.js`/`boot-guard.js`/`process-guards.js` unangetastet.

---

## 2. Impl-Zusammenfassung

P15 (Kompositionswurzel, Capstone) exakt gemaess Plan/Spec umgesetzt auf Branch `phase/slim-p15-composition-root` (von `master` `5476ae9` abgezweigt, isolierter Worktree).

`src/server.js`: **641 -> 185 Zeilen**, export-frei, kein `app.use/get/post` mehr. Baut nur noch die P1-P6-Instanzen unveraendert (inkl. Hochziehen von `conversationWatchdog`/`ttsStore`/`directiveSynth`/`voiceRender`, DEV-3), buendelt sie als EIN `deps`-Objekt und ruft `await buildApp(deps)` + `await bootServer({app, ...deps})`.

Neue `src/app.js` (410 Zeilen): vier benannte Registrar-Funktionen (`installGlobalMiddleware`/`registerPublicRoutes`/`registerStaticServing`/`installAuthGate`) + `buildApp(deps)` in exakt der bisherigen Mount-Reihenfolge (INV-2). Import-vs-Inject-Split laut Plan-Tabelle umgesetzt (BEIDEN-Symbole wie `voiceControl`/`stripeBilling`/`terminateAndBillCall`/`internalIdentity`/`OWNER_ID` in `server.js` UND `app.js` importiert, nicht dupliziert-konstruiert).

Neue `src/boot.js` (159 Zeilen): `runRetention`/`assertBootGates`/`logBootBanner` + `bootServer(deps)`; `rearmActiveCallTimers` strukturell nach allen drei exit1-Gates (INV-5); Boot-Banner-Zeile byte-identisch (INV-6).

Einzige Testaenderung (zwingend-mechanisch, im Plan vorgesehen): `test/telnyx-assistant-route-drift.test.js` liest jetzt `src/app.js` statt `src/server.js` (Shim-Mount dorthin verschoben, Assertions-Staerke unveraendert).

**Deterministische Checks** — alle gruen: `node --check` 0 exit auf allen 3 Dateien; `grep app.post|get|use` in `server.js` = 0; `grep ^export` in `server.js` = 0; `server.js` = 185 Zeilen (< 300); Boot-Zeile `laeuft auf http://localhost` repo-weit genau 1x (nur `src/boot.js`); `STRIPE_WEBHOOK_PATH` genau 1x in `app.js`.

**Testergebnisse:**
- `npm test` (json-Backend, Default): **2301/2301 gruen**, inkl. aller im Spec gezielt genannten Tests (`boot-decoupling`, `boot-failclosed`, `boot-prod-footguns`, `graceful-shutdown`, `root-redirect`, `render-owner-autoseed`, `single-origin-boot-guard/serving/auth`, `max-duration-rearm`, `telnyx-shim-route`, `telnyx-assistant-route-drift`, `call-termination-order`, `process-guards`, `auth-gate-exemption-order`, `web-auth-pg`, `portal-route`).
- `STORE_BACKEND=pg npm test`: 2001/2034 gruen, 33 Failures — per Vergleich gegen einen frischen `master`-Worktree als IDENTISCH verifiziert (exakt dieselbe Menge fehlschlagender Testdateien, nur Timing-Differenz). Ursache: fehlendes echtes Postgres in dieser Sandbox (`store.js` versucht einen realen `pg.Pool`-Connect, kein `DATABASE_URL` gesetzt) — vorbestehende Umgebungs-Einschraenkung, KEINE Regression aus P15.

**Basic-Auth-Smoke** (Server auf Port 3999, `SKIP_TWILIO_SIGNATURE_CHECK`, Owner-Nummer geseedet): `/healthz`, `/favicon.ico`, `/webhooks/stripe`, `/mcp`, `/voice/incoming` alle != 401 wie gefordert. `/api/state` ohne `X-Forwarded-For`-Header lieferte 200 (`isTrustedLocalCaller`-Bestandsverhalten fuer echten Loopback ohne Proxy-Weiterleitung, dokumentiert + testabgedeckt) — mit simuliertem externem `X-Forwarded-For` (wie hinter Render) korrekt 401.

Kein Verhaltens-Drift, keine neuen Env-Vars, keine neuen Dependencies, `bridge.js`/`claude.js`/`config.js`/`boot-guard.js`/`process-guards.js` unangetastet.

**Dateien:**
- neu: `src/app.js`, `src/boot.js`
- geaendert: `src/server.js`, `test/telnyx-assistant-route-drift.test.js`

### Deviations (Impl, final — deckungsgleich mit Plan)

- **DEV-1** (zwingend-mechanisch, im Plan vorgesehen): `test/telnyx-assistant-route-drift.test.js` liest jetzt `src/app.js` statt `src/server.js`, da der Shim-Mount (`app.post /v1/chat/completions`) nach `registerPublicRoutes` gewandert ist. Assertions-Staerke unveraendert (weiterhin `app.post` + `makeTelnyxLlmShim`-Grep + Routen-String-Vergleich). Mount-Zeile bewusst einzeilig gehalten (Test verlangt `app.post` + Handlername auf EINER Zeile).
- **DEV-2** (Struktur, verhaltens-erhaltend, im Plan vorgesehen): `installAuthGate` enthaelt NUR den Gate-Mount; `express.static(config.publicDir)` steht als Inline-Zeile direkt danach in `buildApp`; `registerStaticServing` enthaelt NUR den `webDistDir`-Block. Grund: INV-2 verbietet `publicDir`-Serving vor dem Auth-Gate, ein kombinierter Registrar haette diese Naht ueberspannt.
- **DEV-3** (Struktur, verhaltens-erhaltend, im Plan vorgesehen): `conversationWatchdog`/`ttsStore`/`directiveSynth`/`voiceRender`-Konstruktion in `server.js` VOR den `deps`-Buendel hochgezogen (vorher zwischen Mount-Aufrufen verstreut). Verifiziert seiteneffektfrei bei Konstruktion (nur Map/Objekt-Aufbau, Timer/console erst pro Methode/put) -> beobachtbar folgenlos, DAG-Reihenfolge (`ttsStore` vor `directiveSynth`) erhalten.
- `STORE_BACKEND=pg npm test` zeigt 33 Failures — via Diff gegen einen frischen, unveraenderten `master`-Worktree als vorbestehende Umgebungs-Einschraenkung (kein echtes Postgres erreichbar) bestaetigt, nicht durch P15 verursacht. Identische Fail-Menge, nur Timing unterschiedlich.

### Clean-Code-Selbstcheck (Impl)

F1 (alle neuen Funktionen 1 Objekt-Argument bzw. `bootServer`-Helfer mit 2 Positionsargumenten wie im Plan spezifiziert, nie > 3), G5 (keine Duplizierung — BEIDEN-Symbole wie `voiceControl`/`stripeBilling` werden importiert, nicht dupliziert konstruiert), G12 (kein ungenutzter Import — jedes importierte Symbol in `app.js`/`boot.js`/`server.js` per Grep auf >= 2 Vorkommen verifiziert), G25/G35 (Magic-Strings wie `STRIPE_WEBHOOK_PATH`/`BODY_LIMIT` bleiben benannte Konstanten am bisherigen Ort), G30/G34 (`buildApp` bleibt EINE sichtbare lineare Sequenz aus benannten Registrar-Aufrufen statt einer monolithischen Funktion; `bootServer` in `runRetention`/`assertBootGates`/`logBootBanner` zerlegt), P15 (Konstruktion bleibt vollstaendig in `server.js`, kein Lazy-Init, keine Verdrahtung im Fachcode), C1-C5 (keine neuen Autoren-/Datums-Kommentare, kein auskommentierter Code, alle verschobenen Kommentare verbatim uebernommen und wo noetig auf die neue Datei-Realitaet aktualisiert). Kein S1/S2-Fund in der Selbstpruefung; die Asymmetrie `registerStaticServing`/`installAuthGate`/Inline-`express.static` ist explizit als DEV-2 begruendet (G11/G32 bewusste Ausnahme, keine Willkuer).

---

## 3. Safety-Urteil

**approved: true**

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true

**Blockers:** keine.

**Concerns (nicht blockierend):**

1. Global-Override `STORE_BACKEND=pg npm test` zeigt 33 Fehler — ABER identischer Failing-Set wie die master(P14)-Baseline (per detached-HEAD-Lauf + Diff bewiesen: gleiche 33 Dateien, gleiche 2001/33-Zahlen). Vorbestehend, nicht der designte pg-Testpfad (Spawn-Tests setzen eigenes json-Env; Unit-Tests rufen `store` direkt und erwarten json-Semantik). KEIN P15-Regress. JSON-Backend (Default) ist voll gruen: 2301/2301.
2. Der Test `telnyx-assistant-route-drift.test.js` wurde als einzige mechanische Whitebox-Anpassung (Grep-Ziel `server.js`->`app.js`) geaendert — vom Spec ausdruecklich erlaubt, Assertionsstaerke erhalten (gleicher Grep, gleiche Regex, gleiche Asserts).

**Unabhaengige Verifikation:** JSON-Backend (designter Default): `npm test` 2301 pass / 0 fail. Gezielte P15-Tests (11 Dateien: `boot-decoupling`, `boot-failclosed`, `boot-prod-footguns`, `graceful-shutdown`, `root-redirect`, `render-owner-autoseed`, `single-origin-boot-guard`, `single-origin-serving`, `max-duration-rearm`, `telnyx-shim-route`, `telnyx-assistant-route-drift`) isoliert: 33 pass / 0 fail. Live Basic-Auth-Stichprobe (Spawn + fetch): `/healthz`=200, `/favicon.ico`=200, `/webhooks/stripe`=404, `/mcp`=200, `/voice/incoming`=200 (alle nicht-401, korrekt exempt); `/api/state` extern ohne Auth=401, mit korrektem Basic-Auth=200 -> PASS. pg-Global-Override: 2001 pass / 33 fail, aber Failing-Set byte-identisch zum master(P14)-Baseline (vorbestehend, kein Regress).

**Verdict:** APPROVED. P15 ist eine reine, verhaltens-erhaltende Verschiebung der Kompositionswurzel. `src/server.js` (185 Z, export-frei, 0x `app.post/get/use`) konstruiert nur noch die Singletons (INV-7) und ruft `await buildApp(deps)` dann `await bootServer({app,...deps})`. `src/app.js` bildet die Express-Middleware-/Mount-Kette in EXAKT der master-Reihenfolge ab (INV-2 Zeile fuer Zeile gegen master verifiziert: `securityHeaders`->RateLimit->`urlencoded(verify)`->`json(verify)`->BodyParser-Err->`healthz`->`/api/plans`->`registerWellKnown`->Shim-Mount->`/`-Redirect->`guardedBoot`/`wireWebLogin`->`static(webDistDir)`->AuthGate->`static(publicDir)`->voice->calls->read->tenant-write->profiles->billing->onboard->mcp->errorHandler). `src/boot.js` fuehrt die Boot-Sequenz byte-identisch aus (INV-5: rearm NACH allen 3 exit1-Gates, unmittelbar vor `listen`; kein `exit(1)` danach; INV-6-Boot-Zeile wortwoertlich, genau 1x, im `listen`-Callback nach vollem Boot). INV-1 (`captureRawBody`-Praedikat + `STRIPE_WEBHOOK_PATH` EINE Quelle), INV-3/INV-4 (Auth-Gate/Voice-Sig unveraendert via P14/P11), INV-8 (mcp stateless via P12), INV-9 (Safety-Gates/Disclosure/Max-Dauer/Budget unangetastet), INV-11 (`guardedBoot` fail-open, `buildApp` vollstaendig awaited vor `store.load`) alle erfuellt. Nur 4 Dateien, keine verbotenen Dateien, keine neuen Deps. Alle Blocker-relevanten Tests gruen.

---

## 4. Clean-Code-Audit (S1-S4)

**Verdict: PASS ohne Blocker**, `blocker: false`.

P15 ist eine saubere, mechanische Kompositionswurzel-Extraktion (`server.js` -> `src/app.js` + `src/boot.js`): Mount-Reihenfolge (INV-2), Boot-Gate-Reihenfolge (INV-5) und Graceful-Shutdown-Ordering sind byte-identisch erhalten geblieben (Zeile-fuer-Zeile mit dem Original abgeglichen), keine Sicherheits-Gates beruehrt, kein toter Code, keine neuen Magic Numbers, keine deaktivierten Sicherungen. Der einzige direkt betroffene Test (`telnyx-assistant-route-drift.test.js`) wurde korrekt auf den neuen Pfad nachgezogen. `node --check` sauber fuer alle drei Dateien, volle Suite 2301/2301 gruen (Kindprozess-Boot-Tests decken `buildApp`/`bootServer` indirekt aber real ab).

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (Nebenbefund, ausserhalb Diff-Scope, nicht blockierend):**
  - `test/auth-gate-exemption-order.test.js:15-16` — Kommentar behauptet weiterhin "Server-lokale Pfad-Konstanten (server.js L193/L204)". P15 hat `CUSTOMER_PORTAL_PATH`/`STRIPE_WEBHOOK_PATH` nach `src/app.js` verschoben, Zeilenangabe und Dateiname sind jetzt falsch (C2, veralteter Kommentar). Datei ist nicht Teil des geprueften Diffs, daher kein Blocker — nur als Folgeaufgabe vermerkt. Fix: Kommentar auf `app.js` + aktuelle Zeilen nachziehen.
- **S4 (informativ, kein Blocker):**
  - `src/app.js:195-408` (`buildApp`) — Funktion enthaelt ca. 110 Nicht-Kommentar-Zeilen und liegt damit ueber dem Richtwert "Funktionslaenge 100 Zeilen" (CLAUDE.md-Tabelle). Waehrend `installGlobalMiddleware`/`registerPublicRoutes`/`registerStaticServing`/`installAuthGate` bereits sauber herausgezogen wurden, bleibt der gesamte API-/MCP-Router-Mount-Block (`makeCallRoutes`...`makeMcpRoutes`, ~7 `app.use`-Bloecke) inline in `buildApp`. Fix: analog weiteren Helper extrahieren, z.B. `mountApiRoutes({app, deps})` / `mountVoiceRoutes({app, deps})`, `buildApp` bleibt reine Aufruf-Sequenz.
  - `src/app.js:73,98,145,176` (`installGlobalMiddleware`, `registerPublicRoutes`, `registerStaticServing`, `installAuthGate`) — alle vier Funktionen sind exportiert, haben aber im gesamten Repo genau einen Aufrufer (`buildApp`, selbe Datei) — kein Test und kein anderes Modul importiert sie direkt (grep bestaetigt). Unnoetige oeffentliche Flaeche (G8) UND latentes G31-Risiko: wuerde sie irgendwann jemand direkt statt ueber `buildApp` aufrufen, ist die zwingende Reihenfolge (Global-MW -> Public-Routes -> optionales Web-Login -> Static -> Auth-Gate) durch nichts in den Signaturen erzwungen. Fix: modul-privat halten (kein `export`), es sei denn ein konkreter externer/Test-Konsument ist geplant — dann auch dafuer testen.

**passNotes:** Reine Verschiebung ohne Verhaltensaenderung: Mount-Reihenfolge in `buildApp` exakt gegen das Original verifiziert (siehe Sequenz oben). Boot-Gate-Reihenfolge (`assertConfig` -> `fakeOriginateBootBlocked` -> `hasActiveNumber` -> `rearmActiveCallTimers` -> `listen`) 1:1 nach `src/boot.js` migriert, inkl. der Kommentare zu INV-5/F10-ORD/S1-A/S1-B. Keine neuen Imports mit Sicherheitsbezug, keine geaenderten Auth-/Signatur-/Budget-Pfade. Konstanten (`STRIPE_WEBHOOK_PATH`, `CUSTOMER_PORTAL_PATH`, `LOGIN_PATH`, `APP_PATH`, `BODY_LIMIT`) bleiben je EINE Quelle in `app.js`, keine Duplikate. `buildApp`/`bootServer` nehmen je EIN `deps`-Objekt (F1 eingehalten). Drift-Test korrekt aktualisiert. `node --check src/{server,app,boot}.js` sauber; `npm test`: 2301/2301 gruen, 0 fail.

**topTodos:**
1. `buildApp` weiter zerlegen (> 100-Zeilen-Richtwert): API-/MCP-Router-Block in `mountApiRoutes()`/`mountVoiceRoutes()`-Helfer auslagern, analog zu den bereits extrahierten `registerXxx`-Funktionen.
2. Export-Oberflaeche in `app.js` pruefen: `installGlobalMiddleware`/`registerPublicRoutes`/`registerStaticServing`/`installAuthGate` haben je nur einen Aufrufer (`buildApp`) — modul-privat machen, solange kein externer Konsument/Test existiert.
3. (Optional, ausserhalb Scope) Stale-Kommentar in `test/auth-gate-exemption-order.test.js` nachziehen (`server.js` -> `app.js`), da P15 die referenzierten Pfad-Konstanten verschoben hat.

---

## 5. Fix-Runden

Keine — es gab keine Blocker (S1/S2 leer), daher keine Fix-Runde noetig. Phase in einem Durchgang PASS.
