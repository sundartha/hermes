import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makePgTestStore } from "../pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, makeAccounts, makeSessions, signValue } from "../../src/web-auth.js";
import { makeSelfServiceRoutes } from "../../src/self-service-routes.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const SECRET = "spracheinstellung-web-secret-0123456789";
const SUB = "sub-sprache4a";
const TENANT_ID = "t_sub-sprache4a";
const HTTP_OK = 200;

async function setup() {
  const { store, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
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

test("5986-4a: Einstellungen kennen keine Sprache mehr: sie erscheint in keiner Antwort und wird nicht gespeichert, andere Felder gelten weiter", async () => {
  const srv = await setup();
  try {
    const res = await abrufMitFrist(`${srv.base}/api/self-service/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: srv.cookie },
      body: JSON.stringify({ language: "fr", agentName: "Hermes Vier" }),
    });
    assert.equal(res.status, HTTP_OK);
    const antwort = await res.json();
    assert.equal("language" in antwort, false);
    assert.equal(antwort.agentName, "Hermes Vier");
    const gespeichert = srv.store.tenantContext(TENANT_ID).settings;
    assert.equal("language" in gespeichert, false);
    assert.equal(gespeichert.agentName, "Hermes Vier");
  } finally {
    await srv.close();
  }
});
