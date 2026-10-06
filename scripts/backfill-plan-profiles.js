#!/usr/bin/env node
import { config } from "../src/config.js";
import * as store from "../src/store.js";

const apply = process.argv.includes("--apply");
const reconcile = process.argv.includes("--reconcile");

if (config.store.storeBackend !== "pg") {
  console.log("[backfill] json-Backend: No-Op (keine Bestands-Subscriber lokal).");
  process.exit(0);
}

const { createPortalRunner } = await import("../src/portal-pool.js");
const { backfillPlanProfiles } = await import("../src/billing/backfill-profiles.js");

const runner = await createPortalRunner();

let resolvePlanSlug;
if (reconcile && config.billing.stripeSecretKey) {
  const { stripeBilling } = await import("../src/billing/stripe.js");
  resolvePlanSlug = async (subscriptionId) => {
    try {
      return (await stripeBilling.retrieveSubscription(subscriptionId)).planSlug;
    } catch (e) {
      console.error(`[backfill] reconcile skip sub (HTTP/Parse): ${e.message}`);
      return null;
    }
  };
}

const r = await backfillPlanProfiles({ store, apply, resolvePlanSlug });
if (apply) await store.save();

console.log(
  `[backfill] mode=${apply ? "APPLY" : "DRY-RUN"} scanned=${r.scanned} ` +
    `changes=${r.changes.length} unchanged=${r.unchanged.length} reconciled=${r.reconciled.length}`,
);
for (const c of r.changes) console.log(`  ${c.hadExisting ? "replace" : "set"} ${c.id}`);
for (const sk of r.skipped)
  if (sk.reason !== "not_subscriber" && sk.reason !== "bootstrap")
    console.log(`  skip ${sk.id} (${sk.reason})`);

await runner._pool.end();
process.exit(0);
