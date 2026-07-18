#!/usr/bin/env node
// A3: Backfill plan-abgeleiteter Rechteprofile fuer Bestands-Subscriber (vor A2 aktiviert).
// Idempotent, fail-closed, Dry-Run als Default. NUR pg (reale Subscriber leben dort);
// json = sauberer No-Op (lokal/dev gibt es nichts zu backfillen). §5.7.
// Aufruf: node scripts/backfill-plan-profiles.js [--apply] [--reconcile]
//   (ohne Flags = Dry-Run; --apply schreibt; --reconcile heilt slug-lose Abos via Stripe)
import { config } from "../src/config.js";
import * as store from "../src/store.js";

const apply = process.argv.includes("--apply");
const reconcile = process.argv.includes("--reconcile");

// json = No-Op (kein Fehler, kein Exit 1 - legitimer Migrations-No-Op, NICHT grant-admins
// harter Refusal). Beweist §5.7 (Prod=pg; json=Owner/Dev) ohne Wurf.
if (config.store.storeBackend !== "pg") {
  console.log("[backfill] json-Backend: No-Op (keine Bestands-Subscriber lokal).");
  process.exit(0);
}

// Lazy import erst im pg-Pfad (keine pg-Deps im json-No-Op-Pfad). accounts wird seit
// Phase S nicht mehr gebraucht (Profil keyt direkt auf die tenantId).
const { createPortalRunner } = await import("../src/portal-pool.js");
const { backfillPlanProfiles } = await import("../src/billing/backfill-profiles.js");

const runner = await createPortalRunner();

// Reconcile-Resolver NUR bei --reconcile + vorhandenem Secret; fail-SOFT (Stripe-Fehler ->
// null = no_plan-Skip, NIE Abbruch des ganzen Laufs). Secret nie loggen/leaken (Regel 4).
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
if (apply) await store.save(); // PFLICHT: pg-Flush abwarten (Muster bootstrap-tenant)

// Operator-Report: tenant/Keys/Reason erlaubt, NIE Profil-Werte (PII, §5/Pre-Mortem c).
console.log(
  `[backfill] mode=${apply ? "APPLY" : "DRY-RUN"} scanned=${r.scanned} ` +
    `changes=${r.changes.length} unchanged=${r.unchanged.length} reconciled=${r.reconciled.length}`,
);
for (const c of r.changes) console.log(`  ${c.hadExisting ? "replace" : "set"} ${c.id}`);
// Nur handlungsrelevante Skips (no_plan); bootstrap/not_subscriber sind Rauschen.
for (const sk of r.skipped)
  if (sk.reason !== "not_subscriber" && sk.reason !== "bootstrap")
    console.log(`  skip ${sk.id} (${sk.reason})`);

await runner._pool.end();
process.exit(0);
