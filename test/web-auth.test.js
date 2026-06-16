import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { signValue, verifyValue, makePkce, makeWebAuthRoutes } from "../src/web-auth.js";

const SECRET = "test-session-secret-0123456789";

test("signValue/verifyValue round-trip + Manipulation -> null", () => {
  const signed = signValue("sess123", SECRET);
  assert.equal(verifyValue(signed, SECRET), "sess123");
  assert.equal(verifyValue(signed + "x", SECRET), null, "manipuliert -> null");
  assert.equal(verifyValue("garbage", SECRET), null);
});

test("makePkce liefert verifier + S256-challenge", () => {
  const { verifier, challenge } = makePkce();
  assert.ok(verifier.length >= 43 && challenge.length >= 43);
  assert.notEqual(verifier, challenge);
});

// ---- Router-Tests mit injizierten Fakes (kein pg, kein echter IdP) ----

// Throwaway-express-App mit dem Router auf einem Ephemeral-Port. Liefert base-URL
// + close(). fetch redirect=manual, damit wir Location + Set-Cookie pruefen.
async function mountRouter(deps) {
  const app = express();
  app.use(makeWebAuthRoutes(deps));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

// Set-Cookie-Werte (Array oder einzeln) zu einem Cookie-Header zusammenfassen.
// Nur name=value (vor dem ersten ';'); Attribute (Path/HttpOnly/...) verwerfen.
function cookieHeaderFrom(setCookie) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
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

// node:http statt fetch: liefert raw Set-Cookie als Array (fetch faltet sie).
function rawGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, setCookie: res.headers["set-cookie"] || [], body })
      );
    });
    req.on("error", reject);
  });
}

function rawPost(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, setCookie: res.headers["set-cookie"] || [], body })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// Standard-Fakes; einzelne Tests ueberschreiben Felder gezielt.
function fakeDeps(overrides = {}) {
  const calls = { upsert: [], create: [], audit: [], invalidate: [] };
  const deps = {
    secret: SECRET,
    redirectUri: "https://agent.test/auth/callback",
    ttlSeconds: 3600,
    oidc: {
      authorizeUrl: async ({ challenge, state, redirectUri }) =>
        `https://idp.test/authorize?state=${state}&code_challenge=${challenge}&redirect_uri=${encodeURIComponent(redirectUri)}`,
      exchange: async ({ code }) => {
        calls.exchange = code;
        return { claims: { sub: "user-1", email: "neu@kunde.de" } };
      },
    },
    accounts: {
      upsertOnFirstLogin: async (arg) => {
        calls.upsert.push(arg);
        return { tenantId: "t_user-1", status: "suspended", role: "member" };
      },
    },
    sessions: {
      create: async (arg) => {
        calls.create.push(arg);
        return { id: "sess-abc-123" };
      },
      invalidateById: async (id) => {
        calls.invalidate.push(id);
      },
    },
    audit: { record: async (arg) => calls.audit.push(arg) },
  };
  // Tiefer Merge fuer die verschachtelten Fakes.
  for (const k of Object.keys(overrides)) {
    deps[k] = overrides[k] && typeof overrides[k] === "object" && !Array.isArray(overrides[k])
      ? { ...deps[k], ...overrides[k] }
      : overrides[k];
  }
  return { deps, calls };
}

test("GET /auth/login setzt signierte verifier+state-Cookies und redirectet zum IdP", async () => {
  const { deps } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const res = await rawGet(`${srv.base}/auth/login`);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^https:\/\/idp\.test\/authorize\?/);
    // beide Cookies httpOnly + sameSite=Lax + signiert
    const joined = res.setCookie.join("\n");
    assert.match(joined, /pkce_verifier=/);
    assert.match(joined, /oauth_state=/);
    assert.match(joined, /HttpOnly/i);
    assert.match(joined, /SameSite=Lax/i);
    // state-Cookie traegt eine gueltige Signatur
    const signedState = cookieValue(res.setCookie, "oauth_state");
    assert.ok(verifyValue(signedState, SECRET), "state-Cookie muss verifizierbar signiert sein");
  } finally {
    await srv.close();
  }
});

test("GET /auth/callback mit passendem state: upsert 1x, Session-Cookie gesetzt, redirect /", async () => {
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const state = "state-xyz";
    const cookies = [
      `oauth_state=${encodeURIComponent(signValue(state, SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, { Cookie: cookies });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/");
    // upsert genau 1x mit den IdP-Claims
    assert.equal(calls.upsert.length, 1);
    assert.deepEqual(calls.upsert[0], { sub: "user-1", email: "neu@kunde.de" });
    // Session genau 1x mit sub+tenantId
    assert.equal(calls.create.length, 1);
    assert.equal(calls.create[0].sub, "user-1");
    assert.equal(calls.create[0].tenantId, "t_user-1");
    // Set-Cookie traegt die SIGNIERTE Session-id
    const sessionCookie = cookieValue(res.setCookie, "session");
    assert.equal(verifyValue(sessionCookie, SECRET), "sess-abc-123", "Session-Cookie = signierte Session-id");
    const joined = res.setCookie.join("\n");
    assert.match(joined, /HttpOnly/i);
    assert.match(joined, /SameSite=Lax/i);
    // verifier + state werden geloescht (Max-Age=0 / Expires Vergangenheit)
    assert.match(joined, /pkce_verifier=;|pkce_verifier=deleted|Max-Age=0[\s\S]*pkce_verifier|pkce_verifier[\s\S]*Max-Age=0|pkce_verifier[\s\S]*Expires=Thu, 01 Jan 1970/i);
    // Audit-Eintrag login
    assert.equal(calls.audit.length, 1);
    assert.equal(calls.audit[0].action, "login");
    assert.equal(calls.audit[0].actorSub, "user-1");
  } finally {
    await srv.close();
  }
});

test("GET /auth/callback mit FALSCHEM state -> 400, keine Session (CSRF)", async () => {
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const cookies = [
      `oauth_state=${encodeURIComponent(signValue("the-real-state", SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
    ].join("; ");
    // Angreifer-state weicht vom Cookie ab
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=attacker-state`, { Cookie: cookies });

    assert.equal(res.status, 400);
    assert.equal(calls.upsert.length, 0, "kein Account-Upsert bei CSRF");
    assert.equal(calls.create.length, 0, "keine Session bei CSRF");
    // Cookie darf NICHT gesetzt sein
    assert.equal(cookieValue(res.setCookie, "session"), null);
  } finally {
    await srv.close();
  }
});

test("GET /auth/callback ohne state-Cookie -> 400 (kein Bypass)", async () => {
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=whatever`);
    assert.equal(res.status, 400);
    assert.equal(calls.create.length, 0);
  } finally {
    await srv.close();
  }
});

test("GET /auth/callback mit fehlschlagendem exchange -> 401, Cookies geloescht, kein Leak", async () => {
  const { deps, calls } = fakeDeps({
    oidc: {
      authorizeUrl: async () => "https://idp.test/authorize",
      exchange: async () => {
        throw new Error("id_token signature invalid: super-secret-token-xyz");
      },
    },
  });
  const srv = await mountRouter(deps);
  try {
    const state = "state-xyz";
    const cookies = [
      `oauth_state=${encodeURIComponent(signValue(state, SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, { Cookie: cookies });

    assert.equal(res.status, 401);
    assert.equal(calls.create.length, 0);
    // KEIN Leak des internen Fehlertexts/Tokens in den Body
    assert.doesNotMatch(res.body, /super-secret-token-xyz/);
    assert.equal(cookieValue(res.setCookie, "session"), null);
  } finally {
    await srv.close();
  }
});

test("POST /auth/logout invalidiert die Session und loescht das Cookie -> 204", async () => {
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const cookie = `session=${encodeURIComponent(signValue("sess-abc-123", SECRET))}`;
    const res = await rawPost(`${srv.base}/auth/logout`, { Cookie: cookie });
    assert.equal(res.status, 204);
    assert.deepEqual(calls.invalidate, ["sess-abc-123"]);
    // Cookie geloescht
    const joined = res.setCookie.join("\n");
    assert.match(joined, /session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  } finally {
    await srv.close();
  }
});

test("POST /auth/logout ohne Cookie -> 204 ohne Invalidierung (idempotent)", async () => {
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const res = await rawPost(`${srv.base}/auth/logout`);
    assert.equal(res.status, 204);
    assert.equal(calls.invalidate.length, 0);
  } finally {
    await srv.close();
  }
});
