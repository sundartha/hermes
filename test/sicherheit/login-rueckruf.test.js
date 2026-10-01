import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import express from "express";

import { LOGIN_ROUTE, SESSION_COOKIE_NAME, makeWebAuthRoutes } from "../../src/web-auth.js";

const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const SESSION_SECONDS = 3600;
const AFTER_LOGIN = "/app";
const IDP_AUTHORIZE = "https://idp.sg04.test/authorize";
const ATTACKER = { code: "code-des-angreifers", state: "state-des-angreifers" };
const VICTIM_CODE = "code-des-nutzers";
const FOREIGN_TARGET = "https://boese.sg04.test/";

const login = { exchangedCodes: [], sessions: [] };

function loginRoutes() {
  return makeWebAuthRoutes({
    secret: "sg04-signatur-geheimnis-fuer-login-cookies",
    redirectUri: "https://agent.test/auth/callback",
    ttlSeconds: SESSION_SECONDS,
    postLoginPath: AFTER_LOGIN,
    oidc: {
      authorizeUrl: async ({ state }) => `${IDP_AUTHORIZE}?state=${encodeURIComponent(state)}`,
      exchange: async ({ code }) => {
        login.exchangedCodes.push(code);
        return { claims: { sub: "sub-sg04", email: "sg04@kunde.test" } };
      },
    },
    accounts: {
      upsertOnFirstLogin: async () => ({ tenantId: "t_sg04", status: "active", role: "member" }),
    },
    sessions: {
      create: async (session) => {
        login.sessions.push(session);
        return { id: `sess-sg04-${login.sessions.length}` };
      },
    },
    audit: { record: async () => {} },
  });
}

before(async () => {
  const app = express();
  app.use(loginRoutes());
  login.server = await new Promise((listening) => {
    const server = app.listen(0, "127.0.0.1", () => listening(server));
  });
});

after(() => {
  login.server?.close();
});

function visit(path, cookies = "") {
  const url = `http://127.0.0.1:${login.server.address().port}${path}`;
  return fetch(url, { redirect: "manual", headers: { cookie: cookies } });
}

const cookiePairs = (res) => res.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
const callback = (params) => `/auth/callback?${new URLSearchParams(params)}`;

test("SG-04 Login-Rückruf mit fremdem state wird abgelehnt", async () => {
  const started = await visit(LOGIN_ROUTE);
  const browserCookies = cookiePairs(started).join("; ");
  const authorize = new URL(started.headers.get("location"));
  const ownState = authorize.searchParams.get("state");

  const smuggled = await visit(callback(ATTACKER), browserCookies);
  assert.equal(smuggled.status, HTTP_BAD_REQUEST);
  assert.deepEqual(login.exchangedCodes, []);
  assert.deepEqual(login.sessions, []);
  assert.equal(cookiePairs(smuggled).some((pair) => pair.startsWith(SESSION_COOKIE_NAME)), false);

  const params = { code: VICTIM_CODE, state: ownState, next: FOREIGN_TARGET };
  const own = await visit(callback(params), browserCookies);
  assert.equal(own.status, HTTP_FOUND);
  assert.equal(own.headers.get("location"), AFTER_LOGIN);
  assert.deepEqual(login.exchangedCodes, [VICTIM_CODE]);
  assert.equal(cookiePairs(own).some((pair) => pair.startsWith(SESSION_COOKIE_NAME)), true);
});
