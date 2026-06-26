// P3 - Payment-gated Aktivierung + Provisioning. Zwei Ebenen, beide offline (F.I.R.S.T.):
//  Teil A) applyStripeWebhook ACTIVATE ueber injizierte Fake-Seams (Muster
//          w5-billing-revoke.test.js): bestaetigte Zahlung -> Abo nachziehen + KYC=CARD +
//          status=active + GENAU EIN provision-Aufruf; Suspend kauft NIE.
//  Teil B) die neuen state-ops-Queries (tenantHasLiveNumber/tenantGeo) + der Trigger-Kern
//          (Guard + requestNumber) + das geoeffnete Outbound-Gate - ueber makeDefaultState,
//          ohne Server-Spawn (Repo-Konvention, Lehre p6a-Stall).
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
} from "../src/store/state-ops.js";
import { KYC_LEVEL, KYC_OUTBOUND_MIN, NUMBER_STATUS } from "../src/store/defaults.js";
import { requestNumberForPaidTenant } from "../src/billing/provision-trigger.js";

// Cap hoch genug, dass die Kosten-Notbremse in diesen Tests nie greift (nur die
// Idempotenz/Geo-Logik wird geprueft, nicht der Cap - der hat eigene Tests).
const HIGH_CAP = 100;
const CAPS = { maxNumbers: HIGH_CAP, maxNumbersPerTenant: HIGH_CAP };

// ---- Teil A: applyStripeWebhook ACTIVATE (Unit, Fake-Seams) ----

// Aufzeichnende Seams: store loest den Tenant ggf. ueber subscriptionId auf und
// protokolliert Abo-/KYC-Schreibung; accounts/sessions/provision protokollieren ihre Wirkung.
function fakeDeps({ tenantBySub = null } = {}) {
  const calls = { setStatus: [], invalidate: [], subscription: [], kyc: [], provision: [] };
  return {
    calls,
    store: {
      findTenantBySubscription: (subId) => (tenantBySub && subId ? { id: tenantBySub } : null),
      setTenantSubscription: (tenant, patch) => calls.subscription.push([tenant, patch]),
      setKycLevel: (tenant, level) => calls.kyc.push([tenant, level]),
    },
    accounts: { setStatus: async (tenant, status) => calls.setStatus.push([tenant, status]) },
    sessions: { invalidateByTenant: async (tenant) => calls.invalidate.push(tenant) },
    audit: () => {},
    req: {},
    provision: async (tenant) => calls.provision.push(tenant),
  };
}

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
  ]);
  assert.deepEqual(deps.calls.kyc, [["t_a", KYC_LEVEL.CARD]], "KYC auf CARD gehoben");
  assert.deepEqual(deps.calls.setStatus, [["t_a", "active"]], "Status aktiv");
  assert.deepEqual(deps.calls.provision, ["t_a"], "provision genau 1x mit t_a");
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

// ---- Teil B: state-ops-Ebene (Unit, makeDefaultState) ----

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
