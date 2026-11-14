import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

const LIMIT = 3;
const HTTP_TOO_MANY = 429;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FOUND = 302;
const SECRET = "test-session-secret-0123456789";

process.env.RATE_LIMIT_PER_MIN = String(LIMIT);
process.env.SERVER_INSTANCES = "1";

const { makeWebAuthRoutes } = await import("../../src/web-auth.js");
const { mountSelfServiceRoutes } = await import("../../src/self-service-routes.js");
const { withConfigNamespaces } = await import("../config-namespaces-helper.js");

async function mount(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

async function wiederholt(anzahl, aufruf) {
  const antworten = [];
  for (let i = 0; i < anzahl; i += 1) antworten.push(await aufruf());
  return antworten;
}

function authRouter() {
  return makeWebAuthRoutes({
    secret: SECRET,
    redirectUri: "http://localhost/auth/callback",
    ttlSeconds: 3600,
    oidc: { authorizeUrl: async () => "http://idp.test/authorize" },
    accounts: {},
    sessions: {},
    audit: { record: async () => {} },
  });
}

test("Begrenzer: GET /auth/login antwortet bis zum Limit mit 302 und danach mit 429 samt Retry-After", async () => {
  const s = await mount(authRouter());
  try {
    const antworten = await wiederholt(LIMIT + 1, () =>
      fetch(`${s.base}/auth/login`, { redirect: "manual" }),
    );
    assert.deepEqual(antworten.map((a) => a.status), [HTTP_FOUND, HTTP_FOUND, HTTP_FOUND, HTTP_TOO_MANY]);
    assert.ok(Number(antworten[LIMIT].headers.get("retry-after")) > 0);
  } finally {
    await s.close();
  }
});

test("Begrenzer: GET /auth/callback antwortet bis zum Limit mit 302 und danach mit 429", async () => {
  const s = await mount(authRouter());
  try {
    const antworten = await wiederholt(LIMIT + 1, () =>
      fetch(`${s.base}/auth/callback`, { redirect: "manual" }),
    );
    assert.deepEqual(antworten.map((a) => a.status), [HTTP_FOUND, HTTP_FOUND, HTTP_FOUND, HTTP_TOO_MANY]);
  } finally {
    await s.close();
  }
});

test("Begrenzer: Login und Callback teilen sich ein Fenster je IP", async () => {
  const s = await mount(authRouter());
  try {
    await wiederholt(LIMIT, () => fetch(`${s.base}/auth/login`, { redirect: "manual" }));
    const callback = await fetch(`${s.base}/auth/callback`, { redirect: "manual" });
    assert.equal(callback.status, HTTP_TOO_MANY);
  } finally {
    await s.close();
  }
});

test("Begrenzer: POST /api/self-service/* antwortet bis zum Limit unverändert und danach mit 429", async () => {
  const router = mountSelfServiceRoutes({
    store: {},
    webAuthMw: (_req, res) => res.status(HTTP_UNAUTHORIZED).json({ error: "Unauthorized" }),
    webAuthPendingMw: (_req, res) => res.status(HTTP_UNAUTHORIZED).json({ error: "Unauthorized" }),
    audit: () => {},
    config: withConfigNamespaces({ csrfEnforce: false }),
    billing: {},
    accounts: {},
    provision: async () => {},
  });
  const s = await mount(router);
  try {
    const antworten = await wiederholt(LIMIT + 1, () =>
      fetch(`${s.base}/api/self-service/newsletter-consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    assert.deepEqual(
      antworten.map((a) => a.status),
      [HTTP_UNAUTHORIZED, HTTP_UNAUTHORIZED, HTTP_UNAUTHORIZED, HTTP_TOO_MANY],
    );
    assert.ok(Number(antworten[LIMIT].headers.get("retry-after")) > 0);
  } finally {
    await s.close();
  }
});
