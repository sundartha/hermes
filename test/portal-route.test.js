// Kompositions-Integrationstest fuer den Kunden-Portal-Datenpfad:
// webAuth (Session->req.tenant) -> portalStore.listCalls(tenant-scoped). Baut die
// gleiche Route wie server.js auf einer Wegwerf-App nach (ein echter child-process
// + Postgres ist im Test-Env nicht verfuegbar; pglite ist in-process). Beweist:
// (1) ohne Session -> 401 (fail-closed), (2) aktive Kunden-Session sieht NUR die
// eigenen (leeren) Calls, nie die des Owners. account/session/tenant sind nicht
// unter RLS -> ein Runner reicht; die RLS-Tiefe deckt portal-rls-killer.test.js ab.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { applySchema, seedDefaults } from "../src/db/migrate.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makePortalStore } from "../src/store/portal.js";

const SECRET = "portal-route-secret-0123456789";

async function setup() {
  const db = new PGlite();
  const q = (t, p) => db.query(t, p);
  await applySchema({ query: q, exec: (s) => db.exec(s) });
  await q(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  await seedDefaults({ query: q, exec: (s) => db.exec(s) }, BOOTSTRAP_TENANT_ID);
  // Owner-Call (darf NIE im Kunden-Portal auftauchen)
  await q(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
     VALUES ('call_owner', $1, 'tok', 'inbound', 'active', now()::text)`,
    [BOOTSTRAP_TENANT_ID],
  );
  const runner = { withClient: (fn) => fn({ query: q }) };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  const portalStore = makePortalStore(runner);

  // Kunde anlegen, aktivieren, Session erzeugen (echte Factories).
  await accounts.upsertOnFirstLogin({ sub: "cust1", email: "c@x" });
  await accounts.setStatus("t_cust1", "active");
  const { id: sessionId } = await sessions.create({
    sub: "cust1",
    tenantId: "t_cust1",
    ttlSeconds: 3600,
  });

  // Route wie in server.js.
  const app = express();
  app.get(
    "/api/portal/state",
    webAuth({ secret: SECRET, sessions, accounts }),
    async (req, res) => {
      const calls = await portalStore.listCalls(req.tenant.tenantId);
      res.json({ tenantId: req.tenant.tenantId, calls });
    },
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    sessionId,
    close: () => new Promise((r) => server.close(r)),
  };
}

function get(url, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, cookie ? { headers: { Cookie: cookie } } : {}, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
  });
}

test("/api/portal/state ohne Session -> 401 (fail-closed)", async () => {
  const s = await setup();
  try {
    assert.equal((await get(`${s.base}/api/portal/state`)).status, 401);
  } finally {
    await s.close();
  }
});

test("/api/portal/state mit aktiver Kunden-Session -> nur eigene (leere) Calls, kein Owner-Leak", async () => {
  const s = await setup();
  try {
    const cookie = `session=${encodeURIComponent(signValue(s.sessionId, SECRET))}`;
    const res = await get(`${s.base}/api/portal/state`, cookie);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.tenantId, "t_cust1");
    assert.deepEqual(body.calls, [], "Kunde hat keine eigenen Calls");
    assert.ok(!res.body.includes("call_owner"), "Owner-Call leakt NICHT ins Kunden-Portal");
  } finally {
    await s.close();
  }
});
