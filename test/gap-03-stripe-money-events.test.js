// GAP-03 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-03").
// Jedes zahlungsrelevante Stripe-Ereignis muss eine getestete Wirkung haben. Rein,
// offline (Muster test/p3-payment-webhook.test.js: Fake-Seams, applyStripeWebhook
// direkt, kein Server-Spawn).
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStripeWebhook } from "../src/billing/webhook.js";

// Vier Ereignis-Typen ausserhalb der bekannten SUBSCRIPTION_EVENT-Allowlist
// (src/billing/webhook.js:16-21) - interpretStripeEvent() faellt fuer sie auf den
// default-Zweig (action=IGNORE, webhook.js:139-141) zurueck.
const OUT_OF_SCOPE_TYPES = [
  "charge.dispute.created",
  "charge.refunded",
  "customer.subscription.paused",
  "invoice.payment_action_required",
];

// store bleibt LEER (keine Methoden) - die IGNORE-Wirkung wirft NICHT, weil applyStripeWebhook
// vor JEDEM store-Zugriff zurueckkehrt (webhook.js:200) - ein Aufruf einer store-Methode
// waere selbst schon ein Befund (mehr Wirkung als heute), bricht den Test aber nicht.
for (const type of OUT_OF_SCOPE_TYPES) {
  test(`GAP-03 SOLL: Stripe-Event '${type}' muss eine assertierte Wirkung erzeugen (heute: IGNORE, keine Spur)`, async () => {
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
