#!/usr/bin/env node
// Traegt eine BESTANDSNUMMER (bereits beim Provider gekauft) als Owner-Absendernummer
// in den Store ein - einmalig pro Umgebung, seit der Owner Tenant Null ist und seine
// Nummer(n) wie jeder Tenant im Store haelt (keine TWILIO_NUMBER/TELNYX_NUMBER-Env mehr).
// Direkt 'active' (die EINE legitime Ausnahme zur Transition-Kette; kein Provider-Kauf,
// kein 'requested'-Vorzustand). Idempotent: zweiter Lauf mit derselben E.164 = No-Op.
// Funktioniert fuer beide Backends (STORE_BACKEND json|pg) ueber die Store-Fassade.
// Aufruf: node scripts/seed-owner-number.js <e164> <twilio|telnyx>
import * as store from "../src/store.js";
import { OWNER_TENANT_ID, PROVIDER } from "../src/store/defaults.js";

const e164 = process.argv[2];
const provider = process.argv[3];
const validProviders = Object.values(PROVIDER);

// fail-closed: ohne gueltige E.164 UND gueltigen Provider wird nichts geschrieben
// (sonst landete eine Nummer mit Muell-Provider im Store).
if (!e164 || !validProviders.includes(provider)) {
  console.error(`Aufruf: node scripts/seed-owner-number.js <e164> <${validProviders.join("|")}>`);
  console.error("Traegt eine bereits gekaufte Owner-Nummer als aktive Store-Nummer ein.");
  process.exit(1);
}

store.seedOwnerNumber(e164, OWNER_TENANT_ID, provider);
await store.save(); // PFLICHT: pg-Flush abwarten (json = No-op nach internem save)
console.log(`[seed-owner-number] Owner-Nummer (${provider}) eingetragen/bestaetigt (idempotent).`);
