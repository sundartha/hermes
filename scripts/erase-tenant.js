#!/usr/bin/env node
import * as store from "../src/store.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const tenantId = process.argv[2];
const confirmed = process.argv.includes("--confirm");
if (!tenantId || !confirmed) {
  console.error("Aufruf: node scripts/erase-tenant.js <tenantId> --confirm");
  console.error("IRREVERSIBEL: loescht alle call-verknuepften Daten des Tenants.");
  process.exit(1);
}

const removed = store.eraseTenantData(tenantId);
await store.save();
console.log(
  `[erase] Tenant ${tenantId}${tenantId === BOOTSTRAP_TENANT_ID ? " (Owner)" : ""} geloescht:`,
  `calls=${removed.calls} transcriptSegments=${removed.transcriptSegments}`,
  `actionItems=${removed.actionItems} notifications=${removed.notifications}`,
  `privateNumber=${removed.privateNumber}`,
);
