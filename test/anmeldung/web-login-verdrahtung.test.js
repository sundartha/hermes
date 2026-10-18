import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";
import { abrufMitFrist, fristSignal } from "../gemeinsam/antwortfrist.mjs";
import { echtWarten } from "../echt-warten.js";

process.env.STRIPE_SECRET_KEY = "sk_test_x";

const { wireWebLogin } = await import("../../src/wiring/web-login.js");
const { SESSION_COOKIE_NAME } = await import("../../src/web-auth.js");
const { makePgTestStore } = await import("../pg-helpers.js");

const echtesFetch = globalThis.fetch;
const WORKOS = "https://api.workos.test";
function neuerStub({ stripeStatus = "active" } = {}) {
  return { workosUser: null, stripeStatus, stripeAbrufe: [] };
}
let stub = neuerStub();

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith(`${WORKOS}/user_management/authenticate`)) {
    const sid = "sess_workos_1";
    const payload = Buffer.from(JSON.stringify({ sid })).toString("base64url");
    return new Response(
      JSON.stringify({ user: stub.workosUser, access_token: `h.${payload}.s` }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (/\/subscriptions\/sub_/.test(u)) {
    stub.stripeAbrufe.push(u);
    return new Response(JSON.stringify({ status: stub.stripeStatus }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return echtesFetch(url, {
    ...opts,
    signal: AbortSignal.any([fristSignal(), ...(opts.signal ? [opts.signal] : [])]),
  });
};

async function makePgliteRunner() {
  const { runner } = await makePgTestStore();
  return runner;
}

const tenantIdForSubject = (sub) => `t_${sub}`;

const baseConfig = webLoginBasisKonfiguration(WORKOS);

function makeStore({ tenants = [] } = {}) {
  const state = { tenants, numbers: [], tenantBudgets: [], calls: [] };
  const log = { saves: 0, calls: [] };
  const base = {
    load: () => state,
    save() {
      log.saves++;
    },
    withStoreLock: async (fn) => fn(),
    ensureTenant(t) {
      log.calls.push(["ensureTenant", t]);
    },
    bindSubToTenant(sub, t) {
      log.calls.push(["bindSubToTenant", sub, t]);
    },
    tenantsPendingContractEndCleanup() {
      log.calls.push(["tenantsPendingContractEndCleanup"]);
      return [];
    },
    tenantsPendingCancellationMail() {
      log.calls.push(["tenantsPendingCancellationMail"]);
      return [];
    },
    tenantExists: (id) => state.tenants.some((t) => t.id === id),
    tenantSubscription: () => ({ cancelAtPeriodEnd: false }),
    tenantStripe: () => ({}),
  };
  const store = new Proxy(base, {
    get(t, k) {
      if (k in t || typeof k === "symbol" || k === "then") return t[k];
      return (...a) => {
        log.calls.push([k, ...a]);
      };
    },
  });
  return { store, state, log };
}

function captureConsole() {
  const logs = { out: "", err: "", warn: "" };
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const join = (a) => a.map(String).join(" ") + "\n";
  console.log = (...a) => (logs.out += join(a));
  console.error = (...a) => (logs.err += join(a));
  console.warn = (...a) => (logs.warn += join(a));
  return {
    logs,
    restore: () => {
      console.log = orig.log;
      console.error = orig.error;
      console.warn = orig.warn;
    },
  };
}

async function boot(overrides = {}) {
  stub = neuerStub(overrides.stub);
  const runner = overrides.runner ?? (await makePgliteRunner());
  const { store, state, log } = overrides.fake ?? makeStore();
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        Object.assign(req, { rawBody: buf });
      },
    }),
  );
  const audits = [];
  const deps = {
    app,
    config: baseConfig,
    store,
    audit: (...a) => audits.push(a),
    provision: async () => ({}),
    createPortalRunner: () => runner,
    stripeWebhookPath: "/webhooks/stripe",
    appPath: "/app",
    ...overrides.deps,
  };
  const capture = captureConsole();
  let result;
  try {
    result = await wireWebLogin(deps);
    await echtWarten(80);
  } finally {
    capture.restore();
  }
  const srv = app.listen(0);
  await new Promise((resolve) => srv.once("listening", resolve));
  return {
    runner,
    app,
    store,
    state,
    log,
    audits,
    stripeAbrufe: stub.stripeAbrufe,
    logs: capture.logs,
    result,
    url: `http://127.0.0.1:${srv.address().port}`,
    close: () => srv.close(),
  };
}

function cookiePairs(res) {
  const roh = res.headers.getSetCookie();
  const paare = roh.map((c) => c.split(";")[0]);
  return paare.filter((c) => !/=$/.test(c));
}

async function oidcLogin(url, workosUser, extraHeaders = {}) {
  stub.workosUser = workosUser;
  const start = await abrufMitFrist(`${url}/auth/login`, { redirect: "manual" });
  const location = new URL(start.headers.get("location"));
  const state = location.searchParams.get("state");
  const cookie = cookiePairs(start).join("; ");
  const cb = await abrufMitFrist(
    `${url}/auth/callback?code=c1&state=${encodeURIComponent(state)}`,
    { redirect: "manual", headers: { cookie, ...extraHeaders } },
  );
  const session = cookiePairs(cb).find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  return { start, location, cb, session };
}

async function devLogin(url) {
  const res = await abrufMitFrist(`${url}/auth/dev-login`, { method: "POST", redirect: "manual" });
  const session = cookiePairs(res).find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  return { res, session };
}

const devConfig = { ...baseConfig, auth: { ...baseConfig.auth, devLoginEnabled: true } };

test("OIDC-Login: Weiterleitung nennt die Callback-Adresse der oeffentlichen URL", async () => {
  const w = await boot();
  try {
    const start = await abrufMitFrist(`${w.url}/auth/login`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const loc = new URL(start.headers.get("location"));
    assert.equal(loc.searchParams.get("redirect_uri"), "http://localhost/auth/callback");
  } finally {
    w.close();
  }
});

test("OIDC-Login: Callback legt Tenant an, bindet Subject, setzt Namen genau einmal", async () => {
  const sub = "user_cb";
  const tenantId = tenantIdForSubject(sub);
  const fake = makeStore({ tenants: [{ id: tenantId }] });
  const w = await boot({ fake });
  try {
    const user = {
      id: sub,
      email: "anna@example.test",
      email_verified: true,
      first_name: "Anna",
      last_name: "Muster",
    };
    const erst = await oidcLogin(w.url, user);
    assert.equal(erst.cb.status, 302);
    assert.equal(erst.cb.headers.get("location"), "/");
    assert.ok(erst.session, "Session-Cookie gesetzt");
    const aufrufe = fake.log.calls;
    assert.deepEqual(
      aufrufe.filter((c) => c[0] === "ensureTenant"),
      [["ensureTenant", tenantId]],
    );
    assert.deepEqual(
      aufrufe.filter((c) => c[0] === "bindSubToTenant"),
      [["bindSubToTenant", sub, tenantId]],
    );
    const [tenant] = fake.state.tenants;
    assert.equal(tenant.ownerName, "Anna Muster");
    assert.equal(tenant.firstName, "Anna");
    assert.equal(fake.log.saves, 1);

    const zweit = await oidcLogin(w.url, user);
    assert.equal(zweit.cb.status, 302);
    assert.equal(fake.log.saves, 1, "bereits gesetzter Name loest kein erneutes Speichern aus");
  } finally {
    w.close();
  }
});

test("OIDC-Login: Fehler beim Speichern des Namens bricht den Login nicht ab und wird geloggt", async () => {
  const sub = "user_fehler";
  const fake = makeStore({ tenants: [{ id: tenantIdForSubject(sub) }] });
  const echt = fake.store.withStoreLock;
  fake.store.withStoreLock = async () => {
    throw new Error("kaputt");
  };
  const w = await boot({ fake });
  const capture = captureConsole();
  let r;
  try {
    r = await oidcLogin(w.url, {
      id: sub,
      email: "f@example.test",
      email_verified: true,
      first_name: "Fritz",
      last_name: "Fehler",
    });
  } finally {
    capture.restore();
    fake.store.withStoreLock = echt;
    w.close();
  }
  assert.equal(r.cb.status, 302);
  assert.ok(r.session);
  assert.match(capture.logs.err, /\[web-auth\] applyTenantIdentity fehlgeschlagen: kaputt/);
});

test("Logout: Abmelde-Adresse fuehrt zur Login-Seite der oeffentlichen URL zurueck", async () => {
  const w = await boot();
  try {
    const r = await oidcLogin(w.url, {
      id: "user_logout",
      email: "l@example.test",
      email_verified: true,
    });
    assert.ok(r.session);
    const out = await abrufMitFrist(`${w.url}/auth/logout`, {
      method: "POST",
      headers: { cookie: r.session },
    });
    assert.equal(out.status, 200);
    const { logoutUrl } = await out.json();
    const u = new URL(logoutUrl);
    assert.equal(u.searchParams.get("session_id"), "sess_workos_1");
    assert.equal(u.searchParams.get("return_to"), "http://localhost/auth/login");
  } finally {
    w.close();
  }
});

test("Ratenbegrenzung gilt unter /auth, nicht auf anderen Routen", async () => {
  const w = await boot({
    deps: {
      config: { ...baseConfig, auth: { ...baseConfig.auth, loginRateLimitPerMin: 2 } },
    },
  });
  try {
    const auth = [];
    for (let i = 0; i < 4; i++) {
      const res = await abrufMitFrist(`${w.url}/auth/login`, { redirect: "manual" });
      auth.push(res.status);
    }
    assert.deepEqual(auth, [302, 302, 429, 429]);
    for (let i = 0; i < 5; i++) {
      const res = await abrufMitFrist(`${w.url}/api/portal/state`);
      assert.equal(res.status, 401);
    }
  } finally {
    w.close();
  }
});

async function aktivenTenantEinloggen(w) {
  const { session } = await devLogin(w.url);
  assert.ok(session);
  const tenantId = tenantIdForSubject("dev-user");
  await w.runner.withClient((c) => c.query("UPDATE tenant SET status = 'active' WHERE id = $1", [tenantId]));
  return { session, tenantId };
}

test("Portal-Status: liefert Tenant und Anrufliste des eingeloggten Tenants", async () => {
  const w = await boot({ deps: { config: devConfig } });
  try {
    const { session, tenantId } = await aktivenTenantEinloggen(w);
    const res = await abrufMitFrist(`${w.url}/api/portal/state`, { headers: { cookie: session } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { tenantId, calls: [] });
  } finally {
    w.close();
  }
});

test("Portal-Status: Lesefehler -> 500 mit Fehlertext und Logeintrag", async () => {
  const runner = await makePgliteRunner();
  const w = await boot({ runner, deps: { config: devConfig } });
  const capture = captureConsole();
  try {
    const { session } = await aktivenTenantEinloggen(w);
    const echt = runner.withClient;
    runner.withClient = (fn) =>
      echt((c) =>
        fn({
          query: (t, p) => {
            if (/FROM call/.test(t)) throw new Error("db weg");
            return c.query(t, p);
          },
        }),
      );
    const res = await abrufMitFrist(`${w.url}/api/portal/state`, { headers: { cookie: session } });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "interner Fehler" });
    assert.match(capture.logs.err, /\[portal\] state db weg/);
  } finally {
    capture.restore();
    w.close();
  }
});

test("Selbstbedienung: Abrechnungsstatus ist fuer noch nicht aktivierte Tenants erreichbar", async () => {
  const w = await boot({
    deps: {
      config: {
        ...devConfig,
        tenancy: { selfServiceEnabled: true, multiTenant: true },
        billing: { paymentEnabled: false, paymentCurrency: "eur" },
      },
    },
  });
  try {
    const { session } = await devLogin(w.url);
    const res = await abrufMitFrist(`${w.url}/api/self-service/billing/status`, {
      headers: { cookie: session },
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "suspended");
    const portal = await abrufMitFrist(`${w.url}/api/portal/state`, { headers: { cookie: session } });
    assert.equal(portal.status, 403);
  } finally {
    w.close();
  }
});

test("wireWebLogin gibt Konten- und Audit-Zugriff an uebergebene Referenzen weiter", async () => {
  const accountsRef = {};
  const auditStoreRef = {};
  const w = await boot({ deps: { accountsRef, auditStoreRef } });
  try {
    assert.equal(typeof accountsRef.current.upsertOnFirstLogin, "function");
    assert.equal(typeof auditStoreRef.current.record, "function");
    assert.equal(typeof w.result.webAuthMw, "function");
    assert.equal(typeof w.result.adminMw, "function");
  } finally {
    w.close();
  }
});

test("Neuer Tenant erhaelt das Land aus provisioningCountry", async () => {
  const w = await boot({
    deps: {
      config: {
        ...devConfig,
        provisioning: { releaseGraceMs: 0, provisioningCountry: "FR" },
      },
    },
  });
  try {
    const { session } = await devLogin(w.url);
    assert.ok(session);
    const { rows } = await w.runner.withClient((c) =>
      c.query("SELECT country, timezone FROM tenant WHERE id = $1", [tenantIdForSubject("dev-user")]),
    );
    assert.equal(rows[0].country, "FR");
    assert.equal(rows[0].timezone, "Europe/Paris");
  } finally {
    w.close();
  }
});

test("Hintergrundlaeufe starten mit dem Store und melden keinen Fehler", async () => {
  const w = await boot();
  try {
    const names = w.log.calls.map((c) => c[0]);
    assert.ok(names.includes("tenantsPendingContractEndCleanup"), "Vertragsende-Aufraeumen lief");
    assert.ok(names.includes("tenantsPendingCancellationMail"), "Kuendigungsmail-Lauf lief");
    assert.doesNotMatch(w.logs.err, /\[did-release\]/);
    assert.doesNotMatch(w.logs.err, /\[contract-end\]/);
    assert.doesNotMatch(w.logs.err, /\[cancellation-mail\]/);
    assert.doesNotMatch(w.logs.warn, /\[did-release\]/);
  } finally {
    w.close();
  }
});

const SECHS_STUNDEN_MS = 6 * 60 * 60 * 1000;
const mitZahlung = { ...baseConfig, billing: { paymentEnabled: true, stripeWebhookSecret: "whsec_x" } };
const SWEEP_TAGS = ["did-release", "contract-end", "cancellation-mail", "stripe-reconcile"];
const SWEEP_NACHLAUF_MS = 80;

async function zeitVorstellen(t, ms) {
  const capture = captureConsole();
  try {
    t.mock.timers.tick(ms);
    await echtWarten(SWEEP_NACHLAUF_MS);
  } finally {
    capture.restore();
  }
  return capture.logs;
}

const anzahl = (calls, name) => calls.filter((c) => c[0] === name).length;
const vorkommen = (text, teil) => text.split(teil).length - 1;
const aktiveTimer = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;

test("Hintergrundlaeufe wiederholen sich nach sechs Stunden, nicht frueher", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const fake = makeStore({ tenants: [{ id: "t_heil", stripeSubscriptionId: "sub_heil", status: "active" }] });
  const w = await boot({ fake, stub: { stripeStatus: "canceled" }, deps: { config: mitZahlung } });
  try {
    assert.equal(anzahl(fake.log.calls, "tenantsPendingContractEndCleanup"), 1);
    assert.equal(anzahl(fake.log.calls, "tenantsPendingCancellationMail"), 1);
    assert.equal(w.stripeAbrufe.length, 1);
    await zeitVorstellen(t, SECHS_STUNDEN_MS - 1);
    assert.equal(anzahl(fake.log.calls, "tenantsPendingContractEndCleanup"), 1);
    assert.equal(anzahl(fake.log.calls, "tenantsPendingCancellationMail"), 1);
    assert.equal(w.stripeAbrufe.length, 1);
    const logs = await zeitVorstellen(t, 1);
    assert.equal(anzahl(fake.log.calls, "tenantsPendingContractEndCleanup"), 2);
    assert.equal(anzahl(fake.log.calls, "tenantsPendingCancellationMail"), 2);
    assert.equal(w.stripeAbrufe.length, 2);
    assert.match(logs.warn, /heile tenant=t_heil/);
    assert.equal(logs.err, "");
  } finally {
    w.close();
  }
});

test("Hintergrundlaeufe halten den Prozess nicht am Leben", async () => {
  const runner = await makePgliteRunner();
  const vorher = aktiveTimer();
  const w = await boot({ runner, deps: { config: mitZahlung } });
  try {
    assert.equal(aktiveTimer(), vorher);
  } finally {
    w.close();
  }
});

test("Hintergrundlauf-Fehler wird mit seinem Kennzeichen geloggt statt geworfen, und der naechste Lauf kommt", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const fake = makeStore();
  const kaputt = () => {
    throw new Error("sweep kaputt");
  };
  fake.store.load = kaputt;
  fake.store.tenantsPendingContractEndCleanup = kaputt;
  fake.store.tenantsPendingCancellationMail = kaputt;
  const w = await boot({ fake, deps: { config: mitZahlung } });
  try {
    for (const tag of SWEEP_TAGS) assert.equal(vorkommen(w.logs.err, `[${tag}] sweep kaputt`), 1, tag);
    const logs = await zeitVorstellen(t, SECHS_STUNDEN_MS);
    for (const tag of SWEEP_TAGS) assert.equal(vorkommen(logs.err, `[${tag}] sweep kaputt`), 1, tag);
    const start = await abrufMitFrist(`${w.url}/auth/login`, { redirect: "manual" });
    assert.equal(start.status, 302);
  } finally {
    w.close();
  }
});

test("Konten- und Audit-Zugriff der Verdrahtung arbeiten auf der Datenbank des Logins", async () => {
  const accountsRef = {};
  const auditStoreRef = {};
  const w = await boot({ deps: { config: devConfig, accountsRef, auditStoreRef } });
  try {
    const { session } = await devLogin(w.url);
    assert.ok(session);
    const tenantId = tenantIdForSubject("dev-user");
    const konto = await accountsRef.current.accountByTenant(tenantId);
    assert.equal(konto.sub, "dev-user");
    await auditStoreRef.current.record({ tenantId, action: "pruef_eintrag", detail: "d1" });
    const { rows } = await w.runner.withClient((c) =>
      c.query("SELECT tenant_id, detail FROM audit_log WHERE action = 'pruef_eintrag'"),
    );
    assert.deepEqual(rows, [{ tenant_id: tenantId, detail: "d1" }]);
  } finally {
    w.close();
  }
});

test("Stripe-Abgleich: ohne PAYMENT_ENABLED wird kein Abo bei Stripe abgefragt", async () => {
  const fake = makeStore({ tenants: [{ id: "t_ohne", stripeSubscriptionId: "sub_ohne", status: "active" }] });
  const w = await boot({ fake });
  try {
    assert.deepEqual(w.stripeAbrufe, []);
    assert.doesNotMatch(w.logs.warn, /stripe-reconcile/);
  } finally {
    w.close();
  }
});

test("Stripe-Abgleich: mit PAYMENT_ENABLED wird das Abo abgefragt und ein beendetes Abo geheilt", async () => {
  const fake = makeStore({ tenants: [{ id: "t_heil", stripeSubscriptionId: "sub_heil", status: "active" }] });
  const w = await boot({
    fake,
    stub: { stripeStatus: "canceled" },
    deps: { config: { ...baseConfig, billing: { paymentEnabled: true, stripeWebhookSecret: "whsec_x" } } },
  });
  try {
    assert.equal(w.stripeAbrufe.length, 1);
    assert.match(w.stripeAbrufe[0], /sub_heil/);
    assert.doesNotMatch(w.logs.err, /stripe-reconcile/);
    assert.doesNotMatch(w.logs.warn, /Heilung fehlgeschlagen/);
    assert.match(w.logs.warn, /heile tenant=t_heil/);
    assert.ok(
      fake.log.calls.some((c) => c[0] === "setSuspendedAtIfAbsent" && c[1] === "t_heil"),
      "Tenant wurde ueber den Webhook-Pfad suspendiert",
    );
    assert.ok(
      w.audits.some((a) => a[0] === "stripe_webhook_suspend"),
      "Audit-Eintrag ueber die uebergebene audit-Funktion",
    );
  } finally {
    w.close();
  }
});

test("Stripe-Webhook: ohne PAYMENT_ENABLED 404, mit falscher Signatur 400", async () => {
  const aus = await boot();
  try {
    const res = await abrufMitFrist(`${aus.url}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 404);
  } finally {
    aus.close();
  }

  const an = await boot({
    deps: { config: { ...baseConfig, billing: { paymentEnabled: true, stripeWebhookSecret: "whsec_x" } } },
  });
  try {
    const res = await abrufMitFrist(`${an.url}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" },
      body: "{}",
    });
    assert.equal(res.status, 400);
    assert.ok(an.audits.some((a) => a[0] === "stripe_webhook_rejected"));

    const t = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: "evt_1", type: "customer.created", created: t, data: { object: {} } });
    const sig = crypto.createHmac("sha256", "whsec_x").update(`${t}.${body}`).digest("hex");
    const ok = await abrufMitFrist(`${an.url}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` },
      body,
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { received: true });
  } finally {
    an.close();
  }
});
