// WEB-09 (i18n-Testkatalog, tasks/i18n-tests/08-web-dashboard-onboarding.md:261) -
// Self-Service-API-Fehlertexte sind rohes Deutsch statt Code+lokalisierbarem Text.
//
// SOLL (rot): das `error`-Feld einer fehlgeschlagenen POST /api/self-service/private-number
// soll ein stabiler, sprachneutraler Code sein (z.B. "invalid_private_number"), kein
// deutscher Klartext. Heute liefert src/self-service-routes.js:275 woertlich
// "privateNumber ungueltig (E.164 erwartet, erlaubtes Land)".
//
// Eigene Datei (Vorgabe): WEB-09 betrifft src/self-service-routes.js, NICHT den Auth-Pfad
// (test/web-auth.test.js ist WEB-11/WEB-12 vorbehalten). In-process pglite (Muster
// test/i9-self-service.test.js): kein Server-Spawn, kein Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "web-09-web-secret-0123456789";
const SUB = "sub-web09";
const TENANT_ID = "t_sub-web09"; // upsertOnFirstLogin: tenantId = `t_${sub}`

async function setup() {
  const { store, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  const s = store.load();
  ops.registerTenant(s, TENANT_ID, { firstName: "Web", lastName: "Neun" });
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
    close: () => new Promise((r) => server.close(r)),
  };
}

test("WEB-09 (SOLL rot): ungueltige privateNumber liefert einen stabilen Code, kein deutsches Klartext-Fehlerfeld", async () => {
  const srv = await setup();
  try {
    const res = await fetch(`${srv.base}/api/self-service/private-number`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: srv.cookie },
      body: JSON.stringify({ privateNumber: "abc" }),
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    // SOLL: ein stabiler Code ohne deutsche Signalwoerter/Leerzeichen (z.B. "invalid_private_number").
    assert.doesNotMatch(
      json.error,
      /ungueltig|erwartet|erlaubtes|\s/,
      `SOLL: error-Feld muss ein sprachneutraler Code sein, nicht deutscher Klartext (war "${json.error}")`,
    );
  } finally {
    await srv.close();
  }
});
