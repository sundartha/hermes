import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";
import { makeAccounts } from "../src/web-auth.js";
import { registerTenant } from "../src/store/state-ops.js";
import { tenantIdForSubject } from "../src/store/defaults.js";

const SUB = "sub-p6";
const TENANT = tenantIdForSubject(SUB);
const accountsOn = (db) =>
  makeAccounts({ withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (s) => db.exec(s) }) });

// (A1) Clobber-Regression: frischer Signup (suspended) + Mirror traegt t_<sub> active
// (registerTenant-Default) + Flush -> DARF NICHT auf active kippen. resolve(sub).status
// ist GENAU der Wert, den webAuthMw active-only gated (=> suspended bedeutet /state 403).
test("Flush hebt einen frischen suspended-Tenant NICHT auf active (Clobber)", async () => {
  const { store, db } = await makePgTestStore();
  const accounts = accountsOn(db);
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "p6@kunde.de" });
  registerTenant(store.load(), TENANT, { idpSubject: SUB, firstName: "P6" });
  await store.save();
  assert.equal((await accounts.resolve(SUB)).status, "suspended");
});

// (A2) Owner-Lockout-Schutz (Invariante O): trotz neuem Default 'suspended' bleibt der
// Bootstrap-Tenant nach migrate/seedDefaults active.
test("Owner/Bootstrap bleibt nach migrate active (kein Lockout)", async () => {
  const { db } = await makePgTestStore();
  const r = await db.query(`SELECT status FROM tenant WHERE id=$1`, [BOOTSTRAP_TENANT_ID]);
  assert.equal(r.rows[0].status, "active");
});

// (A3a) Keine Degradierung: aktiver Tenant (DB) + stale Mirror suspended + Flush -> active.
test("Flush degradiert einen aktiven Tenant NICHT", async () => {
  const { store, db } = await makePgTestStore();
  const accounts = accountsOn(db);
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "p6@kunde.de" });
  await accounts.setStatus(TENANT, "active");
  const t = registerTenant(store.load(), TENANT, { idpSubject: SUB });
  t.status = "suspended"; // stale Mirror
  await store.save();
  assert.equal((await accounts.resolve(SUB)).status, "active");
});

// (A3b) Keine Reaktivierung: geschlossener Tenant (DB) + Mirror active + Flush -> closed.
test("Flush reaktiviert einen geschlossenen Tenant NICHT", async () => {
  const { store, db } = await makePgTestStore();
  const accounts = accountsOn(db);
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "p6@kunde.de" });
  await accounts.setStatus(TENANT, "closed");
  registerTenant(store.load(), TENANT, { idpSubject: SUB });
  await store.save();
  assert.equal((await accounts.resolve(SUB)).status, "closed");
});

// (B) BK1: Kacheln kommen aus dem geteilten Katalog (GET /api/plans, SSoT), NICHT mehr aus
// lokalen Preis-Literalen. Drift-Guard: keine hartkodierten Preise/Slugs mehr; Features +
// Popular-Badge werden gerendert; weiterhin kein Free-Tarif.
test("tenant.html: Pricing-Kacheln aus /api/plans, keine Preis-Literale, kein Free", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const html = fs.readFileSync(path.join(dir, "../public/tenant.html"), "utf8");
  assert.match(html, /\/api\/plans/);            // Katalog ist die Datenquelle
  assert.doesNotMatch(html, /PLAN_PRICES/);      // altes Preis-Literal entfernt
  assert.doesNotMatch(html, /4,99/);             // keine hartkodierten Preise (Drift-Guard)
  assert.doesNotMatch(html, /9,99/);
  assert.match(html, /Popular/);                 // Featured-Badge (Parity zur Marketing-Seite)
  assert.match(html, /plan-features/);           // Leistungs-Liste je Kachel
  assert.doesNotMatch(html, /data-plan="free"/i);
  assert.doesNotMatch(html, /Kostenlos|Gratis/i);
});
