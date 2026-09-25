// ex WEB-09, umbenannt in P9 (A3) - i18n-Testkatalog, tasks/i18n-tests/08-web-dashboard-onboarding.md:261.
//
// POST /api/self-service/private-number liefert bei ungueltigem Wert einen stabilen,
// sprachneutralen Code im `error`-Feld ("invalid_private_number"), keinen deutschen
// Klartext.
//
// Eigene Datei (Vorgabe): betrifft src/self-service-routes.js, NICHT den Auth-Pfad
// (test/web-auth.test.js deckt die dortigen Codes ab). In-process pglite (Muster
// test/i9-self-service.test.js): kein Server-Spawn, kein Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "web-09-web-secret-0123456789";
const SUB = "sub-web09";
const TENANT_ID = "t_sub-web09"; // upsertOnFirstLogin: tenantId = `t_${sub}`

async function setup({ paymentEnabled = false, publicUrl = "https://agent.test" } = {}) {
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
      config: withConfigNamespaces({ paymentEnabled, publicUrl }),
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
    close: () => new Promise((r) => server.close(r)),
  };
}

test("private-number: ungueltiger Wert liefert 400 + stabilen Code invalid_private_number (ex WEB-09)", async () => {
  const srv = await setup();
  try {
    const res = await fetch(`${srv.base}/api/self-service/private-number`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: srv.cookie },
      body: JSON.stringify({ privateNumber: "abc" }),
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, "invalid_private_number");
  } finally {
    await srv.close();
  }
});

// WEB-10 (R-G): Katalogtitel nennt api-onboard.js, dort gibt es keinen PUBLIC_URL-Treffer.
// Gemessene Belegstelle ist der Checkout-Handler in self-service-routes.js - dieselbe
// Funktion, die zwei Zeilen weiter plan_unconfigured/already_subscribed als Codes liefert.
test("WEB-10 (SOLL, rot) - fehlende PUBLIC_URL liefert einen sprachneutralen Code, keinen deutschen Klartext", async () => {
  const srv = await setup({ paymentEnabled: true, publicUrl: "" });
  try {
    const res = await fetch(`${srv.base}/api/self-service/billing/setup-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: srv.cookie },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.doesNotMatch(json.error, /\s/, "Code darf kein Satz sein (Leerzeichen), heute 'PUBLIC_URL fehlt'");
    assert.doesNotMatch(json.error, /fehlt/, "kein deutsches Wort im Code");
  } finally {
    await srv.close();
  }
});
