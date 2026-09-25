#!/usr/bin/env node
// CL2: raeumt account-Zeilen ab, deren WorkOS-Identitaet nicht mehr existiert, und zieht
// tenant.idp_subject auf eine lebende Identitaet nach. Der Kern liegt in
// src/orphan-account-reconcile.js (dort steht auch, warum das NICHT im Login-Pfad passiert);
// dieses Skript ist nur die Verdrahtung. Muster: scripts/reconcile-stale-subscriptions.js.
// Trockenlauf ist Default; --apply schreibt.
// Aufruf: node scripts/reconcile-orphan-accounts.js [--apply]
import { config } from "../src/config.js";
import { makeAccounts } from "../src/web-auth.js";
import { makeWorkosManagement } from "../src/workos-management.js";
import { createPortalRunner } from "../src/portal-pool.js";
import { reconcileOrphanAccounts } from "../src/orphan-account-reconcile.js";

const apply = process.argv.includes("--apply");

// account/tenant sind ein pg-Konzept; im json-Pfad gibt es die Tabellen nicht.
if (config.store.storeBackend !== "pg") {
  console.log("[orphan-accounts] json-Backend: No-Op (keine account-Zeilen lokal).");
  process.exit(0);
}
// Ohne Management-Schluessel gibt es nichts zu fragen - lauter Abbruch statt eines Laufs, der
// JEDE Zeile als lookup_failed meldet und wie ein Befund aussieht. Schluessel nie loggen.
if (!config.auth.workosManagementApiKey) {
  console.error("[orphan-accounts] WORKOS_MANAGEMENT_API_KEY fehlt - ohne Abfrage kein Abgleich.");
  process.exit(1);
}

const runner = await createPortalRunner();
const report = await reconcileOrphanAccounts({
  accounts: makeAccounts(runner),
  workos: makeWorkosManagement(config),
  apply,
});

console.log(
  `[orphan-accounts] mode=${apply ? "APPLY" : "DRY-RUN"} tenants=${report.scanned} ` +
    `entfernt=${report.dropped.length} lebend=${report.alive.length} ` +
    `behalten=${report.keptLast.length} anker=${report.anchors.length} fehler=${report.errors.length}`,
);
for (const entry of report.dropped) console.log(`  weg    ${entry.tenantId} sub=${entry.sub}`);
for (const entry of report.keptLast) {
  console.log(`  bleibt ${entry.tenantId} sub=${entry.sub} (letzte Zeile - Tenant muss per Email auffindbar bleiben)`);
}
for (const entry of report.anchors) console.log(`  anker  ${entry.tenantId} ${entry.previous ?? "-"} -> ${entry.sub}`);
for (const entry of report.errors) console.log(`  skip   ${entry.tenantId} (${entry.reason})`);

await runner._pool.end();
process.exit(0);
