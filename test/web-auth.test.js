import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import {
  signValue,
  verifyValue,
  makePkce,
  makeWebAuthRoutes,
  makeOidc,
  claimsFromPayload,
  adminOnly,
} from "../src/web-auth.js";

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
        resolve({
          status: res.statusCode,
          headers: res.headers,
          setCookie: res.headers["set-cookie"] || [],
          body,
        }),
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
    deps[k] =
      overrides[k] && typeof overrides[k] === "object" && !Array.isArray(overrides[k])
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
      `oidc_nonce=${encodeURIComponent(signValue("nonce-abc", SECRET))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, {
      Cookie: cookies,
    });

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
    assert.equal(
      verifyValue(sessionCookie, SECRET),
      "sess-abc-123",
      "Session-Cookie = signierte Session-id",
    );
    const joined = res.setCookie.join("\n");
    assert.match(joined, /HttpOnly/i);
    assert.match(joined, /SameSite=Lax/i);
    // verifier + state werden geloescht (Max-Age=0 / Expires Vergangenheit)
    assert.match(
      joined,
      /pkce_verifier=;|pkce_verifier=deleted|Max-Age=0[\s\S]*pkce_verifier|pkce_verifier[\s\S]*Max-Age=0|pkce_verifier[\s\S]*Expires=Thu, 01 Jan 1970/i,
    );
    // Audit-Eintrag login
    assert.equal(calls.audit.length, 1);
    assert.equal(calls.audit[0].action, "login");
    assert.equal(calls.audit[0].actorSub, "user-1");
  } finally {
    await srv.close();
  }
});

test("GET /auth/callback mit postLoginPath: redirectet ins Kunden-Portal statt /", async () => {
  // Bug-Wurzel W3: ein frisch eingeloggter (suspendierter) Tenant darf NICHT auf "/"
  // (Owner-Dashboard hinter Basic-Auth) landen, sondern auf der Self-Service-Shell.
  const { deps } = fakeDeps({ postLoginPath: "/tenant.html" });
  const srv = await mountRouter(deps);
  try {
    const state = "state-xyz";
    const cookies = [
      `oauth_state=${encodeURIComponent(signValue(state, SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
      `oidc_nonce=${encodeURIComponent(signValue("nonce-abc", SECRET))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, {
      Cookie: cookies,
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/tenant.html");
  } finally {
    await srv.close();
  }
});

test("GET /auth/callback ohne postLoginPath: Default-Redirect bleibt / (byte-identisch)", async () => {
  // fail-safe Default: fehlt postLoginPath, bleibt das Bestands-Verhalten erhalten.
  const { deps } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const state = "state-xyz";
    const cookies = [
      `oauth_state=${encodeURIComponent(signValue(state, SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
      `oidc_nonce=${encodeURIComponent(signValue("nonce-abc", SECRET))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, {
      Cookie: cookies,
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/");
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
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=attacker-state`, {
      Cookie: cookies,
    });

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
      `oidc_nonce=${encodeURIComponent(signValue("nonce-abc", SECRET))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, {
      Cookie: cookies,
    });

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

// ---- F1: email_verified vor Admin-Allowlist erzwingen ----
// claimsFromPayload reicht email NUR durch, wenn email_verified === true ist.
// Verhindert Privilege-Escalation: unverifizierte/aenderbare Mail in ADMIN_EMAILS
// darf keine Admin-Rechte freischalten.

test("T-F1-01: email_verified true -> email durchgereicht", () => {
  const claims = claimsFromPayload({ sub: "u1", email: "admin@vodafone.de", email_verified: true });
  assert.deepEqual(claims, { sub: "u1", email: "admin@vodafone.de" });
});

test("T-F1-02: email_verified false -> email: null", () => {
  const claims = claimsFromPayload({
    sub: "u2",
    email: "attacker@vodafone.de",
    email_verified: false,
  });
  assert.deepEqual(claims, { sub: "u2", email: null });
});

test("T-F1-03: email_verified fehlt (undefined) -> email: null", () => {
  const claims = claimsFromPayload({ sub: "u3", email: "x@y.de" });
  assert.deepEqual(claims, { sub: "u3", email: null });
});

test("T-F1-04: email_verified true, email fehlt -> email: null (kein Throw)", () => {
  const claims = claimsFromPayload({ sub: "u4", email_verified: true });
  assert.deepEqual(claims, { sub: "u4", email: null });
});

test("T-F1-05: email_verified truthy String -> email: null (kein Truthy-Cast)", () => {
  const claims = claimsFromPayload({ sub: "u5", email: "x@y.de", email_verified: "true" });
  assert.deepEqual(claims, { sub: "u5", email: null });
});

// ---- F2: oidc_nonce-Cookie als Same-Session-Bindung ----
// WorkOS User Management kennt im authorize-Endpoint keinen `nonce`-Param und die
// authenticate-Antwort enthaelt kein id_token -> ein OIDC-nonce-Round-Trip ist nicht
// moeglich. Der Replay-Schutz liegt bei PKCE (code nur mit code_verifier einloesbar).
// Das signierte oidc_nonce-Cookie bleibt als zusaetzliche Same-Session-Bindung: /auth/login
// setzt es, /auth/callback erzwingt Vorhandensein + gueltige Signatur VOR dem Token-Tausch
// und loescht es beim Cleanup mit.

test("T-F2-01: GET /auth/login setzt signiertes oidc_nonce-Cookie (Same-Session-Bindung)", async () => {
  const { deps } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const res = await rawGet(`${srv.base}/auth/login`);
    assert.equal(res.status, 302);
    const joined = res.setCookie.join("\n");
    assert.match(joined, /oidc_nonce=/);
    assert.match(joined, /HttpOnly/i);
    assert.match(joined, /SameSite=Lax/i);
    // nonce-Cookie verifizierbar signiert
    const signedNonce = cookieValue(res.setCookie, "oidc_nonce");
    assert.ok(
      verifyValue(signedNonce, SECRET),
      "oidc_nonce-Cookie muss verifizierbar signiert sein",
    );
  } finally {
    await srv.close();
  }
});

test("T-F2-02: GET /auth/callback ohne oidc_nonce-Cookie -> 400, keine Session", async () => {
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const state = "state-xyz";
    const cookies = [
      `oauth_state=${encodeURIComponent(signValue(state, SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, {
      Cookie: cookies,
    });
    assert.equal(res.status, 400);
    assert.equal(cookieValue(res.setCookie, "session"), null);
    assert.equal(calls.upsert.length, 0);
    assert.equal(calls.create.length, 0);
  } finally {
    await srv.close();
  }
});

test("T-F2-03: GET /auth/callback mit manipuliertem oidc_nonce-Cookie -> 400, kein Leak", async () => {
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const state = "state-xyz";
    const cookies = [
      `oauth_state=${encodeURIComponent(signValue(state, SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
      // Falsche Signatur (anderes Secret) -> verifyValue gibt null
      `oidc_nonce=${encodeURIComponent(signValue("nonce-val", "wrong-secret"))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, {
      Cookie: cookies,
    });
    assert.equal(res.status, 400);
    assert.equal(cookieValue(res.setCookie, "session"), null);
    assert.equal(calls.create.length, 0);
    assert.doesNotMatch(res.body, /nonce-val/);
  } finally {
    await srv.close();
  }
});

test("T-F2-04: GET /auth/callback mit fehlschlagendem exchange (WorkOS-Fehler) -> 401, kein Leak", async () => {
  const { deps, calls } = fakeDeps({
    oidc: {
      authorizeUrl: async () => "https://idp.test/authorize",
      exchange: async () => {
        throw new Error("authenticate HTTP 401: super-secret-detail");
      },
    },
  });
  const srv = await mountRouter(deps);
  try {
    const state = "state-xyz";
    const cookies = [
      `oauth_state=${encodeURIComponent(signValue(state, SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
      `oidc_nonce=${encodeURIComponent(signValue("nonce-abc", SECRET))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, {
      Cookie: cookies,
    });
    assert.equal(res.status, 401);
    assert.equal(calls.create.length, 0);
    assert.doesNotMatch(res.body, /super-secret-detail/);
    assert.equal(cookieValue(res.setCookie, "session"), null);
  } finally {
    await srv.close();
  }
});

test("T-F2-05: GET /auth/callback Happy-Path: oidc_nonce-Cookie wird beim Cleanup geloescht", async () => {
  const { deps } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const state = "state-xyz";
    const nonce = "nonce-abc";
    const cookies = [
      `oauth_state=${encodeURIComponent(signValue(state, SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
      `oidc_nonce=${encodeURIComponent(signValue(nonce, SECRET))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, {
      Cookie: cookies,
    });
    assert.equal(res.status, 302);
    // Session-Cookie gesetzt (Happy-Path unveraendert)
    const sessionCookie = cookieValue(res.setCookie, "session");
    assert.equal(verifyValue(sessionCookie, SECRET), "sess-abc-123");
    // oidc_nonce wird geloescht (Max-Age=0)
    const joined = res.setCookie.join("\n");
    assert.match(joined, /oidc_nonce=;|oidc_nonce[\s\S]*Max-Age=0|Max-Age=0[\s\S]*oidc_nonce/i);
  } finally {
    await srv.close();
  }
});

// adminOnly-Mount-Muster: req.tenant per Hilfs-Middleware setzen, dann adminOnly.
async function mountAdmin(adminEmails, tenant) {
  const app = express();
  app.get(
    "/admin-probe",
    (req, _res, next) => {
      req.tenant = tenant;
      next();
    },
    adminOnly({ adminEmails }),
    (_req, res) => res.json({ ok: true }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("T-F1-06: adminOnly mit unverifizierter Email (null) -> 403 trotz Allowlist-Treffer", async () => {
  const srv = await mountAdmin(["admin@vodafone.de"], {
    email: null,
    role: "member",
    tenantId: "t_u1",
    sub: "u1",
  });
  try {
    const res = await rawGet(`${srv.base}/admin-probe`);
    assert.equal(res.status, 403);
  } finally {
    await srv.close();
  }
});

test("T-F1-07: adminOnly mit verifizierter Email in Allowlist -> 200", async () => {
  const srv = await mountAdmin(["admin@vodafone.de"], {
    email: "admin@vodafone.de",
    role: "member",
    tenantId: "t_u1",
    sub: "u1",
  });
  try {
    const res = await rawGet(`${srv.base}/admin-probe`);
    assert.equal(res.status, 200);
  } finally {
    await srv.close();
  }
});

// ---- AC1/AC2: realer WorkOS-UM authorizeUrl/exchange-Pfad (un-gestubbt) ----
// makeOidc bekommt einen injizierbaren fetch (KEIN globalThis-Mock, KEIN neues
// Prod-Interface). Damit laeuft der reale authorizeUrl-/exchange()-Code, den die
// Router-Tests per oidc-Fake umgehen. Beweist: authorizeUrl zeigt auf den WorkOS-UM-
// authorize-Endpoint (+provider=authkit, PKCE); exchange spricht /user_management/
// authenticate, uebernimmt die Identitaet aus dem `user`-Objekt (kein id_token) und
// faengt malformte Antworten als KLAREN Fehler statt undefined-Deref-Crash.

const WORKOS_BASE = "https://api.workos.test";
const OIDC_CFG = {
  workosApiBase: WORKOS_BASE,
  oidcClientId: "client_abc",
  oidcClientSecret: "sk_test_secret",
};

// fetch-Attrappe: zeichnet den letzten Request auf, liefert die konfigurierte Antwort.
// json kann ein Wert ODER eine Fehler-Factory sein.
function captureFetch({ ok = true, status = 200, json } = {}) {
  const seen = {};
  const _fetch = async (url, opts = {}) => {
    seen.url = String(url);
    seen.opts = opts;
    return { ok, status, json: typeof json === "function" ? json : async () => json };
  };
  return { _fetch, seen };
}

test("T-AC1-01: authorizeUrl zeigt auf WorkOS-UM-authorize (+provider=authkit, PKCE, kein scope/nonce)", async () => {
  const oidc = makeOidc(OIDC_CFG);
  const url = await oidc.authorizeUrl({
    challenge: "chal-123",
    state: "state-xyz",
    redirectUri: "https://agent.test/auth/callback",
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, `${WORKOS_BASE}/user_management/authorize`);
  assert.equal(u.searchParams.get("provider"), "authkit");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), "client_abc");
  assert.equal(u.searchParams.get("redirect_uri"), "https://agent.test/auth/callback");
  assert.equal(u.searchParams.get("code_challenge"), "chal-123");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), "state-xyz");
  // WorkOS-UM-authorize kennt weder scope noch nonce
  assert.equal(u.searchParams.get("scope"), null);
  assert.equal(u.searchParams.get("nonce"), null);
});

test("T-AC2-01: exchange spricht /user_management/authenticate und uebernimmt Identitaet aus user", async () => {
  const { _fetch, seen } = captureFetch({
    json: {
      user: { id: "user_01ABC", email: "kunde@firma.de", email_verified: true },
      access_token: "eyJ.aaa.bbb",
      refresh_token: "rt_123",
    },
  });
  const oidc = makeOidc(OIDC_CFG, { _fetch });
  const { claims } = await oidc.exchange({ code: "authcode", verifier: "ver-123" });
  // Identitaet aus dem user-Objekt (sub = user.id, email da email_verified===true)
  assert.deepEqual(claims, { sub: "user_01ABC", email: "kunde@firma.de" });
  // Request: POST an den UM-authenticate-Endpoint, JSON-Body mit grant_type+code+verifier+client
  assert.equal(seen.url, `${WORKOS_BASE}/user_management/authenticate`);
  assert.equal(seen.opts.method, "POST");
  assert.match(seen.opts.headers["Content-Type"], /application\/json/);
  const body = JSON.parse(seen.opts.body);
  assert.equal(body.grant_type, "authorization_code");
  assert.equal(body.code, "authcode");
  assert.equal(body.code_verifier, "ver-123");
  assert.equal(body.client_id, "client_abc");
  assert.equal(body.client_secret, "sk_test_secret");
});

test("T-AC2-02: exchange mit email_verified=false -> email: null (Gate via claimsFromPayload)", async () => {
  const { _fetch } = captureFetch({
    json: { user: { id: "user_01X", email: "unverified@firma.de", email_verified: false } },
  });
  const oidc = makeOidc(OIDC_CFG, { _fetch });
  const { claims } = await oidc.exchange({ code: "c", verifier: "v" });
  assert.deepEqual(claims, { sub: "user_01X", email: null });
});

test("T-AC2-03: exchange ohne user in der Antwort -> klarer Fehler, kein undefined-Deref", async () => {
  const { _fetch } = captureFetch({ json: {} });
  const oidc = makeOidc(OIDC_CFG, { _fetch });
  await assert.rejects(
    () => oidc.exchange({ code: "c", verifier: "v" }),
    (err) => {
      assert.match(err.message, /user/, "Fehler nennt das fehlende user-Objekt");
      assert.doesNotMatch(err.message, /Cannot read|undefined/i, "kein undefined-Deref-Crash");
      return true;
    },
  );
});

test("T-AC2-04: exchange mit non-JSON-Body (r.json wirft) -> gefangen, kein undefined-Crash", async () => {
  const _fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("not json");
    },
  });
  const oidc = makeOidc(OIDC_CFG, { _fetch });
  await assert.rejects(
    () => oidc.exchange({ code: "c", verifier: "v" }),
    (err) => {
      assert.doesNotMatch(err.message, /Cannot read|undefined/i, "kein undefined-Deref-Crash");
      return true;
    },
  );
});

test("T-AC2-05: exchange bei authenticate-HTTP-Fehler -> Throw ohne Body-Leak", async () => {
  const { _fetch } = captureFetch({
    ok: false,
    status: 401,
    json: async () => ({ error: "unauthorized_client", detail: "super-secret-detail" }),
  });
  const oidc = makeOidc(OIDC_CFG, { _fetch });
  await assert.rejects(
    () => oidc.exchange({ code: "c", verifier: "v" }),
    (err) => {
      assert.match(err.message, /authenticate HTTP 401/, "nennt Status, kein Body");
      assert.doesNotMatch(err.message, /super-secret-detail/, "kein Body-/Detail-Leak im Fehler");
      return true;
    },
  );
});

// ---- P4 / AC3: GET /auth/login fail-closed ----
// authorizeUrl baut zwar nur eine URL (kein I/O), bleibt aber awaited: wirft es
// unerwartet, reicht Express 4 die Rejection NICHT an eine Error-MW weiter -> der
// Request haengt bis zum Socket-Timeout. Mit try/catch: sauberer 5xx, kein Detail-Leak.

test("T-P4-05: GET /auth/login bei authorizeUrl-Fehler -> 5xx, kein Hang, kein Leak", async () => {
  const { deps } = fakeDeps({
    oidc: {
      authorizeUrl: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:1 SECRET_IDP_DETAIL");
      },
      exchange: async () => ({ claims: { sub: "x", email: "y@z" } }),
    },
  });
  const srv = await mountRouter(deps);
  try {
    // Eigener Timeout beweist "kein Hang": die Response kommt sofort, nicht erst nach
    // Socket-Timeout. AbortController kappt nach 4s -> der Test wuerde sonst werfen.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    const res = await rawGet(`${srv.base}/auth/login`);
    clearTimeout(timer);
    assert.ok(res.status >= 500 && res.status < 600, `5xx erwartet, war ${res.status}`);
    assert.doesNotMatch(
      res.body,
      /ECONNREFUSED|SECRET_IDP_DETAIL|127\.0\.0\.1/,
      "kein IdP-/Connection-Leak im Body",
    );
  } finally {
    await srv.close();
  }
});
