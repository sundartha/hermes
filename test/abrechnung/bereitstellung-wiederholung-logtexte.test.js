import assert from "node:assert/strict";
import { test } from "node:test";

import { runStripeSubscriptionReconcile } from "../../src/billing/stripe-reconcile.ts";

const STATE = { tenants: [{ id: "t_1", stripeSubscriptionId: "sub_1" }] };

async function abgleichMitFehler(fehler) {
  const zeilen = [];
  await runStripeSubscriptionReconcile({
    store: { load: () => STATE },
    billing: { retrieveSubscription: () => Promise.reject(fehler) },
    webhookDeps: {},
    logger: { warn: (m) => zeilen.push(m) },
    nowMs: 1765000000000,
  });
  return zeilen;
}

test("Stripe-Abgleich: Fehlertext eines Error-Objekts steht im Log", async () => {
  assert.deepEqual(await abgleichMitFehler(new Error("kaputt")), [
    "[stripe-reconcile] Statusabfrage fehlgeschlagen tenant=t_1: kaputt",
  ]);
});

test("Stripe-Abgleich: geworfener Text steht im Log", async () => {
  assert.deepEqual(await abgleichMitFehler("nur-text"), [
    "[stripe-reconcile] Statusabfrage fehlgeschlagen tenant=t_1: nur-text",
  ]);
});

test("Stripe-Abgleich: Heilung, die einen Text wirft, steht mit dem Text im Log", async () => {
  const zeilen = [];
  const ergebnis = await runStripeSubscriptionReconcile({
    store: { load: () => STATE },
    billing: { retrieveSubscription: () => Promise.resolve({ status: "canceled" }) },
    webhookDeps: undefined,
    logger: { warn: (m) => zeilen.push(m) },
    nowMs: 1765000000000,
  });
  assert.equal(ergebnis.errors, 1);
  assert.match(zeilen[1], /^\[stripe-reconcile\] Heilung fehlgeschlagen tenant=t_1: .+$/);
});
