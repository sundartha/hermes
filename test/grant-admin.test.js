// P1: setRole (account-Mutator) + adminOnly-Gate. pglite, kein echtes pg, kein
// CLI-Spawn. Beweist: setRole idempotent (zweimal = ein Effekt); nicht-existente
// E-Mail -> false (kein silent-noop); adminOnly laesst role==='admin' durch und
// weist member + fehlende Identitaet ab (Phasen-Invariante: rein additiv,
// Nicht-Admin-Verhalten unveraendert). Das grant-admin-Script selbst (arg-Parsing/
// process.exit/Pool) ist duenner Glue um createPortalRunner (echtes pg) + setRole;
// ein CLI-Spawn mit echter DB waere ein langsamer Integrationstest ohne Mehrwert (T9).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/db/migrate.js";
import { makeAccounts, adminOnly } from "../src/web-auth.js";

async function setup() {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (s) => db.exec(s) });
  const accounts = makeAccounts({ withClient: (fn) => fn({ query: (t, p) => db.query(t, p) }) });
  return { db, accounts };
}

test("setRole befoerdert per E-Mail zu admin", async () => {
  const { accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "boss@x" }); // role=member
  assert.equal(await accounts.setRole("boss@x", "admin"), true);
  assert.equal((await accounts.resolve("u1")).role, "admin");
});

test("setRole ist idempotent (zweiter Lauf = ein Effekt)", async () => {
  const { accounts } = await setup();
  await accounts.upsertOnFirstLogin({ sub: "u1", email: "boss@x" });
  await accounts.setRole("boss@x", "admin");
  assert.equal(await accounts.setRole("boss@x", "admin"), true);
  assert.equal((await accounts.resolve("u1")).role, "admin");
});

test("setRole auf nicht-existente E-Mail -> false (kein silent-noop)", async () => {
  const { accounts } = await setup();
  assert.equal(await accounts.setRole("ghost@x", "admin"), false);
});

// adminOnly-Gate: role==='admin' durch, member/keine Identitaet ab (Invariante).
async function probe(tenant) {
  const app = express();
  app.get(
    "/p",
    (req, _res, next) => {
      if (tenant) req.tenant = tenant;
      next();
    },
    adminOnly({ adminEmails: [] }),
    (_req, res) => res.json({ ok: true }),
  );
  const s = await new Promise((r) => {
    const x = app.listen(0, "127.0.0.1", () => r(x));
  });
  const base = `http://127.0.0.1:${s.address().port}`;
  const status = await new Promise((res) =>
    http.get(`${base}/p`, (r) => {
      r.resume();
      res(r.statusCode);
    }),
  );
  await new Promise((r) => s.close(r));
  return status;
}

test("adminOnly: role==='admin' (ohne Allowlist) -> 200", async () => {
  assert.equal(await probe({ role: "admin", email: null, tenantId: "t1", sub: "u1" }), 200);
});
test("adminOnly: role==='member' -> 403", async () => {
  assert.equal(await probe({ role: "member", email: null, tenantId: "t1", sub: "u1" }), 403);
});
test("adminOnly: keine Identitaet (req.tenant fehlt) -> 403 (fail-closed)", async () => {
  assert.equal(await probe(null), 403);
});
