#!/usr/bin/env node
// Setzt account.role='admin' fuer den Account mit der angegebenen E-Mail (idempotent:
// zweiter Lauf = derselbe Effekt). Teil des operativen Erst-Setups (zusammen mit
// bootstrap-tenant in P2b). Accounts sind ein pg/OIDC-Konzept -> NUR im pg-Backend
// (STORE_BACKEND=pg, DATABASE_URL gesetzt); im json-Pfad existiert keine account-Tabelle.
// Aufruf: node scripts/grant-admin.js <email>
import { config } from "../src/config.js";
import { createPortalRunner } from "../src/portal-pool.js";
import { makeAccounts } from "../src/web-auth.js";

const email = process.argv[2];

// fail-closed: ohne E-Mail wird nichts geschrieben.
if (!email) {
  console.error("Aufruf: node scripts/grant-admin.js <email>");
  console.error("Setzt account.role='admin' fuer den Account mit dieser E-Mail (idempotent).");
  process.exit(1);
}

// Accounts existieren nur im pg-Backend. Im json-Pfad gibt es keine account-Tabelle
// -> klare Diagnose statt stillem No-Op (fail-closed, kein falscher Erfolg).
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
await runner._pool.end(); // Pool sauber schliessen, sonst haengt der Prozess am offenen Pool

if (!updated) {
  // Kein Account mit dieser E-Mail -> fail-closed (kein stiller Erfolg). Der Account
  // entsteht erst beim ersten OIDC-Login; vorher gibt es nichts zu befoerdern.
  console.error(`[grant-admin] Kein Account mit E-Mail '${email}' gefunden. Erst einloggen.`);
  process.exit(1);
}
console.log(`[grant-admin] account.role='admin' fuer '${email}' gesetzt/bestaetigt (idempotent).`);
