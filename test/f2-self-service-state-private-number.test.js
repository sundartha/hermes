// F2 P6 - Self-Service Read der eigenen privaten Summary-Nummer (GET /api/self-service/
// state liefert privateNumber MASKIERT). Kompositions-Integrationstest nach dem Muster
// f2-self-service-private-number.test.js / i9-self-service.test.js: reines pglite (offline,
// F.I.R.S.T.), KEIN Server-Spawn. Prueft die SICHERHEITS-Invarianten der Lese-Sicht:
//   - eigene Nummer -> maskiert (+49…4567), volle E.164 NIE im Body (H4, Decision #5)
//   - keine Nummer -> privateNumber: null
//   - NIE eine fremde Tenant-Nummer: Schluessel ist die Web-Session (H3)
//   - kein Cookie -> 401 (fail-closed, bestehendes webAuthMw-Verhalten)
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";

const SECRET = "self-service-web-secret-0123456789";
const SUB_A = "sub-a";
const TENANT_A = "t_sub-a";
const SUB_B = "sub-b";
const TENANT_B = "t_sub-b";

const cookieFor = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

async function seedActiveTenant(store, accounts, { sub, tenantId }) {
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Kunde", lastName: sub });
  const t = s.tenants.find((x) => x.id === tenantId);
  t.status = "active";
  t.idpSubject = sub;
  await accounts.upsertOnFirstLogin({ sub, email: `${sub}@kunde.de` });
  await accounts.setStatus(tenantId, "active");
}

async function setup() {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  await seedActiveTenant(store, accounts, { sub: SUB_A, tenantId: TENANT_A });
  await seedActiveTenant(store, accounts, { sub: SUB_B, tenantId: TENANT_B });
  const { id: sessionA } = await sessions.create({
    sub: SUB_A,
    tenantId: TENANT_A,
    ttlSeconds: 3600,
  });
  const { id: sessionB } = await sessions.create({
    sub: SUB_B,
    tenantId: TENANT_B,
    ttlSeconds: 3600,
  });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const audit = () => {};
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      audit,
      config: { paymentEnabled: false },
      billing: {},
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    cookieA: cookieFor(sessionA),
    cookieB: cookieFor(sessionB),
    close: () => new Promise((r) => server.close(r)),
  };
}

function request(method, url, { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
const getState = (s, cookie = s.cookieB) =>
  request("GET", `${s.base}/api/self-service/state`, { cookie });

test("(a) eigene gesetzte Nummer -> maskiert (+49…4567), volle E.164 NIE im Body (H4)", async () => {
  const s = await setup();
  try {
    s.store.setPrivateNumber(TENANT_B, "+49 (170) 123-4567"); // normalisiert -> +491701234567
    const res = await getState(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.privateNumber, "+49…4567", "Laendercode + letzte 4 Ziffern, Rest maskiert");
    // PII-Dichtheit: die volle/mittlere Nummer darf NICHT durchsickern.
    assert.equal(res.body.includes("491701234567"), false, "volle E.164 NIE im Body");
    assert.equal(res.body.includes("17012"), false, "mittlere Ziffern NIE im Body");
    // Niemals in der settings-View (die ueber /api/state + MCP komplett leakt, H4).
    assert.equal("privateNumber" in (body.settings || {}), false, "privateNumber NIE in settings");
  } finally {
    await s.close();
  }
});

test("(b) keine Nummer hinterlegt -> privateNumber: null", async () => {
  const s = await setup();
  try {
    const res = await getState(s);
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).privateNumber, null, "kein Wert -> null");
  } finally {
    await s.close();
  }
});

test("(c) NIE eine fremde Tenant-Nummer: B sieht nur B's Nummer, nie A's (H3)", async () => {
  const s = await setup();
  try {
    s.store.setPrivateNumber(TENANT_A, "+491999000111"); // A's Nummer
    s.store.setPrivateNumber(TENANT_B, "+491701234567"); // B's Nummer
    const res = await getState(s, s.cookieB); // eingeloggt als B
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.privateNumber, "+49…4567", "B sieht B's maskierte Nummer");
    assert.equal(res.body.includes("1999000111"), false, "A's Ziffern NIE im B-Body");
    assert.equal(res.body.includes("0111"), false, "auch A's letzte 4 Ziffern nicht");
  } finally {
    await s.close();
  }
});

test("(d) kein Session-Cookie -> 401 (fail-closed)", async () => {
  const s = await setup();
  try {
    s.store.setPrivateNumber(TENANT_B, "+491701234567");
    const res = await request("GET", `${s.base}/api/self-service/state`);
    assert.equal(res.status, 401);
    assert.equal(res.body.includes("491701234567"), false, "keine Nummer ohne Session");
  } finally {
    await s.close();
  }
});
