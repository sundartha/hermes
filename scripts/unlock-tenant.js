#!/usr/bin/env node
import { config } from "../src/config.js";
import * as store from "../src/store.js";
import { TENANT_STATUS } from "../src/store/defaults.js";
import { makeAccounts } from "../src/web-auth.js";
import { makeAuditStore } from "../src/audit-store.js";
import { createPortalRunner } from "../src/portal-pool.js";

const AUDIT_ACTOR = "system:unlock-tenant";
const AUDIT_ACTION = "tenant_unlock_cli";

const tenantId = process.argv[2];
const apply = process.argv.includes("--apply");

if (!tenantId) {
  console.error("Aufruf: node scripts/unlock-tenant.js <tenantId> [--apply]");
  console.error("Setzt den Tenant auf active und loescht den Grace-Anker suspended_at.");
  console.error("Ohne --apply: Trockenlauf, zeigt nur den Ist-Zustand.");
  process.exit(1);
}

if (config.store.storeBackend !== "pg") {
  console.error(
    "[unlock-tenant] Tenant-Status/Accounts existieren nur im pg-Backend " +
      "(STORE_BACKEND=pg + DATABASE_URL). Im json-Pfad gibt es nichts zu entsperren.",
  );
  process.exit(1);
}

const runner = await createPortalRunner();
const accounts = makeAccounts(runner);
const audit = makeAuditStore(runner);

async function exitWith(code) {
  await runner._pool.end();
  process.exit(code);
}

const tenant = (await accounts.listTenants()).find((row) => row.id === tenantId);
if (!tenant) {
  console.error(`[unlock-tenant] Tenant '${tenantId}' existiert nicht - nichts geaendert.`);
  await exitWith(1);
}

const suspendedAt = store.tenantSuspendedAt(tenantId);
const { subscriptionId, planSlug, cancelAtPeriodEnd } = store.tenantSubscription(tenantId);
console.log(`[unlock-tenant] mode=${apply ? "APPLY" : "DRY-RUN"} tenant=${tenantId}`);
console.log(
  `  status=${tenant.status} suspendedAt=${suspendedAt ?? "-"} ` +
    `spiegel=${store.tenantExists(tenantId) ? "ja" : "nein"}`,
);
console.log(
  `  abo=${subscriptionId ? "gesetzt" : "KEINE"} plan=${planSlug ?? "-"} ` +
    `kuendigungZumPeriodenende=${cancelAtPeriodEnd ? "ja" : "nein"}`,
);

if (tenant.status === TENANT_STATUS.ACTIVE) {
  console.log("[unlock-tenant] bereits active - nichts zu tun.");
  await exitWith(0);
}

if (tenant.status === TENANT_STATUS.CLOSED) {
  console.error(
    "[unlock-tenant] status=closed -> VERWEIGERT: beendeter Vertrag ist kein Lockout-Fall " +
      "(Nummer freigegeben, Identitaet geloescht). Wiederaufnahme = neuer Vertragsabschluss.",
  );
  await exitWith(1);
}

if (!subscriptionId) {
  console.warn(
    "[unlock-tenant] WARNUNG: keine Abo-Referenz am Tenant - die Entsperrung gibt ein " +
      "zahlungspflichtiges Produkt OHNE Abo frei. Abo separat nachziehen.",
  );
}

if (!apply) {
  console.log(
    "[unlock-tenant] DRY-RUN: --apply wuerde status=active setzen, den Grace-Anker " +
      `suspended_at loeschen und eine ${AUDIT_ACTION}-Zeile ins audit_log schreiben.`,
  );
  await exitWith(0);
}

const updated = await accounts.setStatus(tenantId, TENANT_STATUS.ACTIVE);
if (!updated) {
  console.error(`[unlock-tenant] Tenant '${tenantId}' beim Schreiben nicht getroffen - Abbruch.`);
  await exitWith(1);
}
await store.ensureTenant(tenantId);
store.clearSuspendedAt(tenantId);
await store.save();
await audit.record({
  actorSub: AUDIT_ACTOR,
  tenantId,
  action: AUDIT_ACTION,
  detail: `from=${tenant.status}`,
});

console.log(
  `[unlock-tenant] Tenant ${tenantId} entsperrt: status=${TENANT_STATUS.ACTIVE}, ` +
    `suspended_at geloescht, audit=${AUDIT_ACTION}.`,
);
await exitWith(0);
