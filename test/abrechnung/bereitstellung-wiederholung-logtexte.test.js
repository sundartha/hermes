import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { provisionRetryBucket } from "../../src/billing/provision-retry-sweep.ts";
import { retriggerFailedProvisioning } from "../../src/billing/provision-retry.ts";
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

test("Wiederholungs-Sperre je Mandant heißt provision-retry:<Mandant>", () => {
  assert.equal(provisionRetryBucket("t_1"), "provision-retry:t_1");
});

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

for (const [name, fehler, erwartet] of [
  ["Error-Objekt", new Error("laufzeit"), "laufzeit"],
  ["geworfener Text", "nur-text", "nur-text"],
]) {
  test(`Bereitstellungs-Wiederholung: ${name} landet im Log und endet als Fehler`, async () => {
    const fehlerLog = mock.method(console, "error", () => {});
    try {
      const entscheidung = await retriggerFailedProvisioning({
        store: {
          load: () => {
            throw fehler;
          },
        },
        provision: () => Promise.resolve(),
        tenantId: "t_1",
        maxAttempts: 3,
      });
      assert.equal(entscheidung.outcome, "error");
      assert.deepEqual(fehlerLog.mock.calls[0].arguments, ["[provision-retry]", erwartet]);
    } finally {
      fehlerLog.mock.restore();
    }
  });
}
