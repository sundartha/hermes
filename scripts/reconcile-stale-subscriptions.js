#!/usr/bin/env node
// CL1-B3: heilt Bestands-Tenants mit TOTER Stripe-Abo-Referenz (status != active +
// gesetzte stripeSubscriptionId -> Dashboard 403 UND Neu-Abo 409, kein Ausweg).
// Trockenlauf ist Default; --apply schreibt. NUR pg (die realen Datensaetze leben
// dort); json = sauberer No-Op. Muster scripts/backfill-plan-profiles.js.
// Aufruf: node scripts/reconcile-stale-subscriptions.js [--apply]
import { config } from "../src/config.js";
import * as store from "../src/store.js";

const apply = process.argv.includes("--apply");

if (config.store.storeBackend !== "pg") {
  console.log("[stale-subs] json-Backend: No-Op (keine Bestandsdaten lokal).");
  process.exit(0);
}
// Ohne Stripe-Secret gibt es nichts zu fragen - lauter Abbruch statt eines Laufs, der
// jeden Tenant als "lookup_failed" meldet und wie ein Befund aussieht. Secret nie loggen.
if (!config.billing.stripeSecretKey) {
  console.error("[stale-subs] STRIPE_SECRET_KEY fehlt - ohne Stripe-Abfrage kein Abgleich.");
  process.exit(1);
}

const { createPortalRunner } = await import("../src/portal-pool.js");
const { stripeBilling } = await import("../src/billing/stripe.js");
const { reconcileStaleSubscriptions } = await import("../src/billing/stale-subscription-reconcile.js");

const runner = await createPortalRunner();
const report = await reconcileStaleSubscriptions({ store, billing: stripeBilling, apply });
if (apply) await store.save(); // PFLICHT: pg-Flush abwarten (Muster backfill/bootstrap-tenant)

console.log(
  `[stale-subs] mode=${apply ? "APPLY" : "DRY-RUN"} scanned=${report.scanned} ` +
    `cleared=${report.cleared.length} alive=${report.alive.length} errors=${report.errors.length}`,
);
for (const entry of report.cleared) console.log(`  clear ${entry.id} (stripe=${entry.status})`);
for (const entry of report.alive) console.log(`  keep  ${entry.id} (stripe=${entry.status})`);
for (const entry of report.errors) console.log(`  skip  ${entry.id} (${entry.reason})`);

await runner._pool.end();
process.exit(0);
