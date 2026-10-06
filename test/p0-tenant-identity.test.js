import { test } from "node:test";
import assert from "node:assert/strict";
import { seedState } from "./helpers.js";
import { registerTenant, resolveTenant } from "../src/store/state-ops.js";
import { tenantIdForSubject } from "../src/store/defaults.js";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";

const SUB_X = "sub-x";
const ID_X = tenantIdForSubject(SUB_X);

test("registerTenant: set-on-create bindet idpSubject -> resolveTenant findet ihn (json)", () => {
  const s = seedState({ tenants: [] });
  registerTenant(s, ID_X, { idpSubject: SUB_X, firstName: "A" });
  assert.equal(resolveTenant(s, SUB_X), ID_X);
  const t = s.tenants.find((x) => x.id === ID_X);
  assert.equal(t.ownerName, "A");
  assert.equal(t.status, "active");
});

test("registerTenant: idpSubject round-trippt durch pg flush + hydrate (pglite)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  registerTenant(s, ID_X, { idpSubject: SUB_X, firstName: "A" });
  await store.save();
  const reborn = makePgStore(runner);
  await reborn.init();
  assert.equal(reborn.resolveTenant(SUB_X), ID_X);
});

test("registerTenant: complete-if-absent ergaenzt Namen, laesst Status/idpSubject unberuehrt", () => {
  const s = seedState({
    tenants: [{ id: ID_X, status: "suspended", idpSubject: SUB_X }],
  });
  registerTenant(s, ID_X, { idpSubject: SUB_X, firstName: "Maria", lastName: "M" });
  const matches = s.tenants.filter((t) => t.idpSubject === SUB_X);
  assert.equal(matches.length, 1);
  const t = matches[0];
  assert.equal(t.ownerName, "Maria M");
  assert.equal(t.status, "suspended");
  assert.equal(t.idpSubject, SUB_X);
});

test("registerTenant: set-if-absent ueberschreibt bestehende Felder NICHT", () => {
  const s = seedState({
    tenants: [{ id: "t_alt", status: "active", idpSubject: "s1", ownerName: "Alt" }],
  });
  registerTenant(s, "t_alt", { idpSubject: "s2", firstName: "Neu" });
  const t = s.tenants.find((x) => x.id === "t_alt");
  assert.equal(t.ownerName, "Alt");
  assert.equal(t.idpSubject, "s1");
});

test("tenantIdForSubject: deterministisch (t_ + sub)", () => {
  assert.equal(tenantIdForSubject(SUB_X), "t_" + SUB_X);
  assert.equal(tenantIdForSubject("u1"), "t_u1");
});
