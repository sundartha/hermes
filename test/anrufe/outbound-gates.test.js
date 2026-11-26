import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeOutboundGates,
  tariffCentsPerMin,
} from "../../src/telephony/outbound-gates.js";
import { config } from "../../src/config.ts";
import { MAX_CALL_DURATION_CAP_S } from "../../src/begriffe/anrufe.ts";
import { outboundReserveCents } from "../../src/begriffe/abrechnung.ts";

const US_TARGET = "+15551234567";
const DE_OWN_DID = "+4930111222333";
const TENANT = "T";
const storeFake = {
  tenantBudgetSnapshot: () => ({ capCents: 1_000_000, spentCents: 0, remainingCents: 1_000_000 }),
};
const computeReserveGate = makeOutboundGates({ store: storeFake, config }).gates.find(
  (g) => g.name === "compute_reserve",
);

async function gateCtxFor() {
  const ctx = {
    b: {},
    to: US_TARGET,
    fromNumber: DE_OWN_DID,
    tenantId: TENANT,
  };
  await computeReserveGate.run(ctx);
  return ctx;
}

test("PAY-26: bei grossem Guthaben ist die Frist die absolute Obergrenze, die Reserve Satz mal Vorlauffenster", async () => {
  const { maxDur, reserveCents } = await gateCtxFor();
  assert.equal(
    maxDur,
    MAX_CALL_DURATION_CAP_S,
    "die Frist waechst hoechstens bis zur absoluten Obergrenze",
  );
  assert.equal(
    reserveCents,
    outboundReserveCents(tariffCentsPerMin(US_TARGET, DE_OWN_DID)),
    "und die Reserve bleibt davon unberuehrt (KS-P3 (a): Satz * Vorlauffenster)",
  );
});
