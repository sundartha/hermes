import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStripeWebhook } from "../src/billing/webhook.js";

const OUT_OF_SCOPE_TYPES = [
  "charge.dispute.created",
  "charge.refunded",
  "customer.subscription.paused",
  "invoice.payment_action_required",
];

for (const type of OUT_OF_SCOPE_TYPES) {
  test(`Stripe-Event '${type}' erzeugt eine assertierte Wirkung (GAP-03, gefixt in P4)`, async () => {
    const auditCalls = [];
    await applyStripeWebhook(
      { type, data: { object: { id: "evt_gap03" } } },
      {
        store: {},
        accounts: { setStatus: async () => {} },
        sessions: { invalidateByTenant: async () => {} },
        audit: (kind, _req, detail) => auditCalls.push(`${kind} ${detail}`),
        req: {},
        provision: async () => {},
        billing: undefined,
      },
    );
    assert.ok(
      auditCalls.length > 0,
      `SOLL: mindestens ein Audit-Eintrag (oder eine Store-Wirkung) fuer '${type}'; heute ` +
        "kehrt applyStripeWebhook VOR jedem Audit/Store-Zugriff zurueck (webhook.js:200, " +
        "interpretStripeEvent default-Zweig -> action=IGNORE, webhook.js:139-141)",
    );
  });
}
