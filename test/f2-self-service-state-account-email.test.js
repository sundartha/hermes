// F2-Mail - Self-Service GET /api/self-service/state traegt additiv accountEmail
// (Konto-E-Mail-Prefill fuers Newsletter-Feld, s. apps/web NewsletterIsland.astro).
// Kompositions-Integrationstest nach dem Muster f2-self-service-state-private-number.
// test.js: reines pglite (offline, F.I.R.S.T.), KEIN Server-Spawn.
//   - accounts injiziert + Account mit Email -> accountEmail = die echte Konto-Adresse
//   - kein accounts-Adapter injiziert (pg-Web-Login-Block nicht gemountet) -> null,
//     kein Throw (Muster f2-self-service-state-private-number.test.js ohne accounts)
//   - accounts injiziert, Lookup wirft (z.B. IO-Fehler) -> null, Route bleibt 200
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "account-email-web-secret-0123456789";
const SUB_A = "sub-mail-a";
const TENANT_A = "t_sub-mail-a";
const ACCOUNT_EMAIL = "kunde-mail-a@example.test";

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

async function seedActiveTenant(store, accounts, { sub, tenantId, email }) {
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Kunde", lastName: "Mail" });
  const t = s.tenants.find((x) => x.id === tenantId);
  t.status = "active";
  t.idpSubject = sub;
  await accounts.upsertOnFirstLogin({ sub, email });
  await accounts.setStatus(tenantId, "active");
}

async function setup({ routeAccounts: routeAccountsOverride, injectAccounts = true } = {}) {
  const { store, runner } = await makePgTestStore();
  // Session-/Seeding-Pfad braucht IMMER die echte Fassade (upsertOnFirstLogin/setStatus/
  // resolve) - unabhaengig davon, was die Route selbst als `accounts` injiziert bekommt.
  // Nur SO laesst sich Fall (c) bauen: der Login funktioniert normal, NUR der
  // accountByTenant-Lookup der Route schlaegt fehl.
  const realAccounts = makeAccounts(runner);
  const routeAccounts = routeAccountsOverride ?? realAccounts;
  const sessions = makeSessions(runner);

  await seedActiveTenant(store, realAccounts, { sub: SUB_A, tenantId: TENANT_A, email: ACCOUNT_EMAIL });
  const { id: sessionId } = await sessions.create({ sub: SUB_A, tenantId: TENANT_A, ttlSeconds: 3600 });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts: realAccounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: SECRET, sessions, accounts: realAccounts });
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw,
      audit: () => {},
      config: withConfigNamespaces({ paymentEnabled: false }),
      billing: {},
      // Muster f2-self-service-state-private-number.test.js: accounts wird NUR injiziert,
      // wenn injectAccounts=true - so bildet dieselbe Setup-Funktion beide Faelle ab.
      ...(injectAccounts ? { accounts: routeAccounts } : {}),
      provision: async () => {},
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    cookie: cookieFor(sessionId),
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
const getState = (s) => request("GET", `${s.base}/api/self-service/state`, { cookie: s.cookie });

test("(a) accounts injiziert + Account mit Email -> accountEmail = die echte Konto-Adresse", async () => {
  const s = await setup();
  try {
    const res = await getState(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.accountEmail, ACCOUNT_EMAIL);
  } finally {
    await s.close();
  }
});

test("(b) kein accounts-Adapter injiziert -> accountEmail: null, kein Throw", async () => {
  const s = await setup({ injectAccounts: false });
  try {
    const res = await getState(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.accountEmail, null);
  } finally {
    await s.close();
  }
});

test("(c) accountByTenant wirft (z.B. IO-Fehler) -> accountEmail: null, Route bleibt 200 (kein Riss der gesamten Ansicht)", async () => {
  const failingAccounts = {
    accountByTenant: async () => {
      throw new Error("pg connection lost");
    },
  };
  const s = await setup({ routeAccounts: failingAccounts });
  try {
    const res = await getState(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.accountEmail, null);
    // Der Rest der Ansicht bleibt intakt (Beleg, dass der Fehler lokal gefangen wurde).
    assert.ok("settings" in body);
  } finally {
    await s.close();
  }
});
