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
import { MAX_NEWSLETTER_RECIPIENTS } from "../src/newsletter-recipients.js";

const SECRET = "newsletter-recipients-web-secret-0123456789";
const SUB = "sub-nlr-a";
const TENANT = "t_sub-nlr-a";

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

function makeAuditSpy() {
  const calls = [];
  const fn = (action, _req, details = "") => calls.push({ action, details });
  fn.calls = calls;
  return fn;
}

async function seedActiveTenant(store, accounts) {
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Kunde", lastName: "NLR" });
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

const addRecipient = (s, email, cookie = s.cookie) =>
  request("POST", `${s.base}/api/self-service/newsletter-recipients`, { cookie, body: { email } });
const removeRecipient = (s, email, cookie = s.cookie) =>
  request("DELETE", `${s.base}/api/self-service/newsletter-recipients`, { cookie, body: { email } });
const getState = (s, cookie = s.cookie) => request("GET", `${s.base}/api/self-service/state`, { cookie });
const confirmToken = (s, token) => request("GET", `${s.base}/newsletter/confirm?token=${token}`);
const unsubscribeToken = (s, token) => request("GET", `${s.base}/newsletter/unsubscribe?token=${token}`);

async function auditRows(s, action) {
  const { rows } = await s.db.query(`SELECT action, tenant_id, detail FROM audit_log WHERE action=$1`, [action]);
  return rows;
}

function confirmUrlFromMail(mail) {
  return mail.text.match(/https:\/\/hermes\.example\.test\/newsletter\/confirm\?token=([a-f0-9]+)/)[1];
}

test("(a) Add -> 200, pending im Store + in GET /state, Bestaetigungs-Mail ausgeloest (kein Token in der Antwort)", async () => {
  const s = await setup();
  try {
    const res = await addRecipient(s, "freund@example.test");
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, status: "pending" });

    const record = s.recordOf();
    assert.equal(record.newsletterRecipients.length, 1);
    assert.equal(record.newsletterRecipients[0].status, "pending");

    const stateRes = await getState(s);
    const stateBody = JSON.parse(stateRes.body);
    assert.deepEqual(stateBody.newsletterRecipients, [
      { email: "freund@example.test", status: "pending", createdAt: record.newsletterRecipients[0].createdAt },
    ]);
    assert.equal("tokenHash" in stateBody.newsletterRecipients[0], false);

    assert.equal(s.mailer.sent.length, 1, "Bestaetigungs-Mail ausgeloest");
    assert.equal(s.mailer.sent[0].to, "freund@example.test");
    assert.match(s.mailer.sent[0].text, /newsletter\/confirm\?token=/);
  } finally {
    await s.close();
  }
});

test("(b) ungueltiges Format -> 400 error=invalid_format, kein Write, kein Mail-Versand", async () => {
  const s = await setup();
  try {
    const res = await addRecipient(s, "keine-email");
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.body), { error: "invalid_format" });
    assert.equal((s.recordOf().newsletterRecipients ?? []).length, 0);
    assert.equal(s.mailer.sent.length, 0);
  } finally {
    await s.close();
  }
});

test("(c) Duplikat gegen die Konto-Adresse -> 400 error=duplicate", async () => {
  const s = await setup();
  try {
    const res = await addRecipient(s, "kunde@example.test");
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.body), { error: "duplicate" });
  } finally {
    await s.close();
  }
});

test("(d) Duplikat gegen bestehenden Eintrag -> 400 error=duplicate", async () => {
  const s = await setup();
  try {
    await addRecipient(s, "freund@example.test");
    const res = await addRecipient(s, "Freund@Example.Test");
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.body), { error: "duplicate" });
  } finally {
    await s.close();
  }
});

test(`(e) Cap (${MAX_NEWSLETTER_RECIPIENTS}) erreicht -> 400 error=cap_reached`, async () => {
  const s = await setup();
  try {
    for (let i = 0; i < MAX_NEWSLETTER_RECIPIENTS; i++) {
      const r = await addRecipient(s, `person${i}@example.test`);
      assert.equal(r.status, 200, `Eintrag ${i} sollte noch durchgehen`);
    }
    const res = await addRecipient(s, "einer-zu-viel@example.test");
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.body), { error: "cap_reached" });
  } finally {
    await s.close();
  }
});

test("(f) kein Session-Cookie -> 401, kein Write", async () => {
  const s = await setup();
  try {
    const res = await request("POST", `${s.base}/api/self-service/newsletter-recipients`, {
      body: { email: "freund@example.test" },
    });
    assert.equal(res.status, 401);
    assert.equal((s.recordOf().newsletterRecipients ?? []).length, 0);
  } finally {
    await s.close();
  }
});

test("(g) Remove -> 200 removed=true, idempotent (zweiter Versuch -> removed=false)", async () => {
  const s = await setup();
  try {
    await addRecipient(s, "freund@example.test");
    const res = await removeRecipient(s, "freund@example.test");
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, removed: true });
    assert.equal((s.recordOf().newsletterRecipients ?? []).length, 0);

    const second = await removeRecipient(s, "freund@example.test");
    assert.deepEqual(JSON.parse(second.body), { ok: true, removed: false });
  } finally {
    await s.close();
  }
});

test("(h) Confirm mit gueltigem Token -> 200 HTML, Eintrag confirmed, durabler PII-freier Audit-Nachweis", async () => {
  const s = await setup();
  try {
    await addRecipient(s, "freund@example.test");
    const token = confirmUrlFromMail(s.mailer.sent[0]);

    const res = await confirmToken(s, token);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.body, /best.tigt/i);

    const record = s.recordOf();
    assert.equal(record.newsletterRecipients[0].status, "confirmed");
    assert.ok(record.newsletterRecipients[0].confirmedAt);

    const rows = await auditRows(s, "newsletter_recipient_confirmed");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tenant_id, TENANT);
    assert.doesNotMatch(rows[0].detail, /freund@example\.test/, "keine Klartext-Adresse im Audit-Detail");
  } finally {
    await s.close();
  }
});

test("(i) Confirm mit falschem Token -> 400, neutrale Fehlseite, KEIN Zustandswechsel", async () => {
  const s = await setup();
  try {
    await addRecipient(s, "freund@example.test");
    const res = await confirmToken(s, "komplett-falscher-token");
    assert.equal(res.status, 400);
    assert.match(res.body, /ung.ltig/i);
    assert.equal(s.recordOf().newsletterRecipients[0].status, "pending", "kein Zustandswechsel");
  } finally {
    await s.close();
  }
});

test("(j) Confirm ohne Token-Query -> 400, neutrale Seite (kein Crash)", async () => {
  const s = await setup();
  try {
    const res = await request("GET", `${s.base}/newsletter/confirm`);
    assert.equal(res.status, 400);
  } finally {
    await s.close();
  }
});

test("(k) Unsubscribe entfernt den Eintrag (auch bereits bestaetigt), idempotent", async () => {
  const s = await setup();
  try {
    await addRecipient(s, "freund@example.test");
    const confirmLink = confirmUrlFromMail(s.mailer.sent[0]);
    await confirmToken(s, confirmLink);

    const unsubToken = s.recordOf().newsletterRecipients[0].unsubToken;
    const res = await unsubscribeToken(s, unsubToken);
    assert.equal(res.status, 200);
    assert.match(res.body, /abgemeldet/i);
    assert.equal((s.recordOf().newsletterRecipients ?? []).length, 0);

    const second = await unsubscribeToken(s, unsubToken);
    assert.equal(second.status, 400, "idempotent - zweiter Versuch findet nichts mehr");

    const rows = await auditRows(s, "newsletter_recipient_unsubscribed");
    assert.equal(rows.length, 1, "GENAU EIN durabler Nachweis fuer die eine erfolgreiche Abmeldung");
  } finally {
    await s.close();
  }
});

test("(l) Newsletter-Zusatzempfaenger NIE in settings (H4)", async () => {
  const s = await setup();
  try {
    await addRecipient(s, "freund@example.test");
    const settings = s.store.load().settings[TENANT] || {};
    assert.equal("newsletterRecipients" in settings, false);
  } finally {
    await s.close();
  }
});
