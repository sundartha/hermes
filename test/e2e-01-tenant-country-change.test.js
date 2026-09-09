// E2E-01 (i18n-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md:879) - Landwechsel eines
// Bestandstenants (DE -> US).
//
// P8 A3-Migration: dieser Test war "SOLL (rot)". Mit P8 (POST /api/self-service/settings
// lehnt einen Patch mit "country" jetzt ueber lockedSelfServiceKeys VOR jedem Store-Zugriff
// mit 409 ab, statt ihn still zu verschlucken) ist der Zielzustand erreicht - der Test
// wandert von test:gates nach npm test.
//
// In-process pglite (Muster test/i9-self-service.test.js/WEB-09): kein Server-Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "e2e-01-web-secret-0123456789";
const SUB = "sub-e2e01";
const TENANT_ID = "t_sub-e2e01";

async function setup() {
  const { store, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  const s = store.load();
  ops.registerTenant(s, TENANT_ID, { firstName: "E2E", lastName: "Eins" });
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

test("Land-Wechsel DE->US wird begruendet abgelehnt statt still verschluckt (ex E2E-01)", async () => {
  const srv = await setup();
  try {
    const res = await fetch(`${srv.base}/api/self-service/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: srv.cookie },
      body: JSON.stringify({ country: "US" }),
    });
    const json = await res.json();

    const s = srv.store.load();
    const geo = ops.tenantGeo(s, TENANT_ID);
    const changedConsistently = geo.country === "US" && geo.defaultLanguage === "en";
    const explicitlyRejected = res.status >= 400 && typeof json.error === "string";

    assert.ok(
      changedConsistently || explicitlyRejected,
      `SOLL: Land-Wechsel muss entweder konsistent (country=US, defaultLanguage=en) ` +
        `oder mit einem Fehler abgelehnt werden - gemessen: HTTP ${res.status}, ` +
        `tenant.country=${geo.country}, tenant.defaultLanguage=${geo.defaultLanguage}, ` +
        `body=${JSON.stringify(json)}`,
    );
  } finally {
    await srv.close();
  }
});
