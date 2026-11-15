import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import request from "../gemeinsam/testserver-anfrage.mjs";
import { makePgTestStore } from "../pg-helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { SESSION_COOKIE_NAME, webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../../src/web-auth.js";
import { mountSelfServiceRoutes } from "../../src/self-service-routes.js";

const SECRET = "agentname-koerper-secret-0123456789";
const SUB = "sub-an";
const TENANT = "t_sub-an";
const SESSION_TTL_SECONDS = 3600;
const NICHT_STRING_AGENTNAME = 7;
const ABGELEHNT = ["invalid_body", "invalid_agent_name"];

async function setup() {
  const { store, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "an@kunde.de" });
  await accounts.setStatus(TENANT, "active");
  await store.ensureTenant(TENANT);
  const { id: sessionId } = await sessions.create({ sub: SUB, tenantId: TENANT, ttlSeconds: SESSION_TTL_SECONDS });
  const app = express();
  app.use(express.json());
  app.use(
    mountSelfServiceRoutes({
      store,
      webAuthMw: webAuth({ secret: SECRET, sessions, accounts }),
      webAuthPendingMw: webAuthAllowPending({ secret: SECRET, sessions, accounts }),
      audit: () => {},
      config: withConfigNamespaces({ paymentEnabled: true, csrfEnforce: false }),
      billing: {},
      accounts,
      provision: async () => {},
    }),
  );
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(sessionId, SECRET))}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function fehlerCodeVon(body) {
  const ctx = await setup();
  try {
    const res = await request("POST", `${ctx.base}/api/self-service/settings`, { cookie: ctx.cookie, body });
    assert.equal(res.status, 200, res.body);
    return JSON.parse(res.body || "{}").error;
  } finally {
    await ctx.close();
  }
}

test("Einstellungen mit Array als Körper werden nicht als ungültiger Körper oder Agentenname abgelehnt", async () => {
  const fehler = await fehlerCodeVon([]);
  assert.equal(ABGELEHNT.includes(fehler), false, `unerwartet: ${fehler}`);
});

test("Einstellungen mit agentName als Zahl werden nicht als ungültiger Körper oder Agentenname abgelehnt", async () => {
  const fehler = await fehlerCodeVon({ agentName: NICHT_STRING_AGENTNAME });
  assert.equal(ABGELEHNT.includes(fehler), false, `unerwartet: ${fehler}`);
});

test("Einstellungen mit agentName null werden nicht als ungültiger Körper oder Agentenname abgelehnt", async () => {
  const fehler = await fehlerCodeVon({ agentName: null });
  assert.equal(ABGELEHNT.includes(fehler), false, `unerwartet: ${fehler}`);
});
