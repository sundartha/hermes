import test from "node:test";
import assert from "node:assert/strict";
import { budgetAxisLabel } from "../src/boot.js";

test("budgetAxisLabel: Flag AUS - Tenant-Achse nennt Perioden-Fenster, nicht Lebenszeit-Topf", () => {
  const label = budgetAxisLabel(false, "Perioden-Fenster");
  assert.match(label, /Perioden-Fenster/);
  assert.doesNotMatch(label, /Lebenszeit/);
  assert.match(label, /BUDGET_MONTH_ENABLED=false/);
});

test("budgetAxisLabel: Flag AUS - Plattform-Achse bleibt beim Lebenszeit-Topf", () => {
  const label = budgetAxisLabel(false, "Lebenszeit-Topf");
  assert.match(label, /Lebenszeit-Topf/);
  assert.doesNotMatch(label, /Perioden-Fenster/);
});

test("budgetAxisLabel: Flag AN - beide Achsen melden denselben Spend-Monat (keine Divergenz)", () => {
  const tenantLabel = budgetAxisLabel(true, "Perioden-Fenster");
  const platformLabel = budgetAxisLabel(true, "Lebenszeit-Topf");
  assert.equal(tenantLabel, platformLabel);
  assert.match(tenantLabel, /Spend-Monat/);
  assert.match(tenantLabel, /BUDGET_MONTH_ENABLED=true/);
});
