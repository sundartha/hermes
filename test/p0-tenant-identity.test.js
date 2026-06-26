// P0: Tenant-Identitaet vereinheitlichen. Beweist, dass registerTenant denselben
// Tenant-Record an die IdP-Identitaet (WorkOS sub) bindet, den der Web-Login ueber
// tenantIdForSubject adressiert -> Web-Login-Pfad (t_<sub>) UND MCP/REST-Pfad
// (resolveTenant via req.auth.sub) loesen denselben Tenant auf (Fix "Kein Tenant").
//
// Ops-/Fassaden-Ebene, BEIDE Backends: json synchron (reine state-ops) + pglite
// (Fassaden-Round-Trip von idp_subject durch flushTenants + hydrateTenants). KEIN
// Server-Spawn (das deckt onboarding-identity.test.js auf Route-Ebene ab).
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedState } from "./helpers.js";
import { registerTenant, resolveTenant } from "../src/store/state-ops.js";
import { tenantIdForSubject } from "../src/store/defaults.js";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";

// Konstanten statt Magic-Strings (G25).
const SUB_X = "sub-x";
const ID_X = tenantIdForSubject(SUB_X);

// AC1 (json): set-on-create bindet idpSubject -> resolveTenant findet den Record.
test("registerTenant: set-on-create bindet idpSubject -> resolveTenant findet ihn (json)", () => {
  const s = seedState({ tenants: [] });
  registerTenant(s, ID_X, { idpSubject: SUB_X, firstName: "A" });
  assert.equal(resolveTenant(s, SUB_X), ID_X); // Web-Login (t_<sub>) == MCP/REST (req.auth.sub)
  const t = s.tenants.find((x) => x.id === ID_X);
  assert.equal(t.ownerName, "A");
  assert.equal(t.status, "active");
});

// AC1 (pglite): Fassaden-Round-Trip - idp_subject ueberlebt flush + Re-Hydrierung.
// Ein zweiter Store auf derselben DB hydriert frisch und loest denselben sub auf.
test("registerTenant: idpSubject round-trippt durch pg flush + hydrate (pglite)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  registerTenant(s, ID_X, { idpSubject: SUB_X, firstName: "A" });
  await store.save(); // Spiegel -> DB (flushTenants persistiert idp_subject)
  const reborn = makePgStore(runner);
  await reborn.init(); // hydriert frisch aus der DB
  assert.equal(reborn.resolveTenant(SUB_X), ID_X);
});

// AC2 (json): complete-if-absent auf einem bereits gebundenen Login-Record. Der
// fehlende Name wird ergaenzt, aber Status (suspended) UND idpSubject bleiben
// unangetastet (P0 aktiviert NICHT; Aktivierung = P3). Genau EIN Record (1:1).
test("registerTenant: complete-if-absent ergaenzt Namen, laesst Status/idpSubject unberuehrt", () => {
  const s = seedState({
    tenants: [{ id: ID_X, status: "suspended", idpSubject: SUB_X }], // Login-Record, kein ownerName
  });
  registerTenant(s, ID_X, { idpSubject: SUB_X, firstName: "Maria", lastName: "M" });
  const matches = s.tenants.filter((t) => t.idpSubject === SUB_X);
  assert.equal(matches.length, 1); // kein Zweit-Record (1:1)
  const t = matches[0];
  assert.equal(t.ownerName, "Maria M"); // fehlender Name ergaenzt
  assert.equal(t.status, "suspended"); // P0 aktiviert NICHT
  assert.equal(t.idpSubject, SUB_X); // unveraendert
});

// set-if-absent ueberschreibt NIE bestehende Identitaetsfelder.
test("registerTenant: set-if-absent ueberschreibt bestehende Felder NICHT", () => {
  const s = seedState({
    tenants: [{ id: "t_alt", status: "active", idpSubject: "s1", ownerName: "Alt" }],
  });
  registerTenant(s, "t_alt", { idpSubject: "s2", firstName: "Neu" });
  const t = s.tenants.find((x) => x.id === "t_alt");
  assert.equal(t.ownerName, "Alt"); // kein Overwrite
  assert.equal(t.idpSubject, "s1"); // kein Overwrite
});

// tenantIdForSubject ist deterministisch + identisch zur web-auth.js-Ableitung
// (upsertOnFirstLogin nutzt dieselbe Funktion -> kein Drift zwischen den Kanaelen).
test("tenantIdForSubject: deterministisch (t_ + sub)", () => {
  assert.equal(tenantIdForSubject(SUB_X), "t_" + SUB_X);
  assert.equal(tenantIdForSubject("u1"), "t_u1"); // identisch zur upsertOnFirstLogin-Ableitung
});
