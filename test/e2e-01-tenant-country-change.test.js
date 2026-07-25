// E2E-01 (i18n-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md:879) - Landwechsel eines
// Bestandstenants (DE -> US).
//
// SOLL (rot): ein definierter, getesteter Uebergang - entweder aendert sich die Sprache
// konsistent ueber alle Achsen, ODER der Wechsel wird mit begruendetem Fehler abgelehnt.
// Heute existiert kein Aufrufer von setTenantGeo ausserhalb POST /api/onboard (das ueber
// eine Self-Service-Session nicht erreichbar ist, WEB-20); der einzige Self-Service-
// Schreibpfad fuer Tenant-Felder (POST /api/self-service/settings) filtert "country" ueber
// selfServicePatch als unbekanntes Feld (SELF_SERVICE_FREE_FIELDS enthaelt nur agentName/
// language/agentStyle, src/self-service.js:20) - der Request antwortet 200 OHNE Fehler,
// OHNE die Aenderung vorzunehmen. Das ist WEDER ein konsistenter Wechsel NOCH eine
// begruendete Ablehnung - genau der in E2E-01 beschriebene Fehlmodus.
//
// In-process pglite (Muster test/i9-self-service.test.js/WEB-09): kein Server-Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
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
    cookie: `session=${encodeURIComponent(signValue(sessionId, SECRET))}`,
    store,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("E2E-01 (SOLL rot): Land-Wechsel DE->US ist entweder konsistent uebernommen oder begruendet abgelehnt", async () => {
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
