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
import { webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import { GREETING_TEMPLATES } from "../src/self-service.js";
import { OWNER_TENANT_ID, defaultSettings } from "../src/store/defaults.js";
import * as ops from "../src/store/state-ops.js";
import { config } from "../src/config.js";

// Owner-Nummern-Seed (config.twilio/telnyxNumber aus .env) ausschalten -> die
// deterministischen Asserts laufen unabhaengig von einer lokalen .env (Muster wie
// store-pg-multitenant.test.js). Prozess-isoliert pro Datei.
config.twilioNumber = "";
config.telnyxNumber = "";

const SECRET = "self-service-web-secret-0123456789";
const SUB_B = "sub-b";
const TENANT_B = "t_sub-b"; // upsertOnFirstLogin: tenantId = `t_${sub}`
const SUB_SUSPENDED = "sub-susp";
const TENANT_SUSPENDED = "t_sub-susp";

const cookieFor = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

// Seedet einen aktiven Tenant im Mirror (App-Daten) + in der DB (Identitaet) und
// gibt seinen Settings-Bucket zurueck, damit der Aufrufer Vorbedingungen setzen kann.
async function seedActiveTenant(store, accounts, { sub, tenantId, bankData }) {
  const s = store.load();
  ops.registerTenant(s, tenantId, { ownerName: "Kunde B" });
  const t = s.tenants.find((x) => x.id === tenantId);
  t.status = "active";       // Mirror-Status konsistent zur DB (Flush darf nicht downgraden)
  t.idpSubject = sub;
  const bucket = ops.settingsFor(s, tenantId);
  if (bankData !== undefined) bucket.allowBankData = bankData;
  // Identitaet in die DB: Tenant + Account anlegen, dann aktivieren (Session-Auth liest die DB).
  await accounts.upsertOnFirstLogin({ sub, email: `${sub}@kunde.de` });
  await accounts.setStatus(tenantId, "active");
  return bucket;
}

// Baut Store + Identitaets-Schicht + die Self-Service-Routen auf einer Wegwerf-App.
// Liefert base-URL, store (Mirror-Zugriff), Cookies (aktiv/suspendiert) + close().
async function setup({ bankData } = {}) {
  const { store, db } = await makePgTestStore();
  const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  const bucketB = await seedActiveTenant(store, accounts, { sub: SUB_B, tenantId: TENANT_B, bankData });

  // Owner-Call (darf NIE in B's Sicht auftauchen) + B-Call + B-Termin im Mirror.
  const s = store.load();
  const ownerCall = ops.createCall(s, { direction: "inbound", from: "+49", to: "+49", tenantId: OWNER_TENANT_ID });
  const bCall = ops.createCall(s, { direction: "inbound", from: "+49", to: "+49", tenantId: TENANT_B });
  ops.addCalendarEvent(s, TENANT_B, "B-Termin", "2030-02-01T10:00:00.000Z", "2030-02-01T11:00:00.000Z");
  const { id: sessionId } = await sessions.create({ sub: SUB_B, tenantId: TENANT_B, ttlSeconds: 3600 });

  // Suspendierter Tenant (Account in der DB, NICHT aktiviert) fuer den 403-Fall.
  await accounts.upsertOnFirstLogin({ sub: SUB_SUSPENDED, email: "susp@kunde.de" });
  const { id: suspSessionId } = await sessions.create({ sub: SUB_SUSPENDED, tenantId: TENANT_SUSPENDED, ttlSeconds: 3600 });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const app = express();
  app.use(express.json());
  app.use(makeSelfServiceRoutes({ store, webAuthMw, audit: () => {} }));
  const server = await new Promise((r) => { const sv = app.listen(0, "127.0.0.1", () => r(sv)); });

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store, bucketB, ownerCallId: ownerCall.id, bCallId: bCall.id,
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
    if (payload) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(payload); }
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode, body: b })); }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const getState = (s) => request("GET", `${s.base}/api/self-service/state`, { cookie: s.cookieB });
const postSettings = (s, body, cookie = s.cookieB) =>
  request("POST", `${s.base}/api/self-service/settings`, { cookie, body });

test("(a) Lese-Sicht: B sieht nur B's Daten, kein Owner-Call, kein streamToken, mit greetingTemplates", async () => {
  const s = await setup();
  try {
    const res = await getState(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.calls.length, 1, "nur B's Call");
    assert.equal(body.calls[0].id, s.bCallId);
    assert.equal(body.calls.some((c) => c.id === s.ownerCallId), false, "Owner-Call NICHT enthalten");
    assert.equal("streamToken" in body.calls[0], false, "streamToken NIE geleakt (publicCall)");
    assert.deepEqual(body.greetingTemplates, GREETING_TEMPLATES, "Vorlagen mitgeliefert");
    assert.deepEqual(body.calendar.map((e) => e.title), ["B-Termin"], "nur B's Termin");
  } finally { await s.close(); }
});

test("(b) Schreiben: B setzt agentName + allowCalendar; Owner-Bucket unberuehrt", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { agentName: "B-Agent", allowCalendar: false });
    assert.equal(res.status, 200);
    const stored = s.store.load().settings;
    assert.equal(stored[TENANT_B].agentName, "B-Agent", "B-Bucket traegt B's Wert");
    assert.equal(stored[TENANT_B].allowCalendar, false, "allowCalendar gesetzt");
    assert.equal(stored[OWNER_TENANT_ID].agentName, defaultSettings().agentName, "Owner-Bucket unveraendert");
  } finally { await s.close(); }
});

test("(c1) Nicht-Whitelist-Feld (allowSummaries) wird ignoriert", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { allowSummaries: false });
    assert.equal(res.status, 200);
    assert.equal(s.store.load().settings[TENANT_B].allowSummaries, true, "allowSummaries nicht geschrieben");
  } finally { await s.close(); }
});

test("(c2) Restrict-only: allowBankData false->true wird abgelehnt", async () => {
  const s = await setup({ bankData: false });
  try {
    const res = await postSettings(s, { allowBankData: true });
    assert.equal(res.status, 200);
    assert.equal(s.store.load().settings[TENANT_B].allowBankData, false, "false->true abgelehnt");
  } finally { await s.close(); }
});

test("(c3) Restrict-only: allowBankData true->false ist erlaubt", async () => {
  const s = await setup({ bankData: true });
  try {
    const res = await postSettings(s, { allowBankData: false });
    assert.equal(res.status, 200);
    assert.equal(s.store.load().settings[TENANT_B].allowBankData, false, "true->false erlaubt");
  } finally { await s.close(); }
});

test("(d1) greeting-Freitext wird abgelehnt (nur Vorlage)", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { greeting: "Hallo ich bin boese {owner}" });
    assert.equal(res.status, 200);
    assert.equal(s.store.load().settings[TENANT_B].greeting, defaultSettings().greeting, "greeting unveraendert (Default)");
  } finally { await s.close(); }
});

test("(d2) greeting-Vorlage wird akzeptiert", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { greeting: GREETING_TEMPLATES[1] });
    assert.equal(res.status, 200);
    assert.equal(s.store.load().settings[TENANT_B].greeting, GREETING_TEMPLATES[1], "Vorlage uebernommen");
  } finally { await s.close(); }
});

test("(e) Disclosure-Abschalt-Versuch wird abgelehnt (keine neuen Keys)", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { allowDisclosureOff: true, disclosure: "" });
    assert.equal(res.status, 200);
    const bucket = s.store.load().settings[TENANT_B];
    assert.equal("allowDisclosureOff" in bucket, false, "kein erfundenes Disclosure-Off-Feld");
    assert.equal("disclosure" in bucket, false, "kein disclosure-Feld geschrieben");
  } finally { await s.close(); }
});

test("(f1) Fail-closed: ohne Session-Cookie -> 401, kein Datenleck", async () => {
  const s = await setup();
  try {
    const res = await request("GET", `${s.base}/api/self-service/state`);
    assert.equal(res.status, 401);
    assert.equal(res.body.includes(s.bCallId), false, "keine Tenant-Daten ohne Session");
  } finally { await s.close(); }
});

test("(f2) Fail-closed: suspendierter Tenant -> 403 (kein Self-Service bis Freigabe)", async () => {
  const s = await setup();
  try {
    const res = await request("GET", `${s.base}/api/self-service/state`, { cookie: s.cookieSuspended });
    assert.equal(res.status, 403);
  } finally { await s.close(); }
});

test("(f3) Fail-closed: POST als suspendierter Tenant -> 403, kein Write", async () => {
  const s = await setup();
  try {
    const res = await postSettings(s, { agentName: "Boese" }, s.cookieSuspended);
    assert.equal(res.status, 403);
    assert.equal(JSON.stringify(s.store.load().settings).includes("Boese"), false, "kein Write bei 403");
  } finally { await s.close(); }
});
