// GAP-05 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-05").
// Kein Nummernkauf ohne Hold (Gutschein-Missbrauch): der Setup-Hold wird seit P4 IMMER
// gestellt, auch fuer einen per numberSetupFeeExempt befreiten Tenant - die Befreiung
// wirkt nur noch auf die PREIS-Achse (Storno statt Einzug am Ende, settleSetupFeeHold in
// src/onboarding.js). Rein, offline (Muster test/billing-hold-capture.test.js:
// provisionNumber + fakeBilling/fakeProvisioner).
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
  findNumber,
  setTenantSubscription,
  setTenantStripe,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1", holdAmountCents: 500, currency: "eur" };

test("Ein 100-%-Gutschein-Tenant bekommt die Nummer nur mit gestelltem Setup-Hold (GAP-05, gefixt in P4)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_gap05");
  setTenantSubscription(s, "t_gap05", { numberSetupFeeExempt: true });
  // Karte hinterlegt: der Hold-Riegel gilt jetzt UNABHAENGIG von der Befreiung.
  setTenantStripe(s, "t_gap05", {
    customerId: "cus_gap05",
    paymentMethodId: "pm_gap05",
    paymentMethodType: "card", // GP-P2: Eignungs-Gate laesst nur hold-faehige Typen durch
  });
  const { number } = requestNumber(s, { tenantId: "t_gap05", ...CAPS });

  const prov = fakeProvisioner();
  const billing = fakeBilling();
  const result = await provisionNumber(s, { provisioner: prov, billing }, { numberId: number.id, ...ARGS });

  assert.equal(result.status, NUMBER_STATUS.ACTIVE, "Nummer wurde aktiviert (Hold+Storno statt Kauf-Abbruch)");
  const ops = billing.log.map((entry) => entry[0]);
  assert.ok(ops.includes("placeHold"), `SOLL: Hold wird gestellt, auch befreit; log=${JSON.stringify(ops)}`);
  assert.ok(ops.includes("cancelHold"), `SOLL: Hold wird storniert (befreit -> kein Einzug); log=${JSON.stringify(ops)}`);
  assert.ok(!ops.includes("captureHold"), `SOLL: KEIN Einzug fuer einen befreiten Tenant; log=${JSON.stringify(ops)}`);
});

test("GAP-05 SOLL: allow_promotion_codes darf nicht bedingungslos gesetzt sein (nur mit expliziter Coupon-Allowlist)", async () => {
  const withStripeStub = makeStripeStub(config, "sk_test_gap05");
  let captured;
  await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({ id: "cs_1", url: "https://stripe.test/c/cs_1" }) };
    },
    () =>
      stripeBilling.createSubscriptionCheckoutSession({
        tenantRef: "t_gap05",
        customerId: "cus_1",
        priceId: "price_starter",
        planSlug: "starter",
        successUrl: "https://agent.test/ok",
        cancelUrl: "https://agent.test/no",
      }),
  );
  assert.notEqual(
    captured.opts.body.get("allow_promotion_codes"),
    "true",
    "SOLL: allow_promotion_codes darf nur GEMEINSAM mit einer expliziten Coupon-Allowlist " +
      "gesetzt werden (heute: bedingungslos 'true', src/billing/stripe.js:279 - jeder " +
      "beliebige Stripe-Gutscheincode wird angenommen)",
  );
});
