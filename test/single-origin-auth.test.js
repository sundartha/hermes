import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makeWebAuthRoutes, verifyValue, SESSION_COOKIE_NAME } from "../src/web-auth.js";
import { productionFootguns } from "../src/config.js";

const SECRET = "test-session-secret-0123456789";

async function mountRouter(deps) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(makeWebAuthRoutes(deps));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

function cookieValue(setCookie, name) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const c of list) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    if (pair.slice(0, i) === name) return decodeURIComponent(pair.slice(i + 1));
  }
  return null;
}

function rawPost(url, form) {
  const payload = form ? new URLSearchParams(form).toString() : null;
  const headers = payload
    ? { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(payload) }
    : {};
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            setCookie: res.headers["set-cookie"] || [],
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function fakeDeps(overrides = {}) {
  const calls = { upsert: [], create: [] };
  const deps = {
    secret: SECRET,
    ttlSeconds: 3600,
    postLoginPath: "/app",
    accounts: {
      upsertOnFirstLogin: async (arg) => {
        calls.upsert.push(arg);
        return { tenantId: "t_dev", status: "suspended", role: "member" };
      },
    },
    sessions: {
      create: async (arg) => {
        calls.create.push(arg);
        return { id: "sess-dev-1" };
      },
    },
    ...overrides,
  };
  return { deps, calls };
}

test("dev-login (devLoginEnabled): mintet Session-Cookie + 302 postLoginPath (/app)", async () => {
  const { deps, calls } = fakeDeps({ devLoginEnabled: true });
  const srv = await mountRouter(deps);
  try {
    const res = await rawPost(`${srv.base}/auth/dev-login`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/app", "Post-Login-Ziel = App-Shell (Single-Origin)");
    assert.equal(calls.upsert.length, 1);
    assert.equal(calls.create.length, 1);
    assert.equal(calls.create[0].sub, "dev-user", "dev-Default-sub");
    assert.equal(calls.create[0].tenantId, "t_dev");
    const sessionCookie = cookieValue(res.setCookie, SESSION_COOKIE_NAME);
    assert.equal(verifyValue(sessionCookie, SECRET), "sess-dev-1", "signiertes Session-Cookie");
    const joined = res.setCookie.join("\n");
    assert.match(joined, /HttpOnly/i);
    assert.match(joined, /SameSite=Lax/i);
    const gesetzt = res.setCookie.find((zeile) => zeile.startsWith(`${SESSION_COOKIE_NAME}=`));
    assert.match(gesetzt, /;\s*Secure/i);
    assert.match(gesetzt, /;\s*Path=\/(;|$)/i);
    assert.doesNotMatch(gesetzt, /;\s*Domain=/i, "__Host- verbietet Domain=");
  } finally {
    await srv.close();
  }
});

test("dev-login mit Body-sub/email: uebernimmt die Werte (statt der dev-Defaults)", async () => {
  const { deps, calls } = fakeDeps({ devLoginEnabled: true });
  const srv = await mountRouter(deps);
  try {
    const res = await rawPost(`${srv.base}/auth/dev-login`, {
      sub: "custom-dev",
      email: "tester@local.test",
    });
    assert.equal(res.status, 302);
    assert.deepEqual(calls.upsert[0], { sub: "custom-dev", email: "tester@local.test" });
    assert.equal(calls.create[0].sub, "custom-dev");
  } finally {
    await srv.close();
  }
});

test("dev-login OHNE devLoginEnabled: Route existiert nicht -> 404 (fail-closed)", async () => {
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const res = await rawPost(`${srv.base}/auth/dev-login`);
    assert.equal(res.status, 404, "ohne Flag keine Dev-Login-Route");
    assert.equal(calls.create.length, 0, "keine Session ohne Flag");
  } finally {
    await srv.close();
  }
});

const SAFE_PROD = {
  auth: { dashboardPassword: "geheim", mcpAuth: "", oauthIssuerUrl: "" },
  safety: { skipTwilioSignatureCheck: false },
  store: { storeBackend: "pg" },
  server: { publicUrl: "https://agent.test", publicUrlExplicit: true },
};

function withEnv(name, value, fn) {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

test("DEV_LOGIN_ENABLED=true im Hosting -> productionFootguns fatal (Boot-Refusal)", () => {
  withEnv("DEV_LOGIN_ENABLED", "true", () => {
    const errors = productionFootguns(SAFE_PROD, true);
    assert.equal(errors.length, 1, "DEV_LOGIN_ENABLED ist der einzige Footgun in SAFE_PROD");
    assert.match(errors[0], /DEV_LOGIN_ENABLED/);
    assert.deepEqual(productionFootguns(SAFE_PROD, false), [], "lokal kein Footgun");
  });
});

test("DEV_LOGIN_ENABLED nicht gesetzt im Hosting -> kein Footgun", () => {
  withEnv("DEV_LOGIN_ENABLED", undefined, () => {
    assert.deepEqual(productionFootguns(SAFE_PROD, true), [], "ohne DEV_LOGIN_ENABLED sauber");
  });
});

test("DEV_LOGIN_ENABLED-Roh-Pruefung ist unabhaengig vom config-Objekt (Roh-Env 'true' schlaegt durch, auch wenn cfg.auth.devLoginEnabled === false)", () => {
  withEnv("DEV_LOGIN_ENABLED", "true", () => {
    const cfg = { ...SAFE_PROD, auth: { ...SAFE_PROD.auth, devLoginEnabled: false } };
    const errors = productionFootguns(cfg, true);
    assert.ok(
      errors.some((e) => /DEV_LOGIN_ENABLED/.test(e)),
      "die zweite, rohe Sperre feuert unabhaengig vom abweichenden config-Wert",
    );
  });
});
