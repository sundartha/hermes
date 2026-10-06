#!/usr/bin/env node
import { config } from "../src/config.js";
import * as store from "../src/store.js";

const apply = process.argv.includes("--apply");

if (config.store.storeBackend !== "pg") {
  console.log("[stale-subs] json-Backend: No-Op (keine Bestandsdaten lokal).");
  process.exit(0);
}
if (!config.billing.stripeSecretKey) {
  console.error("[stale-subs] STRIPE_SECRET_KEY fehlt - ohne Stripe-Abfrage kein Abgleich.");
  process.exit(1);
}

const { createPortalRunner } = await import("../src/portal-pool.js");
const { stripeBilling } = await import("../src/billing/stripe.js");
const { reconcileStaleSubscriptions } = await import("../src/billing/stale-subscription-reconcile.js");

const runner = await createPortalRunner();
const report = await reconcileStaleSubscriptions({ store, billing: stripeBilling, apply });
if (apply) await store.save();

console.log(
  `[stale-subs] mode=${apply ? "APPLY" : "DRY-RUN"} scanned=${report.scanned} ` +
    `cleared=${report.cleared.length} alive=${report.alive.length} errors=${report.errors.length}`,
);
for (const entry of report.cleared) console.log(`  clear ${entry.id} (stripe=${entry.status})`);
for (const entry of report.alive) console.log(`  keep  ${entry.id} (stripe=${entry.status})`);
for (const entry of report.errors) console.log(`  skip  ${entry.id} (${entry.reason})`);

await runner._pool.end();
process.exit(0);
