// Newsletter-Einwilligung (Opt-in, DSGVO Art. 7 Abs. 1) - Self-Service-Schreib-/Lese-Weg
// (POST /api/self-service/newsletter-consent, GET /api/self-service/state). Kompositions-
// Integrationstest nach dem Muster f2-self-service-private-number.test.js +
// 312k-p3-self-service-cancel.test.js (auditStore-Nachweis): reines pglite (offline,
// F.I.R.S.T.), KEIN Server-Spawn. Deckt ab:
//   - Default eines frischen Tenants: GET /state liefert { consent: false, consentAt: null }
//   - Einwilligen (true) -> 200, Store-Record gesetzt, GET /state spiegelt es, DURABLER
//     Nachweis in audit_log (312k-P3-Muster)
//   - Widerruf (false) NACH Einwilligung -> 200, Store-Record aktualisiert, eigener
//     durabler Nachweis (zweiter Audit-Eintrag, andere action)
//   - ungueltiger Wert -> 400, alter Wert bleibt (fail-closed, H2), KEIN Audit-Eintrag
//   - kein Session-Cookie -> 401, kein Write
//   - suspendierter Tenant -> 403, kein Write
//   - NIE in settings (H4, Muster private-number)
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeAuditStore } from "../src/audit-store.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "newsletter-consent-web-secret-0123456789";
const SUB_B = "sub-nl-b";
const TENANT_B = "t_sub-nl-b";
const SUB_SUSPENDED = "sub-nl-susp";
const TENANT_SUSPENDED = "t_sub-nl-susp";

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

function makeAuditSpy() {
  const calls = [];
  const fn = (action, _req, details = "") => calls.push({ action, details });
  fn.calls = calls;
  return fn;
}

async function seedActiveTenant(store, accounts, { sub, tenantId }) {
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Kunde", lastName: "NL" });
  const t = s.tenants.find((x) => x.id === tenantId);
  t.status = "active";
  t.idpSubject = sub;
  await accounts.upsertOnFirstLogin({ sub, email: `${sub}@kunde.de` });
  await accounts.setStatus(tenantId, "active");
}

async function setup() {
  const { store, db, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  const auditStore = makeAuditStore(runner);

  await seedActiveTenant(store, accounts, { sub: SUB_B, tenantId: TENANT_B });
  const { id: sessionId } = await sessions.create({ sub: SUB_B, tenantId: TENANT_B, ttlSeconds: 3600 });

  await accounts.upsertOnFirstLogin({ sub: SUB_SUSPENDED, email: "nl-susp@kunde.de" });
  const { id: suspSessionId } = await sessions.create({
    sub: SUB_SUSPENDED,
    tenantId: TENANT_SUSPENDED,
    ttlSeconds: 3600,
  });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: SECRET, sessions, accounts });
  const audit = makeAuditSpy();
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw,
      audit,
      config: withConfigNamespaces({ paymentEnabled: false }),
      billing: {},
      provision: async () => {},
      auditStore,
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    db,
    audit,
    cookieB: cookieFor(sessionId),
    cookieSuspended: cookieFor(suspSessionId),
    recordOf: (tenantId) => store.load().tenants.find((x) => x.id === tenantId),
    close: () => new Promise((r) => server.close(r)),
  };
}

function request(method, url, { cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const setConsent = (s, body, cookie = s.cookieB) =>
  request("POST", `${s.base}/api/self-service/newsletter-consent`, { cookie, body });
const getState = (s, cookie = s.cookieB) =>
  request("GET", `${s.base}/api/self-service/state`, { cookie });

async function auditRows(s, tenantId, action) {
  const { rows } = await s.db.query(
    `SELECT action, tenant_id, detail FROM audit_log WHERE tenant_id=$1 AND action=$2`,
    [tenantId, action],
  );
  return rows;
}

test("(a) frischer Tenant: GET /state -> newsletter.consent=false, consentAt=null", async () => {
  const s = await setup();
  try {
    const res = await getState(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.newsletter, { consent: false, consentAt: null });
  } finally {
    await s.close();
  }
});

test("(b) Einwilligen (true) -> 200, Store gesetzt, GET /state spiegelt es, durabler Audit-Nachweis", async () => {
  const s = await setup();
  try {
    const res = await setConsent(s, { consent: true });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, newsletterConsent: true });

    assert.equal(s.recordOf(TENANT_B).newsletterConsent, true, "am Tenant-Record gesetzt");
    assert.ok(s.recordOf(TENANT_B).newsletterConsentAt, "Zeitstempel gesetzt");

    const stateRes = await getState(s);
    const stateBody = JSON.parse(stateRes.body);
    assert.equal(stateBody.newsletter.consent, true);
    assert.ok(stateBody.newsletter.consentAt);

    const rows = await auditRows(s, TENANT_B, "self_service_newsletter_consent_granted");
    assert.equal(rows.length, 1, "GENAU EIN durabler Nachweis (audit_log, Art. 7 Abs. 1)");
    assert.equal(rows[0].tenant_id, TENANT_B);
  } finally {
    await s.close();
  }
});

test("(c) Widerruf (false) NACH Einwilligung -> 200, Store aktualisiert, eigener durabler Nachweis", async () => {
  const s = await setup();
  try {
    await setConsent(s, { consent: true });
    const res = await setConsent(s, { consent: false });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, newsletterConsent: false });

    assert.equal(s.recordOf(TENANT_B).newsletterConsent, false, "Widerruf am Record");

    const grantedRows = await auditRows(s, TENANT_B, "self_service_newsletter_consent_granted");
    const revokedRows = await auditRows(s, TENANT_B, "self_service_newsletter_consent_revoked");
    assert.equal(grantedRows.length, 1, "der urspruengliche Opt-in-Nachweis bleibt stehen");
    assert.equal(revokedRows.length, 1, "der Widerruf bekommt einen EIGENEN Nachweis");
  } finally {
    await s.close();
  }
});

test("(d) ungueltiger Wert (String statt boolean) -> 400, alter Wert bleibt, kein Audit-Eintrag", async () => {
  const s = await setup();
  try {
    await setConsent(s, { consent: true }); // erst gueltig setzen
    const res = await setConsent(s, { consent: "yes" });
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.body), { error: "invalid_newsletter_consent" });
    assert.equal(s.recordOf(TENANT_B).newsletterConsent, true, "alter Wert unveraendert (fail-closed)");

    const rows = await auditRows(s, TENANT_B, "self_service_newsletter_consent_granted");
    assert.equal(rows.length, 1, "kein zweiter Nachweis fuer den abgelehnten Versuch");
  } finally {
    await s.close();
  }
});

test("(e) fehlender Body -> 400 (undefined ist kein boolean, fail-closed statt stiller No-Op)", async () => {
  const s = await setup();
  try {
    const res = await setConsent(s, {});
    assert.equal(res.status, 400);
    assert.equal(s.recordOf(TENANT_B).newsletterConsent ?? null, null, "kein Write ohne gueltigen Wert");
  } finally {
    await s.close();
  }
});

test("(f) kein Session-Cookie -> 401, kein Write", async () => {
  const s = await setup();
  try {
    const res = await request("POST", `${s.base}/api/self-service/newsletter-consent`, {
      body: { consent: true },
    });
    assert.equal(res.status, 401);
    assert.equal(s.recordOf(TENANT_B).newsletterConsent ?? null, null, "kein Write ohne Session");
  } finally {
    await s.close();
  }
});

test("(g) suspendierter Tenant -> 403, kein Write", async () => {
  const s = await setup();
  try {
    const res = await setConsent(s, { consent: true }, s.cookieSuspended);
    assert.equal(res.status, 403);
    assert.equal(
      s.recordOf(TENANT_SUSPENDED) ?? null,
      null,
      "suspendierter Tenant nicht im Mirror -> kein Write",
    );
  } finally {
    await s.close();
  }
});

test("(h) niemals in settings (H4): consent lebt nur am Tenant-Record", async () => {
  const s = await setup();
  try {
    await setConsent(s, { consent: true });
    const settings = s.store.load().settings[TENANT_B] || {};
    assert.equal("newsletterConsent" in settings, false, "newsletterConsent NIE in settings");
    const res = await getState(s);
    const body = JSON.parse(res.body);
    assert.equal("newsletterConsent" in (body.settings || {}), false, "auch nicht in der settings-View");
  } finally {
    await s.close();
  }
});

test("(i) Audit (util.audit) traegt den Outcome-Key, nicht mehr", async () => {
  const s = await setup();
  try {
    await setConsent(s, { consent: true });
    await setConsent(s, { consent: false });
    await setConsent(s, { consent: "bad" });
    const related = s.audit.calls.filter((c) => c.action === "self_service_newsletter_consent");
    assert.deepEqual(
      related.map((c) => c.details),
      ["outcome=granted", "outcome=revoked", "outcome=rejected"],
    );
  } finally {
    await s.close();
  }
});
