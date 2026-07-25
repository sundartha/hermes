// GAP-05 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-05").
// Kein Nummernkauf ohne Hold (Gutschein-Missbrauch): placeHoldUnlessExempt() springt
// bei numberSetupFeeExempt=true DIREKT zu beginProvisioning und gibt null zurueck (kein
// Hold, kein captureHold) - die Kaufkette laeuft unveraendert weiter. Rein, offline
// (Muster test/billing-hold-capture.test.js: provisionNumber + fakeBilling/fakeProvisioner).
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
} from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1", holdAmountCents: 500, currency: "eur" };

test("GAP-05 SOLL: ein 100%-Gutschein-Tenant (numberSetupFeeExempt) bekommt trotzdem eine Nummer, OHNE jeden Hold", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_gap05");
  // KEINE Karte hinterlegt (der Exempt-Zweig braucht keine - genau das ist der Punkt:
  // die Money-Safety-Pruefung (Karte-Pflicht) wird komplett uebersprungen).
  setTenantSubscription(s, "t_gap05", { numberSetupFeeExempt: true });
  const { number } = requestNumber(s, { tenantId: "t_gap05", ...CAPS });

  const prov = fakeProvisioner();
  const billing = fakeBilling();
  const result = await provisionNumber(s, { provisioner: prov, billing }, { numberId: number.id, ...ARGS });

  assert.equal(
    result.status,
    NUMBER_STATUS.ACTIVE,
    "Vorbedingung: die Nummer wurde trotz Befreiung tatsaechlich aktiviert (kein Hold noetig)",
  );
  assert.notEqual(
    billing.log.length,
    0,
    "SOLL: entweder wird KEINE Nummer bestellt (Gegenteil der obigen Vorbedingung), ODER es " +
      `wird ein Hold ueber die Setup-Gebuehr platziert; heute: billing.log ist leer (${billing.log.length} ` +
      "Aufrufe) - onboarding.js:134-136 (placeHoldUnlessExempt) springt bei gesetztem Flag " +
      "direkt zu beginProvisioning und gibt null zurueck, die Kaufkette laeuft unveraendert weiter",
  );
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
