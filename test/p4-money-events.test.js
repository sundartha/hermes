import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStripeWebhook,
  applyStripeWebhookSerialized,
  SUBSCRIPTION_EVENT,
} from "../src/billing/webhook.js";
import { MONEY_EVENT, PAYMENT_ACTION_GRACE_HOURS } from "../src/billing/money-events.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../src/config.js";

config.server.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p4-geldereignisse-"));
const echterSpeicher = await import("../src/store.js");

const CUSTOMER = "cus_money1";
const TENANT = "t_money1";

function fakeMoneyStore({ customerId = CUSTOMER, tenantId = TENANT } = {}) {
  const calls = { setTenantSubscription: [], setBillingHold: [], clearBillingHold: [] };
  return {
    calls,
    findTenantByCustomer: (cid) => (customerId && cid === customerId ? { id: tenantId } : null),
    findTenantBySubscription: () => null,
    tenantExists: () => true,
    setTenantSubscription: (t, patch) => calls.setTenantSubscription.push([t, patch]),
    setBillingHold: (t, patch) => calls.setBillingHold.push([t, patch]),
    clearBillingHold: (t) => calls.clearBillingHold.push(t),
  };
}

function fakeAudit() {
  const calls = [];
  return { calls, audit: (event, _req, detail) => calls.push({ event, detail }) };
}

function baseDeps(store, audit) {
  return { store, accounts: {}, sessions: {}, audit, req: {}, provision: async () => {}, billing: undefined };
}

test("charge.dispute.created: unbedingtes Audit mit event=, KEIN Store-Write", async () => {
  const store = fakeMoneyStore();
  const { calls, audit } = fakeAudit();
  await applyStripeWebhook(
    { id: "evt_dispute1", type: MONEY_EVENT.DISPUTE_CREATED, data: { object: { customer: CUSTOMER } } },
    baseDeps(store, audit),
  );
  const moneyAudit = calls.find((c) => c.event === "stripe_money_event");
  assert.ok(moneyAudit, "Audit-Eintrag vorhanden");
  assert.match(moneyAudit.detail, /event=evt_dispute1/);
  assert.match(moneyAudit.detail, /type=charge\.dispute\.created/);
  assert.deepEqual(store.calls.setTenantSubscription, [], "kein Store-Write fuer WARN");
  assert.deepEqual(store.calls.setBillingHold, []);
});

test("charge.refunded: periodCreditRevoked:true", async () => {
  const store = fakeMoneyStore();
  const { audit } = fakeAudit();
  await applyStripeWebhook(
    { id: "evt_refund1", type: MONEY_EVENT.REFUNDED, data: { object: { customer: CUSTOMER } } },
    baseDeps(store, audit),
  );
  assert.deepEqual(store.calls.setTenantSubscription, [[TENANT, { periodCreditRevoked: true }]]);
});

test("customer.subscription.paused: billingHold=paused, keine Frist", async () => {
  const store = fakeMoneyStore();
  const { audit } = fakeAudit();
  await applyStripeWebhook(
    {
      id: "evt_paused1",
      type: MONEY_EVENT.SUBSCRIPTION_PAUSED,
      data: { object: { id: "sub_paused1", customer: CUSTOMER } },
    },
    baseDeps(store, audit),
  );
  assert.deepEqual(store.calls.setBillingHold, [[TENANT, { reason: "paused" }]]);
});

test("invoice.payment_action_required: dueAt ~= jetzt + 72h, Hold noch NICHT aktiv", async () => {
  const store = fakeMoneyStore();
  const { audit } = fakeAudit();
  const before = Date.now();
  await applyStripeWebhook(
    {
      id: "evt_par1",
      type: MONEY_EVENT.PAYMENT_ACTION_REQUIRED,
      data: { object: { subscription: "sub_par1", customer: CUSTOMER } },
    },
    baseDeps(store, audit),
  );
  assert.equal(store.calls.setBillingHold.length, 1);
  const [[tenant, patch]] = store.calls.setBillingHold;
  assert.equal(tenant, TENANT);
  assert.equal(patch.reason, "payment_action");
  const dueAtMs = Date.parse(patch.dueAtIso);
  const expectedMs = before + PAYMENT_ACTION_GRACE_HOURS * 60 * 60 * 1000;
  assert.ok(
    Math.abs(dueAtMs - expectedMs) < 5000,
    `dueAt liegt ~72h in der Zukunft (delta=${dueAtMs - expectedMs}ms)`,
  );
});

test("Doppelzustellung derselben event.id -> Wirkung genau einmal (applyStripeWebhookSerialized)", async () => {
  const store = fakeMoneyStore({ tenantId: "t_money_dedup" });
  const { audit } = fakeAudit();
  const event = {
    id: "evt_dedup1",
    type: MONEY_EVENT.REFUNDED,
    data: { object: { customer: CUSTOMER } },
  };
  await applyStripeWebhookSerialized(event, baseDeps(store, audit));
  await applyStripeWebhookSerialized(event, baseDeps(store, audit));
  assert.equal(store.calls.setTenantSubscription.length, 1, "genau EIN Write trotz zweifacher Zustellung");
});

test("Aktivierung derselben Periode löst die Sperre und schreibt nichts am Entzug", async () => {
  const store = fakeMoneyStore();
  store.tenantStripe = () => ({ customerId: null, paymentMethodId: null });
  store.setTenantStripe = () => {};
  store.setKycLevel = () => {};
  store.clearSuspendedAt = () => {};
  store.setProfile = () => ({ profile: {}, changed: [] });
  const priorTenantSubscription = store.tenantSubscription;
  store.tenantSubscription = () => ({ planSlug: null });
  store.ensureTenant = async () => {};
  store.billingHoldActive = () => null;
  store.stampBudgetPeriod = () => false;
  const setStatusCalls = [];
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: { object: { id: "sub_reactivate1", status: "active", metadata: { tenant_ref: TENANT } } },
    },
    {
      store,
      accounts: { setStatus: async (t, st) => setStatusCalls.push([t, st]) },
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async () => ({ ok: true, reason: "queued" }),
      billing: undefined,
    },
  );
  assert.deepEqual(setStatusCalls, [[TENANT, "active"]]);
  assert.deepEqual(store.calls.clearBillingHold, [TENANT]);
  assert.deepEqual(
    store.calls.setTenantSubscription.filter(([, patch]) => "periodCreditRevoked" in patch),
    [],
    "Aktivierung derselben Periode schreibt den Entzug neu",
  );
  void priorTenantSubscription;
});

test("unbekannter Tenant (customerId ohne Treffer) -> no_tenant-Audit, kein Write", async () => {
  const store = fakeMoneyStore({ customerId: null });
  const { calls, audit } = fakeAudit();
  await applyStripeWebhook(
    {
      id: "evt_unknown1",
      type: MONEY_EVENT.REFUNDED,
      data: { object: { customer: "cus_unbekannt" } },
    },
    baseDeps(store, audit),
  );
  assert.ok(
    calls.some(
      (c) =>
        c.event === "stripe_money_event_ignored" &&
        c.detail === "type=charge.refunded event=evt_unknown1 no_tenant",
    ),
  );
  assert.deepEqual(store.calls.setTenantSubscription, []);
});

const JANUAR = 1_890_864_000;
const FEBRUAR = 1_893_456_000;
let kundenZaehler = 0;

function kundeImEchtenSpeicher(name) {
  kundenZaehler += 1;
  const tenant = `t_p4_${name}`;
  echterSpeicher.bootstrapTenant(`+4940777${String(kundenZaehler).padStart(4, "0")}`, tenant);
  echterSpeicher.setTenantStripe(tenant, { customerId: `cus_p4_${name}` });
  return tenant;
}

async function zustellen(event) {
  await applyStripeWebhook(event, {
    ...baseDeps(echterSpeicher, () => {}),
    accounts: { setStatus: async () => {} },
    sessions: { invalidateByTenant: async () => {} },
    provision: async () => ({ ok: true, reason: "queued" }),
  });
  await echterSpeicher.drainFlushes();
}

function aboAktiv(tenant, { typ = SUBSCRIPTION_EVENT.UPDATED, abo, periodenstart }) {
  return {
    type: typ,
    data: {
      object: {
        id: abo,
        status: "active",
        customer: echterSpeicher.tenantStripe(tenant).customerId,
        metadata: { tenant_ref: tenant, plan_slug: "starter" },
        current_period_start: periodenstart,
        current_period_end: periodenstart + 2_592_000,
      },
    },
  };
}

function geldEreignisFuer(tenant, type, objekt = {}) {
  const customer = echterSpeicher.tenantStripe(tenant).customerId;
  return { id: `evt_${type}_${tenant}`, type, data: { object: { customer, ...objekt } } };
}

const entzogen = (tenant) => echterSpeicher.tenantSubscription(tenant).periodCreditRevoked;

test("[NIE1] Verlängerung in eine spätere Periode nimmt den Entzug im Speicher zurück", async () => {
  const tenant = kundeImEchtenSpeicher("verlaengert");
  await zustellen(aboAktiv(tenant, { typ: SUBSCRIPTION_EVENT.CREATED, abo: "sub_p4_v", periodenstart: JANUAR }));
  await zustellen(geldEreignisFuer(tenant, MONEY_EVENT.REFUNDED));
  assert.equal(entzogen(tenant), true, "Vorbedingung: Erstattung entzieht");

  await zustellen(aboAktiv(tenant, { abo: "sub_p4_v", periodenstart: FEBRUAR }));

  assert.equal(entzogen(tenant), false);
});

test("[NIE1] Neues Abo mit neuer Periode nach beendetem Abo nimmt den Entzug im Speicher zurück", async () => {
  const tenant = kundeImEchtenSpeicher("neu_abonniert");
  await zustellen(aboAktiv(tenant, { typ: SUBSCRIPTION_EVENT.CREATED, abo: "sub_p4_alt", periodenstart: JANUAR }));
  await zustellen(geldEreignisFuer(tenant, MONEY_EVENT.REFUNDED));
  await zustellen({
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: "sub_p4_alt", metadata: { tenant_ref: tenant } } },
  });
  assert.equal(entzogen(tenant), true, "Vorbedingung: Entzug steht nach Ende des Abos");

  await zustellen(aboAktiv(tenant, { typ: SUBSCRIPTION_EVENT.CREATED, abo: "sub_p4_neu", periodenstart: FEBRUAR }));

  assert.equal(entzogen(tenant), false);
});

test("[NIE2] Aktivierung derselben Periode lässt den Entzug im Speicher stehen", async () => {
  const tenant = kundeImEchtenSpeicher("gleiche_periode");
  await zustellen(aboAktiv(tenant, { typ: SUBSCRIPTION_EVENT.CREATED, abo: "sub_p4_g", periodenstart: JANUAR }));
  await zustellen(geldEreignisFuer(tenant, MONEY_EVENT.REFUNDED));

  await zustellen(aboAktiv(tenant, { abo: "sub_p4_g", periodenstart: JANUAR }));

  assert.equal(entzogen(tenant), true);
});

test("[NIE3] Aktivierung derselben Periode nach Erstattung hebt die Sperre auf", async () => {
  const tenant = kundeImEchtenSpeicher("gesperrt");
  await zustellen(aboAktiv(tenant, { typ: SUBSCRIPTION_EVENT.CREATED, abo: "sub_p4_s", periodenstart: JANUAR }));
  await zustellen(geldEreignisFuer(tenant, MONEY_EVENT.REFUNDED));
  await zustellen(geldEreignisFuer(tenant, MONEY_EVENT.SUBSCRIPTION_PAUSED, { id: "sub_p4_s" }));
  assert.equal(echterSpeicher.billingHoldActive(tenant), "paused", "Vorbedingung: Pause sperrt");

  await zustellen(aboAktiv(tenant, { abo: "sub_p4_s", periodenstart: JANUAR }));

  assert.equal(echterSpeicher.billingHoldActive(tenant), null);
});

test("[NIE3] Aktivierung einer späteren Periode hebt die Sperre auf", async () => {
  const tenant = kundeImEchtenSpeicher("gesperrt_verlaengert");
  await zustellen(aboAktiv(tenant, { typ: SUBSCRIPTION_EVENT.CREATED, abo: "sub_p4_sv", periodenstart: JANUAR }));
  await zustellen(geldEreignisFuer(tenant, MONEY_EVENT.SUBSCRIPTION_PAUSED, { id: "sub_p4_sv" }));
  assert.equal(echterSpeicher.billingHoldActive(tenant), "paused", "Vorbedingung: Pause sperrt");

  await zustellen(aboAktiv(tenant, { abo: "sub_p4_sv", periodenstart: FEBRUAR }));

  assert.equal(echterSpeicher.billingHoldActive(tenant), null);
});
