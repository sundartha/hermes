// FW1 (F3 + F8): Webhook-Haertung. Rein, offline (Muster p3-payment-webhook.test.js +
// profile-a2-activation.test.js: Fake-Recorder-Store bzw. duenner Seam auf echtem State).
//
// FW1-A: ein Stripe-Event kann metadata.tenant_ref NENNEN, das diese Datenbank nicht (mehr)
// kennt (Stripe traegt die Metadata dauerhaft am Objekt). Ungeprueft weitergereicht wirft
// der erste Schreibzugriff. resolveExistingTenant (billing/webhook.js) gated das VOR jedem
// Write - A1/A2/A3 beweisen kein Wurf, kein Write, ein Audit mit tenant=<id> unknown_tenant;
// A4/A5/A6 beweisen: das bekannte Bestandsverhalten (auch der no_tenant-Fall ohne tenant_ref)
// bleibt unveraendert; A7 beweist die store.js-Fassaden-Landmine.
//
// FW1-B: die Ruecknahme einer Zahlungsbeanstandung (clearBillingHold + periodCreditRevoked:
// false) lief bisher NUR im Webhook-ACTIVATE-Zweig - ein Rueckkehrer ueber
// activateSubscriptionFromCheckoutSession (Self-Service) blieb mit Hold+revoked liegen,
// obwohl sein Abo laengst bestaetigt war. B1/B2 beweisen den Rueckkehrpfad direkt; B3/B4
// beweisen, dass der Webhook-Pfad (jetzt ueber dieselbe gemeinsame Stelle) unveraendert
// wirkt.
import test from "node:test";
import assert from "node:assert/strict";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";
import { activateSubscriptionFromCheckoutSession } from "../src/billing/subscribe.js";
import * as storeFacade from "../src/store.js";
import {
  makeDefaultState,
  registerTenant,
  setKycLevel,
  tenantSubscription,
  setTenantSubscription,
  setProfile,
  clearSuspendedAt,
  billingHoldActive,
  setBillingHold,
  clearBillingHold,
  stampBudgetPeriod,
  tenantStripe,
  setTenantStripe,
  tenantExists,
  usageFor,
} from "../src/store/state-ops.js";

const TENANT = "t_fw1_known";
const GHOST_TENANT = "t_fw1_ghost";
const NOW_ISO = "2026-09-07T00:00:00.000Z";
const MS_PER_SECOND = 1000;

// ---- FW1-A: recordingStore - reines Aufzeichnungs-Double, kein echter State ----------
// Zaehlt JEDEN Schreibaufruf (unabhaengig, ob resolveExistingTenant ihn ueberhaupt
// erreicht) - so beweist calls.writes.length===0 direkt, dass ein unbekannter tenant_ref
// NIE bis in einen Schreibzugriff kommt.
const WRITE_METHODS = Object.freeze([
  "setTenantSubscription",
  "setBillingHold",
  "setKycLevel",
  "setTenantStripe",
  "setSuspendedAtIfAbsent",
  "clearSuspendedAt",
  "clearBillingHold",
  "setProfile",
  "ensureTenant",
  "stampBudgetPeriod",
]);

function recordingStore({ known = true } = {}) {
  const calls = { writes: [], tenantExists: 0 };
  const store = {
    tenantExists: (_tenantId) => {
      calls.tenantExists += 1;
      return known;
    },
    // Lese-Seams, die applyStripeWebhook VOR jedem Schreibzugriff braucht (Muster
    // p3-payment-webhook.test.js fakeDeps): planSlug=null haelt provisionPlanProfile auf
    // SKIP (kein setProfile-Aufruf im ACTIVATE-Regressionstest noetig).
    tenantStripe: () => ({ customerId: null, paymentMethodId: null }),
    tenantSubscription: () => ({ planSlug: null, cancelAtPeriodEnd: false }),
    billingHoldActive: () => null,
    findTenantBySubscription: () => null,
    findTenantByCustomer: () => null,
  };
  for (const method of WRITE_METHODS) {
    store[method] = (...args) => {
      calls.writes.push({ method, args });
    };
  }
  return { calls, store };
}

function fakeAudit() {
  const calls = [];
  return { calls, audit: (event, _req, detail) => calls.push({ event, detail }) };
}

function fakeAccounts() {
  const calls = [];
  return { calls, setStatus: async (tenant, status) => calls.push({ tenant, status }) };
}

// ---- FW1-A: Events ---------------------------------------------------------------
function createdEvent(tenantRef, { subscriptionId = "sub_x" } = {}) {
  return {
    type: SUBSCRIPTION_EVENT.CREATED,
    data: { object: { id: subscriptionId, status: "active", metadata: { tenant_ref: tenantRef } } },
  };
}

function deletedEvent(tenantRef, { subscriptionId = "sub_x" } = {}) {
  return {
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: subscriptionId, metadata: { tenant_ref: tenantRef } } },
  };
}

function refundedEvent(tenantRef) {
  return {
    type: "charge.refunded",
    id: "evt_refund_1",
    data: { object: { id: "ch_1", customer: null, metadata: { tenant_ref: tenantRef } } },
  };
}

// A1: ACTIVATE, unbekannter tenant_ref -> kein Wurf, kein Write, Audit tenant=... unknown_tenant.
test("FW1-A1: ACTIVATE mit unbekanntem tenant_ref wird ignoriert, kein Write", async () => {
  const { calls, store } = recordingStore({ known: false });
  const { calls: auditCalls, audit } = fakeAudit();
  await applyStripeWebhook(createdEvent(GHOST_TENANT), {
    store,
    accounts: fakeAccounts(),
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  assert.equal(calls.writes.length, 0, "kein einziger Schreibzugriff");
  assert.deepEqual(
    auditCalls.map((entry) => entry.detail),
    [`action=activate tenant=${GHOST_TENANT} unknown_tenant`],
  );
});

// A2: SUSPEND (deleted), unbekannter tenant_ref -> kein Wurf, kein setStatus, kein Write.
test("FW1-A2: SUSPEND (deleted) mit unbekanntem tenant_ref wird ignoriert, kein Write", async () => {
  const { calls, store } = recordingStore({ known: false });
  const { calls: auditCalls, audit } = fakeAudit();
  const accounts = fakeAccounts();
  await applyStripeWebhook(deletedEvent(GHOST_TENANT), {
    store,
    accounts,
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  assert.equal(accounts.calls.length, 0, "kein setStatus");
  assert.equal(calls.writes.length, 0, "kein einziger Schreibzugriff");
  assert.deepEqual(
    auditCalls.map((entry) => entry.detail),
    [`action=suspend tenant=${GHOST_TENANT} unknown_tenant`],
  );
});

// A3: Geld-Ereignis, unbekannter tenant_ref -> unbedingtes Audit bleibt, danach ignored,
// kein setTenantSubscription (REVOKE_PERIOD_CREDIT wuerde sonst schreiben).
test("FW1-A3: Geld-Ereignis mit unbekanntem tenant_ref wird ignoriert, kein Write", async () => {
  const { calls, store } = recordingStore({ known: false });
  const { calls: auditCalls, audit } = fakeAudit();
  await applyStripeWebhook(refundedEvent(GHOST_TENANT), { store, audit, req: {} });
  assert.equal(calls.writes.length, 0, "kein einziger Schreibzugriff");
  assert.deepEqual(
    auditCalls.map((entry) => entry.event),
    ["stripe_money_event", "stripe_money_event_ignored"],
    "unbedingtes Audit bleibt VOR der Aufloesung stehen",
  );
  assert.equal(auditCalls[1].detail, `tenant=${GHOST_TENANT} unknown_tenant`);
});

// A4: Regression bekannter Tenant, Lifecycle - setStatus(active) + Writes laufen wie heute.
test("FW1-A4: ACTIVATE mit bekanntem tenant_ref aktiviert unveraendert", async () => {
  const { calls, store } = recordingStore({ known: true });
  const { audit } = fakeAudit();
  const accounts = fakeAccounts();
  await applyStripeWebhook(createdEvent(TENANT), {
    store,
    accounts,
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  assert.deepEqual(accounts.calls, [{ tenant: TENANT, status: "active" }]);
  assert.ok(calls.writes.some((entry) => entry.method === "setKycLevel"), "KYC wird gehoben");
  assert.ok(
    calls.writes.some((entry) => entry.method === "clearBillingHold"),
    "FW1-B: die Ruecknahme laeuft jetzt ueber activatePaidTenant, auch im Webhook-Pfad",
  );
});

// A5: Regression bekannter Tenant, Geld - setTenantSubscription(periodCreditRevoked:true)
// unveraendert.
test("FW1-A5: Geld-Ereignis mit bekanntem tenant_ref wirkt unveraendert", async () => {
  const { calls, store } = recordingStore({ known: true });
  const { audit } = fakeAudit();
  await applyStripeWebhook(refundedEvent(TENANT), { store, audit, req: {} });
  assert.deepEqual(
    calls.writes.filter((entry) => entry.method === "setTenantSubscription"),
    [{ method: "setTenantSubscription", args: [TENANT, { periodCreditRevoked: true }] }],
  );
});

// A6: Regression no_tenant (kein tenant_ref UND findTenantBySubscription -> null) - Detail
// bleibt byte-identisch, UND store.tenantExists wird in diesem Pfad NIE gerufen (der
// no_tenant-Fall kommt ohne jeden Store-Zugriff aus, s. resolveExistingTenant).
test("FW1-A6: no_tenant bleibt byte-identisch, kein tenantExists-Aufruf", async () => {
  const { calls, store } = recordingStore({ known: true });
  const { calls: auditCalls, audit } = fakeAudit();
  const event = {
    type: SUBSCRIPTION_EVENT.PAYMENT_FAILED,
    data: { object: { subscription: "sub_missing", customer: null, metadata: {} } },
  };
  await applyStripeWebhook(event, {
    store,
    accounts: fakeAccounts(),
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  assert.deepEqual(auditCalls.map((entry) => entry.detail), ["action=suspend no_tenant"]);
  assert.equal(calls.tenantExists, 0, "no_tenant-Pfad ohne jeden Store-Zugriff");
});

// A7: Fassaden-Landmine (Muster newsletter-consent-facade.test.js) - ohne diesen Re-Export
// ist store.tenantExists auf der Fassade undefined -> billing/webhook.js wirft zur Laufzeit
// einen TypeError.
test("FW1-A7: store.js re-exportiert tenantExists (sonst TypeError zur Laufzeit)", () => {
  assert.equal(typeof storeFacade.tenantExists, "function", "tenantExists fehlt in der Fassade");
});

// ---- FW1-B: stateStore - duenner Seam auf ECHTEM state-ops-State (Muster storeOn aus
// profile-a2-activation.test.js), damit billingHoldActive/stampBudgetPeriod echt schalten.
function stateStore(state) {
  return {
    setKycLevel: (tenant, level) => setKycLevel(state, tenant, level),
    tenantSubscription: (tenant) => tenantSubscription(state, tenant),
    setTenantSubscription: (tenant, patch) => setTenantSubscription(state, tenant, patch),
    setProfile: (key, patch) => setProfile(state, key, patch),
    clearSuspendedAt: (tenant) => clearSuspendedAt(state, tenant),
    billingHoldActive: (tenant) => billingHoldActive(state, tenant, NOW_ISO),
    clearBillingHold: (tenant) => clearBillingHold(state, tenant),
    stampBudgetPeriod: (tenant, periodIso) => stampBudgetPeriod(state, tenant, periodIso).changed,
    ensureTenant: async () => {},
    tenantStripe: (tenant) => tenantStripe(state, tenant),
    setTenantStripe: (tenant, patch) => setTenantStripe(state, tenant, patch),
    findTenantBySubscription: () => null,
    tenantExists: (tenant) => tenantExists(state, tenant),
    setSuspendedAtIfAbsent: () => {},
  };
}

const CHECKOUT_OUTCOME = Object.freeze({
  customerId: "cus_fw1",
  paymentMethodId: "pm_fw1",
  subscriptionId: "sub_fw1_checkout",
  currentPeriodStart: 1890864000,
  currentPeriodEnd: 1893456000,
  planSlug: "starter",
});

function withHold(state) {
  registerTenant(state, TENANT, {});
  setTenantStripe(state, TENANT, { customerId: CHECKOUT_OUTCOME.customerId, paymentMethodId: null });
  setBillingHold(state, TENANT, { reason: "paused" });
  setTenantSubscription(state, TENANT, { periodCreditRevoked: true });
  return state;
}

// B1: activateSubscriptionFromCheckoutSession ok-Pfad - Hold geraeumt, periodCreditRevoked
// zurueckgesetzt UND die Periode NACH dem Raeumen gestempelt (Reihenfolge-Beweis: ohne die
// FW1-B-Verschiebung waere stampBudgetPeriodIfPaid am NOCH aktiven Hold gescheitert).
test("FW1-B1: Checkout-Rueckkehr ok-Pfad hebt Beanstandung auf und stempelt danach", async () => {
  const state = makeDefaultState();
  withHold(state);
  const store = stateStore(state);
  const result = await activateSubscriptionFromCheckoutSession({
    store,
    billing: { getSubscriptionCheckoutResult: async () => CHECKOUT_OUTCOME },
    accounts: { setStatus: async () => {} },
    provision: async () => ({ ok: true, reason: "queued" }),
    tenant: TENANT,
    sessionId: "cs_fw1_ok",
    expectedPlanSlug: "starter",
  });
  assert.equal(result.ok, true);
  assert.equal(billingHoldActive(state, TENANT, NOW_ISO), null, "Hold geraeumt");
  assert.equal(tenantSubscription(state, TENANT).periodCreditRevoked, false);
  assert.ok(usageFor(state, TENANT).budgetPeriodKey, "Periode wurde gestempelt");
});

// B2: derselbe Pfad, Provisioning NICHT geklaert -> activated===false-Semantik: Hold
// bleibt, periodCreditRevoked bleibt true, kein Stempel (fail-closed).
test("FW1-B2: Checkout-Rueckkehr mit ungeklaertem Provisioning laesst die Beanstandung stehen", async () => {
  const state = makeDefaultState();
  withHold(state);
  const store = stateStore(state);
  const result = await activateSubscriptionFromCheckoutSession({
    store,
    billing: { getSubscriptionCheckoutResult: async () => CHECKOUT_OUTCOME },
    accounts: { setStatus: async () => {} },
    provision: async () => ({ ok: false, reason: "tenant_cap" }),
    tenant: TENANT,
    sessionId: "cs_fw1_cap",
    expectedPlanSlug: "starter",
  });
  assert.equal(result.ok, true, "der Checkout-Return selbst meldet ok (activated steckt in result.provisioned)");
  assert.equal(billingHoldActive(state, TENANT, NOW_ISO), "paused", "Hold bleibt (fail-closed)");
  assert.equal(tenantSubscription(state, TENANT).periodCreditRevoked, true, "Beanstandung bleibt");
  assert.equal(usageFor(state, TENANT).budgetPeriodKey, null, "kein Stempel ohne geklaertes Provisioning");
});

// B3: Webhook-ACTIVATE fuer einen Tenant MIT aktivem Hold - pinnt die bewusste Verhaltens-
// delta aus Abschnitt 2.6 (budget_period=reset statt kept, weil der Stempel vorher am
// Hold gescheitert waere).
test("FW1-B3: Webhook-ACTIVATE raeumt einen aktiven Hold und stempelt (budget_period=reset)", async () => {
  const state = makeDefaultState();
  withHold(state);
  const store = stateStore(state);
  const { calls: auditCalls, audit } = fakeAudit();
  const event = {
    type: SUBSCRIPTION_EVENT.CREATED,
    data: {
      object: {
        id: "sub_fw1_b3",
        status: "active",
        metadata: { tenant_ref: TENANT },
        current_period_start: CHECKOUT_OUTCOME.currentPeriodStart,
        current_period_end: CHECKOUT_OUTCOME.currentPeriodEnd,
      },
    },
  };
  await applyStripeWebhook(event, {
    store,
    accounts: { setStatus: async () => {} },
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  assert.equal(billingHoldActive(state, TENANT, NOW_ISO), null, "Hold geraeumt");
  const activateAudit = auditCalls.find((entry) => entry.event === "stripe_webhook_activate");
  assert.ok(activateAudit, "Activate-Audit vorhanden");
  assert.match(activateAudit.detail, /budget_period=reset/);
});

// B4: Webhook-ACTIVATE OHNE aktiven Hold - der zweite Stempelaufruf ist ein No-Op (keine
// Doppel-Baseline): dieselbe Periode wird nur EINMAL als Baseline gesetzt.
test("FW1-B4: Webhook-ACTIVATE ohne Hold stempelt einmal, kein Doppel-Baseline-Reset", async () => {
  const state = makeDefaultState();
  registerTenant(state, TENANT, {});
  setTenantStripe(state, TENANT, { customerId: CHECKOUT_OUTCOME.customerId, paymentMethodId: null });
  const store = stateStore(state);
  const { calls: auditCalls, audit } = fakeAudit();
  const event = {
    type: SUBSCRIPTION_EVENT.CREATED,
    data: {
      object: {
        id: "sub_fw1_b4",
        status: "active",
        metadata: { tenant_ref: TENANT },
        current_period_start: CHECKOUT_OUTCOME.currentPeriodStart,
        current_period_end: CHECKOUT_OUTCOME.currentPeriodEnd,
      },
    },
  };
  await applyStripeWebhook(event, {
    store,
    accounts: { setStatus: async () => {} },
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  const bucket = usageFor(state, TENANT);
  const baselineAfterFirstApply = bucket.budgetPeriodBaselineCents;
  // Zweiter Stempelversuch mit DERSELBEN Periode direkt gegen state-ops (simuliert den
  // zweiten activatePaidTenant-internen Aufruf, s. 2.6): No-Op, keine neue Baseline.
  const secondAttempt = stampBudgetPeriod(
    state,
    TENANT,
    new Date(CHECKOUT_OUTCOME.currentPeriodStart * MS_PER_SECOND).toISOString(),
  );
  assert.equal(secondAttempt.changed, false, "zweiter Stempelversuch derselben Periode ist No-Op");
  assert.equal(bucket.budgetPeriodBaselineCents, baselineAfterFirstApply, "keine Doppel-Baseline");
  const activateAudit = auditCalls.find((entry) => entry.event === "stripe_webhook_activate");
  assert.match(activateAudit.detail, /budget_period=reset/);
});
