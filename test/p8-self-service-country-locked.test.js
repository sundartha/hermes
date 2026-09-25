// P8/E2E-01, Vollbild: POST /api/self-service/settings lehnt einen Patch mit "country"
// mit 409 ab, VOR jedem Store-Zugriff (auch bei gemischtem Patch kein Teil-Apply). Muster
// test/i9-self-service.test.js (in-process pglite, kein Server-Spawn).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "p8-locked-web-secret-0123456789";
const SUB = "sub-p8locked";
const TENANT_ID = "t_sub-p8locked";

async function setup() {
  const { store, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  const s = store.load();
  ops.registerTenant(s, TENANT_ID, { firstName: "P8", lastName: "Locked" });
  ops.setTenantGeo(s, TENANT_ID, { country: "DE", defaultLanguage: "de" });
  const tenant = s.tenants.find((t) => t.id === TENANT_ID);
  tenant.status = "active";
  tenant.idpSubject = SUB;

  await accounts.upsertOnFirstLogin({ sub: SUB, email: `${SUB}@kunde.de` });
  await accounts.setStatus(TENANT_ID, "active");
  const { id: sessionId } = await sessions.create({ sub: SUB, tenantId: TENANT_ID, ttlSeconds: 3600 });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw: webAuthMw,
      audit: () => {},
      config: withConfigNamespaces({ paymentEnabled: false }),
      billing: {},
      provision: async () => {},
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(sessionId, SECRET))}`,
    store,
    close: () => new Promise((r) => server.close(r)),
  };
}

const postSettings = (base, cookie, body) =>
  fetch(`${base}/api/self-service/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });

test("{country:US} -> 409 country_change_unsupported/contact_support, Tenant-Geo unveraendert", async () => {
  const srv = await setup();
  try {
    const res = await postSettings(srv.base, srv.cookie, { country: "US" });
    const json = await res.json();
    assert.equal(res.status, 409);
    assert.equal(json.error, "country_change_unsupported");
    assert.equal(json.remedy, "contact_support");

    const geo = ops.tenantGeo(srv.store.load(), TENANT_ID);
    assert.equal(geo.country, "DE", "Tenant-Geo bleibt unveraendert");
    assert.equal(geo.defaultLanguage, "de");
  } finally {
    await srv.close();
  }
});

test("{country:US, agentName:X} -> 409 UND agentName bleibt unveraendert (kein Teil-Apply)", async () => {
  const srv = await setup();
  try {
    const res = await postSettings(srv.base, srv.cookie, { country: "US", agentName: "X" });
    assert.equal(res.status, 409);

    const ctx = srv.store.tenantContext(TENANT_ID);
    assert.notEqual(ctx.settings.agentName, "X", "agentName darf trotz Mischpatch nicht durchsickern");
  } finally {
    await srv.close();
  }
});

test("{agentName:X} ohne country -> weiterhin 200 (keine Regression)", async () => {
  const srv = await setup();
  try {
    const res = await postSettings(srv.base, srv.cookie, { agentName: "X" });
    assert.equal(res.status, 200);
    const ctx = srv.store.tenantContext(TENANT_ID);
    assert.equal(ctx.settings.agentName, "X");
  } finally {
    await srv.close();
  }
});
