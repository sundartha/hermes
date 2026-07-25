// P4 GAP-03: includedMinutesFor (billing/plan-caps.js) - EINE Quelle fuer Gate
// (outbound-gates.js planMinutesExhausted) UND Anzeige (billing/meter.js quotaView).
// Rein, offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { includedMinutesFor } from "../src/billing/plan-caps.js";
import { quotaView } from "../src/billing/meter.js";
import { findPlan } from "../src/plans.js";
import { makeDefaultState, registerTenant, setTenantSubscription } from "../src/store/state-ops.js";

test("includedMinutesFor: 0 bei periodCreditRevoked, sonst plan.includedMinutes", () => {
  const plan = findPlan("starter");
  assert.equal(includedMinutesFor({ plan, subscription: { periodCreditRevoked: true } }), 0);
  assert.equal(
    includedMinutesFor({ plan, subscription: { periodCreditRevoked: false } }),
    plan.includedMinutes,
  );
  assert.equal(
    includedMinutesFor({ plan, subscription: {} }),
    plan.includedMinutes,
    "fehlendes Flag -> kein Widerruf",
  );
});

test("includedMinutesFor: kein Plan (null) -> undefined, unabhaengig vom Flag", () => {
  assert.equal(includedMinutesFor({ plan: null, subscription: { periodCreditRevoked: true } }), 0);
  assert.equal(includedMinutesFor({ plan: null, subscription: {} }), undefined);
});

test("quotaView zeigt dasselbe Fenster wie das Gate: periodCreditRevoked -> 0 inkludierte Minuten", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_pc1", {});
  const periodStartIso = "2026-01-01T00:00:00.000Z";
  setTenantSubscription(s, "t_pc1", {
    planSlug: "starter",
    currentPeriodStart: Math.floor(Date.parse(periodStartIso) / 1000),
    periodCreditRevoked: true,
  });
  const view = quotaView(s, {
    tenantId: "t_pc1",
    planSlug: "starter",
    currentPeriodStart: Math.floor(Date.parse(periodStartIso) / 1000),
    currentPeriodEnd: null,
    periodCreditRevoked: true,
  });
  assert.equal(view.includedMinutes, 0);
  assert.equal(view.remainingMinutes, 0);
  assert.equal(view.exhausted, true);
});

test("quotaView ohne periodCreditRevoked bleibt byte-identisch zum Bestand (volles Kontingent)", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_pc2", {});
  const plan = findPlan("starter");
  const view = quotaView(s, {
    tenantId: "t_pc2",
    planSlug: "starter",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    periodCreditRevoked: false,
  });
  assert.equal(view.includedMinutes, plan.includedMinutes);
});
