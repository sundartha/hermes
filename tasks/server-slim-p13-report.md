# Server-Slim Phase P13 — Report

**Ziel:** `src/wiring/web-login.js` (`wireWebLogin`) + `src/routes/stripe-webhook.js` (`makeStripeWebhookRoute`) extrahieren — der gesamte `guardedBoot("Web-Login/Portal", ...)`-Block (OIDC/Portal/Accounts/Sessions/AuditStore/Admin-/Self-Service-Mounts/Stripe-Webhook/Release-Reconcile-Scheduler) inkl. Q1-Erfolgsmarker aus `src/server.js`
**Gate:** PASS
**finalBranch:** `phase/slim-p13-web-login-wiring`
**headCommit (Impl):** `1dae9bf6d1a4918a3b9988155fd518513a842d5e`

---

## 1. Plan (gekuerzt)

### Verifizierter Ist-Stand

`src/server.js` war zu Phasenbeginn **868 Zeilen** (nicht 2244 — P0a-P12 bereits gemerged, HEAD `8d57e6a`). Die realen Ziel-Bereiche:

- **L288-307:** `RELEASE_RECONCILE_INTERVAL_MS` (const) + `scheduleReleaseReconcile(deps)` (function)
- **L309/L313-490:** `if (config.sessionSecret && config.storeBackend === "pg") { await guardedBoot("Web-Login/Portal", async () => { ... ~175 Zeilen ... }) }`
- **L459-488:** der inline Stripe-Webhook-Handler `app.post(STRIPE_WEBHOOK_PATH, async (req,res) => {...})`

Blast-Radius bewusst klein: **nur** dieser Block wandert. `captureRawBody` (L228-232), das Auth-Gate mit `STRIPE_WEBHOOK_PATH`-Exemption (L536-558), die Konstanten `STRIPE_WEBHOOK_PATH`/`CUSTOMER_PORTAL_PATH`/`APP_PATH`/`LOGIN_PATH`, der `WEB_DIST_DIR`-Static-Block (L492-519) und die gesamte Boot-Sequenz bleiben **byte-identisch** in `server.js` (INV-1/INV-2/INV-3 unangetastet; die kommen erst in P14/P15 dran).

### (1) `src/routes/stripe-webhook.js` (~50 LOC) — `makeStripeWebhookRoute(deps)`

Reine Verschiebung des inline Handlers (L459-488). Pure Helfer werden **direkt importiert** (Konvention `api-billing.js`: der `stripeBilling`-**Port** wird injiziert, die reinen Funktionen `flushMeters` etc. importiert). `accounts`/`sessions` **muessen** injiziert werden — sie werden in `wireWebLogin` ueber `portalRunner` konstruiert.

Deps: `{ config, store, audit, accounts, sessions, billing, provision }`. Kein Basic-Auth (Stripe kann keine Credentials senden) — die Sicherung ist die HMAC-Signaturpruefung gegen `STRIPE_WEBHOOK_SECRET`, fail-closed: Signatur VOR JSON-Parse (`rawBody`, INV-1). Ohne `PAYMENT_ENABLED` -> 404 (byte-identisch). `verifyStripeSignature`/`applyStripeWebhookSerialized` (reine Funktionen) direkt importiert aus `billing/webhook.js`. Handler-Body byte-identisch zu L460-487; nur `provisioning.triggerTenantProvisioning` -> `provision` und `stripeBilling` -> `billing` (beides dieselbe Instanz via Injektion).

### (2) `src/wiring/web-login.js` (~140 LOC) — `wireWebLogin(deps)` (NEUES Verzeichnis `src/wiring/`)

Konstruiert `portalRunner`/`oidc`/`accounts`/`sessions`/`auditStore`/`portalStore`, mountet in **unveraenderter Reihenfolge**, loggt im Erfolgsfall den Q1-Marker. `RELEASE_RECONCILE_INTERVAL_MS` + `scheduleReleaseReconcile` wandern als Modul-privater Scope mit.

**Import-vs-Inject-Entscheidung (Konvention P1-P12):** reine Factories/Helfer/Konstanten werden **direkt importiert** (wie `api-onboard.js` `PROVIDER`/`registerTenant`... importiert); nur Laufzeit-Instanzen + geteilte Konstanten werden injiziert.

- **Direkt importiert:** `makeOidc, makeAccounts, makeSessions, webAuth, webAuthAllowPending, adminOnly, makeWebAuthRoutes, makeAdminRoutes, LOGIN_ROUTE` (`web-auth.js`), `makePortalStore, makeAuditStore, makeSelfServiceRoutes, createRateLimiter, setTenantIdentityIfAbsent, runReleaseReconcile, numberProvisioning, PROVIDER, stripeBilling, makeStripeWebhookRoute`.
- **Injiziert:** `{ app, config, store, audit, provision, createPortalRunner, stripeWebhookPath, customerPortalPath, appPath }`.

**`createPortalRunner` wird injiziert (bewusste, dokumentierte DIP-Abweichung).** Es ist der EINZIGE infrastruktur-beruehrende Kollaborator (oeffnet den pg-Pool). Injiziert man ihn, ist der Q1-Happy-Path-Marker offline testbar (Fake statt erreichbarer Postgres) — exakt der DI-Fault-Injection-Seam, den `boot-guard.test.js` schon nutzt. Ohne diese Injektion waere die vom Owner-Entscheid Q1 verlangte Marker-Assertion offline nicht deterministisch pruefbar (child-process + pglite ist per Lehre `p6a-Stall` verboten). Das ist die textbuch-korrekte P4-DIP-Wahl.

`RELEASE_RECONCILE_INTERVAL_MS` bleibt benannte Modul-Konstante (`6 * 60 * 60 * 1000`, tenant-prolif-d: Sweep-Kadenz des DID-Release-Reconcilers). `scheduleReleaseReconcile(deps)` bleibt fire-and-forget, `nowMs` pro Lauf injiziert (byte-identisch aus `server.js` verschoben).

`wireWebLogin` konstruiert `portalRunner`, `oidc`, `accounts`, `sessions`, `auditStore`, startet den Release-Reconcile-Scheduler, konstruiert `portalStore` + `webAuthMw`/`webAuthPendingMw`/`adminMw`, definiert die fail-open `applyTenantIdentity`-Closure (byte-identisch aus `server.js`), mountet `/auth`-Rate-Limiter + `makeWebAuthRoutes`, `GET /api/portal/state` (READ-only, tenant-scoped, `webAuthMw`), `makeAdminRoutes`, bedingt `makeSelfServiceRoutes` (`config.selfServiceEnabled && config.multiTenant`), `POST stripeWebhookPath` via `makeStripeWebhookRoute`, und schliesst mit dem Q1-Marker `console.log("[boot] Web-Login aktiv")` als eigene Zeile — erreicht NUR, wenn alle Mounts durchliefen; wirft ein Schritt vorher, faengt `guardedBoot` es als "deaktiviert" ab (fail-open) und diese Zeile bleibt aus.

### (3) Edits an `src/server.js`

- **Edit A:** Import `PROVIDER, NUMBER_STATUS, USAGE_EVENT_KIND` aus `store/defaults.js` **komplett entfernt** (`PROVIDER` durch den Block-Move verwaist; `NUMBER_STATUS`/`USAGE_EVENT_KIND` bereits vor P13 tot, grep-belegt).
- **Edit B:** `setTenantIdentityIfAbsent` aus dem `state-ops.js`-Import entfernt (uebrige 6 Symbole bleiben).
- **Edit C:** Webhook-Import (`verifyStripeSignature, applyStripeWebhookSerialized` aus `billing/webhook.js`) entfernt.
- **Edit D:** `makeSelfServiceRoutes`-Import entfernt.
- **Edit E:** die gesamte `web-auth.js`-Import-Anweisung (9 Symbole) entfernt.
- **Edit F:** drei Einzel-Importe entfernt (`makePortalStore`, `makeAuditStore`, `runReleaseReconcile`) — `createPortalRunner` BLEIBT (wird injiziert).
- **Edit G:** `import { wireWebLogin } from "./wiring/web-login.js";` ergaenzt.
- **Edit H:** `RELEASE_RECONCILE_INTERVAL_MS` + `scheduleReleaseReconcile` (L288-307) ersatzlos entfernt.
- **Edit I:** der ~175-Zeilen-`guardedBoot`-Koerper durch einen duennen Aufruf `wireWebLogin({ app, config, store, audit, provision: provisioning.triggerTenantProvisioning, createPortalRunner, stripeWebhookPath: STRIPE_WEBHOOK_PATH, customerPortalPath: CUSTOMER_PORTAL_PATH, appPath: APP_PATH })` ersetzt; `if`-Rahmen (`config.sessionSecret && config.storeBackend === "pg"`) und `guardedBoot("Web-Login/Portal", ...)`-Aufruf bleiben in der Wurzel sichtbar.

Position unveraendert (nach dem `/`-Redirect, vor dem `WEB_DIST_DIR`-Static-Block) -> INV-2/INV-5 gehalten. `provisioning`, `STRIPE_WEBHOOK_PATH`, `CUSTOMER_PORTAL_PATH`, `APP_PATH` sind alle vor dem Block definiert. Nichts sonst in `server.js` wird angefasst — `captureRawBody`, Auth-Gate-Exemption, Boot-Sequenz, Banner (INV-6) bleiben byte-identisch. Netto laut Plan-Schaetzung: `server.js` schrumpft ~868 -> ~693 Zeilen.

### (4) Tests

Bestehende 11 P13-Verifikationsdateien (`web-auth`, `web-auth-middleware`, `portal-route`, `portal-rls-killer`, `stripe-webhook-signature`, `stripe-webhook-race`, `single-origin-auth`, `self-service-flag-gate`, `admin-approval`, `boot-guard`, `boot-decoupling`) testen die Kollaborator-Module direkt oder eine Wegwerf-App — keiner importiert/spawnt den `guardedBoot`-Block; alle gruen ohne Aenderung. **EIN neuer Test** (`test/web-login-wiring.test.js`, Q1/INV-11): in-process, DI-Stil wie `boot-guard.test.js` — `wireWebLogin` ueber `guardedBoot` mit gefaelschtem `createPortalRunner` (Happy-Path: Marker geloggt, `/api/portal/state` -> 401 statt 404; Fault-Path: `createPortalRunner` wirft -> `guardedBoot` false, kein Marker, "deaktiviert" geloggt).

### (5) Deviations/Safety (Plan-Vorgabe)

**D1** — Import `PROVIDER, NUMBER_STATUS, USAGE_EVENT_KIND` komplett entfernt statt nur `PROVIDER`: G12 gebietet Entfernung, da die Anweisung nach dem Move zu 100 % ungenutzt ist (zwei der drei Symbole waren bereits vorher tot). **D2** — `createPortalRunner` injiziert statt importiert: begruendeter DIP-Seam fuer den Q1-Marker-Test. **D3** — reine Webhook-Funktionen direkt importiert, `stripeBilling` als Instanz injiziert — exakt `api-billing.js`-Konvention.

**Absolute Regeln:** Stripe-HMAC bleibt fail-closed (Signatur VOR JSON-Parse). `applyTenantIdentity` fail-open, Stripe-Webhook fail-closed — beide Semantiken exakt erhalten. `STRIPE_WEBHOOK_PATH` bleibt EINE Konstante (INV-1). Kein Safety-Gate, kein `disclosureSentence`, kein Auth-Gate, keine Boot-Sequenz beruehrt. Kein Secret geloggt. Keine neue Dependency, keine neue Env-Var.

---

## 2. Impl-Zusammenfassung

P13 exakt gemaess Plan umgesetzt: der `guardedBoot("Web-Login/Portal", ...)`-Block wurde nach `src/wiring/web-login.js` (`wireWebLogin`) und `src/routes/stripe-webhook.js` (`makeStripeWebhookRoute`) extrahiert — reine Verschiebung, byte-identische Mount-Reihenfolge/Semantik/Pfade. `server.js` behaelt die Bedingung (`config.sessionSecret && config.storeBackend === "pg"`) und den `guardedBoot`-Aufruf, reicht nur noch Dependencies durch. Q1 (Owner-Entscheid): `wireWebLogin` loggt im Erfolgsfall die eigene Zeile `"[boot] Web-Login aktiv"`, abgedeckt durch den einen neu erlaubten Test (Happy-/Fault-Path).

`server.js` schrumpft von **868 auf 673 Zeilen** (-218/+23 im Diff). Die drei toten/verwaisten Imports (`PROVIDER` durch den Move verwaist, `NUMBER_STATUS`/`USAGE_EVENT_KIND` bereits vor P13 tot) wurden mitentfernt (Deviation dokumentiert).

Alle globalen Verifikationen bestanden: `node --check` auf allen drei Dateien gruen, `grep -c "^export" src/server.js` = 0, Boot-Banner genau 1x im Repo, `guardedBoot`-Aufruf in der Wurzel sichtbar, keine verwaisten Symbolreferenzen. Volle Testsuite (beide Backends, json + pglite-in-process) **2295/2295 gruen**, 0 rot.

**Smoke-Test** (`test/helpers.js` `startServer()`, freier Port, `STORE_BACKEND=json`, Default ohne `SESSION_SECRET`): `/healthz` -> 200 `{ok:true}`, `/api/plans` -> 200, `/auth/login` -> 404 (Web-Login-Block korrekt NICHT gemountet, da `config.sessionSecret` leer — byte-identisches Gating), `/api/portal/state` -> 404 (Block-Routen existieren nicht). Server sauber gestoppt. Ein echter pg-Happy-Path-Spawn (`SESSION_SECRET`+`STORE_BACKEND=pg` mit erreichbarer DB) ist offline nicht herstellbar (kein Netz/DB; pglite-in-Kindprozess ist laut Lehre `p6a-Stall` verboten) — dafuer deckt der neue in-process-Test (`test/web-login-wiring.test.js`, DI-Stil wie `boot-guard.test.js`) den Q1-Marker-Happy-Path UND den Fault-Path deterministisch ab.

**Dateien:**
- neu: `src/routes/stripe-webhook.js`, `src/wiring/web-login.js`, `test/web-login-wiring.test.js`
- geaendert: `src/server.js`

**Tests:** `test/web-login-wiring.test.js` (neu, 2 Tests: Happy-Path Marker + Mount-Beweis via `/api/portal/state` -> 401; Fault-Path kein Marker + "deaktiviert"). Testergebnis: 2295 pass / 0 fail.

### Deviations (Impl, final)

1. **Worktree-Stale-Read:** der initiale Worktree-Branch (HEAD `bf0d529`, `server.js` 2679 Zeilen) war NICHT der Plan-Kontext — erst nach `git checkout -b ... master` (wie im Vorgehen vorgeschrieben) stand `server.js` exakt auf dem im Plan genannten Stand (868 Zeilen, HEAD `8d57e6a`). Die erste Analyse basierte faelschlich auf dem Vor-Checkout-Stand und wurde verworfen, sobald der Edit-Tool-Stale-Check das aufdeckte; alle Edits erfolgten gegen den verifizierten echten Stand.
2. `test/stripe-webhook-race.test.js` existiert in diesem Repo nicht (Plan/Spec nennen einen Dateinamen, der rottete). Als aequivalenter Ersatz `test/p3-payment-webhook.test.js` verifiziert (testet `applyStripeWebhookSerialized` inkl. Race-/Idempotenz-Faelle direkt gegen `billing/webhook.js`, beruehrt keine `server.js`-Interna — gleiche Eigenschaft wie der im Plan beschriebene Test).
3. 3 Kommentar-Erwaehnungen von `makeSelfServiceRoutes`/`makeWebAuthRoutes` bleiben in `server.js` stehen (Zeilen 84/195/487) — das sind Muster-Referenzen in Kommentaren, keine echten Imports/Aufrufe; per grep verifiziert. Nicht angefasst, da ausserhalb des Verschiebe-Scopes dieser Phase und weiterhin inhaltlich korrekt (die Muster existieren unveraendert, nur relokiert).

### Clean-Code-Selbstcheck (Impl)

Geprueft gegen `.claude/refs/clean-code.md`: G5 (keine Duplizierung, reine Verschiebung ohne Kopien), G12 (keine ungenutzten Imports — jedes importierte Symbol in `web-login.js`/`stripe-webhook.js` wird verwendet; in `server.js` alle verwaisten Imports entfernt, verifiziert per grep), G25 (`RELEASE_RECONCILE_INTERVAL_MS` bleibt benannte Konstante, unveraendert mitgewandert), F1 (`wireWebLogin`/`makeStripeWebhookRoute` nehmen je EIN Deps-Objekt), P15 (Konstruktion/Verdrahtung sauber von `server.js` getrennt, kein Lazy-Init), C2 (keine datei:zeile-Kommentare eingefuehrt). Einzige bewusste Abweichung von der Laengen-Richtgroesse: `wireWebLogin` ist ~140 Zeilen eine Funktion — gerechtfertigt durch G31 (verborgene zeitliche Kopplung: `portalRunner` -> `accounts`/`sessions`/`auditStore` -> Routen-Mounts muessen in dieser Reihenfolge passieren) und P15 (reine Kompositions-/Verdrahtungs-Aufgabe ohne Fachlogik, kuenstliche Fragmentierung waere Indirektion ohne Mehrwert, vgl. G6/S4). Kein toter Code, keine Magic Numbers ausser 0/1/-1, Kommentare deutsch ohne Umlaute.

---

## 3. Safety-Urteil

**approved: true** — alle Kernkriterien erfuellt:

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true

**Unabhaengige Verifikation:** Fresh worktree, `node_modules` symlinked, Branch `review-slim-p13` aus `phase/slim-p13-web-login-wiring`. `node --check` gruen fuer `src/server.js` + alle 3 neuen/geaenderten `.js`. P13-Zielset (`web-auth`, `web-auth-middleware`, `portal-route`, `portal-rls-killer`, `stripe-webhook-signature`, `stripe-webhook-race`, `single-origin-auth`, `self-service-flag-gate`, `admin-approval`, `boot-guard`, `boot-decoupling`, `web-login-wiring`): **113 pass / 0 fail**. Voller Lauf `NODE_ENV=test node --test test/*.test.js`: **2295 pass / 0 fail / 0 skipped** (schliesst die pglite-pg-Backend-Tests wie `web-auth-pg`, `boot-decoupling` ein — beide Backends abgedeckt); kein `p5-gate-proof`-Flake. Globale Checks: `grep -c ^export src/server.js` = 0; Boot-Zeile "Hermes Gateway laeuft auf http://localhost" genau 1x unter `src/`; `git diff --stat server.js` -218/+23 (Netto-Reduktion); `package.json` unveraendert (keine neue Dependency).

**Blockers:** keine.

**Concerns (nicht blockierend):**
1. Q1-PFLICHT-Verifikation ist ein In-Process-DI-Test (gefaelschter `createPortalRunner`) statt eines echten pg-Backend-Spawns, wie die Spec woertlich ("pg+session Happy-Path-Spawn") nannte. Nicht-blockierend: der Test durchlaeuft die echte `wireWebLogin`-Verdrahtung (alle `make*`-Factories + alle App-Mounts + Marker) und asserted Marker-vorhanden + "deaktiviert"-abwesend + Route erreichbar (401 statt 404) und im Fault-Pfad das Gegenteil — deckt die INV-11/Q1-Absicht ab; Begruendung dokumentiert (offline kein erreichbares pg; pglite-im-Kindprozess = p6a-Stall-Lehre).
2. `web-login.js` importiert reine Helfer/Konstanten (`runReleaseReconcile`, `numberProvisioning`, `PROVIDER`, `stripeBilling`, `verifyStripeSignature`, `applyStripeWebhookSerialized`) direkt statt sie zu injizieren, waehrend der Basis-Plan-Text eine `releaseReconcile`-Dep-Untergruppe als injiziert skizzierte. Nicht-blockierend und kein Verhaltensdrift: identische ESM-Modul-Specifier wie Master-`server.js` -> selbe Singletons (INV-7 gewahrt); Spec erlaubte explizit "Exakte Dep-Listen aus echtem Code ableiten", nur Laufzeit-Instanzen (`app`/`store`/`audit`/`provision`/`createPortalRunner`) + Pfad-Konstanten werden injiziert.

**Verdict:** APPROVED. P13 ist eine saubere reine Verschiebung: der ~180-Zeilen-`guardedBoot`-Koerper wandert byte-identisch nach `src/wiring/web-login.js` (`wireWebLogin`) und der inline Stripe-Webhook-Handler nach `src/routes/stripe-webhook.js` (`makeStripeWebhookRoute`), waehrend die Wurzel Bedingung + `guardedBoot`-Aufruf sichtbar behaelt. Zeilenweiser Vergleich gegen `master` bestaetigt identische Mount-Reihenfolge, identische Handler-Logik und identische Import-Quellen (selbe Singletons, INV-7). Die einzige neue Verhaltens-Zeile ist der zugelassene Q1-Erfolgsmarker "[boot] Web-Login aktiv" (im `guardedBoot`-try, nach allen Mounts -> nur im Erfolgsfall). Alle absoluten Regeln gewahrt: Safety-Gates (nicht in P13-Dateien, unberuehrt), Disclosure (`claude.js`/`bridge.js` unveraendert), Auth fail-closed (Stripe-HMAC vor JSON-Parse; `/api/portal/state` `webAuth` 401; Auth-Gate-Exemption unveraendert; Block VOR Basic-Auth, fail-OPEN INV-11), keine Secrets im Log/Response. INV-1/6/7/10/11 erfuellt. 2295/0 Tests gruen (beide Backends), Netto-Reduktion in `server.js`, export-frei. Zwei kleine, dokumentierte, nicht-blockierende Design-Anmerkungen (In-Process-statt-Spawn-Test; Direkt-Import reiner Helfer) aendern das Verhalten nicht.

---

## 4. Clean-Code-Audit (S1-S4)

**Verdict: PASS**, `blocker: false`.

Byte-identische Mount-Reihenfolge und Semantik verifiziert (`server.js`-Diff zeigt reine Extraktion, keine Logikaenderung). Keine verwaisten Imports in `server.js` (`PROVIDER`/`NUMBER_STATUS`/`USAGE_EVENT_KIND`, `setTenantIdentityIfAbsent`, `web-auth`-Exports, `verifyStripeSignature`/`applyStripeWebhookSerialized` korrekt in die neuen Module verschoben, nirgends doppelt importiert). `createPortalRunner` bleibt als DIP-Seam injiziert, `provision`/`audit`/`store` werden als dieselben Singleton-Referenzen durchgereicht wie vorher (INV-7/G5 gewahrt). `stripeBilling` bleibt EINE Modul-Singleton-Instanz trotz Import an zwei Stellen (ESM-Cache). `node --check` fuer alle drei neuen/geaenderten Dateien sauber; `grep -c "^export" src/server.js` = 0 (Plan-Kontrakt erfuellt). Kommentare konsistent Deutsch ohne Umlaute, gleicher Begruendungsstil wie Bestand (G24). Test-Datei nutzt sauberes Build-Operate-Check mit Helper-Factories (`makeDeps`/`captureConsole`/`fakeRunner`), deckt Happy- und Fault-Pfad des `guardedBoot`-Verhaltens ab, F.I.R.S.T.-konform (kein echtes Netz/DB, in-process `express()`).

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (nicht blockierend):**
  - P2/G30 (S4, gebuendelt) · `src/wiring/web-login.js:58-213` (`wireWebLogin`) · Die Funktion buendelt sechs Zustaendigkeiten (OIDC-Routen, Portal-Store, Admin-Mount, Self-Service-Mount, Stripe-Webhook-Mount, Release-Reconcile-Scheduler) und laesst sich nur mit "und...und...und" beschreiben, ~156 Zeilen Body (> 100-Zeilen-Richtwert aus CLAUDE.md). Kein Blocker: reine Verschiebung (vorher unbenannter Callback direkt in `server.js`, jetzt benannte, testbare Funktion — netto eine Verbesserung), und das Muster folgt bewusst P15 (Kompositionswurzel/Wiring-Modul), wie im `PLAN-SERVER-SLIM.md` fuer P13 vorgesehen. Fix (optional, kein Muss fuer P13): bei spaeterer Anfassung in interne Helfer wie `wireOidcLogin(...)`, `wireAdminAndPortal(...)`, `wireSelfServiceAndBilling(...)` zerlegen, um unter die Zeilenrichtlinie zu kommen.
  - P14 (S3) · `test/web-login-wiring.test.js:74-96` (erster Test) · Ein Test prueft zwei Konzepte: (1) Boot-Marker-Logzeile, (2) HTTP-Mount-Beweis per `fetch` auf `/api/portal/state` -> 401. Kein Blocker, beide Assertions haengen am selben Wiring-Erfolg und der Testname nennt kein "and"; sauberer waere ein zweiter benannter Test fuer den Mount-Beweis.
- **S4 (informativ):** keine.

**passNotes:** Byte-identische Mount-Reihenfolge und Semantik verifiziert (siehe oben). Keine verwaisten Imports. `createPortalRunner` bleibt korrekt als DIP-Seam injiziert. `stripeBilling` bleibt EINE Modul-Singleton-Instanz. `node --check` sauber. Volle Testsuite 2295/2295, keine Flakes. Kommentare konsistent Deutsch ohne Umlaute.

**topTodos:**
1. Kein Handlungsbedarf fuer P13 selbst (PASS ohne Blocker).
2. Optional/spaeter: `wireWebLogin` bei naechster Beruehrung in 2-3 benannte Helfer zerlegen, um den 100-Zeilen-Richtwert einzuhalten (kein Muss, da reine Verschiebung).
3. Optional: den kombinierten Boot-Marker+Mount-Beweis-Test in `web-login-wiring.test.js` in zwei separate Tests aufteilen (P14-Reinheit).

---

## 5. Fix-Runden

Keine — es gab keine Blocker (S1/S2 leer), daher keine Fix-Runde noetig. Phase in einem Durchgang PASS.
