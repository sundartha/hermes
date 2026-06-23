// F2 P7 - planSummarySms: reine Ziel-/Sende-Entscheidung fuer die Summary-SMS nach
// einem Inbound-Call. Offline-Unit-Test mit Fake-Store (kein DB, kein Netz, F.I.R.S.T.).
// Deckt die Sicherheits-Invarianten ab:
//   - alles vorhanden -> send, Ziel = private Nummer des Call-Tenants
//   - H3: Ziel IMMER ueber call.tenantId, nie eine fremde Nummer
//   - kein Ziel -> skip + reason=no_private_number (M4: kein Crash, PII-frei auditierbar)
//   - Opt-Out (smsSummaryOptIn=false) / Feature-Schalter aus / kein Absender -> skip, KEIN reason
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSummarySms } from "../src/sms-summary.js";
import { NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";

const PROV = PROVIDER.TWILIO;

// Fake-Store: pro Tenant privateNumber (Ziel), sender (aktive Absender-Nummer) und optIn.
// Bildet exakt die drei Reads ab, die planSummarySms macht (Vertrag dokumentiert).
function makeStore(tenants) {
  const numbers = [];
  for (const [tenantId, t] of Object.entries(tenants))
    if (t.sender) numbers.push({ tenantId, e164: t.sender, status: NUMBER_STATUS.ACTIVE, provider: PROV });
  return {
    tenantPrivateNumber: (id) => tenants[id]?.privateNumber ?? null,
    load: () => ({ numbers }),
    tenantContext: (id) => ({ settings: { smsSummaryOptIn: tenants[id]?.optIn ?? true } }),
  };
}
const call = (tenantId) => ({ id: `call_${tenantId}`, tenantId, provider: PROV });
const cfg = (sendSmsSummary = true) => ({ sendSmsSummary });

test("alles vorhanden -> send=true, Ziel = private Nummer des Call-Tenants", () => {
  const store = makeStore({ A: { privateNumber: "+491701234567", sender: "+4915100000001", optIn: true } });
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
  assert.equal(planSummarySms(store, cfg(), call("A")).to, "+491701111111", "Call an A -> A's Nummer");
  assert.equal(planSummarySms(store, cfg(), call("B")).to, "+492209999999", "Call an B -> B's Nummer");
});

test("kein Ziel (keine private Nummer) -> send=false, reason=no_private_number (M4)", () => {
  const store = makeStore({ A: { privateNumber: null, sender: "+4915100000001", optIn: true } });
  const plan = planSummarySms(store, cfg(), call("A"));
  assert.equal(plan.send, false);
  assert.equal(plan.reason, "no_private_number");
  assert.equal(plan.to, null);
});

test("Opt-Out (smsSummaryOptIn=false) -> send=false, KEIN reason (kein Ziel-Defizit)", () => {
  const store = makeStore({ A: { privateNumber: "+491701234567", sender: "+4915100000001", optIn: false } });
  const plan = planSummarySms(store, cfg(), call("A"));
  assert.equal(plan.send, false);
  assert.equal(plan.reason, null);
});

test("Feature-Schalter aus (config.sendSmsSummary=false) -> send=false, kein reason", () => {
  const store = makeStore({ A: { privateNumber: "+491701234567", sender: "+4915100000001", optIn: true } });
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
