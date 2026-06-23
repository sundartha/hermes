// PER-RUN Skript fuer P6b1 (Rest-P6 Sub-Scheibe 1). Phase HART gepinnt (args erreichen
// das Skript NICHT -> NIE ueber {name,args} aufrufen; nur ueber scriptPath, KEIN resume).
// Siehe Memory [[phase-impl-workflow-args]]. Body identisch zum kanonischen
// .claude/workflows/phase-impl.js; nur das A-Objekt + STATUS-Kommentar sind P6b1.

export const meta = {
  name: "phase-impl-p6b1",
  description:
    "P6b1 umsetzen: capturing-State + Billing-Port + Stripe Hold/Capture (synchron). Plan -> Implementieren (Worktree) -> dualer Review (Safety + Clean-Code). S1/S2 = Blocker.",
  phases: [
    {
      title: "Plan",
      detail: "Regelkonformer Umsetzungsplan (liest clean-code.md + Plan-Doku + echten Code)",
    },
    {
      title: "Implementieren",
      detail: "Umsetzung im Worktree, clean-code-konform, npm test gruen",
    },
    {
      title: "Review",
      detail: "Safety/Verhalten-Reviewer + dedizierter Clean-Code-Auditor (parallel)",
    },
  ],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// STATUS: Onboarding-Scheibe + P6a + P7 + P8a + P8b + Identitaets-Schicht I0-I9 GEMERGT
// (master=origin/master=8a8bceb, 2026-06-16, 361/361 selbst verifiziert; NICHT upstream/live).
// Rest-P6 (Stripe/Payment/Worker/KYC) ist die diese-Session gewaehlte Arbeit, gesplittet in
// P6b1-P6b4 (wie P3->P3a/b/c). DIES ist P6b1 (Money-Safety-Kern, synchron). NICHT pushen,
// NICHT mergen (Owner merged koordiniert). Plan-Doc-Umbrella: "**P6 — Onboarding + Stripe
// Hold/Capture + Provisioning-Worker**". Owner-Entscheidungen diese Session fixiert (s. extraNotes).
const A =
  typeof args === "object" && args
    ? args
    : {
        phaseId: "P6b1",
        phaseTitle:
          "capturing-State + Billing-Port + Stripe Hold/Capture (synchron, hinter PAYMENT_ENABLED, fail-closed)",
        branch: "phase/p6b1-capturing-billing",
        baseBranch: "master",
        planDoc: "PLAN-MULTI-TENANT-TELNYX.md",
        extraNotes: `WICHTIG ZUR PHASE: P6b1 ist die erste Sub-Scheibe von P6 (Split wie P3->P3a/b/c). Der Plan-Doc-Abschnitt "**P6 — Onboarding + Stripe Hold/Capture + Provisioning-Worker**" ist die UMBRELLA; der Onboarding-Teil (POST /api/onboard, Number-Lifecycle requested->provisioning->active, synchrone Orchestrierung, Caps, PROVISIONING_ENABLED-Dry-Run) ist BEREITS GEMERGT. Die AUTORITATIVE Scope-Definition fuer P6b1 ist DIESER ZUSATZ-HINWEIS (nicht der Doc-Abschnitt, der den ganzen P6 beschreibt). Base ist master @8a8bceb.

P6b1 = der Money-Safety-Kern "provision-after-payment", SYNCHRON: ein Billing-Port (Hold/Capture/Cancel) + ein echter Stripe-Adapter (fetch+Bearer, KEIN SDK) + ein neuer Number-State 'capturing'. Alles hinter dem fail-closed Master-Flag PAYMENT_ENABLED (Default AUS) -> solange aus, ist das beobachtbare Verhalten BYTE-IDENTISCH zum Bestand (kein Hold, keine capturing-Transition, requested->provisioning->active wie heute). KEIN echtes Geld, kein Live-Stripe-Call in den Tests (alles ueber einen Fake-Billing-Adapter im test/helpers.js).

GESPERRTE OWNER-ENTSCHEIDUNGEN (diese Session, verbindlich):
- Stripe-Adapter via fetch+Bearer wie src/telephony/adapters/telnyx/numbers.js -> KEIN neuer Dependency (kein 'stripe'-npm-Paket, kein pg-boss). package.json bleibt 0 Diff.
- Fake-Billing-Adapter lebt in test/helpers.js (wie fakeProvisioner), NICHT in src/.
- PAYMENT_ENABLED Default AUS = byte-identisch (wie MULTI_TENANT/SELF_SERVICE_ENABLED/PROVISIONING_ENABLED).
- Owner hat (noch) KEINE Stripe-Test-Keys -> der echte Live-Test-Mode-Smoke (Hold->Capture->Release) ist ein GEPARKTER Owner-Schritt (NICHT in dieser Phase verifizierbar; analog dem geparkten Telnyx-Live-Smoke). Der Stripe-Adapter wird trotzdem korrekt-geformt mitgebaut (drop-in), live UNBESTAETIGT (im Adapter-Kommentar so markieren, wie der Telnyx-Adapter es tut).

ABGRENZUNG (was P6b1 IST und was NICHT):
- P6b1 IST: NUMBER_STATUS.CAPTURING + Transition-Edges; Billing-Port (placeHold/captureHold/cancelHold) + Stripe-Adapter + Fake; number.payment_intent_id (additiv); die SYNCHRONE Orchestrierung in src/onboarding.js erweitert um Hold-vor-Provisioning und Capture-vor-Aktivierung inkl. Rollback (cancelHold/releaseNumber); PAYMENT_ENABLED + Stripe-Config; die Onboard-Route waehlt den Billing-Client nur bei PAYMENT_ENABLED.
- P6b1 IST NICHT: async Worker / Queue-Port / provisioning_job (das ist P6b2 - die Orchestrierung bleibt SYNCHRON im HTTP-Handler wie heute). KEIN tenant_budget / usage_event / Stripe-Meter / Flush (P6b3). KEIN kyc_level / KYC-Gate (P6b4). KEINE Aenderung an den Safety-Gates (numberGateError), der Disclosure, der Auth, den Telephony-Adaptern, bridge.js, claude.js, mcp-tools.js. KEINE registry fuer Billing (ein einziger Provider -> direkter Adapter-Import + Injection; eine Registry waere spekulative Generalitaet, nur mit Begruendung).

KONTEXT (Ist-Stand SELBST am echten Code auf master @8a8bceb verifiziert - SELBST greppen, KEINE Zeilennummern uebernehmen, sie rotten):
- src/store/defaults.js: NUMBER_STATUS = {REQUESTED,PROVISIONING,ACTIVE,FAILED,SUSPENDED,RELEASED}. NUMBER_TRANSITIONS = {requested:[provisioning,failed], provisioning:[active,failed], active:[suspended,released], suspended:[active,released], failed:[released], released:[]}. PROVIDER-Enum (twilio/telnyx) + DEFAULT_PROVIDER + OWNER_TENANT_ID liegen hier.
- src/store/state-ops.js: requestNumber(s,{tenantId,provider,maxNumbers,maxNumbersPerTenant}) legt {id,e164:null,tenantId,provider,status:REQUESTED,providerNumberId:null} an (Caps + tenant.status-Check). canTransitionNumber(from,to)=NUMBER_TRANSITIONS[from].includes(to). transitionNumber(s,numberId,toStatus) wirft fail-closed bei illegalem Uebergang, sonst number.status=toStatus. beginProvisioning(s,numberId)=transitionNumber(...,PROVISIONING). activateNumber(s,numberId,{e164,providerNumberId})=transitionNumber(...,ACTIVE)+setzt e164/providerNumberId+legt numberAssignments-Zeile an (assignedAt). failNumber(s,numberId)=transitionNumber(...,FAILED). releaseNumber(s,numberId)=transitionNumber(...,RELEASED)+schliesst assignment (releasedAt). findNumber(s,id).
- src/onboarding.js: provisionNumber(s, provisioner, {numberId,countryCode,connectionId,type}) orchestriert SYNCHRON: beginProvisioning -> provisioner.searchNumbers -> provisioner.orderNumber({e164,idempotencyKey:'order_'+numberId}) (Fehler -> failNumber + throw, KEIN Release) -> provisioner.configureNumber({providerNumberId,connectionId}) (Fehler -> failNumber + provisioner.releaseNumber + releaseNumber(state) bei sauberem Release, sonst bleibt 'failed') -> activateNumber. KEIN store.save() hier (Route persistiert). KEIN config-Zugriff (alles hereingereicht).
- src/server.js POST /api/onboard (ca. ab "// ---- Onboarding"): registerTenant -> requestNumber(PROVIDER.TELNYX, Caps) -> bei !ok ONBOARD_REASON_STATUS-Mapping (403/409/429) -> store.save() ('requested' auch im Dry-Run) -> Dry-Run-Return wenn !config.provisioningEnabled (status 'requested', provisioning:'disabled') -> sonst provisionNumber(s, numberProvisioning(PROVIDER.TELNYX), {numberId,countryCode:config.provisioningCountry,connectionId:config.telnyxConnectionId}) im try/catch (catch -> 502 + store.save()). Imports oben: numberProvisioning aus ./telephony/registry.js, provisionNumber aus ./onboarding.js, PROVIDER/OWNER_TENANT_ID/NUMBER_STATUS aus ./store/defaults.js. Route hinter Basic-Auth (Bestand deckt /api/* ab), KEIN MCP-Tool (bewusst, R4).
- src/telephony/registry.js numberProvisioning(provider=TELNYX) -> wirft fail-closed bei nicht-unterstuetztem Provider. Adapter src/telephony/adapters/telnyx/numbers.js: fetch+Bearer (authHeaders wirft wenn TELNYX_API_KEY fehlt), assertOk(res,op) wirft "... HTTP <status>" OHNE Key-Leak, Idempotency-Key-Header bei orderNumber. DAS ist das exakte Vorbild fuer den Stripe-Adapter.
- src/store/pg.js: flushNumbers(client,tenantId,numbers) UPSERTet (id,tenant_id,e164,provider,status,provider_number_id) + deleteMissing; hydrate liest dieselben Spalten in state.numbers (rowToNumber-aequivalent). src/db/schema.sql: number-Tabelle (id,tenant_id FK,e164 UNIQUE nullable,provider,status default 'active',provider_number_id,created_at) + RLS-Policy tenant_isolation. migrate.js applySchema(db) wendet schema.sql idempotent an (CREATE/ALTER IF NOT EXISTS).
- src/store/json.js: persistiert s.numbers als Ganzes (whole-object save) -> ein additives Feld auf dem number-Objekt reist automatisch mit (KEIN json.js-Diff noetig).
- src/config.js: fail-closed Flags-Muster (provisioningEnabled/multiTenant/selfServiceEnabled = (env||'false')==='true'). telnyxApiBase = (env||default).replace(/\\/$/,''). assertConfig() sammelt fehlende Pflicht-Vars. test/helpers.js BASE_ENV spiegelt JEDE config-Var mit neutralem fail-closed Default (Lehre test-base-env-drift: neue config-Var OHNE BASE_ENV-Nachzug -> lokales .env leakt via dotenv in Spawn-Tests -> Baseline lokal rot).

ZIEL-DESIGN (am Ist-Code verankert; finale Mechanik darf der Plan-Agent code-gegroundet schaerfen, Umfang/Invarianten/Entscheidungen bleiben):
- defaults.js: NUMBER_STATUS.CAPTURING="capturing". NUMBER_TRANSITIONS: provisioning:[capturing,active,failed] (ACTIVE BLEIBT drin -> payment-off byte-identisch), capturing:[active,failed]. Alle anderen Edges UNVERAENDERT.
- state-ops.js: requestNumber legt zusaetzlich paymentIntentId:null an. beginProvisioning(s,numberId,paymentIntentId=null) -> transition + (falls paymentIntentId) number.paymentIntentId setzen (optionaler 3. Param, payment-off ruft 2-arg = unveraendert). NEU beginCapturing(s,numberId)=transitionNumber(...,CAPTURING) (duenn, analog beginProvisioning). activateNumber UNVERAENDERT (transition->active jetzt legal aus provisioning UND capturing; canTransitionNumber gated es). KEIN finalizeCapture noetig (activateNumber deckt den Schritt capturing->active ab; Nebeneffekt/Name pruefen).
- src/billing/ports.js: JSDoc-Vertrag BillingPort: placeHold({tenantRef,amountCents,currency,idempotencyKey})->Promise<{paymentIntentId}>; captureHold(paymentIntentId,amountCents)->Promise<void>; cancelHold(paymentIntentId)->Promise<void>. NUR Domaenensprache (kein Stripe-Objekt nach aussen).
- src/billing/stripe.js: echter Adapter (export const stripeBilling), fetch+Bearer gegen config.stripeApiBase (https://api.stripe.com), Form-Encoding (application/x-www-form-urlencoded via URLSearchParams), Idempotency-Key-Header. authHeaders wirft wenn config.stripeSecretKey fehlt; assertOk wirft "Stripe <op> fehlgeschlagen: HTTP <status>" OHNE Key-Leak. Endpunkte (live UNBESTAETIGT, im Kommentar markieren): placeHold=POST /v1/payment_intents {amount,currency,capture_method:'manual',confirm:true,...} -> {paymentIntentId:json.id}; captureHold=POST /v1/payment_intents/{id}/capture {amount_to_capture}; cancelHold=POST /v1/payment_intents/{id}/cancel.
- onboarding.js: SIGNATUR auf provisionNumber(s, deps, opts) heben, deps={provisioner, billing} (billing optional/null). Grund: F1 (<=3 Args) + billing ist eine Dependency, kein Datum -> deps-Objekt statt 4. Param. Ablauf: number=findNumber. Wenn deps.billing: hold=await billing.placeHold({tenantRef:number.tenantId, amountCents:opts.holdAmountCents, currency:opts.currency, idempotencyKey:'hold_'+numberId}); beginProvisioning(s,numberId,hold.paymentIntentId). Sonst beginProvisioning(s,numberId). Dann search/order (Fehler -> failNumber + (billing? cancelHold(paymentIntentId)) + throw). Dann configure (Fehler -> failNumber + provisioner.releaseNumber + releaseNumber(state) + (billing? cancelHold) + throw). Dann, wenn billing: beginCapturing(s,numberId); await billing.captureHold(paymentIntentId, opts.holdAmountCents) (Fehler -> failNumber + provisioner.releaseNumber + releaseNumber(state) + cancelHold + throw). Dann activateNumber(s,numberId,{e164:ordered.e164,providerNumberId:ordered.providerNumberId}). HOLD-Fehler (vor beginProvisioning, number noch 'requested'): failNumber(s,numberId) (requested->failed) + throw, KEIN Provider-Call, KEIN cancelHold (nichts gehalten). Den paymentIntentId fuer die Rollbacks aus number.paymentIntentId bzw. der hold-Variable ziehen.
- server.js Onboard-Route: payment-off (config.paymentEnabled false) -> provisionNumber(s, {provisioner: numberProvisioning(PROVIDER.TELNYX)}, opts) mit denselben opts wie heute -> BYTE-IDENTISCH. payment-on (config.paymentEnabled true, nur sinnvoll innerhalb des provisioningEnabled-Zweigs) -> deps={provisioner: numberProvisioning(PROVIDER.TELNYX), billing: stripeBilling}, opts zusaetzlich {holdAmountCents:config.numberSetupFeeCents, currency:config.paymentCurrency}. Audit-Eintraege fuer hold/capture sinnvoll ergaenzen (KEIN Secret/PI-Leak ueber das Noetige hinaus). PAYMENT_ENABLED greift NUR im provisioningEnabled-Zweig (ohne echten Kauf kein Capture).
- config.js: paymentEnabled=(env.PAYMENT_ENABLED||'false')==='true'; stripeSecretKey=env.STRIPE_SECRET_KEY||'' (SECRET, nie loggen); stripeApiBase=(env.STRIPE_API_BASE||'https://api.stripe.com').replace(trailing-slash); numberSetupFeeCents=parseInt(env.NUMBER_SETUP_FEE_CENTS||'0',10); paymentCurrency=(env.PAYMENT_CURRENCY||'eur').toLowerCase(). assertConfig(): wenn paymentEnabled && !stripeSecretKey -> missing STRIPE_SECRET_KEY; wenn paymentEnabled && numberSetupFeeCents<=0 -> missing NUMBER_SETUP_FEE_CENTS (kein Magic-Default); optional Warnung wenn paymentEnabled && !provisioningEnabled (Payment ohne Provisioning = wirkungslos).
- .env.example: neuer Block "# ---- Payment/Billing (Stripe Hold/Capture, P6b1) ----" mit PAYMENT_ENABLED=false, STRIPE_SECRET_KEY= (SECRET), STRIPE_API_BASE=https://api.stripe.com, NUMBER_SETUP_FEE_CENTS=0, PAYMENT_CURRENCY=eur (jeweils mit deutscher Erklaerung ohne Umlaute).
- render.yaml: dieselben Keys ergaenzen (PAYMENT_ENABLED value "false"; STRIPE_SECRET_KEY sync:false; STRIPE_API_BASE value; NUMBER_SETUP_FEE_CENTS value "0"; PAYMENT_CURRENCY value "eur").
- src/db/schema.sql: ALTER TABLE number ADD COLUMN IF NOT EXISTS payment_intent_id TEXT; (idempotent, additiv NULLABLE). src/store/pg.js: payment_intent_id in flushNumbers-UPSERT (INSERT-Spalten + ON CONFLICT SET) und in den hydrate-SELECT + die Zeilen-Map (paymentIntentId: r.payment_intent_id ?? null). migrate.js 0 Diff (schema.sql traegt den ALTER). json.js 0 Diff (whole-object save).
- test/helpers.js: NEU fakeBilling(overrides) analog fakeProvisioner: {log:[], placeHold(args){log.push(['placeHold',args]); return {paymentIntentId:'pi_fake_1'}}, captureHold(id,amt){log.push(['captureHold',id,amt])}, cancelHold(id){log.push(['cancelHold',id])}} mit per-Override-werfbaren Methoden. BASE_ENV um PAYMENT_ENABLED:"false", STRIPE_SECRET_KEY:"", STRIPE_API_BASE:"", NUMBER_SETUP_FEE_CENTS:"0", PAYMENT_CURRENCY:"eur" ergaenzen (PFLICHT - test-base-env-drift).

EXPLIZIT NICHT (kein Vorgriff/BDUF):
- KEIN Queue-Port/Worker/provisioning_job (P6b2). KEIN tenant_budget/usage_event/Meter/Flush (P6b3). KEIN kyc_level/KYC-Gate (P6b4).
- KEIN neuer npm-Dependency (kein 'stripe', kein 'pg-boss'). package.json 0 Diff.
- KEINE Billing-Registry (ein Provider). KEINE Aenderung an numberGateError/Allowlist/Budget/Max-Dauer, Disclosure, Auth, bridge.js, claude.js, mcp-tools.js, json.js, migrate.js, den Telephony-Adaptern.
- KEIN store.save() in onboarding.js (Route persistiert, wie heute). KEIN config-Zugriff in onboarding.js (alles hereingereicht - testbar).

ABSOLUTE REGELN / SICHERHEITS-INVARIANTEN DIESER SCHEIBE (als Test festnageln):
- PAYMENT-OFF BYTE-IDENTISCH: mit PAYMENT_ENABLED aus (Default) ist das beobachtbare Verhalten identisch zum Bestand - selbe Dry-Run-/Provisioning-/Fail-Antworten, selbe Number-Zustaende (requested->provisioning->active, KEIN capturing), kein Hold/Capture-Call. Die Bestandssuite belegt das (onboarding-route/onboarding-service unveraendert in der Aussage).
- HOLD-VOR-ORDER (R4/Money-Safety): mit billing wird placeHold VOR jedem provisioner.searchNumbers/orderNumber aufgerufen. Test: placeHold im Fake-Log VOR order; und placeHold wirft -> provisioner-Log LEER (kein Provider-Call), Number 'failed'.
- KEIN ACTIVE OHNE CAPTURE: mit billing wird activateNumber NUR nach erfolgreichem captureHold erreicht. Test: fakeBilling.captureHold wirft -> Number endet 'failed', provisioner.releaseNumber + billing.cancelHold gerufen, NIE 'active'.
- ROLLBACK-MATRIX: order/search-Fehler -> failed + cancelHold (kein releaseNumber, nichts gekauft). configure-Fehler -> failed + releaseNumber + cancelHold. capture-Fehler -> failed + releaseNumber + cancelHold. hold-Fehler -> failed, kein Provider-Call, kein cancelHold. Jede Kante ein Test (Fake wirft gezielt).
- IDEMPOTENZ: hold-idempotencyKey='hold_'+numberId, order-idempotencyKey='order_'+numberId (Bestand). Test: die Keys landen so im Fake-Log.
- MAP/STATE: number.payment_intent_id round-trippt durch pg flush/hydrate (pglite) und reist durch json (whole-object). KEIN undefined-Drift.
- DISCLOSURE/Safety-Gates/Auth/Secrets UNVERAENDERT. Stripe-Secret NIE in Response/Log/Fehlermeldung (assertOk ohne Key). Audio nie durch MCP.

CODE-GEGROUNDETE LANDMINES (SELBST greppen auf BASE master @8a8bceb - KEINE Zeilennummern):
- F1-Falle: provisionNumber bekommt eine NEUE Dependency (billing). NICHT als 4. Positional-Arg (F1 <=3) - deps-Objekt {provisioner,billing}. ALLE Caller (Onboard-Route + onboarding-service.test.js) mitziehen, sonst undefined.provisioner -> Crash.
- payment-off-Pfad MUSS deps.billing weglassen/null lassen, sonst laeuft Hold/Capture trotz Flag aus = Geld-Pfad ungewollt aktiv. Der Guard ist "if (deps.billing)", NICHT config in onboarding.js (config bleibt draussen).
- BASE_ENV-Nachzug fuer ALLE neuen config-Vars (PAYMENT_ENABLED/STRIPE_SECRET_KEY/STRIPE_API_BASE/NUMBER_SETUP_FEE_CENTS/PAYMENT_CURRENCY) - sonst leakt lokales .env in Spawn-Tests und die Baseline ist lokal rot/CI gruen (Lehre test-base-env-drift). Neutral + fail-closed (PAYMENT_ENABLED false, Key leer, Fee 0).
- pg.js: payment_intent_id in BEIDE Richtungen (flush UPSERT + hydrate SELECT/Map). Vergessenes Feld im SELECT -> paymentIntentId undefined nach Re-Hydrierung -> stiller Drift. ?? null beim Mappen.
- Stripe-Adapter: Form-Encoding (NICHT JSON) - Stripe /v1 erwartet application/x-www-form-urlencoded. assertOk darf den Bearer-Key NIE in die Fehlermeldung ziehen.
- canTransitionNumber: provisioning->active MUSS legal bleiben (payment-off), sonst bricht der Bestand. NUR additiv capturing einfuegen.

JUSTIERTE BESTANDSTESTS (bewusster Signatur-Wechsel -> Aenderung ERLAUBT, minimal + in deviations begruendet; SELBST am Code verifizieren, Liste ist Befund nicht Dogma):
- test/onboarding-service.test.js: provisionNumber(s, fakeProvisioner, opts) -> provisionNumber(s, {provisioner: fakeProvisioner}, opts). Assertions (Zustaende/Release-Verhalten) bleiben unveraendert (payment-off byte-identisch, billing weggelassen).
- test/number-lifecycle.test.js: canTransitionNumber-Matrix um capturing-Edges ergaenzen (provisioning->capturing, capturing->active, capturing->failed legal; capturing->suspended/released illegal). beginProvisioning bleibt aufrufkompatibel (2-arg). KEINE Aussage-Aenderung an den Bestands-Faellen ausser der Matrix.
- test/onboarding-route.test.js: payment-off (BASE_ENV PAYMENT_ENABLED=false) UNVERAENDERT gruen. KEINE payment-on-Route-Pflicht hier (Route-on braeuchte einen Stripe-Mock; die Geld-Invarianten sind am onboarding.js-Unit-Level abgedeckt). Optional, NUR wenn billig: startStripeMock() in helpers + ein payment-on-Route-Happy-Path; sonst dokumentieren, dass Route-on ueber den Unit-Level + geparkten Live-Smoke abgesichert ist.
- test/store-pg.test.js: payment_intent_id-Roundtrip (Number mit paymentIntentId setzen, save, reopen, assert) ergaenzen; bestehende number-Faelle bleiben.

TESTS (PFLICHT, F.I.R.S.T., offline, KEIN Netz, KEIN echtes Stripe):
- NEU test/billing-hold-capture.test.js (reine Unit: src/onboarding.js provisionNumber + fakeProvisioner + fakeBilling, makeDefaultState + ein 'requested'-Number-Seed; KEIN Spawn, KEINE pglite): die komplette Rollback-Matrix + Hold-vor-Order + kein-active-ohne-capture + Idempotenz-Keys + Happy-Path (hold->order->configure->capturing->capture->active, alle Fake-Logs in Reihenfolge). Plus die capturing-State-Maschine (canTransitionNumber/beginCapturing legal+illegal) falls nicht in number-lifecycle.
- Bestandssuite: 361 bleiben gruen, BEIDE Backends; jede Anpassung begruenden. Gesamt = 361 + neue Tests (- ggf. nichts geloescht).

DETERMINISTISCHER CHECK (Gate, DREIFACH):
(a) node --check auf jede neue/geaenderte .js (defaults.js, state-ops.js, onboarding.js, server.js, config.js, pg.js, src/billing/ports.js, src/billing/stripe.js, neue/justierte Testdateien, test/helpers.js).
(b) npm test BEIDE Backends (json-Default + pglite-in-process) gruen, 0 fail; SELBST zaehlen (Reviewer-/Auditor-Counts NIE blind glauben).
(c) Dreifach: Bestandssuite byte-identisch gruen (payment-off) + Rollback-Matrix/Invarianten-Test (Fake wirft gezielt) + pg payment_intent_id-Roundtrip.
(d) Dichtheit: git diff master HEAD zeigt 0 Verhaltens-Diff in bridge.js, claude.js, mcp-tools.js, auth.js, json.js, migrate.js, den Safety-Gate-/Auth-Pfaden, den Telephony-Adaptern, der Disclosure; package.json 0 Diff (kein neuer Dep); geaendert NUR: defaults.js (capturing + Edges), state-ops.js (paymentIntentId in requestNumber + beginProvisioning-3.Param + beginCapturing), onboarding.js (deps-Signatur + Hold/Capture/Rollback), server.js (NUR Onboard-Route payment-Zweig + stripeBilling-Import), config.js (5 neue Vars + assertConfig), .env.example + render.yaml (5 Keys), schema.sql (1 ALTER) + pg.js (payment_intent_id), src/billing/* (neu), test/* (neu + justiert).

COMMIT: git add EXPLIZIT src/ test/ + die geaenderten config/doc-Dateien (config.js .env.example render.yaml src/db/schema.sql). KEINE neuen Dependencies (package.json/package-lock NICHT aendern). node_modules-Symlink NICHT committen (git rm --cached node_modules falls gestaged). Commit-Msg: feat(p6b1): capturing-State + Billing-Port + Stripe Hold/Capture (synchron, hinter PAYMENT_ENABLED; payment-off byte-identisch, kein neuer Dep).`,
      };
const PHASE = A.phaseId || "P?";
const PHASE_TITLE = A.phaseTitle || "";
const BRANCH = A.branch || `phase/${String(PHASE).toLowerCase()}-impl`;
const BASE = A.baseBranch || "master";
const EXTRA = A.extraNotes ? `\nZUSATZ-HINWEISE DES AUFTRAGGEBERS:\n${A.extraNotes}\n` : "";
const PLAN_DOC = A.planDoc || "PLAN-MULTI-TENANT-TELNYX.md";

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT, kein Optional): Lies "${REPO}/.claude/refs/clean-code.md" - das ist der verbindliche Prueftkatalog dieses Repos - und befolge ihn bei JEDER Code-Entscheidung. Insbesondere:
- Keine Duplizierung (G5/S2) - gemeinsame Logik extrahieren.
- Keine Magic Numbers ausser 0/1/-1 (G25) - benannte Konstante, in config.js wenn konfigurierbar (G35).
- Kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports/Variablen (G12).
- Aussagekraeftige, intentions-ausdrueckende Namen (N-Serie); Nebeneffekte im Namen sichtbar (N7).
- Eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34); <=3 Argumente (F1).
- Konstruktion von Fachlogik trennen, Lazy-Init-Antipattern vermeiden (P15).
- Kommentare: kein brittle Datei:Zeile-Verweis (rottet -> C2), nichts Redundantes (C3).
- Konventionen des Bestands einhalten (G24/G11): ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae).
- Neues Verhalten braucht einen automatisierten Test (P11/T-Serie); bei reinem Refactor muss die bestehende Suite OHNE Test-Aenderung gruen bleiben.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (numberGateError: Denylist/Allowlist/Land/Stundenlimit/Budget/Max-Dauer) NIE entfernen/aufweichen/per-Default umgehen. Neue Endpunkte, die Calls/SMS ausloesen, brauchen dieselben Gates.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet, unveraendert.
- Auth fail-closed: Twilio-Signaturpruefung (/voice), Basic-Auth (Dashboard/API), MCP-Auth - timing-sichere Vergleiche (safeEqual). Neue Endpunkte standardmaessig hinter Auth.
- Secrets nur via env, nie loggen/in Responses oder MCP-Ausgaben leaken. Audio nie durch MCP.
- SCOPE: NUR diese Phase. Keine ungefragten Extras.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten und CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.

1. Lies "${REPO}/${PLAN_DOC}" und den UMBRELLA-Abschnitt "**P6 — Onboarding + Stripe Hold/Capture + Provisioning-Worker**" als Kontext. Die AUTORITATIVE Scope-/Design-Definition fuer ${PHASE} sind die ZUSATZ-HINWEISE unten (P6b1 ist eine Sub-Scheibe von P6).
2. Lies "${REPO}/.claude/refs/clean-code.md" (Prueftkatalog) - dein Plan muss regelkonform sein.
3. Lies den ECHTEN Code auf Basis-Branch "${BASE}": fuer Dateien nutze den Arbeitsbaum bzw. \`git show ${BASE}:<pfad>\`. Grep gezielt nach den relevanten Symbolen/Call-Sites (onboard-Route, provisionNumber, NUMBER_STATUS/NUMBER_TRANSITIONS, requestNumber/beginProvisioning/activateNumber/failNumber/releaseNumber, flushNumbers/hydrate, telnyx numbers-Adapter, config-Flags, test/helpers.js BASE_ENV+fakeProvisioner).

${CLEAN_CODE_REQ}
${ABS_RULES}${EXTRA}

LIEFERE: (1) exakte Liste neuer Dateien inkl. Funktionssignaturen + Inhalts-Skizze; (2) pro bestehender Datei die exakten Edits als Vorher/Nachher mit Datei:Zeile; (3) welche Tests neu/angepasst werden (oder Begruendung, warum die Bestandssuite reicht); (4) das deterministisch pruefbare Ergebnis dieser Phase als konkreten Check (Befehl + erwartete Ausgabe). Halte den Blast-Radius klein. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan" },
);

// ---------- Phase 2: Implementieren + Verifizieren (Worktree) ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    branch: { type: "string" },
    baseBranch: { type: "string" },
    filesCreated: { type: "array", items: { type: "string" } },
    filesEdited: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    smokePass: { type: "boolean" },
    smokeNote: { type: "string" },
    cleanCodeSelfCheck: { type: "string", description: "kurze Selbstpruefung gegen clean-code.md" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    diff: { type: "string", description: `voller git diff ${BASE} HEAD` },
    summary: { type: "string" },
  },
  required: [
    "branch",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "committed",
    "diff",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert vom Arbeitsstand des Nutzers - du fasst dessen Working-Tree NICHT an). Setze Phase ${PHASE} ${PHASE_TITLE} GENAU gemaess diesem Plan um:

=== PLAN ===
${plan || "(Plan fehlt - brich ab und melde es in deviations)"}
=== ENDE PLAN ===

VORGEHEN:
1. node_modules fehlt im Worktree. ZUERST symlinken: ln -s "${NODE_MODULES}" node_modules
2. Branch von der Basis anlegen: git checkout -b ${BRANCH} ${BASE}
3. Implementiere EXAKT gemaess Plan. ${CLEAN_CODE_REQ}
4. node --check auf JEDE neue/geaenderte .js-Datei.
5. npm test ausfuehren. Bestehende Tests duerfen nur dann angepasst werden, wenn die Phase bewusst Verhalten/Signatur aendert (im Plan begruendet); reiner Refactor -> Suite OHNE Test-Aenderung gruen. Neues Verhalten -> neuer Test im selben Lauf.
6. Smoke (best-effort): Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true + Dummy-Env starten, POST /api/onboard Dry-Run via curl pruefen (payment-off, Antwort wie Bestand), Server killen. Zu flaky -> smokePass=false + Grund, KEIN Blocker.
7. node_modules-Symlink NICHT committen (git rm --cached node_modules falls gestaged). Dann: git add src/ test/ config-Dateien && git commit -m "feat(${String(PHASE).toLowerCase()}): <kurze Beschreibung>". KEINE package.json/package-lock-Aenderung (kein neuer Dependency).
8. cleanCodeSelfCheck: pruefe deinen eigenen Diff kurz gegen clean-code.md (Duplizierung? Magic Numbers? Namen? tote Kommentare? F1<=3 Args?) und fasse zusammen.
9. Erfasse git diff ${BASE} HEAD vollstaendig im Feld diff.

${ABS_RULES}

Fuelle das Ergebnis EHRLICH. Wenn Tests nicht gruen werden oder du blockiert bist: testsPass=false + ehrliche deviations, nicht schoenen.`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
    isolation: "worktree",
  },
);

// ---------- Phase 3: Dualer Review (parallel) ----------
phase("Review");
const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string" },
    scopeRespected: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    authFailClosedIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    behaviorAsIntended: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "safetyGatesIntact",
    "disclosureIntact",
    "blockers",
    "verdict",
  ],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: {
      type: "array",
      items: { type: "string" },
      description: 'Tests/Sicherheit/Korrektheit - Format: "ID · Datei:Zeile · Verstoss · Fix"',
    },
    s2: { type: "array", items: { type: "string" }, description: "Duplizierung" },
    s3: {
      type: "array",
      items: { type: "string" },
      description: "Ausdrucksstaerke/Namen/Kommentare",
    },
    s4: { type: "array", items: { type: "string" }, description: "Struktur/Anzahl" },
    blocker: { type: "boolean", description: "true wenn s1 oder s2 nicht leer" },
    passNotes: { type: "string" },
    topTodos: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: ["s1", "s2", "s3", "s4", "blocker", "verdict"],
};

const reviews = await parallel([
  () =>
    agent(
      `Du bist ein STRENGER, adversarialer Safety-/Verhaltens-Reviewer in einem frischen Worktree. Pruefe Phase ${PHASE} auf Branch "${BRANCH}".
UNABHAENGIGE VERIFIKATION (selbst ausfuehren):
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()} ${BRANCH}
3. npm test selbst laufen lassen -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${BRANCH} lesen und gegen die absoluten Regeln pruefen.
PRUEFE: scopeRespected (nur ${PHASE}, keine Extras - KEIN Worker/Meter/KYC, kein neuer npm-Dep), safetyGatesIntact (numberGateError/Allowlist/Budget/Max-Dauer), disclosureIntact (claude.js+bridge.js), authFailClosedIntact (Signaturpruefung/Basic-Auth/MCP-Auth), noSecretsLeaked (Stripe-Key nie in Log/Response/Fehler), behaviorAsIntended (payment-off BYTE-IDENTISCH; payment-on Hold-vor-Order + kein-active-ohne-capture + Rollback wie im Plan).
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine eigenen Tests gruen. Sei skeptisch; im Zweifel blockieren. Rueckgabe IST das Urteil.`,
      {
        label: `${PHASE}-review-safety`,
        phase: "Review",
        schema: SAFETY_SCHEMA,
        isolation: "worktree",
      },
    ),
  () =>
    agent(
      `Du bist der CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${BRANCH}", Basis "${BASE}") streng gegen den Prueftkatalog.
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG - das ist deine Wissensbasis und definiert die Schweregrade S1-S4 und die Audit-Regeln (u.a.: nur gesehenen Code bewerten, nicht raten; [Prozess/Repo]-Eintraege nur bei direkter Evidenz).
2. Lies den geaenderten Code: git diff ${BASE} ${BRANCH} ; und die neuen Dateien per git show ${BRANCH}:<pfad>.
3. Gehe Kategorie fuer Kategorie, Eintrag fuer Eintrag durch. Pro FLAG: "ID · Datei:Zeile · was den Verstoss ausmacht · konkreter Fix". Ordne jedem FLAG den Schweregrad zu (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt. Achte besonders auf: F1 (<=3 Args bei provisionNumber/deps-Objekt), G5/S2 (Rollback-Logik nicht dupliziert), N7 (Nebeneffekte im Namen), C2 (keine Datei:Zeile-Kommentare).
Setze blocker=true, wenn s1 ODER s2 nicht leer ist (das verhindert den Merge). passNotes: was sauber ist. topTodos: die 1-3 wichtigsten. Rueckgabe IST der strukturierte Audit. Erfinde nichts (Audit-Regel 1).`,
      {
        label: `${PHASE}-review-cleancode`,
        phase: "Review",
        schema: CC_SCHEMA,
        isolation: "worktree",
      },
    ),
]);

const safetyReview = reviews[0];
const cleanCodeAudit = reviews[1];
const approved = !!(
  safetyReview &&
  safetyReview.approved &&
  cleanCodeAudit &&
  !cleanCodeAudit.blocker
);

return {
  phaseId: PHASE,
  branch: BRANCH,
  baseBranch: BASE,
  approved,
  gate: approved ? "PASS" : "BLOCKED (Safety nicht approved ODER Clean-Code S1/S2)",
  plan,
  impl,
  safetyReview,
  cleanCodeAudit,
};
