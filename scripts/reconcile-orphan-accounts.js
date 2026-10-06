#!/usr/bin/env node
import { config } from "../src/config.js";
import { makeAccounts } from "../src/web-auth.js";
import { makeWorkosManagement } from "../src/workos-management.js";
import { createPortalRunner } from "../src/portal-pool.js";
import { reconcileOrphanAccounts } from "../src/orphan-account-reconcile.js";

const apply = process.argv.includes("--apply");

if (config.store.storeBackend !== "pg") {
  console.log("[orphan-accounts] json-Backend: No-Op (keine account-Zeilen lokal).");
  process.exit(0);
}
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
