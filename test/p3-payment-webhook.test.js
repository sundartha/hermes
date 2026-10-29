import test from "node:test";
import assert from "node:assert/strict";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  setTenantGeo,
  tenantGeo,
  tenantHasLiveNumber,
  setKycLevel,
  tenantActiveSubscriber,
  numberRecordByE164,
  canTransitionNumber,
  kycReached,
  setTenantStripe,
  tenantStripe,
  setTenantSubscription,
  tenantSubscription,
  findTenantBySubscription,
  findTenantByCustomer,
  setBillingHold,
  clearBillingHold,
  billingHoldActive,
  normalizePrivateNumber,
  failedNumberCount,
} from "../src/store/state-ops.js";
import {
  KYC_LEVEL,
  KYC_OUTBOUND_MIN,
  NUMBER_STATUS,
  NUMBER_TRANSITIONS,
} from "../src/store/defaults.js";
import { requestNumberForPaidTenant } from "../src/billing/provision-trigger.js";

const HIGH_CAP = 100;
const CAPS = { maxNumbers: HIGH_CAP, maxNumbersPerTenant: HIGH_CAP };

function fakeDeps({ tenantBySub = null, stripeOnFile = { customerId: null, paymentMethodId: null } } = {}) {
  const calls = {
    setStatus: [],
    invalidate: [],
    subscription: [],
    kyc: [],
    provision: [],
    stripe: [],
    suspend: [],
    clearSuspend: [],
  };
  return {
    calls,
    store: {
      findTenantBySubscription: (subId) => (tenantBySub && subId ? { id: tenantBySub } : null),
      tenantExists: () => true,
      setTenantSubscription: (tenant, patch) => calls.subscription.push([tenant, patch]),
      setKycLevel: (tenant, level) => calls.kyc.push([tenant, level]),
      tenantStripe: () => stripeOnFile,
      setTenantStripe: (tenant, patch) => calls.stripe.push([tenant, patch]),
      tenantSubscription: () => ({ planSlug: null }),
      setProfile: () => ({ profile: {}, changed: [] }),
      setSuspendedAtIfAbsent: (tenant) => calls.suspend.push(tenant),
      clearSuspendedAt: (tenant) => calls.clearSuspend.push(tenant),
      ensureTenant: async () => {},
      clearBillingHold: () => {},
      billingHoldActive: () => null,
      stampBudgetPeriod: () => false,
    },
    accounts: {
      setStatus: async (tenant, status) => calls.setStatus.push([tenant, status]),
      accountByTenant: async () => null,
    },
    sessions: { invalidateByTenant: async (tenant) => calls.invalidate.push(tenant) },
    audit: () => {},
    req: {},
    provision: async (tenant) => {
      calls.provision.push(tenant);
      return { ok: true, reason: "queued" };
    },
  };
}

const activationMarkerPatches = (tenant) => [
  [tenant, { activationPending: true }],
  [tenant, { activationPending: false }],
];

test("A(a) updated mit tenant_ref -> Abo + KYC(card) + active + provision genau 1x", async () => {
  const deps = fakeDeps();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: {
        object: {
          id: "sub_1",
          status: "active",
          current_period_end: 1893456000,
          metadata: { tenant_ref: "t_a", plan_slug: "starter" },
        },
      },
    },
    deps,
  );
  assert.deepEqual(deps.calls.subscription, [
    ["t_a", { subscriptionId: "sub_1", planSlug: "starter", currentPeriodEnd: 1893456000 }],
    ...activationMarkerPatches("t_a"),
  ]);
  assert.deepEqual(deps.calls.kyc, [["t_a", KYC_LEVEL.CARD]], "KYC auf CARD gehoben");
  assert.deepEqual(deps.calls.setStatus, [["t_a", "active"]], "Status aktiv");
  assert.deepEqual(deps.calls.provision, ["t_a"], "provision genau 1x mit t_a");
});

test("A(a2) updated mit current_period_start -> Anker im setTenantSubscription-Patch (B1a)", async () => {
  const deps = fakeDeps();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: {
        object: {
          id: "sub_1",
          status: "active",
          current_period_end: 1893456000,
          current_period_start: 1890864000,
          metadata: { tenant_ref: "t_a", plan_slug: "starter" },
        },
      },
    },
    deps,
  );
  assert.deepEqual(deps.calls.subscription, [
    [
      "t_a",
      {
        subscriptionId: "sub_1",
        planSlug: "starter",
        currentPeriodEnd: 1893456000,
        currentPeriodStart: 1890864000,
      },
    ],
    ...activationMarkerPatches("t_a"),
  ]);
});

test("A(b) created aktiviert identisch (deckt das .created-Mapping)", async () => {
  const deps = fakeDeps();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.CREATED,
      data: { object: { id: "sub_2", status: "active", metadata: { tenant_ref: "t_b" } } },
    },
    deps,
  );
  assert.deepEqual(deps.calls.kyc, [["t_b", KYC_LEVEL.CARD]]);
  assert.deepEqual(deps.calls.setStatus, [["t_b", "active"]]);
  assert.deepEqual(deps.calls.provision, ["t_b"]);
});

test("A(c) ohne tenant_ref: Tenant via findTenantBySubscription, dieselben Effekte", async () => {
  const deps = fakeDeps({ tenantBySub: "t_c" });
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.UPDATED, data: { object: { id: "sub_3", status: "active", metadata: {} } } },
    deps,
  );
  assert.deepEqual(deps.calls.kyc, [["t_c", KYC_LEVEL.CARD]]);
  assert.deepEqual(deps.calls.setStatus, [["t_c", "active"]]);
  assert.deepEqual(deps.calls.provision, ["t_c"]);
});

test("A(d) Suspend (deleted/payment_failed) ruft provision NIE (Suspend kauft nicht)", async () => {
  for (const event of [
    {
      type: SUBSCRIPTION_EVENT.DELETED,
      data: { object: { id: "sub_d", metadata: { tenant_ref: "t_d" } } },
    },
    {
      type: SUBSCRIPTION_EVENT.PAYMENT_FAILED,
      data: { object: { subscription: "sub_e", metadata: {} } },
    },
  ]) {
    const deps = fakeDeps({ tenantBySub: "t_e" });
    await applyStripeWebhook(event, deps);
    assert.deepEqual(deps.calls.provision, [], "provision nie bei Suspend");
    assert.deepEqual(deps.calls.kyc, [], "kein KYC-Set bei Suspend");
  }
});

test("A(e) updated mit Dunning-Status (past_due) -> ignore: kein KYC/active/provision", async () => {
  const deps = fakeDeps({ tenantBySub: "t_pd" });
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: { object: { id: "sub_pd", status: "past_due", metadata: { tenant_ref: "t_pd" } } },
    },
    deps,
  );
  assert.deepEqual(deps.calls.provision, [], "unbezahlt -> kein provision (Invariante 1/2)");
  assert.deepEqual(deps.calls.kyc, [], "unbezahlt -> kein KYC=CARD");
  assert.deepEqual(deps.calls.setStatus, [], "unbezahlt -> kein active (Outbound-Gate bleibt zu)");
});

const RACE_EVENT = (defaultPaymentMethod) => ({
  type: SUBSCRIPTION_EVENT.UPDATED,
  data: {
    object: {
      id: "sub_r",
      status: "active",
      customer: "cus_r",
      default_payment_method: defaultPaymentMethod,
      metadata: { tenant_ref: "t_r" },
    },
  },
});

test("A(f) activate mit customer+default_payment_method, Tenant OHNE Karte + Customer-Match -> Karte gebunden (Luecke gefuellt), provision laeuft", async () => {
  const deps = fakeDeps({ stripeOnFile: { customerId: "cus_r", paymentMethodId: null } });
  await applyStripeWebhook(RACE_EVENT("pm_r"), deps);
  assert.deepEqual(
    deps.calls.stripe,
    [["t_r", { paymentMethodId: "pm_r", paymentMethodType: null }]],
    "Karte aus dem Event gebunden",
  );
  assert.deepEqual(deps.calls.provision, ["t_r"], "Provisioning laeuft mit hinterlegter Karte");
});

test("A(g) default_payment_method als expandiertes Objekt ({id}) -> dieselbe Bindung", async () => {
  const deps = fakeDeps({ stripeOnFile: { customerId: "cus_r", paymentMethodId: null } });
  await applyStripeWebhook(RACE_EVENT({ id: "pm_r" }), deps);
  assert.deepEqual(deps.calls.stripe, [["t_r", { paymentMethodId: "pm_r", paymentMethodType: null }]]);
});

test("A(h) Tenant MIT Karte-on-file -> KEIN Ueberschreiben (bewusst neu erfasste Karte bleibt)", async () => {
  const deps = fakeDeps({ stripeOnFile: { customerId: "cus_r", paymentMethodId: "pm_bestand" } });
  await applyStripeWebhook(RACE_EVENT("pm_r"), deps);
  assert.deepEqual(deps.calls.stripe, [], "vorhandene Karte bleibt unangetastet");
  assert.deepEqual(deps.calls.provision, ["t_r"], "Aktivierung/Provisioning unveraendert");
});

test("A(i) Customer-Mismatch -> KEINE Bindung (R4: nie fremdes payment_method an den Tenant)", async () => {
  const deps = fakeDeps({ stripeOnFile: { customerId: "cus_ANDERS", paymentMethodId: null } });
  await applyStripeWebhook(RACE_EVENT("pm_r"), deps);
  assert.deepEqual(deps.calls.stripe, [], "Mismatch bindet fail-closed nichts");
});

test("A(j) Event ohne customer/default_payment_method (Bestandsform) -> keine Stripe-Schreibung, Effekte wie A(a)", async () => {
  const deps = fakeDeps();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: { object: { id: "sub_1", status: "active", metadata: { tenant_ref: "t_a" } } },
    },
    deps,
  );
  assert.deepEqual(deps.calls.stripe, [], "ohne Event-Felder keine Karten-Schreibung");
  assert.deepEqual(deps.calls.provision, ["t_a"]);
});

test("B(e) tenantHasLiveNumber: kein/requested/active -> live, nur released/failed -> false", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_n", {});
  assert.equal(tenantHasLiveNumber(s, "t_n"), false, "kein Number -> false");
  requestNumber(s, { tenantId: "t_n", ...CAPS });
  assert.equal(tenantHasLiveNumber(s, "t_n"), true, "requested -> live");

  registerTenant(s, "t_act", {});
  s.numbers.push({ id: "num_act", tenantId: "t_act", status: NUMBER_STATUS.ACTIVE });
  assert.equal(tenantHasLiveNumber(s, "t_act"), true, "active -> live");

  registerTenant(s, "t_term", {});
  s.numbers.push({ id: "num_rel", tenantId: "t_term", status: NUMBER_STATUS.RELEASED });
  s.numbers.push({ id: "num_fail", tenantId: "t_term", status: NUMBER_STATUS.FAILED });
  assert.equal(tenantHasLiveNumber(s, "t_term"), false, "nur released/failed -> false");
});

test("B(f) tenantGeo: gesetzt -> Werte, fehlend -> {null,null}", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_g", {});
  assert.deepEqual(
    tenantGeo(s, "t_g"),
    { country: null, defaultLanguage: null },
    "fehlend -> null",
  );
  setTenantGeo(s, "t_g", { country: "FR", defaultLanguage: "fr" });
  assert.deepEqual(tenantGeo(s, "t_g"), { country: "FR", defaultLanguage: "fr" });
});

test("B(g) Outbound-Gate offen: aktiver Tenant + setKycLevel(card) -> tenantActiveSubscriber true", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_sub", {});
  assert.equal(
    tenantActiveSubscriber(s, "t_sub", KYC_OUTBOUND_MIN),
    false,
    "ohne KYC noch kein Subscriber",
  );
  setKycLevel(s, "t_sub", KYC_LEVEL.CARD);
  assert.equal(
    tenantActiveSubscriber(s, "t_sub", KYC_OUTBOUND_MIN),
    true,
    "card oeffnet das Outbound-Gate (P3 Kern-Fix)",
  );
});

test("B(h) Idempotenz: zweiter Trigger-Kern kauft nicht doppelt (genau eine Nummer)", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_one", {});
  const opts = { tenantId: "t_one", fallbackCountry: "DE", ...CAPS };
  const first = requestNumberForPaidTenant(s, opts);
  assert.equal(first.ok, true, "erster Lauf fragt eine Nummer an");
  const second = requestNumberForPaidTenant(s, opts);
  assert.equal(second.ok, false, "zweiter Lauf -> Guard greift");
  assert.equal(second.reason, "already_provisioned");
  assert.equal(
    s.numbers.filter((n) => n.tenantId === "t_one").length,
    1,
    "genau eine Nummer pro bezahltem Abo",
  );
});

test("A(k) Perioden-Anker aus items.data[0] landet im setTenantSubscription-Patch (Quota-Fenster-Fix)", async () => {
  const deps = fakeDeps();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: {
        object: {
          id: "sub_q",
          status: "active",
          items: { data: [{ current_period_start: 1890864000, current_period_end: 1893456000 }] },
          metadata: { tenant_ref: "t_q", plan_slug: "business" },
        },
      },
    },
    deps,
  );
  assert.deepEqual(deps.calls.subscription, [
    [
      "t_q",
      {
        subscriptionId: "sub_q",
        planSlug: "business",
        currentPeriodEnd: 1893456000,
        currentPeriodStart: 1890864000,
      },
    ],
    ...activationMarkerPatches("t_q"),
  ], "Anker aus dem Item persistiert (kein leeres Quota-Fenster)");
});

test("A(l) Suspend stempelt suspended_at (setSuspendedAtIfAbsent), Activate loescht ihn", async () => {
  const sup = fakeDeps({ tenantBySub: "t_l" });
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.DELETED, data: { object: { id: "sub_l", metadata: { tenant_ref: "t_l" } } } },
    sup,
  );
  assert.deepEqual(sup.calls.suspend, ["t_l"], "Suspend stempelt den Grace-Anker");
  assert.deepEqual(sup.calls.clearSuspend, [], "Suspend loescht nicht");

  const act = fakeDeps();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: { object: { id: "sub_l", status: "active", metadata: { tenant_ref: "t_l" } } },
    },
    act,
  );
  assert.deepEqual(act.calls.clearSuspend, ["t_l"], "Reaktivierung loescht den Grace-Anker");
  assert.deepEqual(act.calls.suspend, [], "Activate stempelt nicht");
});

const UNBEKANNTER_MANDANT = "t_gibt_es_nicht";
const UNBEKANNTE_STUFE = "stufe_unbekannt";

test("C(a) numberRecordByE164: nur aktive Nummer mit dieser E.164, ohne Angabe nie ein Treffer", () => {
  const s = makeDefaultState();
  s.numbers.push({ id: "num_ohne", tenantId: "t_c", status: NUMBER_STATUS.ACTIVE });
  s.numbers.push({ id: "num_a", tenantId: "t_c", status: NUMBER_STATUS.ACTIVE, e164: "+4930111" });
  s.numbers.push({ id: "num_r", tenantId: "t_c", status: NUMBER_STATUS.RELEASED, e164: "+4930222" });
  assert.equal(numberRecordByE164(s, undefined), null, "ohne Angabe kein Treffer");
  assert.equal(numberRecordByE164(s, ""), null);
  assert.equal(numberRecordByE164(s, "+4930111").id, "num_a");
  assert.equal(numberRecordByE164(s, "+4930222"), null, "nicht aktive Nummer zaehlt nicht");
});

test("C(b) canTransitionNumber: erlaubter Uebergang ja, unbekannter Ausgangsstatus nie", () => {
  assert.equal(canTransitionNumber(NUMBER_STATUS.ACTIVE, NUMBER_STATUS.RELEASED), true);
  assert.equal(canTransitionNumber(NUMBER_STATUS.RELEASED, NUMBER_STATUS.ACTIVE), false);
  assert.equal(Object.keys(NUMBER_TRANSITIONS).includes(UNBEKANNTE_STUFE), false);
  assert.equal(canTransitionNumber(UNBEKANNTE_STUFE, "Stryker was here"), false);
});

test("C(c) kycReached/tenantActiveSubscriber: ohne Mandant oder ohne KYC-Stufe nie erreicht", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_ohne_kyc", {});
  assert.equal(kycReached(s, UNBEKANNTER_MANDANT, KYC_LEVEL.NONE), false, "kein Mandant");
  assert.equal(kycReached(s, "t_ohne_kyc", UNBEKANNTE_STUFE), false, "ohne Stufe nie erreicht");
  assert.equal(
    tenantActiveSubscriber(s, "t_ohne_kyc", UNBEKANNTE_STUFE),
    false,
    "ohne Stufe kein Abonnent",
  );
  setKycLevel(s, "t_ohne_kyc", KYC_LEVEL.CARD);
  assert.equal(kycReached(s, "t_ohne_kyc", KYC_LEVEL.CARD), true);
  assert.equal(kycReached(s, "t_ohne_kyc", KYC_LEVEL.ID_VERIFIED), false);
});

test("C(d) Stripe-Daten: Teil-Update laesst Rest stehen, unbekannter Mandant liefert null", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_str", {});
  setTenantStripe(s, "t_str", { customerId: "cus_1", paymentMethodId: "pm_1", paymentMethodType: "card" });
  setTenantStripe(s, "t_str", { customerId: "cus_2" });
  assert.deepEqual(tenantStripe(s, "t_str"), {
    customerId: "cus_2",
    paymentMethodId: "pm_1",
    paymentMethodType: "card",
  });
  assert.deepEqual(tenantStripe(s, UNBEKANNTER_MANDANT), {
    customerId: null,
    paymentMethodId: null,
    paymentMethodType: null,
  });
});

test("C(e) Abo-Daten: unbekannter Mandant wirft, leerer Plan erlaubt, Standardwerte, Suche ohne Id", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_abo", {});
  assert.throws(
    () => setTenantSubscription(s, UNBEKANNTER_MANDANT, { subscriptionId: "sub_x" }),
    /setTenantSubscription: Tenant t_gibt_es_nicht nicht gefunden/,
  );
  assert.doesNotThrow(() => setTenantSubscription(s, "t_abo", { planSlug: "" }));
  assert.deepEqual(tenantSubscription(s, "t_abo"), {
    subscriptionId: null,
    planSlug: "",
    currentPeriodEnd: null,
    currentPeriodStart: null,
    numberSetupFeeExempt: false,
    activationPending: false,
    periodCreditRevoked: false,
    cancelAtPeriodEnd: false,
  });
  assert.equal(tenantSubscription(s, UNBEKANNTER_MANDANT).activationPending, false);
  setTenantStripe(s, "t_abo", { customerId: "cus_abo" });
  setTenantSubscription(s, "t_abo", { subscriptionId: "sub_abo" });
  assert.equal(findTenantBySubscription(s, "sub_abo").id, "t_abo");
  assert.equal(findTenantBySubscription(s, undefined), null);
  assert.equal(findTenantByCustomer(s, "cus_abo").id, "t_abo");
  assert.equal(findTenantByCustomer(s, undefined), null);
});

test("C(f) Billing-Hold: unbekannter Mandant stoert nicht, Faelligkeit ab genau dem Zeitpunkt aktiv", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_hold", {});
  const faellig = "2030-01-01T00:00:00.000Z";
  assert.doesNotThrow(() => setBillingHold(s, UNBEKANNTER_MANDANT, { reason: "x" }));
  assert.doesNotThrow(() => clearBillingHold(s, UNBEKANNTER_MANDANT));
  assert.equal(billingHoldActive(s, UNBEKANNTER_MANDANT, faellig), null);
  assert.equal(billingHoldActive(s, "t_hold", faellig), null, "ohne Hold null");
  setBillingHold(s, "t_hold", { reason: "zahlung", dueAtIso: faellig });
  assert.equal(billingHoldActive(s, "t_hold", "2029-12-31T23:59:59.999Z"), null, "vor Faelligkeit");
  assert.equal(billingHoldActive(s, "t_hold", faellig), "zahlung", "genau zur Faelligkeit aktiv");
  assert.equal(billingHoldActive(s, "t_hold", "2030-01-02T00:00:00.000Z"), "zahlung");
});

test("C(g) normalizePrivateNumber: leer -> null, ungueltig wirft, tenantGeo/failedNumberCount", () => {
  assert.equal(normalizePrivateNumber("   ", "DE"), null, "nur Leerzeichen -> keine Nummer");
  assert.equal(normalizePrivateNumber(null, "DE"), null);
  assert.equal(normalizePrivateNumber("+49 30 123456", "DE"), "+4930123456");
  assert.throws(() => normalizePrivateNumber("abc", "DE"), /ungueltiges E\.164-Format/);
  assert.throws(() => normalizePrivateNumber(12345, "DE"), /ungueltiges E\.164-Format/);

  const s = makeDefaultState();
  assert.deepEqual(tenantGeo(s, UNBEKANNTER_MANDANT), { country: null, defaultLanguage: null });
  s.numbers.push({ id: "n1", tenantId: "t_x", status: NUMBER_STATUS.FAILED });
  s.numbers.push({ id: "n2", tenantId: "t_x", status: NUMBER_STATUS.FAILED });
  s.numbers.push({ id: "n3", tenantId: "t_x", status: NUMBER_STATUS.ACTIVE });
  s.numbers.push({ id: "n4", tenantId: "t_y", status: NUMBER_STATUS.FAILED });
  s.numbers.push({ id: "n5", tenantId: "t_y", status: NUMBER_STATUS.ACTIVE });
  assert.equal(failedNumberCount(s, "t_x"), 2, "nur eigene fehlgeschlagene Nummern");
});

import { findTenant, setPrivateNumber } from "../src/store/state-ops.js";

test("C(h) Schreiber geben den gespeicherten Mandantensatz zurueck", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_ret", {});
  const gespeichert = () => findTenant(s, "t_ret");
  assert.equal(setKycLevel(s, "t_ret", KYC_LEVEL.CARD), gespeichert());
  assert.equal(setTenantStripe(s, "t_ret", { customerId: "cus_ret" }), gespeichert());
  assert.equal(setTenantSubscription(s, "t_ret", { subscriptionId: "sub_ret" }), gespeichert());
  assert.equal(setPrivateNumber(s, "t_ret", "+49 30 123456"), gespeichert());
  assert.equal(setTenantGeo(s, "t_ret", { timezone: "Europe/Berlin" }), gespeichert());
});

test("C(i) Widerruf des Perioden-Guthabens wird gespeichert und zurueckgelesen", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_widerruf", {});
  setTenantSubscription(s, "t_widerruf", { periodCreditRevoked: true });
  assert.equal(tenantSubscription(s, "t_widerruf").periodCreditRevoked, true);
  assert.equal(findTenant(s, "t_widerruf").stripePeriodCreditRevoked, true);
});

test("C(j) clearBillingHold loescht Hold und Faelligkeit im Mandantensatz", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_clear", {});
  setBillingHold(s, "t_clear", { reason: "zahlung", dueAtIso: "2030-01-01T00:00:00.000Z" });
  clearBillingHold(s, "t_clear");
  assert.equal(findTenant(s, "t_clear").billingHold, null);
  assert.equal(findTenant(s, "t_clear").billingHoldDueAt, null);
});
