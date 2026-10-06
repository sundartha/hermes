import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionNumber } from "../src/onboarding.js";
import { fakeBilling, fakeProvisioner } from "./helpers.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  findNumber,
  setTenantStripe,
  bindPlatformNumber,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1", holdAmountCents: 500, currency: "eur" };
const BOUND_E164 = "+4915799990002";

function seedRequested() {
  const state = makeDefaultState();
  registerTenant(state, "t_user1");
  setTenantStripe(state, "t_user1", {
    customerId: "cus_1",
    paymentMethodId: "pm_1",
    paymentMethodType: "card",
  });
  const { number } = requestNumber(state, { tenantId: "t_user1", ...CAPS });
  return { state, numberId: number.id };
}

test("Capture wirft + gekaufte e164 ist plattform-gebunden -> KEIN Provider-DELETE, KEIN releaseNumber, Status bleibt failed", async () => {
  const { state, numberId } = seedRequested();
  bindPlatformNumber(state, { e164: BOUND_E164, purpose: "outbound_ani", provider: "telnyx" });
  const prov = fakeProvisioner({
    async orderNumber() {
      return { e164: BOUND_E164, providerNumberId: "num_ext_bound" };
    },
  });
  const billing = fakeBilling({
    async captureHold() {
      throw new Error("Stripe captureHold fehlgeschlagen: HTTP 500");
    },
  });
  const logs = [];
  const logger = { warn: (msg) => logs.push(msg) };
  await assert.rejects(
    () => provisionNumber(state, { provisioner: prov, billing, logger }, { numberId, ...ARGS }),
    /HTTP 500/,
  );

  assert.ok(
    !prov.log.some((line) => line.startsWith("release")),
    "kein Provider-Release bei Plattform-Bindung",
  );
  assert.equal(findNumber(state, numberId).status, NUMBER_STATUS.FAILED);
  assert.ok(billing.log.some((entry) => entry[0] === "cancelHold"), "Hold wird freigegeben");
  assert.ok(
    logs.some((msg) => msg.includes("uebersprungen") && msg.includes("Plattform-Bindung")),
    "HOLD wird sichtbar geloggt statt still zu verschwinden",
  );
});

test("Positiv-Kontrolle: Capture wirft + gekaufte e164 ist NICHT gebunden -> Provider-Release + releaseNumber laufen normal", async () => {
  const { state, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const billing = fakeBilling({
    async captureHold() {
      throw new Error("Stripe captureHold fehlgeschlagen: HTTP 500");
    },
  });
  await assert.rejects(
    () => provisionNumber(state, { provisioner: prov, billing }, { numberId, ...ARGS }),
    /HTTP 500/,
  );

  assert.ok(prov.log.includes("release:num_ext_1"), "ungebundene Nummer wird normal freigegeben");
  assert.equal(findNumber(state, numberId).status, NUMBER_STATUS.RELEASED);
});
