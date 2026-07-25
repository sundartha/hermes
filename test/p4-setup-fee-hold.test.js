// P4 GAP-05: der Setup-Hold ist das GATE, nicht die Gebuehr. Rein, offline (Muster
// test/billing-hold-capture.test.js: provisionNumber + fakeBilling/fakeProvisioner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionNumber } from "../src/onboarding.js";
import { fakeBilling, fakeProvisioner, makeStripeStub } from "./helpers.js";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  setTenantSubscription,
  setTenantStripe,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1", holdAmountCents: 500, currency: "eur" };

function tenantWithCard(s, id, patch = {}) {
  registerTenant(s, id);
  setTenantStripe(s, id, { customerId: `cus_${id}`, paymentMethodId: `pm_${id}` });
  if (Object.keys(patch).length) setTenantSubscription(s, id, patch);
  return requestNumber(s, { tenantId: id, ...CAPS }).number;
}

test("exempt + Karte: placeHold UND cancelHold, KEIN captureHold, Nummer ACTIVE, paymentIntentId gesetzt", async () => {
  const s = makeDefaultState();
  const number = tenantWithCard(s, "t_exempt", { numberSetupFeeExempt: true });
  const billing = fakeBilling();
  const result = await provisionNumber(s, { provisioner: fakeProvisioner(), billing }, { numberId: number.id, ...ARGS });

  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  const ops = billing.log.map((e) => e[0]);
  assert.deepEqual(ops, ["placeHold", "cancelHold"]);
  assert.equal(result.paymentIntentId, "pi_fake_1");
});

test("nicht-exempt: placeHold + captureHold (byte-identisch zum Bestand)", async () => {
  const s = makeDefaultState();
  const number = tenantWithCard(s, "t_regular");
  const billing = fakeBilling();
  const result = await provisionNumber(s, { provisioner: fakeProvisioner(), billing }, { numberId: number.id, ...ARGS });

  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  const ops = billing.log.map((e) => e[0]);
  assert.deepEqual(ops, ["placeHold", "captureHold"]);
});

test("exempt + placeHold wirft -> failNumber, KEIN orderNumber", async () => {
  const s = makeDefaultState();
  const number = tenantWithCard(s, "t_exempt_fail", { numberSetupFeeExempt: true });
  const prov = fakeProvisioner();
  const billing = fakeBilling({
    async placeHold() {
      throw new Error("stripe down");
    },
  });
  await assert.rejects(
    () => provisionNumber(s, { provisioner: prov, billing }, { numberId: number.id, ...ARGS }),
    /stripe down/,
  );
  assert.deepEqual(prov.log, [], "kein Provider-Kauf ohne gestellten Hold");
});

test("createSubscriptionCheckoutSession traegt payment_method_collection=always UND allow_promotion_codes=true", async () => {
  const withStripeStub = makeStripeStub(config, "sk_test_p4setupfee");
  let captured;
  await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({ id: "cs_1", url: "https://stripe.test/c/cs_1" }) };
    },
    () =>
      stripeBilling.createSubscriptionCheckoutSession({
        tenantRef: "t_p4setupfee",
        customerId: "cus_1",
        priceId: "price_starter",
        planSlug: "starter",
        successUrl: "https://agent.test/ok",
        cancelUrl: "https://agent.test/no",
      }),
  );
  assert.equal(captured.opts.body.get("payment_method_collection"), "always");
  assert.equal(captured.opts.body.get("allow_promotion_codes"), "true");
});
