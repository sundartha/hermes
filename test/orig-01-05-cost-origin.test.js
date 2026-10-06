import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { makeDefaultState, registerTenant, reserveExceedsBudget } from "../src/store/state-ops.js";
import { outboundReserveCents } from "../src/store/defaults.js";

const TENANT_A = "t_orig";
const US_OWN_DID = "+15005550006";
const US_TARGET = "+15551234567";

test("Charakterisierung ORIG-05: US-Tenant ruft +1 (DID-Land == Ziel-Land) - Reserve 60 ct kommt seit P7 durch die Tenant-Decke 1500 ct", () => {
  const reserveCents = outboundReserveCents(tariffCentsPerMin(US_TARGET, US_OWN_DID));
  assert.equal(
    reserveCents,
    60,
    "Vorbedingung: live-gemessene Worst-Case-Reserve (KS-P6: 30 ct/min; KS-P3: * 2 Vorlauf-Minuten statt * 5 Dauer-Minuten)",
  );
  assert.equal(
    config.billing.defaultTenantBudgetCents,
    1500,
    "Vorbedingung: generische Tenant-Decke (Code-Fallback == render.yaml-Wert)",
  );

  const s = makeDefaultState();
  registerTenant(s, TENANT_A, {});
  assert.equal(
    reserveExceedsBudget(s, TENANT_A, reserveCents, config.billing),
    false,
    "seit P7: auch wenn DID-Land und Ziel-Land beide US sind, gibt es fuer +1 keinen " +
      "gemessenen Inlandssatz - der Worst-Case-Satz gilt weiter, die generische Tenant-Decke " +
      "traegt die Reserve aber jetzt genau. Das SOLL fuer 'der Anruf soll durchkommen' " +
      "fuehrt test/prod-config-smoke.test.js (GAP-33, Auslandsziel)",
  );
});
