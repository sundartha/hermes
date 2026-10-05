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
  SESSION_COOKIE_NAME,
} from "../src/web-auth.js";
import { GERMAN_STOPWORDS } from "./helpers.js";

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
  const calls = { upsert: [], create: [], audit: [], invalidate: [], get: [] };
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
      sessionLogoutUrl: ({ workosSessionId, returnTo }) => {
        const params = new URLSearchParams({ session_id: workosSessionId });
        if (returnTo) params.set("return_to", returnTo);
        return `https://idp.test/user_management/sessions/logout?${params}`;
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
      get: async (id) => {
        calls.get.push(id);
        return { workosSessionId: null };
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
    const sessionCookie = cookieValue(res.setCookie, SESSION_COOKIE_NAME);
    assert.equal(
      verifyValue(sessionCookie, SECRET),
      "sess-abc-123",
      "Session-Cookie = signierte Session-id",
    );
    const joined = res.setCookie.join("\n");
    assert.match(joined, /HttpOnly/i);
    assert.match(joined, /SameSite=Lax/i);
    // SEC-P5: die drei Bedingungen, die der Browser fuer __Host- erzwingt.
    const gesetzt = res.setCookie.find((zeile) => zeile.startsWith(`${SESSION_COOKIE_NAME}=`));
    assert.match(gesetzt, /;\s*Secure/i);
    assert.match(gesetzt, /;\s*Path=\/(;|$)/i);
    assert.doesNotMatch(gesetzt, /;\s*Domain=/i, "__Host- verbietet Domain=");
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
  // in einer rohen Auth-Sackgasse landen, sondern auf der Self-Service-Shell.
  const { deps } = fakeDeps({ postLoginPath: "/app" });
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
    assert.equal(res.headers.location, "/app");
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
    assert.equal(cookieValue(res.setCookie, SESSION_COOKIE_NAME), null);
  } finally {
    await srv.close();
  }
});

test("GET /auth/callback ohne state-Cookie -> 302 Recovery (kein Bypass, keine Session)", async () => {
  // AM2: FEHLENDES state-Cookie ist benign (Drop/Expiry/anderer Tab) -> Flow-Neustart statt
  // 400-Sackgasse. CSRF-Sicherung bleibt: KEINE Session, KEIN exchange, KEIN Mint.
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=whatever`);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/auth\/login\?retry=1$/);
    assert.equal(calls.create.length, 0, "kein Session-Mint im Recovery-Pfad");
    assert.equal(calls.upsert.length, 0);
    assert.equal(cookieValue(res.setCookie, SESSION_COOKIE_NAME), null);
  } finally {
    await srv.close();
  }
});

// ---- AM2: Registrierung ohne CSRF-Sackgasse (Auth-Callback-Recovery) ----
// Ein FEHLENDES state-Cookie ist benign (Cookie-Drop/Expiry/anderer Tab beim Mail-Link)
// und startet den Flow neu; ein VORHANDENES-aber-ungueltiges Cookie bleibt strikt 400.
// Loop-Guard ueber einen state-Marker (ueberlebt den IdP-Round-Trip ohne Cookies).

test("AM2: Callback mit kaputt signiertem oauth_state-Cookie -> 400 (fail-closed, kein Recovery)", async () => {
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const cookies = [
      `oauth_state=${encodeURIComponent(signValue("state-xyz", "wrong-secret"))}`, // falsche Signatur
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
      `oidc_nonce=${encodeURIComponent(signValue("nonce-abc", SECRET))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=state-xyz`, {
      Cookie: cookies,
    });
    assert.equal(res.status, 400, "vorhandenes-aber-ungueltiges Cookie != absent");
    assert.equal(calls.create.length, 0);
  } finally {
    await srv.close();
  }
});

test("AM2: Callback ohne Cookie + markierter state -> terminale Seite (Loop-Guard, kein Endlos-302)", async () => {
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=abc~retry`);
    assert.equal(res.status, 200);
    assert.notEqual(res.status, 302);
    assert.match(res.body, /Session expired/);
    assert.match(res.body, /\/auth\/login/);
    assert.equal(calls.create.length, 0);
    assert.equal(cookieValue(res.setCookie, SESSION_COOKIE_NAME), null);
  } finally {
    await srv.close();
  }
});

// WEB-13 - SOLL-Gegenstueck zum AM2-Ist-Pin darueber (der /Session expired/ pinnt).
// Die terminale Recovery-Seite erscheint, BEVOR eine Identitaet existiert
// (kein Cookie, kein Tenant) - eine Tenant-Sprache gibt es dort strukturell nicht. Der
// SOLL-Massstab ist deshalb der Weltdefault (P10: DEFAULT_LANGUAGE "en"), nicht "irgendeine
// Sprache". Welcher Kanal ihn kuenftig traegt (Accept-Language, Weltdefault, sprachneutraler
// Code), entscheidet die Fix-Phase - dieser Test entscheidet es NICHT.
test("WEB-13 (SOLL, rot) - die Session-abgelaufen-Seite ist nicht hart deutsch", async () => {
  const { deps } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=abc~retry`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.body, /lang="de"/);
    assert.doesNotMatch(res.body, GERMAN_STOPWORDS);
  } finally {
    await srv.close();
  }
});

test("AM2: GET /auth/login?retry=1 markiert state in Cookie UND authorize-URL", async () => {
  const { deps } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const res = await rawGet(`${srv.base}/auth/login?retry=1`);
    assert.equal(res.status, 302);
    const state = verifyValue(cookieValue(res.setCookie, "oauth_state"), SECRET);
    assert.ok(state.endsWith("~retry"), "state-Cookie traegt den retry-Marker");
    const u = new URL(res.headers.location);
    assert.ok(u.searchParams.get("state").endsWith("~retry"), "derselbe Marker geht an den IdP");
  } finally {
    await srv.close();
  }
});

test("AM2: GET /auth/login (ohne retry) -> state ohne Marker", async () => {
  const { deps } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const res = await rawGet(`${srv.base}/auth/login`);
    const state = verifyValue(cookieValue(res.setCookie, "oauth_state"), SECRET);
    assert.ok(!state.endsWith("~retry"));
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
    assert.equal(cookieValue(res.setCookie, SESSION_COOKIE_NAME), null);
  } finally {
    await srv.close();
  }
});

test("POST /auth/logout invalidiert die Session und loescht das Cookie -> 204", async () => {
  const { deps, calls } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue("sess-abc-123", SECRET))}`;
    const res = await rawPost(`${srv.base}/auth/logout`, { Cookie: cookie });
    assert.equal(res.status, 204);
    assert.deepEqual(calls.invalidate, ["sess-abc-123"]);
    // Cookie geloescht
    const joined = res.setCookie.join("\n");
    assert.match(
      joined,
      new RegExp(`${SESSION_COOKIE_NAME}=;|Max-Age=0|Expires=Thu, 01 Jan 1970`, "i"),
    );
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
    assert.equal(cookieValue(res.setCookie, SESSION_COOKIE_NAME), null);
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
    assert.equal(cookieValue(res.setCookie, SESSION_COOKIE_NAME), null);
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
    assert.equal(cookieValue(res.setCookie, SESSION_COOKIE_NAME), null);
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
    const sessionCookie = cookieValue(res.setCookie, SESSION_COOKIE_NAME);
    assert.equal(verifyValue(sessionCookie, SECRET), "sess-abc-123");
    // oidc_nonce wird geloescht (Max-Age=0)
    const joined = res.setCookie.join("\n");
    assert.match(joined, /oidc_nonce=;|oidc_nonce[\s\S]*Max-Age=0|Max-Age=0[\s\S]*oidc_nonce/i);
  } finally {
    await srv.close();
  }
});

// ---- Callback-Eingabevalidierung: PKCE-Verifier + code fail-fast ----
// state und nonce werden bereits mit 400 erzwungen; der PKCE-Verifier (Cookie) und der
// code-Query-Param ebenso, BEVOR WorkOS angerufen wird (kein null/undefined an
// authenticate). Fehlt eins -> 400, kein exchange, keine Session.

test("T-CB-01: GET /auth/callback ohne pkce_verifier-Cookie -> 400, kein exchange", async () => {
  const { deps, calls } = fakeDeps({
    oidc: {
      authorizeUrl: async () => "https://idp.test/authorize",
      exchange: async () => {
        calls.exchangeCalled = true;
        return { claims: { sub: "user-1", email: "neu@kunde.de" } };
      },
    },
  });
  const srv = await mountRouter(deps);
  try {
    const state = "state-xyz";
    const cookies = [
      `oauth_state=${encodeURIComponent(signValue(state, SECRET))}`,
      `oidc_nonce=${encodeURIComponent(signValue("nonce-abc", SECRET))}`,
    ].join("; ");
    const res = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, {
      Cookie: cookies,
    });
    assert.equal(res.status, 400);
    assert.equal(calls.exchangeCalled, undefined, "exchange darf ohne Verifier nicht laufen");
    assert.equal(cookieValue(res.setCookie, SESSION_COOKIE_NAME), null);
  } finally {
    await srv.close();
  }
});

test("T-CB-02: GET /auth/callback ohne code-Query-Param -> 400, kein exchange", async () => {
  const { deps, calls } = fakeDeps({
    oidc: {
      authorizeUrl: async () => "https://idp.test/authorize",
      exchange: async () => {
        calls.exchangeCalled = true;
        return { claims: { sub: "user-1", email: "neu@kunde.de" } };
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
    // Callback ohne code (z.B. WorkOS-Fehler-Redirect)
    const res = await rawGet(`${srv.base}/auth/callback?state=${state}`, { Cookie: cookies });
    assert.equal(res.status, 400);
    assert.equal(calls.exchangeCalled, undefined, "exchange darf ohne code nicht laufen");
    assert.equal(cookieValue(res.setCookie, SESSION_COOKIE_NAME), null);
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
// Spiegelt die echte config.auth-Namespace-Form (PA-17 Runde 2): makeOidc liest
// config.auth.<key>, nicht mehr config.<key> flach.
const OIDC_CFG = {
  auth: {
    workosApiBase: WORKOS_BASE,
    oidcClientId: "client_abc",
    oidcClientSecret: "sk_test_secret",
  },
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

// ---- P1: sid-Klaim-Extraktion aus dem Access-Token (WorkOS-Sign-out-Grundlage) ----
// exchange() liest die "sid"-Klaim aus dem JWT-Payload-Segment des access_token, OHNE
// Signatur-Pruefung (server-zu-server-Antwort, gleiche Vertrauensstufe wie user).
// fakeAccessToken baut ein ungueltig-signiertes, aber strukturell echtes JWT (Header.
// Payload.Signatur, base64url) -- die Extraktion prueft nur die Payload-Dekodierung.
function fakeAccessToken(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.dummy-signature`;
}

test("T-AC2-06: exchange liest die sid-Klaim aus einem gueltig geformten access_token", async () => {
  const { _fetch } = captureFetch({
    json: {
      user: { id: "user_01ABC", email: "kunde@firma.de", email_verified: true },
      access_token: fakeAccessToken({ sid: "session_01ABC" }),
    },
  });
  const oidc = makeOidc(OIDC_CFG, { _fetch });
  const { workosSessionId } = await oidc.exchange({ code: "c", verifier: "v" });
  assert.equal(workosSessionId, "session_01ABC");
});

test("T-AC2-07: exchange mit fehlendem/kaputtem access_token -> workosSessionId: null, kein Throw", async () => {
  const cases = [
    { label: "fehlend", access_token: undefined },
    { label: "kein Punkt", access_token: "keinpunkt" },
    { label: "nur 2 Segmente", access_token: "aaa.bbb" },
  ];
  for (const { label, access_token } of cases) {
    const { _fetch } = captureFetch({
      json: {
        user: { id: "user_01ABC", email: "kunde@firma.de", email_verified: true },
        access_token,
      },
    });
    const oidc = makeOidc(OIDC_CFG, { _fetch });
    const { workosSessionId } = await oidc.exchange({ code: "c", verifier: "v" });
    assert.equal(workosSessionId, null, label);
  }
});

test("T-AC2-08: access_token mit nicht-JSON Payload-Segment -> workosSessionId: null, kein Crash", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const badPayload = Buffer.from("not-json").toString("base64url");
  const { _fetch } = captureFetch({
    json: {
      user: { id: "user_01ABC", email: "kunde@firma.de", email_verified: true },
      access_token: `${header}.${badPayload}.dummy-signature`,
    },
  });
  const oidc = makeOidc(OIDC_CFG, { _fetch });
  const { workosSessionId } = await oidc.exchange({ code: "c", verifier: "v" });
  assert.equal(workosSessionId, null);
});

// ---- P1: sessionLogoutUrl (WorkOS-UM-Session-Logout-URL) ----

test("T-SL-01: sessionLogoutUrl baut die WorkOS-Sign-out-URL mit session_id + return_to", () => {
  const oidc = makeOidc(OIDC_CFG);
  const url = oidc.sessionLogoutUrl({
    workosSessionId: "session_01ABC",
    returnTo: "https://agent.test/auth/login",
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, `${WORKOS_BASE}/user_management/sessions/logout`);
  assert.equal(u.searchParams.get("session_id"), "session_01ABC");
  assert.equal(u.searchParams.get("return_to"), "https://agent.test/auth/login");
});

test("T-SL-02: sessionLogoutUrl ohne returnTo -> return_to fehlt, session_id vorhanden", () => {
  const oidc = makeOidc(OIDC_CFG);
  const url = oidc.sessionLogoutUrl({ workosSessionId: "session_01ABC" });
  const u = new URL(url);
  assert.equal(u.searchParams.get("session_id"), "session_01ABC");
  assert.equal(u.searchParams.get("return_to"), null);
});

// ---- P1: Router-Integration Login -> Logout mit WorkOS-Session-ID ----

test("T-SL-03: Login mit workosSessionId, POST /auth/logout liefert 200 {logoutUrl} und invalidiert die Session", async () => {
  const sessionStore = new Map();
  let nextId = 1;
  const { deps } = fakeDeps({
    oidc: {
      authorizeUrl: async () => "https://idp.test/authorize",
      exchange: async () => ({
        claims: { sub: "user-1", email: "neu@kunde.de" },
        workosSessionId: "workos_sess_xyz",
      }),
    },
    sessions: {
      create: async ({ sub, tenantId, workosSessionId = null }) => {
        const id = `sess-${nextId++}`;
        sessionStore.set(id, { sub, tenantId, workosSessionId, invalidated: false });
        return { id };
      },
      get: async (id) => {
        const row = sessionStore.get(id);
        return row ? { workosSessionId: row.workosSessionId } : null;
      },
      invalidateById: async (id) => {
        const row = sessionStore.get(id);
        if (row) row.invalidated = true;
      },
    },
    postLogoutUrl: "https://agent.test/auth/login",
  });
  const srv = await mountRouter(deps);
  try {
    const state = "state-xyz";
    const loginCookies = [
      `oauth_state=${encodeURIComponent(signValue(state, SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
      `oidc_nonce=${encodeURIComponent(signValue("nonce-abc", SECRET))}`,
    ].join("; ");
    const loginRes = await rawGet(`${srv.base}/auth/callback?code=authcode&state=${state}`, {
      Cookie: loginCookies,
    });
    assert.equal(loginRes.status, 302);
    const sessionCookieHeader = cookieHeaderFrom(loginRes.setCookie);

    const logoutRes = await rawPost(`${srv.base}/auth/logout`, { Cookie: sessionCookieHeader });
    assert.equal(logoutRes.status, 200);
    const body = JSON.parse(logoutRes.body);
    const u = new URL(body.logoutUrl);
    assert.equal(u.searchParams.get("session_id"), "workos_sess_xyz");
    assert.equal(u.searchParams.get("return_to"), "https://agent.test/auth/login");

    assert.equal(sessionStore.size, 1);
    const [row] = sessionStore.values();
    assert.equal(row.invalidated, true, "Session muss tatsaechlich invalidiert sein");
  } finally {
    await srv.close();
  }
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
    ac.signal.addEventListener("abort", () => http.globalAgent.destroy());
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

// ---- P2b: Web-Login schreibt den IdP-Namen in den Gate-Store ----
// Der echte Callback uebernimmt Vor-/Nachname aus dem verifizierten IdP-Profil (exchange,
// server-zu-server -> kein Body-Spoofing) und ruft applyTenantIdentity set-if-absent. Der
// Dev-Login (Body-Quelle) tut das NIE. claimsFromPayload reicht die Namen additiv durch,
// exchange traegt die WorkOS-Felder (first_name/last_name) ein.

test("T-P2b-01: Callback schreibt IdP-Namen via applyTenantIdentity (set-if-absent, kein Body-Spoofing)", async () => {
  const identityCalls = [];
  const { deps, calls } = fakeDeps({
    oidc: {
      authorizeUrl: async () => "https://idp.test/authorize",
      exchange: async () => ({
        claims: { sub: "user-1", email: "neu@kunde.de", firstName: "Erika", lastName: "Muster" },
      }),
    },
    applyTenantIdentity: async (tenantId, identity) => identityCalls.push({ tenantId, identity }),
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
    assert.equal(res.status, 302);
    // Identitaets-Write genau 1x mit tenantId + getrennten Namen aus dem IdP-Profil.
    assert.equal(identityCalls.length, 1);
    assert.deepEqual(identityCalls[0], {
      tenantId: "t_user-1",
      identity: { firstName: "Erika", lastName: "Muster" },
    });
    // Name NICHT ueber den Account-Upsert (der bekommt weiter nur sub+email).
    assert.deepEqual(calls.upsert[0], { sub: "user-1", email: "neu@kunde.de" });
  } finally {
    await srv.close();
  }
});

test("T-P2b-02: claimsFromPayload reicht firstName/lastName additiv durch (ohne Namen byte-identisch)", () => {
  const withNames = claimsFromPayload({
    sub: "u1",
    email: "k@firma.de",
    email_verified: true,
    firstName: "Erika",
    lastName: "Muster",
  });
  assert.deepEqual(withNames, {
    sub: "u1",
    email: "k@firma.de",
    firstName: "Erika",
    lastName: "Muster",
  });
  // Ohne Namen bleibt die Bestands-Form {sub,email} (kein leerer Key).
  const withoutNames = claimsFromPayload({ sub: "u2", email: "x@y.de", email_verified: true });
  assert.deepEqual(withoutNames, { sub: "u2", email: "x@y.de" });
});

test("T-P2b-03: exchange reicht WorkOS first_name/last_name in die Claims durch", async () => {
  const { _fetch } = captureFetch({
    json: {
      user: {
        id: "user_01ABC",
        email: "kunde@firma.de",
        email_verified: true,
        first_name: "Erika",
        last_name: "Muster",
      },
    },
  });
  const oidc = makeOidc(OIDC_CFG, { _fetch });
  const { claims } = await oidc.exchange({ code: "authcode", verifier: "ver-123" });
  assert.equal(claims.firstName, "Erika");
  assert.equal(claims.lastName, "Muster");
});

test("T-P2b-04: Dev-Login schreibt KEINE Identitaet (kein Body-Spoofing), mintet aber die Session", async () => {
  // express.json() mountet den Body wirklich -> selbst MIT Namen im Body loest der
  // Dev-Login-Pfad keinen Identitaets-Write aus (mintSession reicht dort keine Namen durch).
  const identityCalls = [];
  const { deps, calls } = fakeDeps({
    devLoginEnabled: true,
    applyTenantIdentity: async (tenantId, identity) => identityCalls.push({ tenantId, identity }),
  });
  const app = express();
  app.use(express.json());
  app.use(makeWebAuthRoutes(deps));
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/auth/dev-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sub: "dev-1", email: "dev@x.de", firstName: "X", lastName: "Y" }),
      redirect: "manual",
    });
    assert.equal(res.status, 302);
    assert.equal(identityCalls.length, 0, "Body-Namen duerfen KEINEN Identitaets-Write ausloesen");
    assert.equal(calls.create.length, 1, "Session dennoch gemintet");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---- tenant-prolif-b: mintSession bindet den (evtl. gemergten) sub in den MCP/REST-
// Resolver-Index -----------------------------------------------------------------
// mintSession ist die GEMEINSAME Session-Mint-Mechanik fuer Callback UND Dev-Login (G5).
// deps.bindSub wird NACH ensureTenant aufgerufen, UNCONDITIONAL (anders als
// applyTenantIdentity, das nur bei vorhandenem Namen schreibt) - ohne diese Verdrahtung
// bliebe ein per Email-Merge (Phase A) gebundener Zweit-sub bis zum naechsten Boot
// "eingefroren" (resolveTenant faende ihn nicht). Store-seitiger Beweis der Merge-
// Aufloesung selbst: test/tenant-prolif-b.test.js.

test("T-tpb-01: Callback bindet den sub via bindSub(sub, tenantId) (mintSession)", async () => {
  const bindCalls = [];
  const { deps } = fakeDeps({
    oidc: {
      authorizeUrl: async () => "https://idp.test/authorize",
      exchange: async () => ({ claims: { sub: "user-1", email: "neu@kunde.de" } }),
    },
    bindSub: async (sub, tenantId) => bindCalls.push({ sub, tenantId }),
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
    assert.equal(res.status, 302);
    assert.equal(bindCalls.length, 1, "bindSub genau 1x aufgerufen");
    assert.deepEqual(bindCalls[0], { sub: "user-1", tenantId: "t_user-1" });
  } finally {
    await srv.close();
  }
});

test("T-tpb-02: Dev-Login bindet den sub ebenfalls (bindSub ist UNCONDITIONAL, anders als applyTenantIdentity)", async () => {
  const bindCalls = [];
  const { deps } = fakeDeps({
    devLoginEnabled: true,
    accounts: {
      upsertOnFirstLogin: async ({ sub }) => ({
        tenantId: `t_${sub}`,
        status: "suspended",
        role: "member",
      }),
    },
    bindSub: async (sub, tenantId) => bindCalls.push({ sub, tenantId }),
  });
  const app = express();
  app.use(express.json());
  app.use(makeWebAuthRoutes(deps));
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/auth/dev-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sub: "dev-1", email: "dev@x.de" }),
      redirect: "manual",
    });
    assert.equal(res.status, 302);
    assert.equal(bindCalls.length, 1, "bindSub auch auf dem Dev-Login-Pfad (mintSession geteilt)");
    assert.deepEqual(bindCalls[0], { sub: "dev-1", tenantId: "t_dev-1" });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---- ex WEB-11 (i18n-Testkatalog, tasks/i18n-tests/08-web-dashboard-onboarding.md:294) ----
// CSRF-Fehlerantwort bei fehlgeschlagenem OIDC-State ist ein stabiler, sprachneutraler
// Code (kein deutscher Klartext) - src/web-auth.js rejectCsrf().
//
// Zweiter Request in DEMSELBEN Test gegen eine ANDERE rejectCsrf-Aufrufstelle (fehlender
// oidc_nonce-Cookie statt State-Mismatch) pinnt die Regel-3-Invariante: der Code ist fuer
// ALLE CSRF-Ablehnungsgruende byte-identisch - kein Detail-Leak, welcher Check scheiterte.

test("CSRF-Fehlantwort ist ein sprachneutraler Code, identisch fuer alle Ablehnungsgruende (ex WEB-11)", async () => {
  const { deps } = fakeDeps();
  const srv = await mountRouter(deps);
  try {
    const stateMismatchCookies = [
      `oauth_state=${encodeURIComponent(signValue("the-real-state", SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
    ].join("; ");
    const stateMismatch = await rawGet(
      `${srv.base}/auth/callback?code=authcode&state=attacker-state`,
      { Cookie: stateMismatchCookies },
    );
    assert.equal(stateMismatch.status, 400);
    assert.equal(stateMismatch.body, "csrf_state_invalid");

    // andere Aufrufstelle: state passt, aber oidc_nonce-Cookie fehlt komplett.
    const missingNonceCookies = [
      `oauth_state=${encodeURIComponent(signValue("the-real-state", SECRET))}`,
      `pkce_verifier=${encodeURIComponent(signValue("verifier-123", SECRET))}`,
    ].join("; ");
    const missingNonce = await rawGet(
      `${srv.base}/auth/callback?code=authcode&state=the-real-state`,
      { Cookie: missingNonceCookies },
    );
    assert.equal(missingNonce.status, 400);
    assert.equal(
      missingNonce.body,
      stateMismatch.body,
      "byte-identischer Body ueber beide Ablehnungsgruende hinweg (kein Detail-Leak)",
    );
  } finally {
    await srv.close();
  }
});

// ---- ex WEB-12 (i18n-Testkatalog, tasks/i18n-tests/08-web-dashboard-onboarding.md:313) ----
// Login-Fehlerpfade (authorizeUrl wirft -> 500, exchange wirft -> 401) liefern den
// stabilen, sprachneutralen Code ERROR_LOGIN_FAILED statt deutschem Klartext.

test("Login-Fehlerpfad: authorizeUrl wirft -> 5xx + sprachneutraler Code (ex WEB-12a)", async () => {
  const { deps } = fakeDeps({
    oidc: {
      authorizeUrl: async () => {
        throw new Error("boom");
      },
      exchange: async () => ({ claims: { sub: "x", email: "y@z" } }),
    },
  });
  const srv = await mountRouter(deps);
  try {
    const res = await rawGet(`${srv.base}/auth/login`);
    assert.ok(res.status >= 500 && res.status < 600);
    assert.equal(res.body, "login_failed");
  } finally {
    await srv.close();
  }
});

test("Login-Fehlerpfad: exchange wirft -> 401 + sprachneutraler Code (ex WEB-12b)", async () => {
  const { deps } = fakeDeps({
    oidc: {
      authorizeUrl: async () => "https://idp.test/authorize",
      exchange: async () => {
        throw new Error("boom");
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
    assert.equal(res.body, "login_failed");
  } finally {
    await srv.close();
  }
});
