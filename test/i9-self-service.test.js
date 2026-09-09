// #3 — Self-Service-Login-Konvergenz (web-session-only). Loest den alten i9-Pfad
// (json + X-Internal-Identity) ab: Self-Service laeuft jetzt hinter dem echten
// OIDC-Web-Login (Feature B, webAuthMw -> req.tenant.tenantId aus der DB-Session).
//
// Kompositions-Integrationstest nach dem Muster portal-route.test.js: reines pglite
// (Postgres-in-WASM, offline, F.I.R.S.T.), KEIN Server-Spawn in dieser Datei (Lehre
// p6a-Stall: pglite NIE mit child-process mischen). Der Flag-/Wiring-Gate-Test
// (json -> 404) lebt separat in self-service-flag-gate.test.js.
//
// Identitaets-Konvergenz: webAuthMw setzt req.tenant.tenantId = account.tenant_id =
// t_<sub>; der pg-Store-Mirror keyt seine Buckets ebenfalls auf t_<sub>. Damit ist
// req.tenant.tenantId exakt der Bucket-Key (kein zweiter Resolver).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import { greetingTemplatesFor } from "../src/i18n/greeting-catalog.js";
import { PERSONA_STYLE_IDS } from "../src/i18n/locales.js";
import { BOOTSTRAP_TENANT_ID, defaultSettings } from "../src/store/defaults.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "self-service-web-secret-0123456789";
const SUB_B = "sub-b";
const TENANT_B = "t_sub-b"; // upsertOnFirstLogin: tenantId = `t_${sub}`
const SUB_SUSPENDED = "sub-susp";
const TENANT_SUSPENDED = "t_sub-susp";

// Pay3: Fake-Billing (in-process, KEIN Netz) + Fake-Config. So testet die echte
// Self-Service-Route die Customer-Idempotenz/Match-Logik (card-setup.js) ohne Stripe.
const FAKE_CUST = "cus_b";
const FAKE_PM = "pm_b";
const FAKE_SESSION = "cs_b";
const PUBLIC_URL = "https://test.local";
const OTHER_SESSION = "cs_other"; // gehoert einem fremden Customer -> Customer-Mismatch
function fakeBilling() {
  return {
    createCustomer: async () => ({ customerId: FAKE_CUST }),
    createSetupCheckoutSession: async () => ({
      url: `https://stripe.test/c/${FAKE_SESSION}`,
      sessionId: FAKE_SESSION,
    }),
    getCheckoutSessionResult: async (id) =>
      id === OTHER_SESSION
        ? { customerId: "cus_other", paymentMethodId: "pm_other" }
        : { customerId: FAKE_CUST, paymentMethodId: FAKE_PM },
  };
}

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

// Seedet einen aktiven Tenant im Mirror (App-Daten) + in der DB (Identitaet) und
// gibt seinen Settings-Bucket zurueck, damit der Aufrufer Vorbedingungen setzen kann.
async function seedActiveTenant(store, accounts, { sub, tenantId, bankData }) {
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Kunde", lastName: "B" }); // G1: komponiert ownerName="Kunde B"
  const t = s.tenants.find((x) => x.id === tenantId);
  t.status = "active"; // Mirror-Status konsistent zur DB (Flush darf nicht downgraden)
  t.idpSubject = sub;
  // P10: Subjekt dieses Tests-Setups sind Self-Service-Reads/-Writes, nicht die
  // Sprachaufloesung - ohne den Pin faellt der Tenant auf den Weltdefault (en) durch.
  t.defaultLanguage = "de";
  const bucket = ops.settingsFor(s, tenantId);
  if (bankData !== undefined) bucket.allowBankData = bankData;
  // Identitaet in die DB: Tenant + Account anlegen, dann aktivieren (Session-Auth liest die DB).
  await accounts.upsertOnFirstLogin({ sub, email: `${sub}@kunde.de` });
  await accounts.setStatus(tenantId, "active");
  return bucket;
}

// Baut Store + Identitaets-Schicht + die Self-Service-Routen auf einer Wegwerf-App.
// Liefert base-URL, store (Mirror-Zugriff), Cookies (aktiv/suspendiert) + close().
async function setup({ bankData, paymentEnabled = true } = {}) {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  const bucketB = await seedActiveTenant(store, accounts, {
    sub: SUB_B,
    tenantId: TENANT_B,
    bankData,
  });

  // Owner-Call (darf NIE in B's Sicht auftauchen) + B-Call + B-Termin im Mirror.
  const s = store.load();
  const ownerCall = ops.createCall(s, {
    direction: "inbound",
    from: "+49",
    to: "+49",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  const bCall = ops.createCall(s, {
    direction: "inbound",
    from: "+49",
    to: "+49",
    tenantId: TENANT_B,
  });
  ops.addCalendarEvent(s, {
    tenantId: TENANT_B,
    title: "B-Termin",
    startIso: "2030-02-01T10:00:00.000Z",
    endIso: "2030-02-01T11:00:00.000Z",
  });
  const { id: sessionId } = await sessions.create({
    sub: SUB_B,
    tenantId: TENANT_B,
    ttlSeconds: 3600,
  });

  // Suspendierter Tenant (Account in der DB, NICHT aktiviert) fuer den 403-Fall.
  await accounts.upsertOnFirstLogin({ sub: SUB_SUSPENDED, email: "susp@kunde.de" });
  const { id: suspSessionId } = await sessions.create({
    sub: SUB_SUSPENDED,
    tenantId: TENANT_SUSPENDED,
    ttlSeconds: 3600,
  });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: SECRET, sessions, accounts });
  const app = express();
  app.use(express.json());
  // Eigenes Config-Objekt (NICHT das Singleton kippen, F.I.R.S.T./Independent): so ist
  // der Flag-aus-Fall in einem separaten setup() testbar, ohne andere Tests zu stoeren.
  const cfg = withConfigNamespaces({ paymentEnabled, publicUrl: PUBLIC_URL });
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw,
      audit: () => {},
      config: cfg,
      billing: fakeBilling(),
      provision: async () => {},
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    accounts,
    bucketB,
    ownerCallId: ownerCall.id,
    bCallId: bCall.id,
    cookieB: cookieFor(sessionId),
    cookieSuspended: cookieFor(suspSessionId),
    close: () => new Promise((r) => server.close(r)),
  };
}

function request(method, url, { cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
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
        res.on("end", () =>
          resolve({ status: res.statusCode, body: b, location: res.headers.location }),
        );
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const getState = (s) => request("GET", `${s.base}/api/self-service/state`, { cookie: s.cookieB });
const postSettings = (s, body, cookie = s.cookieB) =>
  request("POST", `${s.base}/api/self-service/settings`, { cookie, body });
// Pay3-Routen-Shortcuts.
const postSetupCheckout = (s, cookie = s.cookieB) =>
  request("POST", `${s.base}/api/self-service/billing/setup-checkout`, { cookie });
const getCardReturn = (s, sessionId, cookie = s.cookieB) =>
  request("GET", `${s.base}/api/self-service/billing/return?session_id=${sessionId}`, { cookie });

test("(a) Lese-Sicht: B sieht nur B's Daten, kein Owner-Call, kein streamToken, mit greetingTemplates", async () => {
  const s = await setup();
  try {
    const res = await getState(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.calls.length, 1, "nur B's Call");
    assert.equal(body.calls[0].id, s.bCallId);
    assert.equal(
      body.calls.some((c) => c.id === s.ownerCallId),
      false,
      "Owner-Call NICHT enthalten",
    );
    assert.equal("streamToken" in body.calls[0], false, "streamToken NIE geleakt (publicCall)");
    assert.deepEqual(body.greetingTemplates, greetingTemplatesFor("de"), "Vorlagen mitgeliefert in der Sprache des Tenants");
    assert.deepEqual(
      body.calendar.map((e) => e.title),
      ["B-Termin"],
      "nur B's Termin",
    );
  } finally {
    await s.close();
  }
});

test("(w1) /state liefert die aufgeloeste Tenant-Sprache (Quelle des lang-Attributs, ex WEB-01)", async () => {
  const s = await setup();
  try {
    // EXPLIZITE Sprachen statt Default: die Aussage ist "das Feld spiegelt die Aufloesung",
    // nicht "der Default ist de" - damit ist dieser Test gegen den P10-Flip immun (A2).
    s.bucketB.language = "en";
    const en = JSON.parse((await getState(s)).body);
    assert.equal(en.language, "en");
    assert.deepEqual(en.greetingTemplates, greetingTemplatesFor("en"), "eine Aufloesung fuer beides (G5)");
    s.bucketB.language = "fr";
    const fr = JSON.parse((await getState(s)).body);
    assert.equal(fr.language, "fr");
  } finally {
    await s.close();
  }
});

test("(b) Schreiben: B setzt agentName + agentStyle; Owner-Bucket unberuehrt", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { agentName: "B-Agent", agentStyle: "warm-persoenlich" });
    assert.equal(res.status, 200);
    const stored = s.store.load().settings;
    assert.equal(stored[TENANT_B].agentName, "B-Agent", "B-Bucket traegt B's Wert");
    assert.equal(stored[TENANT_B].agentStyle, "warm-persoenlich", "agentStyle gesetzt");
    assert.equal(
      stored[BOOTSTRAP_TENANT_ID].agentName,
      defaultSettings().agentName,
      "Owner-Bucket unveraendert",
    );
  } finally {
    await s.close();
  }
});

test("(c1) Nicht-Whitelist-Feld (allowSummaries) wird ignoriert", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { allowSummaries: false });
    assert.equal(res.status, 200);
    assert.equal(
      s.store.load().settings[TENANT_B].allowSummaries,
      true,
      "allowSummaries nicht geschrieben",
    );
  } finally {
    await s.close();
  }
});

test("(c1b) allowCalendar/allowBooking sind seit P1b kein Self-Service-Feld mehr (E1)", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { allowCalendar: false, allowBooking: false });
    assert.equal(res.status, 200);
    const bucket = s.store.load().settings[TENANT_B];
    assert.equal(bucket.allowCalendar, true, "allowCalendar nicht geschrieben (Default true)");
    assert.equal(bucket.allowBooking, true, "allowBooking nicht geschrieben (Default true)");
  } finally {
    await s.close();
  }
});

test("(c2) Restrict-only: allowBankData false->true wird abgelehnt", async () => {
  const s = await setup({ bankData: false });
  try {
    const res = await postSettings(s, { allowBankData: true });
    assert.equal(res.status, 200);
    assert.equal(s.store.load().settings[TENANT_B].allowBankData, false, "false->true abgelehnt");
  } finally {
    await s.close();
  }
});

test("(c3) Restrict-only: allowBankData true->false ist erlaubt", async () => {
  const s = await setup({ bankData: true });
  try {
    const res = await postSettings(s, { allowBankData: false });
    assert.equal(res.status, 200);
    assert.equal(s.store.load().settings[TENANT_B].allowBankData, false, "true->false erlaubt");
  } finally {
    await s.close();
  }
});

test("(d1) greeting-Freitext wird abgelehnt (nur Vorlage)", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { greeting: "Hallo ich bin boese {owner}" });
    assert.equal(res.status, 200);
    assert.equal(
      s.store.load().settings[TENANT_B].greeting,
      defaultSettings().greeting,
      "greeting unveraendert (Default)",
    );
  } finally {
    await s.close();
  }
});

test("(d2) greeting-Vorlage wird akzeptiert", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { greeting: greetingTemplatesFor("de")[1] });
    assert.equal(res.status, 200);
    assert.equal(
      s.store.load().settings[TENANT_B].greeting,
      greetingTemplatesFor("de")[1],
      "Vorlage uebernommen",
    );
  } finally {
    await s.close();
  }
});

test("(e) Disclosure-Abschalt-Versuch wird abgelehnt (keine neuen Keys)", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { allowDisclosureOff: true, disclosure: "" });
    assert.equal(res.status, 200);
    const bucket = s.store.load().settings[TENANT_B];
    assert.equal("allowDisclosureOff" in bucket, false, "kein erfundenes Disclosure-Off-Feld");
    assert.equal("disclosure" in bucket, false, "kein disclosure-Feld geschrieben");
  } finally {
    await s.close();
  }
});

test("(f1) Fail-closed: ohne Session-Cookie -> 401, kein Datenleck", async () => {
  const s = await setup();
  try {
    const res = await request("GET", `${s.base}/api/self-service/state`);
    assert.equal(res.status, 401);
    assert.equal(res.body.includes(s.bCallId), false, "keine Tenant-Daten ohne Session");
  } finally {
    await s.close();
  }
});

test("(f2) Fail-closed: suspendierter Tenant -> 403 (kein Self-Service bis Freigabe)", async () => {
  const s = await setup();
  try {
    const res = await request("GET", `${s.base}/api/self-service/state`, {
      cookie: s.cookieSuspended,
    });
    // W3-Backend der "Choose your plan"-Landeseite: 403 ist die erreichbare Antwort,
    // die die App-Shell abfaengt (kein roher Basic-Auth-Prompt). Der Body
    // traegt KEINE Tenant-Daten (kein calls/settings) -> suspended ist nicht datenfaehig.
    assert.equal(res.status, 403);
    assert.equal(res.body.includes("calls"), false, "kein Datenleck im 403-Body");
    assert.equal(res.body.includes("settings"), false, "kein Datenleck im 403-Body");
  } finally {
    await s.close();
  }
});

test("(f3) Fail-closed: POST als suspendierter Tenant -> 403, kein Write", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { agentName: "Boese" }, s.cookieSuspended);
    assert.equal(res.status, 403);
    assert.equal(
      JSON.stringify(s.store.load().settings).includes("Boese"),
      false,
      "kein Write bei 403",
    );
  } finally {
    await s.close();
  }
});

// ---- Pay3: Karten-Erfassung aus dem Self-Service-Dashboard --------------------------

test("(g1) hasCard: false ohne Karte, true nach Bindung; payment_method im B-Bucket", async () => {
  const s = await setup();
  try {
    const before = JSON.parse((await getState(s)).body);
    assert.equal(before.hasCard, false, "ohne Karte: false");

    await postSetupCheckout(s); // Customer anlegen
    const ret = await getCardReturn(s, FAKE_SESSION); // Karte binden
    assert.equal(ret.status, 302);

    const after = JSON.parse((await getState(s)).body);
    assert.equal(after.hasCard, true, "nach Bindung: true");
    const t = s.store.load().tenants.find((x) => x.id === TENANT_B);
    assert.equal(t.stripePaymentMethodId, FAKE_PM, "payment_method gespeichert");
  } finally {
    await s.close();
  }
});

test("(g2) setup-checkout liefert Stripe-URL + legt Customer im B-Bucket an", async () => {
  const s = await setup();
  try {
    const res = await postSetupCheckout(s);
    assert.equal(res.status, 200);
    assert.equal(
      JSON.parse(res.body).url,
      `https://stripe.test/c/${FAKE_SESSION}`,
      "Stripe-URL durchgereicht",
    );
    const t = s.store.load().tenants.find((x) => x.id === TENANT_B);
    assert.equal(t.stripeCustomerId, FAKE_CUST, "Customer im B-Bucket");
  } finally {
    await s.close();
  }
});

test("(g3) return mit fremder session_id -> 403, KEIN payment_method gebunden (Customer-Match)", async () => {
  const s = await setup();
  try {
    await postSetupCheckout(s); // bindet B an FAKE_CUST
    const ret = await getCardReturn(s, OTHER_SESSION); // fremder Customer
    assert.equal(ret.status, 403);
    const t = s.store.load().tenants.find((x) => x.id === TENANT_B);
    assert.equal(t.stripePaymentMethodId ?? null, null, "kein fremdes payment_method gebunden");
  } finally {
    await s.close();
  }
});

test("(g4) return -> 302 mit Location /app?card=ok", async () => {
  const s = await setup();
  try {
    await postSetupCheckout(s);
    const ret = await getCardReturn(s, FAKE_SESSION);
    assert.equal(ret.status, 302);
    assert.equal(ret.location, "/app?card=ok", "Redirect in die UI");
  } finally {
    await s.close();
  }
});

test("(g5) Fail-closed: ohne Session-Cookie -> 401 auf beiden Pay3-Routen", async () => {
  const s = await setup();
  try {
    const post = await request("POST", `${s.base}/api/self-service/billing/setup-checkout`);
    assert.equal(post.status, 401, "setup-checkout ohne Session -> 401");
    const get = await request(
      "GET",
      `${s.base}/api/self-service/billing/return?session_id=${FAKE_SESSION}`,
    );
    assert.equal(get.status, 401, "return ohne Session -> 401");
  } finally {
    await s.close();
  }
});

test("(g6) Fail-closed: GESCHLOSSENER Tenant -> 403 auf setup-checkout (P5: suspended darf, closed nicht)", async () => {
  const s = await setup();
  try {
    // P5: webAuthAllowPending laesst suspended (Selbst-Aktivierung) an die Pay3-/Aktivierungs-
    // Routen, blockt aber closed HART - auf Middleware-Ebene (403 VOR dem Handler, kein
    // ensureCustomer, kein Store-Schreiben). Der frisch suspendierte Tenant wird dafuer auf
    // closed gesetzt; ein suspended-darf-durch-Fall ist in p5-onboarding-funnel.test.js (Case 4).
    await s.accounts.setStatus(TENANT_SUSPENDED, "closed");
    const res = await postSetupCheckout(s, s.cookieSuspended);
    assert.equal(res.status, 403);
  } finally {
    await s.close();
  }
});

test("(g7) PAYMENT_ENABLED aus: beide Routen 404 + hasCard fehlt im state (byte-identisch)", async () => {
  const s = await setup({ paymentEnabled: false });
  try {
    const state = JSON.parse((await getState(s)).body);
    assert.equal("hasCard" in state, false, "hasCard fehlt bei Flag aus -> UI versteckt den Block");
    assert.equal((await postSetupCheckout(s)).status, 404, "setup-checkout -> 404");
    assert.equal((await getCardReturn(s, FAKE_SESSION)).status, 404, "return -> 404");
  } finally {
    await s.close();
  }
});

// ---- P4: kuratierte agentStyle-Auswahl im Self-Service ------------------------------

test("(p4-1) gueltiger agentStyle persistiert + /state spiegelt; Reset auf null", async () => {
  const s = await setup();
  try {
    const set = await postSettings(s, { agentStyle: PERSONA_STYLE_IDS[0] });
    assert.equal(set.status, 200);
    assert.equal(
      s.store.load().settings[TENANT_B].agentStyle,
      PERSONA_STYLE_IDS[0],
      "gueltige Stil-ID im B-Bucket",
    );
    const state = JSON.parse((await getState(s)).body);
    assert.equal(state.settings.agentStyle, PERSONA_STYLE_IDS[0], "/state spiegelt den Wert");
    assert.deepEqual(state.personaStyleIds, PERSONA_STYLE_IDS, "Katalog-IDs fuers Dropdown geliefert");

    // Reset: "" -> null (Standardstil), byte-identisches Prompt-Verhalten.
    const reset = await postSettings(s, { agentStyle: "" });
    assert.equal(reset.status, 200);
    assert.equal(s.store.load().settings[TENANT_B].agentStyle, null, "Reset auf null");
  } finally {
    await s.close();
  }
});

test("(p4-2) Freitext/Impersonation als agentStyle -> abgelehnt, nicht persistiert", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { agentStyle: "ICH BIN DR. X VON BANK Y" });
    assert.equal(res.status, 200); // Patch teil-akzeptiert, Muellwert verworfen
    assert.equal(
      s.store.load().settings[TENANT_B].agentStyle,
      defaultSettings().agentStyle,
      "Freitext NICHT geschrieben (bleibt null)",
    );
  } finally {
    await s.close();
  }
});

test("(p4-3) Identitaetsfelder bleiben ueber Self-Service nicht setzbar", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { ownerName: "Hacker", firstName: "Hacker", agentStyle: PERSONA_STYLE_IDS[1] });
    assert.equal(res.status, 200);
    const bucket = s.store.load().settings[TENANT_B];
    assert.equal("ownerName" in bucket, false, "ownerName nie in settings");
    assert.equal("firstName" in bucket, false, "firstName nie in settings");
    assert.equal(
      s.store.load().tenants.find((t) => t.id === TENANT_B).ownerName,
      "Kunde B",
      "Tenant-Identitaet (ownerName) unveraendert",
    );
    assert.equal(bucket.agentStyle, PERSONA_STYLE_IDS[1], "gueltiger Stil im selben Patch trotzdem gesetzt");
  } finally {
    await s.close();
  }
});

test("(p4-4) /state liefert personaStyleIds = das P2-Enum (eine Quelle)", async () => {
  const s = await setup();
  try {
    const state = JSON.parse((await getState(s)).body);
    assert.deepEqual(state.personaStyleIds, PERSONA_STYLE_IDS);
  } finally {
    await s.close();
  }
});
