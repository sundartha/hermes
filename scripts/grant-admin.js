#!/usr/bin/env node
import { config } from "../src/config.js";
import { createPortalRunner } from "../src/portal-pool.js";
import { makeAccounts } from "../src/web-auth.js";

const email = process.argv[2];

if (!email) {
  console.error("Aufruf: node scripts/grant-admin.js <email>");
  console.error("Setzt account.role='admin' fuer den Account mit dieser E-Mail (idempotent).");
  process.exit(1);
}

if (config.store.storeBackend !== "pg") {
  console.error(
    "[grant-admin] Accounts existieren nur im pg-Backend (STORE_BACKEND=pg). " +
      "Im json-Pfad gibt es keine Account-/Rollen-Tabelle.",
  );
  process.exit(1);
}

const runner = await createPortalRunner();
const accounts = makeAccounts(runner);
const updated = await accounts.setRole(email, "admin");
await runner._pool.end();

if (!updated) {
  console.error(`[grant-admin] Kein Account mit E-Mail '${email}' gefunden. Erst einloggen.`);
  process.exit(1);
}
console.log(`[grant-admin] account.role='admin' fuer '${email}' gesetzt/bestaetigt (idempotent).`);
