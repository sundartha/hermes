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

// ---- F2: nonce im OIDC Auth-Code-Flow ----
// /auth/login erzeugt nonce, legt ihn signiert als oidc_nonce-Cookie ab und gibt
// ihn an authorizeUrl. /auth/callback liest den Cookie, reicht ihn an exchange
// durch (id_token-nonce-Bindung) und loescht ihn beim Cleanup mit. Schuetzt vor
// id_token-Replay/-Substitution, das PKCE nicht abdeckt.

test("T-F2-01: GET /auth/login setzt signiertes oidc_nonce-Cookie und gibt nonce an authorizeUrl", async () => {
  const { deps } = fakeDeps({
    oidc: {
      authorizeUrl: async ({ state, challenge, nonce, redirectUri }) =>
        `https://idp.test/authorize?state=${state}&code_challenge=${challenge}&nonce=${nonce}&redirect_uri=${encodeURIComponent(redirectUri)}`,
      exchange: async () => ({ claims: { sub: "user-1", email: "neu@kunde.de" } }),
    },
  });
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
    const nonceValue = verifyValue(signedNonce, SECRET);
    assert.ok(nonceValue, "oidc_nonce-Cookie muss verifizierbar signiert sein");
    // nonce-Param in der URL und stimmt mit dem Cookie-Klarwert ueberein
    const loc = new URL(res.headers.location);
    assert.equal(loc.searchParams.get("nonce"), nonceValue);
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

test("T-F2-04: GET /auth/callback mit nonce-Mismatch im id_token (exchange wirft) -> 401, kein Leak", async () => {
  const { deps, calls } = fakeDeps({
    oidc: {
      authorizeUrl: async () => "https://idp.test/authorize",
      exchange: async () => {
        throw new Error("nonce mismatch");
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
    assert.doesNotMatch(res.body, /nonce/);
    assert.equal(cookieValue(res.setCookie, "session"), null);
  } finally {
    await srv.close();
  }
});

test("T-F2-05: GET /auth/callback Happy-Path: nonce-Klarwert an exchange uebergeben, oidc_nonce geloescht", async () => {
  const { deps, calls } = fakeDeps({
    oidc: {
      authorizeUrl: async () => "https://idp.test/authorize",
      exchange: async ({ nonce }) => {
        calls.exchangeNonce = nonce;
        return { claims: { sub: "user-1", email: "neu@kunde.de" } };
      },
    },
  });
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
    // exchange erhielt den nonce-Klarwert (nach verifyValue des Cookies)
    assert.equal(calls.exchangeNonce, nonce);
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

// ---- P4 / AC1 + AC2: echter OIDC-discover/exchange-Pfad un-gestubbt ----
// makeOidc bekommt einen injizierbaren fetch (Muster wie _discoveryTtlMs): KEIN
// globalThis-Mock, KEIN neues Prod-Interface. Damit laeuft der reale discover()-/
// exchange()-Code (fetch + r.json() + Deref), den jeder andere Test per oidc-Fake
// umgeht. Beweist: malformte IdP-Antworten -> KLARER, gefangener Fehler statt
// new URL(undefined)/jwtVerify(undefined)-Crash als unhandled rejection.

const OIDC_ISSUER = "https://idp.p4.test";

// Baut eine fetch-Antwort-Attrappe. json kann ein Wert ODER eine Fehler-Factory sein.
function fakeResponse({ ok = true, status = 200, json } = {}) {
  return { ok, status, json: typeof json === "function" ? json : async () => json };
}

test("T-P4-01: Discovery ohne jwks_uri -> klarer Fehler, kein new URL(undefined)", async () => {
  // Discovery-200 OHNE jwks_uri. getJwks() darf NICHT mit `TypeError: Invalid URL`
  // crashen, sondern einen identifizierbaren Fehler werfen.
  const _fetch = async (url) => {
    if (String(url).endsWith("/.well-known/openid-configuration"))
      return fakeResponse({
        json: {
          authorization_endpoint: `${OIDC_ISSUER}/authorize`,
          token_endpoint: `${OIDC_ISSUER}/token`,
        },
      });
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  const oidc = makeOidc({ oauthIssuerUrl: OIDC_ISSUER }, { _fetch });
  await assert.rejects(
    () => oidc._getJwksForTest(),
    (err) => {
      assert.match(err.message, /jwks_uri/, "Fehler nennt das fehlende jwks_uri");
      assert.doesNotMatch(err.message, /Invalid URL/, "kein roher new URL(undefined)-TypeError");
      return true;
    },
  );
});

test("T-P4-02: Discovery-HTTP-Fehler -> bestehender OIDC discovery HTTP <status>-Throw", async () => {
  const _fetch = async () => fakeResponse({ ok: false, status: 503 });
  const oidc = makeOidc({ oauthIssuerUrl: OIDC_ISSUER }, { _fetch });
  await assert.rejects(() => oidc._getJwksForTest(), /OIDC discovery HTTP 503/);
});

test("T-P4-03: Token-Body non-JSON (r.json wirft) -> gefangen, kein jwtVerify(undefined)", async () => {
  // Discovery ok (mit jwks_uri), Token-Endpoint liefert ok:true aber r.json() rejected.
  const _fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/.well-known/openid-configuration"))
      return fakeResponse({
        json: {
          authorization_endpoint: `${OIDC_ISSUER}/authorize`,
          token_endpoint: `${OIDC_ISSUER}/token`,
          jwks_uri: `${OIDC_ISSUER}/jwks`,
        },
      });
    if (u === `${OIDC_ISSUER}/token`)
      return fakeResponse({
        ok: true,
        json: async () => {
          throw new Error("not json");
        },
      });
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  const oidc = makeOidc(
    { oauthIssuerUrl: OIDC_ISSUER, oidcClientId: "cid", oidcClientSecret: "csec" },
    { _fetch },
  );
  await assert.rejects(
    () => oidc.exchange({ code: "c", verifier: "v", nonce: "n", redirectUri: `${OIDC_ISSUER}/cb` }),
    (err) => {
      // gefangener Fehler (egal ob "not json" oder unser Guard) - NUR kein TypeError aus
      // jwtVerify(undefined): der Code darf den Token-Body-Parse-Fehler nicht als
      // undefined-id_token weiterreichen.
      assert.doesNotMatch(err.message, /Cannot read|undefined/i, "kein undefined-Deref-Crash");
      return true;
    },
  );
});

test("T-P4-04: Token-Body {} ohne id_token -> klarer Fehler, kein jwtVerify(undefined)", async () => {
  const _fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/.well-known/openid-configuration"))
      return fakeResponse({
        json: {
          authorization_endpoint: `${OIDC_ISSUER}/authorize`,
          token_endpoint: `${OIDC_ISSUER}/token`,
          jwks_uri: `${OIDC_ISSUER}/jwks`,
        },
      });
    if (u === `${OIDC_ISSUER}/token`) return fakeResponse({ ok: true, json: async () => ({}) }); // kein id_token
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  const oidc = makeOidc(
    { oauthIssuerUrl: OIDC_ISSUER, oidcClientId: "cid", oidcClientSecret: "csec" },
    { _fetch },
  );
  await assert.rejects(
    () => oidc.exchange({ code: "c", verifier: "v", nonce: "n", redirectUri: `${OIDC_ISSUER}/cb` }),
    (err) => {
      assert.match(err.message, /id_token/, "Fehler nennt das fehlende id_token");
      assert.doesNotMatch(
        err.message,
        /Cannot read|Invalid Compact JWS/i,
        "kein jwtVerify(undefined)-Crash",
      );
      return true;
    },
  );
});

// ---- P4 / AC3: GET /auth/login fail-closed ----
// Ist der IdP unerreichbar, rejected oidc.authorizeUrl (intern discover()->fetch).
// Ohne try/catch reicht Express 4 die Rejection NICHT an eine Error-MW weiter -> der
// Request haengt bis zum Socket-Timeout. Mit try/catch: sauberer 5xx, kein IdP-Leak.

test("T-P4-05: GET /auth/login bei IdP-down -> 5xx, kein Hang, kein Leak", async () => {
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
