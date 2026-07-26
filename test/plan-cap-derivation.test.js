// LCT P6: Tenant-Decken aus dem Abo ableiten (billing/plan-caps.js + state-ops
// deriveTenantBudgetFromPlan, an der Schreibkante store.setTenantSubscription gehaengt).
// pglite (kein Netz, kein echter Server-Spawn, F.I.R.S.T.).
//
// MECHANIK GEGEN DIE MODUL-CONFIG-FALLE: config.js liest process.env EINMALIG beim
// Modul-Import (Modul-Singleton). Damit die Ableitung 900 (Business) UNCLAMPED sieht,
// braucht der Prozess platformSpendCapCents > 900 - deshalb MUESSEN MAX_BUDGET_EUR/
// VOICE_CAP_RATE_CENTS_PER_MIN VOR jedem Import (auch transitiv ueber store/pg.js,
// billing/*.js) gesetzt sein. Ein statischer Import wuerde per ESM-Hoisting VOR diesem
// Zeilenblock laufen - deshalb AUSSCHLIESSLICH dynamische Imports in before() (Muster
// assistant-context-persist-pg.test.js). `node --test` isoliert jede Datei in einem
// eigenen Prozess -> keine Cross-File-Leckage dieser process.env-Werte.
process.env.MAX_BUDGET_EUR = "30";
process.env.VOICE_CAP_RATE_CENTS_PER_MIN = "6";

import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let PGlite, makePgStore, config, ops, subscribeMod, webhookMod, activationMod, backfillMod, planCapsMod;
let USAGE_EVENT_KIND, KYC_LEVEL, CATALOG_SLUGS;

before(async () => {
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ config } = await import("../src/config.js"));
  ops = await import("../src/store/state-ops.js");
  subscribeMod = await import("../src/billing/subscribe.js");
  webhookMod = await import("../src/billing/webhook.js");
  activationMod = await import("../src/billing/activation.js");
  backfillMod = await import("../src/billing/backfill-profiles.js");
  planCapsMod = await import("../src/billing/plan-caps.js");
  ({ CATALOG_SLUGS } = await import("../src/plans.js")); // PAY-16: die Katalog-Slug-Quelle
  ({ USAGE_EVENT_KIND, KYC_LEVEL } = await import("../src/store/defaults.js"));
  // createTenantSubscription/priceIdForPlan brauchen konfigurierte Price-Ids (sonst
  // plan_unconfigured). Direkte Namespace-Zuweisung (Getter+Setter auf denselben
  // rawConfig-Slot, s. config.js) statt Env - diese Datei besitzt bereits die
  // Punkt-0-Env-Zeilen oben, ein drittes process.env-Paar waere Rauschen.
  config.billing.stripeStarterPriceId = "price_starter_test";
  config.billing.stripeBusinessPriceId = "price_business_test";
});

async function makeTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

function registerCardedTenant(store, tenantId) {
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Test" });
  store.setTenantStripe(tenantId, { customerId: `cus_${tenantId}`, paymentMethodId: `pm_${tenantId}` });
}

function fakeSubscribeBilling(overrides = {}) {
  return {
    createSubscription: async () => ({
      subscriptionId: `sub_${Math.random().toString(36).slice(2)}`,
      currentPeriodEnd: 1893456000,
      currentPeriodStart: 1890864000,
    }),
    ...overrides,
  };
}

function noopAccounts() {
  return { setStatus: async () => {} };
}
// GAP-04: activatePaidTenant aktiviert nur bei GEKLAERTEM Provisioning-Ergebnis
// (provisionCleared) - der Noop muss also einen freigebenden Grund liefern, sonst
// bliebe jeder Aufrufer hier faelschlich im GAP-04-Wartezustand haengen.
function noopProvision() {
  return async () => ({ ok: true, reason: "queued" });
}

// ---- (a) Happy-Pfad + Formel direkt gepinnt --------------------------------------

test("(a) planCapCents direkt: starter=300, business=900 (Bruch, keine Rundung)", () => {
  assert.equal(planCapsMod.planCapCents("starter", { voiceCapRateCentsPerMin: 6 }), 300);
  assert.equal(planCapsMod.planCapCents("business", { voiceCapRateCentsPerMin: 6 }), 900);
});

test("(a) createTenantSubscription(business) -> abgeleitete Decke 900 ct", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_a_biz";
  registerCardedTenant(store, tenantId);
  const r = await subscribeMod.createTenantSubscription({
    store, billing: fakeSubscribeBilling(), config, tenant: tenantId, planSlug: "business",
  });
  assert.equal(r.ok, true);
  assert.equal(store.tenantBudgetSnapshot(tenantId, config.billing).capCents, 900);
});

test("(a) createTenantSubscription(starter) -> abgeleitete Decke 300 ct", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_a_starter";
  registerCardedTenant(store, tenantId);
  const r = await subscribeMod.createTenantSubscription({
    store, billing: fakeSubscribeBilling(), config, tenant: tenantId, planSlug: "starter",
  });
  assert.equal(r.ok, true);
  assert.equal(store.tenantBudgetSnapshot(tenantId, config.billing).capCents, 300);
});

// ---- PAY-15/16: fail-closed bei fehlender Kopffreiheit ---------------------------
// (a) oben pinnt die WERTE der zwei heutigen Slugs. Hier steht die andere Haelfte: was
// passiert mit einem Slug, den die Kopffreiheit-Tabelle nicht kennt. Beide Faelle teilen
// sich EINEN Wurf (`!plan || !headroom`) und sind trotzdem zwei Tests (ein Konzept je
// Test, P14): PAY-15 ist der unbekannte Slug (keine Katalog-Zeile), PAY-16 die
// OCP-Frage - ein KUENFTIGER Katalog-Slug ohne Kopffreiheit-Eintrag.
//
// Die Basissatz-Fixtur spiegelt die VOICE_CAP_RATE_CENTS_PER_MIN-Zeile am Dateikopf
// (Punkt 0): dieselbe Zahl, damit die abgeleiteten Decken hier und in der Ableitung
// darunter dieselben sind.
const PLAN_CAP_CFG = Object.freeze({ voiceCapRateCentsPerMin: 6 });
const UNKNOWN_PLAN_SLUG = "enterprise_us"; // weder im Katalog noch in der Kopffreiheit-Tabelle

test("PAY-15: planCapCents wirft fail-closed bei unbekanntem Plan-Slug (kein stiller Default)", () => {
  assert.throws(
    () => planCapsMod.planCapCents(UNKNOWN_PLAN_SLUG, PLAN_CAP_CFG),
    new RegExp(`planCapCents: unbekannter Plan-Slug '${UNKNOWN_PLAN_SLUG}'`),
    "ein unbekannter Slug darf NIE einen Zahlenwert liefern - das waere eine erfundene Decke",
  );
});

test("PAY-16: JEDER Katalog-Slug hat eine Kopffreiheit (ein neuer Plan ohne Eintrag blockiert sofort)", () => {
  for (const slug of CATALOG_SLUGS) {
    const cap = planCapsMod.planCapCents(slug, PLAN_CAP_CFG);
    assert.ok(Number.isInteger(cap) && cap > 0, `${slug}: keine ganzzahlige, positive Decke`);
  }
  // Der Waechter-Anteil: dieselbe Klausel greift fuer einen Slug OHNE Eintrag. Waere sie
  // fail-open, kaeme hier eine Zahl statt eines Wurfs - und ein neu eingefuehrter Plan
  // bekaeme lautlos eine falsche Decke statt eines lauten Boot-Abbruchs (erste Linie:
  // planCapInertFindings, gepinnt in test/env-docs-spend-cap-coherence.test.js).
  assert.throws(
    () => planCapsMod.planCapCents("starter_us", PLAN_CAP_CFG),
    /kein Katalog-\/Kopffreiheit-Eintrag/,
    "ein kuenftiger Katalog-Slug ohne Kopffreiheit-Eintrag muss werfen, nie rechnen",
  );
});

// ---- (b) Downgrade senkt die Decke, auch bei bereits hoeherem Verbrauch ----------

test("(b) Downgrade business(900)->starter(300): Verbrauch 400 wird erst NACH dem Downgrade exceeded", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_b";
  registerCardedTenant(store, tenantId);
  await subscribeMod.createTenantSubscription({
    store, billing: fakeSubscribeBilling(), config, tenant: tenantId, planSlug: "business",
  });
  store.addVoiceUsageCostCents(tenantId, 400);
  assert.equal(store.budgetExceeded(tenantId, config.billing), false, "400 < 900 (business) -> frei");
  // Downgrade (Muster Webhook-Patch: nur planSlug).
  store.setTenantSubscription(tenantId, { planSlug: "starter" });
  assert.equal(store.tenantBudgetSnapshot(tenantId, config.billing).capCents, 300, "Decke gesunken");
  assert.equal(
    store.budgetExceeded(tenantId, config.billing),
    true,
    "400 >= 300 (starter) -> exceeded (Decke ist Grenze, kein Guthaben)",
  );
});

// ---- PAY-24: Downgrade waehrend einer OFFENEN In-Flight-Reserve ------------------
// (b) oben prueft den Downgrade gegen SETTLED Verbrauch. Der gefaehrlichere Fall ist die
// noch nicht abgerechnete Reserve eines LAUFENDEN Calls: sie sitzt im ephemeren
// Reserve-Ledger (s.reservations), nicht im usage-Bucket. Der Test beweist, dass
// effectiveCapCents bei JEDER Pruefung frisch gelesen wird (kein zwischengespeicherter
// Cap, der die alte Business-Decke ueberleben liesse). Reine state-ops-Ebene, kein
// pglite noetig.
const BUSINESS_CAP_CENTS = 900;
const STARTER_CAP_CENTS = 300;

test("PAY-24: Downgrade business->starter wirkt sofort auf eine bereits offene Nicht-Inlands-Reserve", () => {
  const s = ops.makeDefaultState();
  const tenantId = "t_pay24";
  ops.registerTenant(s, tenantId, {});
  ops.setTenantSubscription(s, tenantId, { planSlug: "business" });
  ops.deriveTenantBudgetFromPlan(s, tenantId, config.billing);
  assert.equal(
    ops.tenantBudgetSnapshot(s, tenantId, config.billing).capCents,
    BUSINESS_CAP_CENTS,
    "Vorbedingung: Business-Decke unclamped (MAX_BUDGET_EUR=30 am Dateikopf)",
  );

  assert.equal(
    ops.tryReserveOutboundBudget(s, tenantId, BUSINESS_CAP_CENTS, config.billing),
    true,
    "Vorbedingung: die volle Decke ist als In-Flight-Reserve gebucht",
  );

  ops.setTenantSubscription(s, tenantId, { planSlug: "starter" });
  ops.deriveTenantBudgetFromPlan(s, tenantId, config.billing);
  assert.equal(
    ops.tenantBudgetSnapshot(s, tenantId, config.billing).capCents,
    STARTER_CAP_CENTS,
    "Decke gesunken",
  );
  assert.equal(
    ops.reserveExceedsBudget(s, tenantId, 1, config.billing),
    true,
    "die 900er-Reserve allein sprengt die neue 300er-Decke - schon ein Cent mehr wird abgelehnt",
  );
});

// ---- (c) Tenant ohne Abo: keine Ableitung, Bestandsverhalten unveraendert --------

test("(c) Tenant ohne stripePlanSlug: keine tenant_budget-Zeile, Cap = Registrierungs-Default", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_c";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Ohne Abo" });
  // Patch OHNE Slug (Muster activation.js syncNumberSetupFeeExemption) - No-op.
  store.setTenantSubscription(tenantId, { numberSetupFeeExempt: false });
  assert.equal(
    s.tenantBudgets.find((b) => b.tenantId === tenantId),
    undefined,
    "keine Zeile aus der Ableitung",
  );
  assert.equal(
    store.tenantBudgetSnapshot(tenantId, config.billing).capCents,
    1500,
    "faellt auf den DEFAULT_TENANT_BUDGET_CENTS-Code-Fallback (seit P7 1500) zurueck",
  );
});

// ---- (d) EUR-Gate vs. Minuten-Gate: D8 ist behoben (heute umgekehrt) ------------

test("(d) Business-Tenant telefoniert 120 Min: EUR-Gate frei (900 > 648), Minuten-Gate exceeded (120>=120)", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_d";
  registerCardedTenant(store, tenantId);
  await subscribeMod.createTenantSubscription({
    store, billing: fakeSubscribeBilling(), config, tenant: tenantId, planSlug: "business",
  });
  // 120 Minuten zu 5.4 ct = 648 ct Ist-Verbrauch (Kontrollrechnung, NICHT die Formel-Eingabe).
  store.addVoiceUsageCostCents(tenantId, 648);
  assert.equal(store.budgetExceeded(tenantId, config.billing), false, "648 < 900 -> EUR-Gate frei");
  const s = store.load();
  ops.recordUsageEvent(s, { tenantId, kind: USAGE_EVENT_KIND.VOICE_MINUTE, quantity: 120, costCents: 0 });
  const periodStartIso = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(
    ops.planMinutesExceeded(s, tenantId, { includedMinutes: 120, periodStartIso }),
    true,
    "120 >= 120 Minuten -> Plan-Minuten-Gate exceeded",
  );
});

// ---- (e) ALLE SECHS setTenantSubscription-Aufrufer treiben die Ableitung --------

test("(e1) createTenantSubscription -> Ableitung laeuft (bereits durch (a) bewiesen, hier nur benannt)", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_e1";
  registerCardedTenant(store, tenantId);
  await subscribeMod.createTenantSubscription({
    store, billing: fakeSubscribeBilling(), config, tenant: tenantId, planSlug: "starter",
  });
  assert.equal(store.tenantBudgetSnapshot(tenantId, config.billing).capCents, 300);
});

test("(e2) activateSubscriptionFromCheckoutSession ok-Pfad (kein Abo bisher) -> Ableitung laeuft", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_e2";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "E2" });
  store.setTenantStripe(tenantId, { customerId: "cus_e2" }); // Customer-Match, kein Abo -> unterer Zweig
  const outcome = {
    customerId: "cus_e2",
    paymentMethodId: "pm_e2",
    subscriptionId: "sub_e2",
    currentPeriodStart: 1890864000,
    currentPeriodEnd: 1893456000,
    planSlug: "business",
  };
  const result = await subscribeMod.activateSubscriptionFromCheckoutSession({
    store,
    billing: { getSubscriptionCheckoutResult: async () => outcome },
    accounts: noopAccounts(),
    provision: noopProvision(),
    tenant: tenantId,
    sessionId: "cs_e2",
    expectedPlanSlug: "business",
  });
  assert.equal(result.ok, true);
  assert.equal(store.tenantBudgetSnapshot(tenantId, config.billing).capCents, 900);
});

test("(e3) activateSubscriptionFromCheckoutSession Heilungs-Pfad (Karte fehlt, Abo bereits gespeichert) -> Ableitung laeuft", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_e3";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "E3" });
  store.setTenantStripe(tenantId, { customerId: "cus_e3" }); // KEIN paymentMethodId -> hasCardOnFile=false
  // Simuliert "der Webhook hat das Rennen gewonnen": Abo roh gesetzt, OHNE die Schreibkante
  // zu durchlaufen (RAW ops-Aufruf, keine Ableitung) - der Test isoliert damit, dass
  // GENAU der Heilungs-Pfad (nicht ein vorheriger Aufrufer) die Ableitung ausloest.
  ops.setTenantSubscription(s, tenantId, { subscriptionId: "sub_e3", planSlug: "business" });
  assert.equal(
    s.tenantBudgets.find((b) => b.tenantId === tenantId),
    undefined,
    "Vorbedingung: roher ops-Aufruf hat NICHT abgeleitet",
  );
  const outcome = {
    customerId: "cus_e3",
    paymentMethodId: "pm_e3",
    subscriptionId: "sub_e3", // IDENTISCH -> Heilungs-Pfad, kein subscription_conflict
    currentPeriodStart: 1890864000,
    currentPeriodEnd: 1893456000,
    planSlug: "business",
  };
  const result = await subscribeMod.activateSubscriptionFromCheckoutSession({
    store,
    billing: { getSubscriptionCheckoutResult: async () => outcome },
    accounts: noopAccounts(),
    provision: noopProvision(),
    tenant: tenantId,
    sessionId: "cs_e3",
    expectedPlanSlug: "business",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "already_subscribed");
  assert.equal(
    store.tenantBudgetSnapshot(tenantId, config.billing).capCents,
    900,
    "Heilungs-Pfad hat die Ableitung ausgeloest",
  );
});

test("(e4) applyStripeWebhook ACTIVATE mit plan_slug in Metadata -> Ableitung laeuft", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_e4";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "E4" });
  const event = {
    type: webhookMod.SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_e4",
        status: "active",
        current_period_end: 1893456000,
        current_period_start: 1890864000,
        metadata: { tenant_ref: tenantId, plan_slug: "starter" },
      },
    },
  };
  await webhookMod.applyStripeWebhook(event, {
    store,
    accounts: noopAccounts(),
    sessions: { invalidateByTenant: async () => {} },
    audit: () => {},
    req: {},
    provision: noopProvision(),
    billing: undefined,
  });
  assert.equal(store.tenantBudgetSnapshot(tenantId, config.billing).capCents, 300);
});

test("(e5) activation.js syncNumberSetupFeeExemption -> {numberSetupFeeExempt} ALLEIN (kein Slug) -> No-op", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_e5";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "E5" });
  store.setTenantSubscription(tenantId, { subscriptionId: "sub_e5" }); // kein planSlug
  await activationMod.activatePaidTenant({
    store,
    accounts: noopAccounts(),
    provision: noopProvision(),
    billing: { retrieveSubscription: async () => ({ numberSetupFeeExempt: true }) },
    tenant: tenantId,
  });
  assert.equal(store.tenantSubscription(tenantId).numberSetupFeeExempt, true, "Flag wurde gesetzt");
  assert.equal(
    s.tenantBudgets.find((b) => b.tenantId === tenantId),
    undefined,
    "kein Slug -> No-op, keine tenant_budget-Zeile",
  );
});

test("(e6) backfillPlanProfiles apply+resolvePlanSlug -> {planSlug} ALLEIN -> Ableitung heilt Bestands-Abo", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_e6";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "E6" });
  store.setKycLevel(tenantId, KYC_LEVEL.CARD);
  store.setTenantSubscription(tenantId, { subscriptionId: "sub_e6" }); // slug-los (Bestands-Abo)
  assert.equal(store.tenantActiveSubscriber(tenantId, KYC_LEVEL.CARD), true, "Vorbedingung: aktiver Subscriber");
  const report = await backfillMod.backfillPlanProfiles({
    store,
    apply: true,
    resolvePlanSlug: async () => "business",
  });
  assert.ok(
    report.reconciled.some((r) => r.id === tenantId),
    "Backfill hat den slug-losen Tenant heilend nachgezogen",
  );
  assert.equal(store.tenantBudgetSnapshot(tenantId, config.billing).capCents, 900);
});

// ---- (f) Bestands-Guard: der Spiegel apps/web/src/lib/plans.js bleibt unberuehrt ----

test("(f) plan-caps.js importiert NICHTS aus apps/web (der Spiegel bleibt unberuehrt)", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "src", "billing", "plan-caps.js"), "utf8");
  const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
  assert.ok(importLines.length > 0, "Vorbedingung: die Datei hat ueberhaupt einen Import");
  assert.ok(
    importLines.every((l) => !l.includes("apps/web")),
    `kein Import-Statement darf apps/web referenzieren: ${JSON.stringify(importLines)}`,
  );
});

// ---- (g) Patch ohne Slug wirft nicht; Webhook-Perioden-Verlaengerung laeuft durch ---

test("(g) Patch ohne Slug wirft NICHT, Decke unveraendert", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_g1";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "G1" });
  assert.doesNotThrow(() => store.setTenantSubscription(tenantId, { numberSetupFeeExempt: true }));
  assert.equal(s.tenantBudgets.find((b) => b.tenantId === tenantId), undefined);
});

test("(g) applyStripeWebhook ACTIVATE OHNE plan_slug (Perioden-Verlaengerung) laeuft vollstaendig durch, Budget-Zeile unangetastet", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_g2";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "G2" });
  // Erst-Abo mit Slug (Ableitung laeuft einmal, pinnt die Decke auf 300).
  store.setTenantSubscription(tenantId, {
    subscriptionId: "sub_g2",
    planSlug: "starter",
    currentPeriodEnd: 1893456000,
    currentPeriodStart: 1890864000,
  });
  assert.equal(store.tenantBudgetSnapshot(tenantId, config.billing).capCents, 300);
  // Perioden-Verlaengerung: Event OHNE plan_slug in der Metadata.
  const event = {
    type: webhookMod.SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_g2",
        status: "active",
        current_period_end: 1896134400,
        current_period_start: 1893456000,
        metadata: { tenant_ref: tenantId },
      },
    },
  };
  const setStatusCalls = [];
  await webhookMod.applyStripeWebhook(event, {
    store,
    accounts: { setStatus: async (t, st) => setStatusCalls.push([t, st]) },
    sessions: { invalidateByTenant: async () => {} },
    audit: () => {},
    req: {},
    provision: noopProvision(),
    billing: undefined,
  });
  assert.deepEqual(setStatusCalls, [[tenantId, "active"]], "Webhook lief vollstaendig durch (activatePaidTenant)");
  assert.equal(
    store.tenantSubscription(tenantId).currentPeriodEnd,
    1896134400,
    "Perioden-Anker nachgezogen",
  );
  assert.equal(
    store.tenantBudgetSnapshot(tenantId, config.billing).capCents,
    300,
    "Budget-Zeile unangetastet (gleicher Slug, idempotente Re-Ableitung)",
  );
});

// ---- (h) Slug gesetzt, aber UNBEKANNT -> wirft (der einzige Wurf dieser Phase) -----

test("(h) unbekannter Plan-Slug -> setTenantSubscription wirft (fail-closed)", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_h";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "H" });
  assert.throws(
    () => store.setTenantSubscription(tenantId, { planSlug: "enterprise" }),
    /unbekannter Plan-Slug 'enterprise'/,
  );
});

// ---- (h2) S1-1 TORN WRITE: der Wurf hinterlaesst KEINE Mutation im Singleton, auch nicht
// nach einem spaeteren, unabhaengigen save() ------------------------------------------------
// Repro des Blockers: vor dem Fix mutierte ops.setTenantSubscription stripePlanSlug BEVOR
// deriveTenantBudgetFromPlan warf; die Mutation ueberlebte im Singleton und ein spaeterer,
// unabhaengiger save() (anderer Tenant) flushte den ungueltigen Slug still auf die DB.
test("(h2) unbekannter Slug wirft ATOMAR: Tenant-Record unveraendert, kein Flush durch spaeteren save()", async () => {
  const { store, runner } = await makeTestStore();
  const tenantId = "t_h2";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "H2" });
  assert.throws(
    () => store.setTenantSubscription(tenantId, { planSlug: "enterprise", subscriptionId: "sub_h2" }),
    /unbekannter Plan-Slug 'enterprise'/,
  );
  // In-Memory sofort nach dem Wurf: NICHTS mutiert (kein Slug, keine subscriptionId, keine Zeile).
  assert.equal(store.tenantSubscription(tenantId).planSlug, null, "stripePlanSlug NICHT mutiert");
  assert.equal(store.tenantSubscription(tenantId).subscriptionId, null, "subscriptionId NICHT mutiert");
  assert.equal(s.tenantBudgets.find((b) => b.tenantId === tenantId), undefined, "keine Budget-Zeile");
  // Ein spaeterer, voellig unabhaengiger save() (zweiter Tenant) darf den ungueltigen Slug
  // NICHT nachtraeglich flushen. Frischer Store auf DERSELBEN pglite-DB -> hydriert aus der DB.
  ops.registerTenant(store.load(), "t_h2_other", { firstName: "Other" });
  await store.save();
  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(
    store2.tenantSubscription(tenantId).planSlug,
    null,
    "nach unrelated save()+reload weiterhin kein 'enterprise' auf der DB (Torn Write behoben)",
  );
});

// ---- (h3) S1-1 Webhook-Gate: ACTIVATE mit unbekanntem plan_slug wirft NICHT (kein unhandled
// rejection durch die Route), aktiviert NICHT und schreibt keine Budget-Zeile -----------------
test("(h3) applyStripeWebhook ACTIVATE mit unbekanntem plan_slug -> ignoriert fail-closed (kein Wurf, keine Aktivierung)", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_h3";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "H3" });
  const event = {
    type: webhookMod.SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_h3",
        status: "active",
        current_period_end: 1893456000,
        current_period_start: 1890864000,
        metadata: { tenant_ref: tenantId, plan_slug: "enterprise" },
      },
    },
  };
  const setStatusCalls = [];
  const auditCalls = [];
  await assert.doesNotReject(
    webhookMod.applyStripeWebhook(event, {
      store,
      accounts: { setStatus: async (t, st) => setStatusCalls.push([t, st]) },
      sessions: { invalidateByTenant: async () => {} },
      audit: (kind, _req, detail) => auditCalls.push(`${kind} ${detail}`),
      req: {},
      provision: noopProvision(),
      billing: undefined,
    }),
    "unbekannter Slug darf im Webhook NICHT werfen (sonst unhandled rejection in der Route)",
  );
  assert.deepEqual(setStatusCalls, [], "NICHT aktiviert (fail-closed)");
  assert.equal(store.tenantSubscription(tenantId).subscriptionId, null, "kein Abo geschrieben");
  assert.equal(s.tenantBudgets.find((b) => b.tenantId === tenantId), undefined, "keine Budget-Zeile");
  assert.ok(
    auditCalls.some((l) => l.includes("stripe_webhook_ignored") && l.includes("unknown_plan")),
    `unknown_plan auditiert, war: ${JSON.stringify(auditCalls)}`,
  );
});

// ---- (i) pg-Rundlauf: BEIDE Pflichtfelder ueberleben save()->reload, kein Mit-Verlust ---

test("(i) pg-Rundlauf: budgetCents+hardCapCents beide 900 nach reload; ein im selben Flush geschriebener Call bleibt erhalten", async () => {
  const { store, runner } = await makeTestStore();
  const tenantId = "t_i";
  registerCardedTenant(store, tenantId);
  await subscribeMod.createTenantSubscription({
    store, billing: fakeSubscribeBilling(), config, tenant: tenantId, planSlug: "business",
  });
  const s = store.load();
  ops.createCall(s, { direction: "outbound", from: "+49", to: "+49", tenantId });
  await store.save();

  // Frischer Store auf DERSELBEN pglite-DB -> hydriert aus der DB (kein Spiegel-Reuse).
  const store2 = makePgStore(runner);
  await store2.init();
  const s2 = store2.load();
  assert.deepEqual(
    s2.tenantBudgets.find((b) => b.tenantId === tenantId),
    { tenantId, budgetCents: 900, hardCapCents: 900 },
    "beide Pflichtfelder persistiert (waere budgetCents=undefined gesetzt worden, haette die " +
      "BIGINT-NOT-NULL-Verletzung die GESAMTE Transaktion inkl. Call zurueckgerollt)",
  );
  assert.equal(
    s2.calls.filter((c) => c.tenantId === tenantId).length,
    1,
    "der im selben Flush geschriebene Call ist ebenfalls da (Mit-Verlust-Beweis)",
  );

  // Patch ohne Slug, erneut save() -> weiterhin beide Felder 900.
  store2.setTenantSubscription(tenantId, { numberSetupFeeExempt: true });
  await store2.save();
  const store3 = makePgStore(runner);
  await store3.init();
  assert.deepEqual(
    store3.load().tenantBudgets.find((b) => b.tenantId === tenantId),
    { tenantId, budgetCents: 900, hardCapCents: 900 },
    "Patch ohne Slug hat die Zeile nicht veraendert",
  );
});

// ---- (j) S1-1 Runde 3: ein FRUEHER gueltiger, jetzt aus dem Katalog entfernter/umbenannter
// (Alt-/Test-) Slug erreicht die Ableitung ueber einen SLUG-LOSEN Folge-Patch. Die
// Schreibkanten-Validierung (setTenantSubscription) prueft NUR patch.planSlug - der alte,
// bereits persistierte Slug wird NIE erneut geprueft. Vor dem Fix warf planCapCents darauf
// uncaught und riss den nicht gefangenen Stripe-Webhook ab (haengende Antwort). Erwartung:
// No-op + WARN, KEIN Wurf; bestehende Decke bleibt (fail-closed). ---------------------------

test("(j) persistierter, nicht mehr im Katalog gefuehrter Slug + slug-loser Patch wirft NICHT (No-op, Decke bleibt)", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_j";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "J" });
  // Bestehende Decke aus einer frueheren, damals gueltigen Ableitung.
  ops.setTenantBudget(s, tenantId, { budgetCents: 300, hardCapCents: 300 });
  // Simuliert Katalog-Umbenennung/-Entfernung ODER Alt-/Testdaten: ein Slug, der bei
  // Persistenz gueltig war, den isKnownPlanSlug jetzt aber ablehnt. Direkt am Record geplant -
  // die Schreibkante wuerde ihn heute abweisen, genau darum geht es (er sitzt bereits at rest).
  s.tenants.find((t) => t.id === tenantId).stripePlanSlug = "legacy-discontinued-plan";
  // Slug-loser Folge-Patch (Perioden-Verlaengerung): triggert die Ableitung auf dem
  // PERSISTIERTEN Alt-Slug.
  assert.doesNotThrow(
    () => store.setTenantSubscription(tenantId, { currentPeriodEnd: 1896134400 }),
    "persistierter Alt-Slug darf die Ableitung NICHT werfen lassen",
  );
  assert.deepEqual(
    s.tenantBudgets.find((b) => b.tenantId === tenantId),
    { tenantId, budgetCents: 300, hardCapCents: 300 },
    "bestehende Decke unveraendert (No-op, fail-closed)",
  );
});

test("(j2) applyStripeWebhook ACTIVATE ohne plan_slug bei persistiertem Alt-Slug: kein unhandled rejection, Aktivierung laeuft durch", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_j2";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "J2" });
  const tenant = s.tenants.find((t) => t.id === tenantId);
  tenant.stripeSubscriptionId = "sub_j2";
  tenant.stripePlanSlug = "legacy-discontinued-plan"; // Alt-Slug at rest, Katalog kennt ihn nicht mehr
  // Perioden-Verlaengerung: Event OHNE plan_slug in der Metadata (der gespeicherte Slug bleibt).
  const event = {
    type: webhookMod.SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_j2",
        status: "active",
        current_period_end: 1896134400,
        current_period_start: 1893456000,
        metadata: { tenant_ref: tenantId },
      },
    },
  };
  const setStatusCalls = [];
  await assert.doesNotReject(
    webhookMod.applyStripeWebhook(event, {
      store,
      accounts: { setStatus: async (t, st) => setStatusCalls.push([t, st]) },
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: noopProvision(),
      billing: undefined,
    }),
    "persistierter Alt-Slug darf den Webhook NICHT werfen lassen (sonst haengende Stripe-Antwort)",
  );
  assert.deepEqual(setStatusCalls, [[tenantId, "active"]], "Webhook lief vollstaendig durch (activatePaidTenant)");
  assert.equal(
    store.tenantSubscription(tenantId).currentPeriodEnd,
    1896134400,
    "Perioden-Anker nachgezogen",
  );
});
