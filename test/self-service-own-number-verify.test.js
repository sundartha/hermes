// OC-Besitz-Verifikation, Stufe 1 (PLAN-SECURITY.md Launch-Blocker geloest, Owner-
// Entscheidung 2026-08-21): HTTP-Integrationstest fuer POST /api/self-service/private-number
// (Mail-Ausloesung), POST .../private-number/confirm-resend, GET /own-number/confirm UND die
// additive Dashboard-View. Kompositionstest nach dem Muster
// self-service-newsletter-recipients.test.js: reines pglite (offline, F.I.R.S.T.), KEIN
// Server-Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeAuditStore } from "../src/audit-store.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { OWN_NUMBER_CONFIRM_MAIL_DAILY_CAP } from "../src/own-number-verify.js";

const SECRET = "own-number-verify-web-secret-0123456789";
const SUB = "sub-onv-a";
const TENANT = "t_sub-onv-a";
const OWN = "+491737252163";
const OTHER_OWN = "+491729999001";

const cookieFor = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

function makeAuditSpy() {
  const calls = [];
  const fn = (action, _req, details = "") => calls.push({ action, details });
  fn.calls = calls;
  return fn;
}

async function seedActiveTenant(store, accounts) {
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Kunde", lastName: "ONV" });
  const t = s.tenants.find((x) => x.id === TENANT);
  t.status = "active";
  t.idpSubject = SUB;
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "kunde@example.test" });
  await accounts.setStatus(TENANT, "active");
}

function fakeMailer() {
  const sent = [];
  return { sent, sendMail: async (p) => sent.push(p) };
}

async function setup({ mailer = fakeMailer() } = {}) {
  const { store, db, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  const auditStore = makeAuditStore(runner);

  await seedActiveTenant(store, accounts);
  const { id: sessionId } = await sessions.create({ sub: SUB, tenantId: TENANT, ttlSeconds: 3600 });

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
      config: withConfigNamespaces({ paymentEnabled: false, publicUrl: "https://hermes.example.test" }),
      billing: {},
      accounts,
      provision: async () => {},
      auditStore,
      mailer,
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
    mailer,
    cookie: cookieFor(sessionId),
    recordOf: () => store.load().tenants.find((x) => x.id === TENANT),
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
        res.on("end", () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const setNumber = (s, privateNumber, cookie = s.cookie) =>
  request("POST", `${s.base}/api/self-service/private-number`, { cookie, body: { privateNumber } });
const resend = (s, cookie = s.cookie) =>
  request("POST", `${s.base}/api/self-service/private-number/confirm-resend`, { cookie });
const getState = (s, cookie = s.cookie) => request("GET", `${s.base}/api/self-service/state`, { cookie });
const confirmToken = (s, token) => request("GET", `${s.base}/own-number/confirm?token=${token}`);

function confirmUrlFromMail(mail) {
  return mail.text.match(/https:\/\/hermes\.example\.test\/own-number\/confirm\?token=([a-f0-9]+)/)[1];
}

test("(a) Nummer setzen -> 200, Bestaetigungs-Mail an die KONTO-Adresse (kein Token in der Antwort)", async () => {
  const s = await setup();
  try {
    const res = await setNumber(s, OWN);
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, hasPrivateNumber: true });

    assert.equal(s.mailer.sent.length, 1);
    assert.equal(s.mailer.sent[0].to, "kunde@example.test", "Konto-Adresse, NICHT ein Freitext-Ziel");
    assert.match(s.mailer.sent[0].text, /own-number\/confirm\?token=/);

    const stateBody = JSON.parse((await getState(s)).body);
    assert.deepEqual(stateBody.privateNumberVerification, { emailConfirmed: false, verified: false, verifiedAt: null });
    assert.equal("privateNumberConfirmTokenHash" in stateBody, false, "kein Token in der Antwort");
  } finally {
    await s.close();
  }
});

test("(b) dieselbe Nummer erneut speichern (idempotent) -> KEINE zweite Mail", async () => {
  const s = await setup();
  try {
    await setNumber(s, OWN);
    assert.equal(s.mailer.sent.length, 1);
    const res = await setNumber(s, OWN);
    assert.equal(res.status, 200);
    assert.equal(s.mailer.sent.length, 1, "kein erneuter Versand bei unveraendertem Wert");
  } finally {
    await s.close();
  }
});

test("(c) Nummer wechseln -> Reset, NEUE Bestaetigungs-Mail", async () => {
  const s = await setup();
  try {
    await setNumber(s, OWN);
    const token = confirmUrlFromMail(s.mailer.sent[0]);
    await confirmToken(s, token);
    assert.equal(s.recordOf().privateNumberEmailConfirmedAt != null, true);

    await setNumber(s, OTHER_OWN);
    assert.equal(s.recordOf().privateNumberEmailConfirmedAt, undefined, "Reset bei echter Aenderung");
    assert.equal(s.mailer.sent.length, 2, "neue Mail fuer die neue Nummer");
  } finally {
    await s.close();
  }
});

test("(d) ungueltiges Format -> 400 error=invalid_private_number, keine Mail", async () => {
  const s = await setup();
  try {
    const res = await setNumber(s, "keine-nummer");
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.body), { error: "invalid_private_number" });
    assert.equal(s.mailer.sent.length, 0);
  } finally {
    await s.close();
  }
});

test("(e) Loeschen (leerer String) -> 200 hasPrivateNumber=false, keine Mail", async () => {
  const s = await setup();
  try {
    await setNumber(s, OWN);
    const res = await setNumber(s, "");
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, hasPrivateNumber: false });
    assert.equal(s.mailer.sent.length, 1, "kein Versand, wenn nichts mehr zu bestaetigen ist");
  } finally {
    await s.close();
  }
});

test("(f) kein Mailer konfiguriert -> Nummer speichert trotzdem, kein Wurf, Verifikation bleibt offen", async () => {
  const s = await setup({ mailer: null });
  try {
    const res = await setNumber(s, OWN);
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, hasPrivateNumber: true });
    assert.equal(s.recordOf().privateNumber, OWN);
    assert.equal(s.recordOf().privateNumberEmailConfirmedAt, undefined);
  } finally {
    await s.close();
  }
});

test("(g) kein Session-Cookie -> 401, kein Write, keine Mail", async () => {
  const s = await setup();
  try {
    const res = await request("POST", `${s.base}/api/self-service/private-number`, {
      body: { privateNumber: OWN },
    });
    assert.equal(res.status, 401);
    assert.equal(s.recordOf().privateNumber, undefined);
    assert.equal(s.mailer.sent.length, 0);
  } finally {
    await s.close();
  }
});

test("(h) Confirm mit gueltigem Token -> 200 HTML, privateNumberEmailConfirmedAt gesetzt", async () => {
  const s = await setup();
  try {
    await setNumber(s, OWN);
    const token = confirmUrlFromMail(s.mailer.sent[0]);

    const res = await confirmToken(s, token);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.body, /best.tigt/i);
    assert.ok(s.recordOf().privateNumberEmailConfirmedAt);

    const stateBody = JSON.parse((await getState(s)).body);
    assert.equal(stateBody.privateNumberVerification.emailConfirmed, true);
    assert.equal(stateBody.privateNumberVerification.verified, false, "Stufe 2 noch offen");
  } finally {
    await s.close();
  }
});

test("(i) Confirm mit falschem/fehlendem Token -> 400 HTML, keine Mutation", async () => {
  const s = await setup();
  try {
    await setNumber(s, OWN);
    const res = await confirmToken(s, "falscher-token");
    assert.equal(res.status, 400);
    assert.match(res.body, /ung.ltig/i);
    assert.equal(s.recordOf().privateNumberEmailConfirmedAt, undefined);

    const noToken = await request("GET", `${s.base}/own-number/confirm`);
    assert.equal(noToken.status, 400);
  } finally {
    await s.close();
  }
});

test("(j) confirm-resend ohne hinterlegte Nummer -> 409 error=no_private_number", async () => {
  const s = await setup();
  try {
    const res = await resend(s);
    assert.equal(res.status, 409);
    assert.deepEqual(JSON.parse(res.body), { error: "no_private_number" });
  } finally {
    await s.close();
  }
});

test("(k) confirm-resend nach bereits erfolgter Bestaetigung -> 409 error=already_confirmed", async () => {
  const s = await setup();
  try {
    await setNumber(s, OWN);
    const token = confirmUrlFromMail(s.mailer.sent[0]);
    await confirmToken(s, token);
    const res = await resend(s);
    assert.equal(res.status, 409);
    assert.deepEqual(JSON.parse(res.body), { error: "already_confirmed" });
  } finally {
    await s.close();
  }
});

test("(l) confirm-resend vor Bestaetigung -> 200, neue Mail ausgeloest", async () => {
  const s = await setup();
  try {
    await setNumber(s, OWN);
    assert.equal(s.mailer.sent.length, 1);
    const res = await resend(s);
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });
    assert.equal(s.mailer.sent.length, 2);
  } finally {
    await s.close();
  }
});

test(`(m) Tageslimit (${OWN_NUMBER_CONFIRM_MAIL_DAILY_CAP}) erreicht -> confirm-resend liefert 409 error=daily_limit`, async () => {
  const s = await setup();
  try {
    await setNumber(s, OWN);
    for (let i = 1; i < OWN_NUMBER_CONFIRM_MAIL_DAILY_CAP; i++) {
      const r = await resend(s);
      assert.equal(r.status, 200, `Resend ${i} sollte noch durchgehen`);
    }
    const res = await resend(s);
    assert.equal(res.status, 409);
    assert.deepEqual(JSON.parse(res.body), { error: "daily_limit" });
  } finally {
    await s.close();
  }
});

test("(n) confirm-resend ohne Session-Cookie -> 401", async () => {
  const s = await setup();
  try {
    const res = await request("POST", `${s.base}/api/self-service/private-number/confirm-resend`);
    assert.equal(res.status, 401);
  } finally {
    await s.close();
  }
});
