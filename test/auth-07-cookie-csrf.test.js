// AUTH-07 (PLAN-LAUNCH-TESTS.md P1, NUR der "auto"-Teil - der "live"-Teil mit echten
// DevTools braucht Jonas persoenlich): Session-Cookie-Attribute + CSRF-Schutz der
// state-aendernden Self-Service-POST-Routen.
//
// Teil 1 (mintSession): mintSession selbst ist eine private Closure in web-auth.js
// (makeWebAuthRoutes), nicht exportiert - EINZIGE Quelle (G5), beide Aufrufer (echter
// OIDC-Callback UND /auth/dev-login) teilen sie sich (s. web-auth.js Kommentar an
// mintSession). Dieser Test ruft sie ueber /auth/dev-login auf (Modell: web-auth.test.js
// mountRouter/fakeDeps-Pattern) und inspiziert den resultierenden Set-Cookie-Header roh
// (node:http, KEIN fetch - fetch faltet mehrere Set-Cookie-Header zusammen).
//
// Teil 2 (Cross-Site-POST): /api/self-service/settings und /api/self-service/private-
// number haben KEIN eigenes CSRF-Token (s. self-service-routes.js - kein csrf-Import,
// kein Origin-/Referer-Check). Der GESAMTE Cross-Site-Schutz ist das SameSite=Lax-Attribut
// des Session-Cookies: ein Browser haengt bei einem Cross-Site-POST (z.B. von einer
// boesartigen Fremd-Seite initiiert) das Lax-Cookie NICHT an, der Request kommt also OHNE
// gueltige Session bei der Route an. Dieser Test simuliert GENAU diese Browser-Semantik
// (POST ohne Cookie) und beweist, dass die Route dann fail-closed 401 antwortet und KEINE
// Mutation stattfindet - im Kontrast zu einem echten Same-Site-POST MIT Cookie, der
// durchgeht. WICHTIG (Grenze dieses Tests, ehrlich dokumentiert): SameSite ist eine
// BROWSER-durchgesetzte Regel, kein serverseitiges CSRF-Token - ein Angreifer mit direktem
// HTTP-Zugriff (kein Browser, z.B. gestohlener Cookie-Wert) waere davon nicht betroffen.
// Das deckt dieser Test bewusst NICHT ab (anderer Bedrohungsvektor: Cookie-Diebstahl/XSS,
// dagegen schuetzt HttpOnly, s. Teil 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makeWebAuthRoutes, webAuth, verifyValue, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "auth-07-cookie-csrf-secret-0123456789";

// ---- roher HTTP-POST-Helfer (node:http statt fetch: fetch faltet mehrere Set-Cookie-
// Header zu einem String zusammen, node:http liefert sie als Array - wie in web-auth.test.js) --
function rawPost(url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const finalHeaders = { ...headers };
    if (payload) {
      finalHeaders["Content-Type"] = "application/json";
      finalHeaders["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers: finalHeaders },
      (res) => {
        let respBody = "";
        res.on("data", (d) => (respBody += d));
        res.on("end", () =>
          resolve({ status: res.statusCode, setCookie: res.headers["set-cookie"] || [], body: respBody }),
        );
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
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

// ---- Teil 1: mintSession -> Set-Cookie-Attribute -------------------------------------
// /auth/dev-login ruft mintSession GENAU wie der echte OIDC-Callback (G5, s. web-auth.js
// Kommentar "DIESELBE Mint-Quelle wie der echte Callback"). Fakes wie web-auth.test.js
// fakeDeps(), aber lokal (eigene Datei, keine Kopplung an die grosse Fixture dort).
function fakeAuthDeps() {
  return {
    secret: SECRET,
    redirectUri: "https://agent.test/auth/callback",
    ttlSeconds: 3600,
    devLoginEnabled: true, // NUR so existiert /auth/dev-login ueberhaupt (fail-closed Default)
    oidc: {
      authorizeUrl: async () => "https://idp.test/authorize",
      exchange: async () => ({ claims: { sub: "user-1", email: "u@test.de" } }),
      sessionLogoutUrl: () => "https://idp.test/logout",
    },
    accounts: { upsertOnFirstLogin: async ({ sub }) => ({ tenantId: `t_${sub}`, status: "suspended", role: "member" }) },
    sessions: { create: async () => ({ id: "sess-mint-1" }), get: async () => null, invalidateById: async () => {} },
    audit: { record: async () => {} },
  };
}

async function mountAuthRouter(deps) {
  const app = express();
  app.use(express.json());
  app.use(makeWebAuthRoutes(deps));
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test("AUTH-07 Teil 1: mintSession (via /auth/dev-login) setzt Session-Cookie mit HttpOnly + Secure + SameSite=Lax", async () => {
  const srv = await mountAuthRouter(fakeAuthDeps());
  try {
    const res = await rawPost(`${srv.base}/auth/dev-login`, { body: { sub: "user-1", email: "u@test.de" } });
    assert.equal(res.status, 302, "dev-login redirectet nach erfolgreichem mintSession");
    const joined = res.setCookie.join("\n");
    assert.match(joined, /^session=|\nsession=/, "Set-Cookie enthaelt einen session-Eintrag");
    assert.match(joined, /HttpOnly/i, "Session-Cookie muss HttpOnly tragen (kein JS-Zugriff, XSS-Haertung)");
    assert.match(joined, /Secure/i, "Session-Cookie muss Secure tragen (nie im Klartext ueber HTTP)");
    assert.match(joined, /SameSite=Lax/i, "Session-Cookie muss SameSite=Lax tragen (Cross-Site-Basis-Schutz)");
    assert.match(joined, /Path=\//i);
    // Cookie-Wert ist die SIGNIERTE Session-id aus mintSession (sessions.create-Rueckgabe).
    const raw = cookieValue(res.setCookie, "session");
    assert.equal(verifyValue(raw, SECRET), "sess-mint-1", "Cookie-Wert = signierte Session-id von mintSession");
  } finally {
    await srv.close();
  }
});

test("AUTH-07 Teil 1b: Kontrastfall - Attribute exakt in EINEM Set-Cookie-Eintrag (nicht ueber mehrere verteilt)", async () => {
  const srv = await mountAuthRouter(fakeAuthDeps());
  try {
    const res = await rawPost(`${srv.base}/auth/dev-login`, { body: {} }); // dev-Defaults
    const sessionEntry = (res.setCookie || []).find((c) => c.startsWith("session="));
    assert.ok(sessionEntry, "genau ein Set-Cookie-Eintrag beginnt mit session=");
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax"]) {
      assert.match(sessionEntry, new RegExp(attr, "i"), `${attr} fehlt im session-Cookie-Eintrag selbst`);
    }
  } finally {
    await srv.close();
  }
});

// ---- Teil 2: Cross-Site-POST gegen die zwei state-aendernden Self-Service-Routen -----
const SUB = "sub-csrf";
const TENANT = "t_sub-csrf";

async function setupSelfService() {
  const { store } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Kunde", lastName: "CSRF" });
  const t = s.tenants.find((x) => x.id === TENANT);
  t.status = "active";
  t.idpSubject = SUB;
  // webAuth() braucht sessions.get + accounts.resolve (resolveWebSession, s. web-auth.js) -
  // hier minimal in-memory gefaked (kein pg-Roundtrip fuer Session/Account noetig, DIESER
  // Test prueft die Route-Schicht, nicht die Session-Persistenz - die deckt web-auth-
  // middleware.test.js bereits ab).
  const VALID_SESSION_ID = "sess-valid-csrf";
  const sessions = {
    get: async (id) =>
      id === VALID_SESSION_ID
        ? { id, sub: SUB, tenantId: TENANT, expires_at: new Date(Date.now() + 3600_000).toISOString(), invalidated_at: null }
        : null,
  };
  const accounts = {
    resolve: async (sub) => (sub === SUB ? { tenantId: TENANT, role: "member", status: "active", email: "csrf@test.de" } : null),
  };
  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const audit = () => {};
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw: webAuthMw, // in diesem Test nicht relevant (settings/private-number nutzen webAuthMw)
      audit,
      config: withConfigNamespaces({ paymentEnabled: false }),
      billing: {},
      provision: async () => {},
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });
  const validCookie = `session=${encodeURIComponent(signValue(VALID_SESSION_ID, SECRET))}`;
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    validCookie,
    settingsOf: () => store.tenantContext(TENANT).settings,
    privateNumberOf: () => store.tenantPrivateNumber(TENANT),
    close: () => new Promise((r) => server.close(r)),
  };
}

test("AUTH-07 Teil 2: Cross-Site-POST (kein Cookie, wie unter SameSite=Lax vom Browser nie mitgesendet) gegen /api/self-service/settings -> 401, keine Mutation", async () => {
  const srv = await setupSelfService();
  try {
    const before = { ...srv.settingsOf() };
    const res = await rawPost(`${srv.base}/api/self-service/settings`, {
      body: { greeting: "Cross-Site-Injektion" },
      // BEWUSST kein Cookie-Header: bildet nach, was ein Browser bei einem echten
      // Cross-Site-POST unter SameSite=Lax tut (Cookie wird NICHT mitgesendet).
    });
    assert.equal(res.status, 401, "ohne Session-Cookie -> 401 (fail-closed, webAuthMw)");
    assert.deepEqual(srv.settingsOf(), before, "keine Mutation ohne gueltige Session");
  } finally {
    await srv.close();
  }
});

test("AUTH-07 Teil 2b: Kontrastfall - derselbe POST MIT gueltigem (Same-Site-)Cookie geht durch", async () => {
  const srv = await setupSelfService();
  try {
    const res = await rawPost(`${srv.base}/api/self-service/settings`, {
      headers: { Cookie: srv.validCookie },
      body: { greeting: "Legitime Same-Site-Aenderung" },
    });
    assert.equal(res.status, 200, "MIT gueltiger Session geht der Write durch (Kontrast zu Teil 2)");
  } finally {
    await srv.close();
  }
});

test("AUTH-07 Teil 2: Cross-Site-POST (kein Cookie) gegen /api/self-service/private-number -> 401, keine Mutation", async () => {
  const srv = await setupSelfService();
  try {
    const before = srv.privateNumberOf();
    const res = await rawPost(`${srv.base}/api/self-service/private-number`, {
      body: { privateNumber: "+491701234567" },
      // Kein Cookie-Header - s. Kommentar im settings-Fall oben.
    });
    assert.equal(res.status, 401, "ohne Session-Cookie -> 401 (fail-closed, webAuthMw)");
    assert.equal(srv.privateNumberOf(), before, "keine Mutation ohne gueltige Session (H4: nie eine fremde/geraten Nummer)");
  } finally {
    await srv.close();
  }
});

test("AUTH-07 Teil 2b: Kontrastfall - private-number-POST MIT gueltigem Cookie geht durch", async () => {
  const srv = await setupSelfService();
  try {
    const res = await rawPost(`${srv.base}/api/self-service/private-number`, {
      headers: { Cookie: srv.validCookie },
      body: { privateNumber: "+491701234567" },
    });
    assert.equal(res.status, 200, "MIT gueltiger Session geht der Write durch (Kontrast zu Teil 2)");
    assert.equal(srv.privateNumberOf(), "+491701234567");
  } finally {
    await srv.close();
  }
});
