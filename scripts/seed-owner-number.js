#!/usr/bin/env node
import * as store from "../src/store.js";
import { BOOTSTRAP_TENANT_ID } from "../src/begriffe/mandant.js";
import { PROVIDER } from "../src/begriffe/nummern-vergabe.js";

const e164 = process.argv[2];
const provider = process.argv[3];
const validProviders = Object.values(PROVIDER);

if (!e164 || !validProviders.includes(provider)) {
  console.error(`Aufruf: node scripts/seed-owner-number.js <e164> <${validProviders.join("|")}>`);
  console.error("Traegt eine bereits gekaufte Owner-Nummer als aktive Store-Nummer ein.");
  process.exit(1);
}

await store.oeffneSpeicher();
store.seedBootstrapNumber(e164, BOOTSTRAP_TENANT_ID, provider);
await store.save();
console.log(`[seed-owner-number] Owner-Nummer (${provider}) eingetragen/bestaetigt (idempotent).`);
