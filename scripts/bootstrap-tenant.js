#!/usr/bin/env node
import * as store from "../src/store.js";
import { BOOTSTRAP_TENANT_ID } from "../src/begriffe/mandant.js";
import { PROVIDER } from "../src/begriffe/nummern-vergabe.js";

const e164 = process.argv[2];
const provider = process.argv[3];
const tenantId = process.argv[4] || BOOTSTRAP_TENANT_ID;
const validProviders = Object.values(PROVIDER);

if (!e164 || !validProviders.includes(provider)) {
  console.error(
    `Aufruf: node scripts/bootstrap-tenant.js <e164> <${validProviders.join("|")}> [tenantId]`,
  );
  console.error("Legt den ersten Tenant an + traegt seine aktive Nummer ein.");
  process.exit(1);
}

await store.oeffneSpeicher();
store.bootstrapTenant(e164, tenantId, provider);
await store.save();
console.log(
  `[bootstrap-tenant] Tenant ${tenantId} + aktive Nummer (${provider}) eingetragen (idempotent).`,
);
