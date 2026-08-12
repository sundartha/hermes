// 312k-Phase 5 (Kuendigungsbestaetigung per E-Mail, § 312k BGB): der Unternehmer muss dem
// Verbraucher den Inhalt der Kuendigung unverzueglich in Textform auf einem dauerhaften
// Datentraeger bestaetigen. Reine In-Process-Units (Muster
// test/312k-p4-contract-end-cleanup.test.js, fakeStore/fakeAccounts/fakeMailer) fuer die
// Retry-Mechanik + eine pglite-Integration (Muster
// test/312k-p3-self-service-cancel.test.js) fuer die echte Verdrahtung.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeAuditStore } from "../src/audit-store.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import {
  attemptCancellationMailConfirm,
  runCancellationMailSweep,
  buildCancellationMailText,
} from "../src/billing/cancellation-mail.js";

const TENANT = "t_mail";
const PLAN_SLUG = "starter";
const PERIOD_END = 1896134400; // Unix-Sekunden, teilt sich mit dem P3-Test denselben Wert
const RECEIVED_AT = "2026-08-12T10:15:00.000Z";
const PUBLIC_URL = "https://sundartha.example";

// ---- geteilte Fakes (Muster test/312k-p4-contract-end-cleanup.test.js) --------------

const fakeAudit = () => ({
  records: [],
  record(entry) {
    this.records.push(entry);
    return Promise.resolve();
  },
});

function fakeLogger() {
  const lines = [];
  return { lines, log: (m) => lines.push(String(m)), warn: (m) => lines.push(String(m)) };
}

function fakeConfig() {
  return withConfigNamespaces({ publicUrl: PUBLIC_URL });
}

function seedState(over = {}) {
  return { tenants: [{ id: TENANT, ...over }] };
}

function fakeStore(s, sub = { planSlug: PLAN_SLUG, currentPeriodEnd: PERIOD_END }) {
  const findTenant = (tenantId) => s.tenants.find((t) => t.id === tenantId);
  return {
    cancellationMailPending: (tenantId) => {
      const t = findTenant(tenantId);
      return {
        pending: t?.cancellationMailPending ?? false,
        receivedAt: t?.cancellationMailReceivedAt ?? null,
      };
    },
    setCancellationMailPending: (tenantId, patch = {}) => {
      const t = findTenant(tenantId);
      if (!t) return null;
      if (patch.pending !== undefined) t.cancellationMailPending = patch.pending;
      if (patch.receivedAt !== undefined) t.cancellationMailReceivedAt = patch.receivedAt;
      return t;
    },
    tenantsPendingCancellationMail: () => s.tenants.filter((t) => t.cancellationMailPending),
    tenantSubscription: () => sub,
  };
}

function fakeAccounts(email) {
  const calls = [];
  return {
    calls,
    accountByTenant: async (tenantId) => {
      calls.push(tenantId);
      return email ? { sub: "sub_mail", email } : null;
    },
  };
}

const KUNDE_EMAIL = "kunde-mail-test@example.test";

function successfulMailer() {
  const calls = [];
  return { calls, sendMail: async (params) => void calls.push(params) };
}

function flakyMailer() {
  const calls = [];
  let attempts = 0;
  return {
    calls,
    sendMail: async (params) => {
      attempts++;
      if (attempts === 1) throw new Error("connect ECONNREFUSED 127.0.0.1:465");
      calls.push(params);
    },
    get attempts() {
      return attempts;
    },
  };
}

// ======================================================================================
// buildCancellationMailText (Inhalt - EINE Stelle, s. Kommentar im Modul)
// ======================================================================================

test("buildCancellationMailText: enthaelt Eingang, Tarifname, Wirkungsdatum, Nutzbarkeits-Hinweis, Impressum-Verweis", () => {
  const { subject, text } = buildCancellationMailText({
    planSlug: PLAN_SLUG,
    currentPeriodEnd: PERIOD_END,
    receivedAt: RECEIVED_AT,
    publicUrl: PUBLIC_URL,
  });

  assert.match(subject, /Kündigung/);
  assert.match(text, /Starter/, "Tarifname aus dem Plan-Katalog");
  assert.match(text, /ordentliche Kündigung zum Ende des laufenden Abrechnungszeitraums/);
  assert.match(text, /unverändert.*nutzen/s, "Hinweis: Dienst bleibt bis dahin nutzbar");
  assert.match(text, new RegExp(`${PUBLIC_URL}/impressum`), "Verweis aufs Impressum");
  const expectedEffective = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
  }).format(new Date(PERIOD_END * 1000));
  assert.ok(text.includes(expectedEffective), "deutsches Wirkungsdatum im Text");
  const expectedReceived = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(RECEIVED_AT));
  assert.ok(text.includes(expectedReceived), "Eingangsdatum+Uhrzeit im Text");
});

test("buildCancellationMailText: unbekannter/fehlender Plan-Slug faellt auf den Slug selbst zurueck (kein Wurf)", () => {
  const { text } = buildCancellationMailText({
    planSlug: "unbekannt",
    currentPeriodEnd: PERIOD_END,
    receivedAt: RECEIVED_AT,
    publicUrl: PUBLIC_URL,
  });
  assert.match(text, /unbekannt/);
});

// ======================================================================================
// attemptCancellationMailConfirm / runCancellationMailSweep (Orchestrator-Ebene)
// ======================================================================================

test("Happy Path: Versand gelingt - richtige Adresse, Text mit Tarif+Wirkungsdatum, Vermerk geloescht, durabler Nachweis", async () => {
  const s = seedState({ cancellationMailPending: true, cancellationMailReceivedAt: RECEIVED_AT });
  const store = fakeStore(s);
  const accounts = fakeAccounts(KUNDE_EMAIL);
  const mailer = successfulMailer();
  const audit = fakeAudit();

  const stillPending = await attemptCancellationMailConfirm({
    store, mailer, accounts, config: fakeConfig(), auditStore: audit, logger: fakeLogger(), tenantId: TENANT,
  });

  assert.equal(stillPending, false);
  assert.equal(mailer.calls.length, 1);
  assert.equal(mailer.calls[0].to, KUNDE_EMAIL);
  assert.match(mailer.calls[0].text, /Starter/);
  assert.equal(s.tenants[0].cancellationMailPending, false, "am Tenant geloescht");
  assert.ok(audit.records.some((r) => r.action === "cancellation_mail_sent"), "durabel auditiert");
});

// ---- Pflichttest 3: SMTP nicht konfiguriert -------------------------------------------

test("Pflichttest 3: SMTP nicht konfiguriert (mailer=null) -> kein Versuch, Vermerk bleibt offen, kein Wurf", async () => {
  const s = seedState({ cancellationMailPending: true, cancellationMailReceivedAt: RECEIVED_AT });
  const store = fakeStore(s);
  const accounts = fakeAccounts(KUNDE_EMAIL);
  const audit = fakeAudit();

  const stillPending = await attemptCancellationMailConfirm({
    store, mailer: null, accounts, config: fakeConfig(), auditStore: audit, logger: fakeLogger(), tenantId: TENANT,
  });

  assert.equal(stillPending, true, "bleibt offen vermerkt");
  assert.equal(s.tenants[0].cancellationMailPending, true);
  assert.equal(accounts.calls.length, 0, "kein Adress-Lookup ohne Mailer");
  assert.ok(
    audit.records.some(
      (r) => r.action === "cancellation_mail_send_skipped" && r.detail === "reason=smtp_not_configured",
    ),
  );
});

// ---- Pflichttest 4: keine Adresse hinterlegt ------------------------------------------

test("Pflichttest 4: keine Empfaengeradresse hinterlegt -> kein Versandversuch, Kuendigung bleibt gueltig (Vermerk offen)", async () => {
  const s = seedState({ cancellationMailPending: true, cancellationMailReceivedAt: RECEIVED_AT });
  const store = fakeStore(s);
  const accounts = fakeAccounts(null);
  const mailer = successfulMailer();
  const audit = fakeAudit();

  const stillPending = await attemptCancellationMailConfirm({
    store, mailer, accounts, config: fakeConfig(), auditStore: audit, logger: fakeLogger(), tenantId: TENANT,
  });

  assert.equal(stillPending, true);
  assert.equal(mailer.calls.length, 0, "kein Versandversuch ohne Adresse");
  assert.ok(
    audit.records.some(
      (r) => r.action === "cancellation_mail_send_skipped" && r.detail === "reason=no_address",
    ),
  );
});

// ---- Pflichttest 2: Mailserver nicht erreichbar -> Retry durch den Sweep --------------

test("Pflichttest 2: Mailserver nicht erreichbar -> Vermerk bleibt offen, spaeterer Sweep versucht erneut und gelingt", async () => {
  const s = seedState({ cancellationMailPending: true, cancellationMailReceivedAt: RECEIVED_AT });
  const store = fakeStore(s);
  const accounts = fakeAccounts(KUNDE_EMAIL);
  const mailer = flakyMailer();
  const audit = fakeAudit();

  const first = await attemptCancellationMailConfirm({
    store, mailer, accounts, config: fakeConfig(), auditStore: audit, logger: fakeLogger(), tenantId: TENANT,
  });
  assert.equal(first, true, "erster Versuch scheitert -> offen");
  assert.equal(s.tenants[0].cancellationMailPending, true, "am Tenant offen vermerkt");
  assert.deepEqual(
    store.tenantsPendingCancellationMail().map((t) => t.id),
    [TENANT],
    "Selektor findet den Tenant fuer den naechsten Sweep",
  );
  assert.ok(audit.records.some((r) => r.action === "cancellation_mail_send_failed"));

  const sweep = await runCancellationMailSweep({
    store, mailer, accounts, config: fakeConfig(), auditStore: audit, logger: fakeLogger(),
  });

  assert.equal(sweep.attempted, 1);
  assert.equal(mailer.attempts, 2, "der Sweep hat einen ZWEITEN Versuch unternommen");
  assert.equal(s.tenants[0].cancellationMailPending, false, "der zweite Versuch gelang -> nicht mehr offen");
  assert.ok(audit.records.some((r) => r.action === "cancellation_mail_sent"));
});

// ---- Pflichttest 5: Idempotenz --------------------------------------------------------

test("Pflichttest 5: zweiter Durchlauf nach Erfolg schickt NICHT erneut (Idempotenz)", async () => {
  const s = seedState({ cancellationMailPending: true, cancellationMailReceivedAt: RECEIVED_AT });
  const store = fakeStore(s);
  const accounts = fakeAccounts(KUNDE_EMAIL);
  const mailer = successfulMailer();
  const audit = fakeAudit();

  await attemptCancellationMailConfirm({
    store, mailer, accounts, config: fakeConfig(), auditStore: audit, logger: fakeLogger(), tenantId: TENANT,
  });
  assert.deepEqual(store.tenantsPendingCancellationMail(), [], "kein offener Rest mehr");

  const sweep = await runCancellationMailSweep({
    store, mailer, accounts, config: fakeConfig(), auditStore: audit, logger: fakeLogger(),
  });

  assert.equal(sweep.attempted, 0, "der Selektor liefert leer -> der Sweep ruehrt den Tenant nicht an");
  assert.equal(mailer.calls.length, 1, "kein zweiter Versand");

  // Direkter zweiter Aufruf (nicht ueber den Sweep) - derselbe Fall, "nichts zu tun":
  const secondDirect = await attemptCancellationMailConfirm({
    store, mailer, accounts, config: fakeConfig(), auditStore: audit, logger: fakeLogger(), tenantId: TENANT,
  });
  assert.equal(secondDirect, false, "bereits bestaetigt gilt als erledigt");
  assert.equal(mailer.calls.length, 1, "immer noch kein zweiter Versand");
  assert.equal(accounts.calls.length, 1, "kein zweiter Adress-Lookup, sobald bestaetigt");
});

// ---- Pflichttest 6: kein Passwort/keine Email in Log oder Audit-Detail ----------------

test("Pflichttest 6: weder Passwort noch Empfaengeradresse erscheinen in Log oder Audit-Detail", async () => {
  const s = seedState({ cancellationMailPending: true, cancellationMailReceivedAt: RECEIVED_AT });
  const store = fakeStore(s);
  const accounts = fakeAccounts(KUNDE_EMAIL);
  const secretPassword = "sk_smtp_should_never_leak_zoho9x";
  const failingMailer = {
    sendMail: async () => {
      // Realistische SMTP-Fehlermeldung koennte Nutzer/Adresse tragen - genau DAS darf
      // nie geloggt werden (der Adapter loggt bewusst nur err.code/err.name, nie
      // err.message).
      const err = new Error(
        `535 authentication failed for user with password ${secretPassword} to ${KUNDE_EMAIL}`,
      );
      err.code = "EAUTH";
      throw err;
    },
  };
  const audit = fakeAudit();
  const logger = fakeLogger();

  await attemptCancellationMailConfirm({
    store, mailer: failingMailer, accounts, config: fakeConfig(), auditStore: audit, logger, tenantId: TENANT,
  });

  const logText = logger.lines.join("\n");
  assert.doesNotMatch(logText, new RegExp(secretPassword), "kein Passwort im Log");
  assert.doesNotMatch(logText, new RegExp(KUNDE_EMAIL), "keine Empfaengeradresse im Log");

  const auditText = audit.records.map((r) => `${r.action} ${r.detail ?? ""}`).join("\n");
  assert.doesNotMatch(auditText, new RegExp(secretPassword), "kein Passwort im Audit-Detail");
  assert.doesNotMatch(auditText, new RegExp(KUNDE_EMAIL), "keine Empfaengeradresse im Audit-Detail");
});

// ======================================================================================
// Integration: echte Verdrahtung ueber self-service-routes.js (Muster
// test/312k-p3-self-service-cancel.test.js)
// ======================================================================================

const SECRET = "312k-p5-web-secret-0123456789";
const SUB_M = "sub-m";
const TENANT_M = "t_sub-m"; // upsertOnFirstLogin: tenantId = `t_${sub}`
const OLD_PERIOD_END = 1893456000;
const NEW_PERIOD_END = 1896134400;
const SUBSCRIPTION_ID = "sub_m1";
const ACCOUNT_EMAIL = "m@kunde.de";

function fakeBilling() {
  return {
    scheduleCancellation: async (params) => ({
      subscriptionId: params.subscriptionId,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: NEW_PERIOD_END,
    }),
  };
}

const cookieFor = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

async function setupIntegration({ mailer } = {}) {
  const { store, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  const auditStore = makeAuditStore(runner);

  const s = store.load();
  ops.registerTenant(s, TENANT_M, { firstName: "Kunde", lastName: "M" });
  const t = s.tenants.find((x) => x.id === TENANT_M);
  t.idpSubject = SUB_M;
  await accounts.upsertOnFirstLogin({ sub: SUB_M, email: ACCOUNT_EMAIL });
  await accounts.setStatus(TENANT_M, "active");
  const { id: sessionId } = await sessions.create({ sub: SUB_M, tenantId: TENANT_M, ttlSeconds: 3600 });

  store.setTenantSubscription(TENANT_M, {
    subscriptionId: SUBSCRIPTION_ID,
    planSlug: PLAN_SLUG,
    currentPeriodEnd: OLD_PERIOD_END,
  });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw: webAuthMw,
      audit: () => {},
      config: withConfigNamespaces({ paymentEnabled: true, publicUrl: PUBLIC_URL }),
      billing: fakeBilling(),
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
    cookie: cookieFor(sessionId),
    close: () => new Promise((r) => server.close(r)),
  };
}

function request(method, url, { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("Integration: Kuendigung ueber die echte Route loest den Versand mit der echten Kontoadresse aus", async () => {
  const mailer = successfulMailer();
  const s = await setupIntegration({ mailer });
  try {
    const res = await request("POST", `${s.base}/api/self-service/billing/cancel`, { cookie: s.cookie });
    assert.equal(res.status, 200);

    assert.equal(mailer.calls.length, 1);
    assert.equal(mailer.calls[0].to, ACCOUNT_EMAIL, "die ECHTE, ueber accounts.accountByTenant gelesene Adresse");
    assert.match(mailer.calls[0].text, /Starter/);
    const expectedEffective = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      dateStyle: "medium",
    }).format(new Date(NEW_PERIOD_END * 1000));
    assert.ok(mailer.calls[0].text.includes(expectedEffective));

    assert.equal(s.store.cancellationMailPending(TENANT_M).pending, false, "Vermerk erledigt");
  } finally {
    await s.close();
  }
});

test("Integration: SMTP nicht konfiguriert (kein mailer injiziert) -> Kuendigung bleibt gueltig, Vermerk offen", async () => {
  const s = await setupIntegration({ mailer: null });
  try {
    const res = await request("POST", `${s.base}/api/self-service/billing/cancel`, { cookie: s.cookie });
    assert.equal(res.status, 200, "die Kuendigung selbst scheitert NIE an der Mail");
    assert.equal(JSON.parse(res.body).cancelAtPeriodEnd, true);
    assert.equal(s.store.tenantSubscription(TENANT_M).cancelAtPeriodEnd, true, "Kuendigung ist gueltig");
    assert.equal(s.store.cancellationMailPending(TENANT_M).pending, true, "Bestaetigung bleibt offen vermerkt");
  } finally {
    await s.close();
  }
});
