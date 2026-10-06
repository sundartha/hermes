import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { makeDefaultState, registerTenant, setTenantBudget, reserveExceedsBudget } from "../src/store/state-ops.js";
import { planCapCents } from "../src/billing/plan-caps.js";
import { tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { outboundReserveCents } from "../src/store/defaults.js";

const TENANT_A = "t_pay04_starter";
const NON_DOMESTIC_TARGET = "+15551234567";
const US_OWN_DID = "+15005550006";

test("PAY-04: Starter-Decke traegt die Worst-Case-Reserve eines Nicht-Inlandsanrufs bei 0 Ist-Verbrauch", () => {
  const capCents = planCapCents("starter", config.billing);
  assert.ok(capCents > 0, "Vorbedingung: die Kosten-Achse ist aktiv (Satz > 0)");

  const reserveCents = outboundReserveCents(tariffCentsPerMin(NON_DOMESTIC_TARGET, US_OWN_DID));

  const s = makeDefaultState();
  registerTenant(s, TENANT_A, {});
  setTenantBudget(s, TENANT_A, { budgetCents: capCents, hardCapCents: capCents });

  assert.equal(
    reserveExceedsBudget(s, TENANT_A, reserveCents, config.billing),
    false,
    "seit KS-P5a leiten Decke und Reserve sich aus DEMSELBEN Satz ab - ein Starter-Abonnent " +
      "kommt bei 0 Ist-Verbrauch zu einem Nicht-Inlandsziel durch",
  );
});
