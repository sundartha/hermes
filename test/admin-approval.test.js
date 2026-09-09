// Admin-Approve/Suspend-Datenpfad: webAuth -> adminOnly -> setStatus/
// invalidateByTenant/audit. Baut die server.js-Routen auf einer Wegwerf-App nach
// (in-process pglite). Beweist: Nicht-Admin -> 403; Admin approve -> active +
// Audit; Admin suspend -> suspended + ALLE Sessions des Tenants invalidiert + Audit.
// store kommt aus makePgTestStore (pg-helpers, G5: gleicher Helper wie die anderen
// pg-Tests) - accounts/sessions/audit teilen sich DESSEN runner/db, damit approve
// UND der pg-Store-Spiegel (suspended_at-Anchor) auf derselben Instanz laufen.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import {
  webAuth,
  adminOnly,
  makeAccounts,
  makeSessions,
  makeAdminRoutes,
  signValue,
  SESSION_COOKIE_NAME,
} from "../src/web-auth.js";
import { makeAuditStore } from "../src/audit-store.js";

const SECRET = "admin-test-secret-0123456789";
const ADMIN_EMAILS = ["admin@x"];

async function setup() {
  const { store, db, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  const auditStore = makeAuditStore(runner);

  // Admin (E-Mail in Allowlist) + Kunde (aktiv, kein Admin), je mit Session.
  await accounts.upsertOnFirstLogin({ sub: "admin1", email: "admin@x" });
  await accounts.setStatus("t_admin1", "active");
  const adminSession = (
    await sessions.create({ sub: "admin1", tenantId: "t_admin1", ttlSeconds: 3600 })
  ).id;
  await accounts.upsertOnFirstLogin({ sub: "cust1", email: "cust@x" });
  await accounts.setStatus("t_cust1", "active");
  const custSession = (
    await sessions.create({ sub: "cust1", tenantId: "t_cust1", ttlSeconds: 3600 })
  ).id;

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const adminMw = adminOnly({ adminEmails: ADMIN_EMAILS });
  const app = express();
  // Produktions-Router (server.js nutzt dieselbe Factory) -> der Test prueft den
  // echten Handler, keine handkopierte Replik.
  app.use(makeAdminRoutes({ accounts, sessions, audit: auditStore, webAuthMw, adminMw, store }));
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    db,
    store,
    accounts,
    sessions,
    adminSession,
    custSession,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Eine Quelle fuer Cookie-Signatur + HTTP-Roundtrip (G5); post/get sind duenne
// Methoden-Wrapper darueber.
function request(method, url, sessionId) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = sessionId
      ? { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(sessionId, SECRET))}` }
      : {};
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method, headers },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const post = (url, sessionId) => request("POST", url, sessionId);
const get = (url, sessionId) => request("GET", url, sessionId);

test("Nicht-Admin (aktiver Kunde) -> 403 bei approve", async () => {
  const s = await setup();
  try {
    const res = await post(`${s.base}/api/admin/tenants/t_cust1/approve`, s.custSession);
    assert.equal(res.status, 403);
  } finally {
    await s.close();
  }
});

test("Admin approve -> Tenant active + Audit", async () => {
  const s = await setup();
  try {
    await s.accounts.upsertOnFirstLogin({ sub: "target1", email: "t@x" }); // suspended
    const res = await post(`${s.base}/api/admin/tenants/t_target1/approve`, s.adminSession);
    assert.equal(res.status, 200);
    assert.equal((await s.accounts.resolve("target1")).status, "active");
    const rows = (await s.db.query(`SELECT action FROM audit_log WHERE tenant_id='t_target1'`))
      .rows;
    assert.ok(rows.some((r) => r.action === "tenant_approve"));
  } finally {
    await s.close();
  }
});

// Review-Blocker G3 (tenant-prolif-c, Invariante 2): Admin-approve ist der DRITTE
// Reaktivierungspfad neben Webhook-Activate/Self-Service-Subscribe (activatePaidTenant)
// und lief bisher NICHT ueber store.clearSuspendedAt - ein per Stripe suspendierter,
// manuell reaktivierter Tenant behielt einen stale Grace-Anker. store.ensureTenant zieht
// den Tenant in den pg-Spiegel (Muster: Web-Login mintSession macht das VOR jeder
// Billing-Aktion in Produktion), danach stempelt setSuspendedAtIfAbsent den Anchor wie
// die echte Stripe-Suspendierung (billing/webhook.js SUSPEND).
test("Admin approve nach Stripe-Suspendierung -> Grace-Anker geloescht (G3-Fix)", async () => {
  const s = await setup();
  try {
    await s.accounts.upsertOnFirstLogin({ sub: "target1", email: "t@x" });
    await s.accounts.setStatus("t_target1", "active");
    await s.store.ensureTenant("t_target1");
    s.store.setSuspendedAtIfAbsent("t_target1");
    assert.notEqual(s.store.tenantSuspendedAt("t_target1"), null, "Vorbedingung: Anker gesetzt");

    const res = await post(`${s.base}/api/admin/tenants/t_target1/approve`, s.adminSession);
    assert.equal(res.status, 200);
    assert.equal((await s.accounts.resolve("target1")).status, "active");
    assert.equal(
      s.store.tenantSuspendedAt("t_target1"),
      null,
      "Grace-Anker nach Admin-approve geloescht (kein stale Release-Kandidat)",
    );
  } finally {
    await s.close();
  }
});

test("Admin suspend -> suspended + alle Tenant-Sessions invalidiert + Audit", async () => {
  const s = await setup();
  try {
    await s.accounts.upsertOnFirstLogin({ sub: "target1", email: "t@x" });
    await s.accounts.setStatus("t_target1", "active");
    const targetSession = (
      await s.sessions.create({ sub: "target1", tenantId: "t_target1", ttlSeconds: 3600 })
    ).id;

    const res = await post(`${s.base}/api/admin/tenants/t_target1/suspend`, s.adminSession);
    assert.equal(res.status, 200);
    assert.equal((await s.accounts.resolve("target1")).status, "suspended");
    assert.notEqual(
      (await s.sessions.get(targetSession)).invalidated_at,
      null,
      "Session sofort invalidiert",
    );
    const rows = (await s.db.query(`SELECT action FROM audit_log WHERE tenant_id='t_target1'`))
      .rows;
    assert.ok(rows.some((r) => r.action === "tenant_suspend"));
  } finally {
    await s.close();
  }
});

// P4 GAP-04: Admin-Suspend loescht den Wartezustands-Marker (state-ops.tenantMayRequestNumber)
// - sonst duerfte ein gerade gesperrter Tenant ueber den stehengebliebenen Marker weiterhin
// eine Nummer anfragen.
test("Admin suspend loescht den GAP-04-Wartezustands-Marker (activationPending)", async () => {
  const s = await setup();
  try {
    await s.accounts.upsertOnFirstLogin({ sub: "target1", email: "t@x" });
    await s.accounts.setStatus("t_target1", "active");
    await s.store.ensureTenant("t_target1");
    s.store.setTenantSubscription("t_target1", { activationPending: true });
    assert.equal(
      s.store.tenantSubscription("t_target1").activationPending,
      true,
      "Vorbedingung: Marker gesetzt",
    );

    const res = await post(`${s.base}/api/admin/tenants/t_target1/suspend`, s.adminSession);
    assert.equal(res.status, 200);
    assert.equal(
      s.store.tenantSubscription("t_target1").activationPending,
      false,
      "Marker nach Admin-Suspend geloescht",
    );
  } finally {
    await s.close();
  }
});

test("ohne Session -> 401 (fail-closed, vor adminOnly)", async () => {
  const s = await setup();
  try {
    assert.equal((await post(`${s.base}/api/admin/tenants/t_cust1/approve`)).status, 401);
  } finally {
    await s.close();
  }
});

test("Admin approve/suspend auf nicht-existenten Tenant -> 404 (kein silent-noop, kein Audit)", async () => {
  const s = await setup();
  try {
    assert.equal(
      (await post(`${s.base}/api/admin/tenants/t_ghost/approve`, s.adminSession)).status,
      404,
    );
    assert.equal(
      (await post(`${s.base}/api/admin/tenants/t_ghost/suspend`, s.adminSession)).status,
      404,
    );
    const rows = (await s.db.query(`SELECT 1 FROM audit_log WHERE tenant_id='t_ghost'`)).rows;
    assert.equal(rows.length, 0, "kein Audit-Eintrag fuer nicht-existenten Tenant");
  } finally {
    await s.close();
  }
});

test("Admin -> 200 + listet alle Tenants (id/status, keine PII)", async () => {
  const s = await setup();
  try {
    const res = await get(`${s.base}/api/admin/tenants`, s.adminSession);
    assert.equal(res.status, 200);
    const { tenants } = JSON.parse(res.body);
    const ids = tenants.map((t) => t.id);
    assert.ok(ids.includes("t_admin1") && ids.includes("t_cust1"));
    // Kein Cross-Tenant-Leak: nur Lebenszyklus-Felder, keine Calls/Settings/Nummern.
    for (const t of tenants)
      assert.deepEqual(Object.keys(t).sort(), ["createdAt", "id", "status"]);
  } finally {
    await s.close();
  }
});

test("Nicht-Admin -> 403 bei tenant-list", async () => {
  const s = await setup();
  try {
    assert.equal((await get(`${s.base}/api/admin/tenants`, s.custSession)).status, 403);
  } finally {
    await s.close();
  }
});

test("ohne Session -> 401 bei tenant-list (fail-closed)", async () => {
  const s = await setup();
  try {
    assert.equal((await get(`${s.base}/api/admin/tenants`)).status, 401);
  } finally {
    await s.close();
  }
});
