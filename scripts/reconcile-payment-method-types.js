#!/usr/bin/env node
// GP-P2-Nachtrag: traegt den fehlenden Typ der Zahlungsmethode nach (gebundene
// stripePaymentMethodId + stripePaymentMethodType null). Ohne ihn gilt die Methode
// fail-closed als ungeeignet und der automatische Wiederanlauf (GP-P3/GP-P4)
// ueberspringt den zahlenden Mandanten dauerhaft und lautlos.
// Trockenlauf ist Default; --apply schreibt. NUR pg (die realen Datensaetze leben
// dort); json = sauberer No-Op. Muster scripts/reconcile-stale-subscriptions.js.
// Aufruf: node scripts/reconcile-payment-method-types.js [--apply]
import { config } from "../src/config.js";
import * as store from "../src/store.js";

const apply = process.argv.includes("--apply");

if (config.store.storeBackend !== "pg") {
  console.log("[pm-type] json-Backend: No-Op (keine Bestandsdaten lokal).");
  process.exit(0);
}
// Ohne Stripe-Secret gibt es nichts zu fragen - lauter Abbruch statt eines Laufs, der
// jeden Mandanten als "lookup_failed" meldet und wie ein Befund aussieht. Secret nie loggen.
if (!config.billing.stripeSecretKey) {
  console.error("[pm-type] STRIPE_SECRET_KEY fehlt - ohne Stripe-Abfrage kein Abgleich.");
  process.exit(1);
}

const { createPortalRunner } = await import("../src/portal-pool.js");
const { stripeBilling } = await import("../src/billing/stripe.js");
const { reconcilePaymentMethodTypes } = await import("../src/billing/payment-method-type-reconcile.js");

const runner = await createPortalRunner();
const report = await reconcilePaymentMethodTypes({ store, billing: stripeBilling, apply });
if (apply) await store.save(); // PFLICHT: pg-Flush abwarten (Muster reconcile-stale-subscriptions)

console.log(
  `[pm-type] mode=${apply ? "APPLY" : "DRY-RUN"} scanned=${report.scanned} ` +
    `filled=${report.filled.length} unknown=${report.unknown.length} errors=${report.errors.length}`,
);
for (const entry of report.filled) console.log(`  fill  ${entry.id} (type=${entry.paymentMethodType})`);
for (const entry of report.unknown) console.log(`  keep  ${entry.id} (${entry.reason})`);
for (const entry of report.errors) console.log(`  skip  ${entry.id} (${entry.reason})`);

await runner._pool.end();
process.exit(0);
