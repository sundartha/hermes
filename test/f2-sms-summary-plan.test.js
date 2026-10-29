import { test } from "node:test";
import assert from "node:assert/strict";
import { planSummarySms } from "../src/sms-summary.js";
import { NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";

const PROV = PROVIDER.TELNYX;

function makeStore(tenants) {
  const numbers = [];
  for (const [tenantId, t] of Object.entries(tenants))
    if (t.sender)
      numbers.push({ tenantId, e164: t.sender, status: NUMBER_STATUS.ACTIVE, provider: PROV });
  return {
    tenantPrivateNumber: (id) => tenants[id]?.privateNumber ?? null,
    load: () => ({ numbers }),
    tenantContext: (id) => ({ settings: { smsSummaryOptIn: tenants[id]?.optIn ?? true } }),
    dailySmsCount: (id) => tenants[id]?.smsCount ?? 0,
  };
}
const call = (tenantId) => ({ id: `call_${tenantId}`, tenantId, provider: PROV });
const cfg = (sendSmsSummary = true) => withConfigNamespaces({ sendSmsSummary, dailySmsCap: 20 });

test("alles vorhanden -> send=true, Ziel = private Nummer des Call-Tenants", () => {
  const store = makeStore({
    A: { privateNumber: "+491701234567", sender: "+4915100000001", optIn: true },
  });
  const plan = planSummarySms(store, cfg(), call("A"));
  assert.equal(plan.send, true);
  assert.equal(plan.to, "+491701234567");
  assert.equal(plan.reason, null);
  assert.equal(plan.smsFrom.e164, "+4915100000001");
});

test("H3: Ziel IMMER ueber call.tenantId - Call an A -> A's Nummer, nie B's", () => {
  const store = makeStore({
    A: { privateNumber: "+491701111111", sender: "+4915100000001", optIn: true },
    B: { privateNumber: "+492209999999", sender: "+4915100000002", optIn: true },
  });
  assert.equal(
    planSummarySms(store, cfg(), call("A")).to,
    "+491701111111",
    "Call an A -> A's Nummer",
  );
  assert.equal(
    planSummarySms(store, cfg(), call("B")).to,
    "+492209999999",
    "Call an B -> B's Nummer",
  );
});

test("kein Ziel (keine private Nummer) -> send=false, reason=no_private_number (M4)", () => {
  const store = makeStore({ A: { privateNumber: null, sender: "+4915100000001", optIn: true } });
  const plan = planSummarySms(store, cfg(), call("A"));
  assert.equal(plan.send, false);
  assert.equal(plan.reason, "no_private_number");
  assert.equal(plan.to, null);
});

test("Opt-Out (smsSummaryOptIn=false) -> send=false, KEIN reason (kein Ziel-Defizit)", () => {
  const store = makeStore({
    A: { privateNumber: "+491701234567", sender: "+4915100000001", optIn: false },
  });
  const plan = planSummarySms(store, cfg(), call("A"));
  assert.equal(plan.send, false);
  assert.equal(plan.reason, null);
});

test("Feature-Schalter aus (config.sendSmsSummary=false) -> send=false, kein reason", () => {
  const store = makeStore({
    A: { privateNumber: "+491701234567", sender: "+4915100000001", optIn: true },
  });
  const plan = planSummarySms(store, cfg(false), call("A"));
  assert.equal(plan.send, false);
  assert.equal(plan.reason, null);
});

test("kein Absender (keine aktive Nummer) -> send=false, kein reason (Bestandsverhalten)", () => {
  const store = makeStore({ A: { privateNumber: "+491701234567", sender: null, optIn: true } });
  const plan = planSummarySms(store, cfg(), call("A"));
  assert.equal(plan.send, false);
  assert.equal(plan.reason, null);
});

test("[NIE2] die SMS-Tageskappe zaehlt genau das letzte 24-Stunden-Fenster", async (t) => {
  const { store } = await makePgTestStore();
  store.seedBootstrapNumber("+4915100000001", BOOTSTRAP_TENANT_ID, PROV);
  store.setPrivateNumber(BOOTSTRAP_TENANT_ID, "+491701234567");
  const sentAt = Date.parse("2026-08-14T12:00:00.000Z");
  store.recordUsageEvent({
    tenantId: BOOTSTRAP_TENANT_ID,
    kind: "sms",
    quantity: 1,
    costCents: 0,
    occurredAt: new Date(sentAt).toISOString(),
  });
  const capOne = withConfigNamespaces({ sendSmsSummary: true, dailySmsCap: 1 });
  t.mock.timers.enable({ apis: ["Date"], now: sentAt });
  const reasonAfter = (ms) => {
    t.mock.timers.setTime(sentAt + ms);
    return planSummarySms(store, capOne, call(BOOTSTRAP_TENANT_ID)).reason;
  };
  const DAY = 86_400_000;
  assert.deepEqual(
    [reasonAfter(60_000), reasonAfter(DAY / 2), reasonAfter(DAY), reasonAfter(DAY + 1)],
    ["daily_cap", "daily_cap", "daily_cap", null],
  );
});
