#!/usr/bin/env node
import { config } from "../src/config.js";
import * as store from "../src/store.js";

const apply = process.argv.includes("--apply");

if (config.store.storeBackend !== "pg") {
  console.log("[pm-type] json-Backend: No-Op (keine Bestandsdaten lokal).");
  process.exit(0);
}
if (!config.billing.stripeSecretKey) {
  console.error("[pm-type] STRIPE_SECRET_KEY fehlt - ohne Stripe-Abfrage kein Abgleich.");
  process.exit(1);
}

const { createPortalRunner } = await import("../src/portal-pool.js");
const { stripeBilling } = await import("../src/billing/stripe.js");
const { reconcilePaymentMethodTypes } = await import("../src/billing/payment-method-type-reconcile.js");

const runner = await createPortalRunner();
const report = await reconcilePaymentMethodTypes({ store, billing: stripeBilling, apply });
if (apply) await store.save();

console.log(
  `[pm-type] mode=${apply ? "APPLY" : "DRY-RUN"} scanned=${report.scanned} ` +
    `filled=${report.filled.length} unknown=${report.unknown.length} errors=${report.errors.length}`,
);
for (const entry of report.filled) console.log(`  fill  ${entry.id} (type=${entry.paymentMethodType})`);
for (const entry of report.unknown) console.log(`  keep  ${entry.id} (${entry.reason})`);
for (const entry of report.errors) console.log(`  skip  ${entry.id} (${entry.reason})`);

await runner._pool.end();
process.exit(0);
