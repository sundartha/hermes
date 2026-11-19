import assert from "node:assert/strict";
import { test } from "node:test";

import { config, assertConfig } from "../../src/config.js";
import { makeConfigOverrides, CONFIG_REQUIRED_OK } from "../helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const MIT_ZAHLUNG = {
  ...CONFIG_REQUIRED_OK,
  paymentEnabled: true,
  stripeSecretKey: "x",
  stripeWebhookSecret: "x",
  platformAlertSmsTo: "+15005550006",
};

const FAELLE = [
  [1, true],
  [100, true],
  [0, false],
  [-1, false],
  [-100, false],
  [0.5, false],
  [1.5, false],
  [NaN, false],
  [Infinity, false],
];

for (const [cents, erwartet] of FAELLE) {
  test(`Einrichtungsgebuehr ${cents} Cent bei aktiver Zahlung: Start ${erwartet ? "erlaubt" : "gesperrt"}`, () => {
    withConfigOverrides({ ...MIT_ZAHLUNG, numberSetupFeeCents: cents }, () => {
      assert.equal(assertConfig(), erwartet);
    });
  });
}

test("Einrichtungsgebuehr 0 Cent ohne aktive Zahlung: Start erlaubt", () => {
  withConfigOverrides({ ...MIT_ZAHLUNG, paymentEnabled: false, numberSetupFeeCents: 0 }, () => {
    assert.equal(assertConfig(), true);
  });
});
