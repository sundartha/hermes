import { test } from "node:test";
import assert from "node:assert/strict";
import * as stateOps from "../src/store/state-ops.js";

const NAMEN = ["tenantBudgetRow", "seedTenantDefaultBudget", "deriveTenantBudgetFromPlan", "setTenantBudget"];

test("Budget-Zeile liegt in zustand/budget.js und state-ops reicht dieselben Funktionen weiter", async () => {
  const budget = await import("../src/store/zustand/budget.js");
  for (const name of NAMEN) {
    assert.equal(typeof budget[name], "function", name);
  }
  assert.equal(budget.setTenantBudget, stateOps.setTenantBudget);
  assert.equal(budget.deriveTenantBudgetFromPlan, stateOps.deriveTenantBudgetFromPlan);
  assert.equal(typeof stateOps.tenantBudgetSnapshot, "function");
});

test("setTenantBudget legt an und überschreibt dieselbe Zeile", async () => {
  const { setTenantBudget, tenantBudgetRow } = await import("../src/store/zustand/budget.js");
  const state = stateOps.makeDefaultState();
  assert.equal(tenantBudgetRow(state, "t1"), null);
  setTenantBudget(state, "t1", { budgetCents: 100, hardCapCents: 200 });
  const again = setTenantBudget(state, "t1", { budgetCents: 300, hardCapCents: 400 });
  assert.deepEqual(again, { tenantId: "t1", budgetCents: 300, hardCapCents: 400 });
  assert.equal(state.tenantBudgets.filter((b) => b.tenantId === "t1").length, 1);
});
