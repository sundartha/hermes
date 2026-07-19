// outbound-p1c (D5): registerTenant seedt EINMALIG die per-Tenant-Default-Kostendecke
// (tenant_budget), damit ein neuer Tenant aus dem geteilten globalen Pool genommen wird
// (sonst faellt er in effectiveCapEur auf cfg.maxBudgetCents). Prueft: (1) Seed legt die
// Zeile budget == hard cap == Default an + hebt budgetExceeded auf den Default-Cap, (2)
// set-if-absent (zweiter registerTenant ueberschreibt NICHT), (3) defaultBudgetCents 0
// oder weggelassen -> KEINE Zeile (Owner/Bestand byte-identisch). Rein ueber state-ops.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  trackUsage,
  budgetExceeded,
} from "../src/store/state-ops.js";
import { PRICES, tokensOf } from "./_prices.js";

const DEFAULT_BUDGET_CENTS = 1000; // 10 EUR
const TOKENS_PER_EUR = 1_000_000 / 0.93;

test("registerTenant seedt die per-Tenant-Default-Kostendecke (Zeile budget == hard cap)", () => {
  const s = makeDefaultState();
  registerTenant(s, "user_x", {
    firstName: "Max",
    lastName: "Muster",
    defaultBudgetCents: DEFAULT_BUDGET_CENTS,
  });
  assert.deepEqual(
    s.tenantBudgets.find((b) => b.tenantId === "user_x"),
    { tenantId: "user_x", budgetCents: 1000, hardCapCents: 1000 },
    "tenant_budget-Zeile = Default (budget == hard cap)",
  );
});

test("seeded Default-Budget hebt budgetExceeded auf den Default-Cap (ueber dem 8-EUR-Default)", () => {
  const s = makeDefaultState();
  registerTenant(s, "user_x", { defaultBudgetCents: DEFAULT_BUDGET_CENTS }); // 10 EUR
  // 9 EUR Verbrauch: ueber dem globalen 8-EUR-Default, aber unter dem 10-EUR-Tenant-Cap.
  trackUsage(s, "user_x", tokensOf(Math.round(TOKENS_PER_EUR * 9), 0), PRICES);
  assert.equal(budgetExceeded(s, "user_x", PRICES), false, "9 EUR < 10-EUR-Tenant-Cap -> frei");
});

test("set-if-absent: zweiter registerTenant ueberschreibt die Zeile NICHT", () => {
  const s = makeDefaultState();
  registerTenant(s, "user_x", { defaultBudgetCents: 1000 });
  registerTenant(s, "user_x", { defaultBudgetCents: 2000 }); // existing-Zweig -> No-Op
  assert.equal(
    s.tenantBudgets.filter((b) => b.tenantId === "user_x").length,
    1,
    "kein Duplikat",
  );
  assert.equal(
    s.tenantBudgets.find((b) => b.tenantId === "user_x").hardCapCents,
    1000,
    "erste Zeile bleibt (kein Override)",
  );
});

test("defaultBudgetCents 0 oder weggelassen -> KEINE Zeile (Owner/Bestand byte-identisch)", () => {
  const s = makeDefaultState();
  registerTenant(s, "user_zero", { defaultBudgetCents: 0 });
  registerTenant(s, "user_none", { firstName: "Ohne" });
  assert.equal(s.tenantBudgets.find((b) => b.tenantId === "user_zero"), undefined, "0 -> kein Seed");
  assert.equal(s.tenantBudgets.find((b) => b.tenantId === "user_none"), undefined, "weggelassen -> kein Seed");
});
