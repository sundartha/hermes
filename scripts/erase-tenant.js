#!/usr/bin/env node
// Per-Tenant-DSGVO-Loeschung (Art. 17): entfernt call-verknuepfte Daten EINES
// Tenants (Calls inkl. Transkripte, daraus extrahierte Action Items, call-
// verknuepfte Notifications) PLUS die private Summary-Nummer am tenant-Record
// (F2 P10, PII-Kontaktdatum). Settings/Profile/aktive Nummern (s.numbers)/Kalender/
// Usage bleiben. IRREVERSIBEL -> fail-closed: verlangt tenantId UND --confirm. BEWUSST
// KEIN Netz-Endpunkt (kleinste Angriffsflaeche, Safety vor Features).
// Aufruf: node scripts/erase-tenant.js <tenantId> --confirm
import * as store from "../src/store.js";
import { OWNER_TENANT_ID } from "../src/store/defaults.js";

const tenantId = process.argv[2];
const confirmed = process.argv.includes("--confirm");
if (!tenantId || !confirmed) {
  console.error("Aufruf: node scripts/erase-tenant.js <tenantId> --confirm");
  console.error("IRREVERSIBEL: loescht alle call-verknuepften Daten des Tenants.");
  process.exit(1); // fail-closed: nichts geloescht
}

const removed = store.eraseTenantData(tenantId);
await store.save(); // PFLICHT: pg-Flush abwarten (json = No-op)
console.log(
  `[erase] Tenant ${tenantId}${tenantId === OWNER_TENANT_ID ? " (Owner)" : ""} geloescht:`,
  `calls=${removed.calls} transcriptSegments=${removed.transcriptSegments}`,
  `actionItems=${removed.actionItems} notifications=${removed.notifications}`,
  // privateNumber als 0/1-Zaehler (F2 P10): zeigt, ob eine private Summary-Nummer
  // mitgeloescht wurde - NIE der Wert (PII-frei, wie die uebrigen Zaehler).
  `privateNumber=${removed.privateNumber}`,
);
