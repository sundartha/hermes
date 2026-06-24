#!/usr/bin/env node
// Einmaliger operativer Erst-Setup: legt den Bootstrap-Tenant an (status active) und
// traegt seine bereits gekaufte Bestandsnummer 'active' ein. Zusammen mit
// scripts/grant-admin.js (P1) ist das der komplette Erst-Setup ohne env-Seed (P2b
// loest den fruehen config-derived Boot-Seed ab). Idempotent (zweiter Lauf = No-Op).
// Funktioniert fuer beide Backends (STORE_BACKEND json|pg) ueber die Store-Fassade.
// Aufruf: node scripts/bootstrap-tenant.js <e164> <twilio|telnyx> [tenantId]
import * as store from "../src/store.js";
import { BOOTSTRAP_TENANT_ID, PROVIDER } from "../src/store/defaults.js";

const e164 = process.argv[2];
const provider = process.argv[3];
const tenantId = process.argv[4] || BOOTSTRAP_TENANT_ID;
const validProviders = Object.values(PROVIDER);

// fail-closed: ohne gueltige E.164 UND gueltigen Provider wird nichts geschrieben
// (sonst landete ein Tenant mit Muell-Provider-Nummer im Store).
if (!e164 || !validProviders.includes(provider)) {
  console.error(
    `Aufruf: node scripts/bootstrap-tenant.js <e164> <${validProviders.join("|")}> [tenantId]`,
  );
  console.error("Legt den ersten Tenant an + traegt seine aktive Nummer ein.");
  process.exit(1);
}

store.bootstrapTenant(e164, tenantId, provider);
await store.save(); // PFLICHT: pg-Flush abwarten (json = No-op nach internem save)
console.log(
  `[bootstrap-tenant] Tenant ${tenantId} + aktive Nummer (${provider}) eingetragen (idempotent).`,
);
