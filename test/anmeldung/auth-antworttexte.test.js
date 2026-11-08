import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "../pg-helpers.js";
import {
  webAuth,
  adminOnly,
  makeAccounts,
  makeSessions,
  makeAdminRoutes,
  makeWebAuthRoutes,
  signValue,
  SESSION_COOKIE_NAME,
} from "../../src/web-auth.js";
import request from "../gemeinsam/testserver-anfrage.mjs";

const SECRET = "antworttexte-secret-0123456789";
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_ERROR = 500;
const DB_WEG = "datenbank nicht erreichbar";

const ausfall = () => Promise.reject(new Error(DB_WEG));

async function start(ueberschreibungen = {}) {
  const { store, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  await accounts.upsertOnFirstLogin({ sub: "admin1", email: "admin@x" });
  await accounts.setStatus("t_admin1", "active");
  const { id: adminSession } = await sessions.create({
    sub: "admin1",
    tenantId: "t_admin1",
    ttlSeconds: 3600,
  });
  await accounts.upsertOnFirstLogin({ sub: "ziel1", email: "ziel@x" });
  await accounts.setStatus("t_ziel1", "suspended");
  const konten = { ...accounts, ...ueberschreibungen.accounts };
  const sitzungen = { ...sessions, ...ueberschreibungen.sessions };
  const webAuthMw = webAuth({ secret: SECRET, sessions: sitzungen, accounts: konten });
  const app = express();
  app.use(express.json());
  app.use(
    makeAdminRoutes({
      accounts: konten,
      sessions: sitzungen,
      audit: { record: async () => {} },
      webAuthMw,
      adminMw: adminOnly({ adminEmails: ["admin@x"] }),
      store,
    }),
  );
  app.use(
    makeWebAuthRoutes({
      secret: SECRET,
      ttlSeconds: 3600,
      accounts: konten,
      sessions: sitzungen,
      devLoginEnabled: true,
    }),
  );
  app.get("/probe", webAuthMw, (_req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(adminSession, SECRET))}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function mitServer(ueberschreibungen, pruefung) {
  const s = await start(ueberschreibungen);
  try {
    await pruefung(s);
  } finally {
    await s.close();
  }
}

test("Anmeldung: Dev-Login mit Datenbankfehler antwortet 500 mit dem Text dev-login fehlgeschlagen", async () => {
  await mitServer({ sessions: { create: ausfall } }, async (s) => {
    const res = await request("POST", `${s.base}/auth/dev-login`, { body: {} });
    assert.equal(res.status, HTTP_ERROR);
    assert.equal(res.body, "dev-login fehlgeschlagen");
  });
});

test("Anmeldung: geschuetzte Route ohne Sitzung antwortet 401 mit error Unauthorized", async () => {
  await mitServer({}, async (s) => {
    const mitSitzung = await request("GET", `${s.base}/probe`, { cookie: s.cookie });
    assert.equal(mitSitzung.status, HTTP_OK);
    const res = await request("GET", `${s.base}/probe`);
    assert.equal(res.status, HTTP_UNAUTHORIZED);
    assert.deepEqual(JSON.parse(res.body), { error: "Unauthorized" });
  });
});

test("Anmeldung: Fehler bei der Sitzungspruefung antwortet 401 mit error Unauthorized", async () => {
  await mitServer({ sessions: { get: ausfall } }, async (s) => {
    const res = await request("GET", `${s.base}/probe`, { cookie: s.cookie });
    assert.equal(res.status, HTTP_UNAUTHORIZED);
    assert.deepEqual(JSON.parse(res.body), { error: "Unauthorized" });
  });
});

test("Admin: Tenant-Liste mit Datenbankfehler antwortet 500 mit error interner Fehler", async () => {
  await mitServer({ accounts: { listTenants: ausfall } }, async (s) => {
    const res = await request("GET", `${s.base}/api/admin/tenants`, { cookie: s.cookie });
    assert.equal(res.status, HTTP_ERROR);
    assert.deepEqual(JSON.parse(res.body), { error: "interner Fehler" });
  });
});

test("Admin: approve mit Datenbankfehler antwortet 500 mit error interner Fehler", async () => {
  await mitServer({ accounts: { setStatus: ausfall } }, async (s) => {
    const res = await request("POST", `${s.base}/api/admin/tenants/t_ziel1/approve`, {
      cookie: s.cookie,
    });
    assert.equal(res.status, HTTP_ERROR);
    assert.deepEqual(JSON.parse(res.body), { error: "interner Fehler" });
  });
});

test("Admin: suspend mit Datenbankfehler antwortet 500 mit error interner Fehler", async () => {
  await mitServer({ accounts: { setStatus: ausfall } }, async (s) => {
    const res = await request("POST", `${s.base}/api/admin/tenants/t_ziel1/suspend`, {
      cookie: s.cookie,
    });
    assert.equal(res.status, HTTP_ERROR);
    assert.deepEqual(JSON.parse(res.body), { error: "interner Fehler" });
  });
});

async function bekanntUndUnbekannt(aktion, erwartetStatus) {
  await mitServer({}, async (s) => {
    const bekannt = await request("POST", `${s.base}/api/admin/tenants/t_ziel1/${aktion}`, {
      cookie: s.cookie,
    });
    assert.equal(bekannt.status, HTTP_OK);
    assert.deepEqual(JSON.parse(bekannt.body), { tenantId: "t_ziel1", status: erwartetStatus });
    const res = await request("POST", `${s.base}/api/admin/tenants/t_unbekannt/${aktion}`, {
      cookie: s.cookie,
    });
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.deepEqual(JSON.parse(res.body), { error: "Tenant nicht gefunden" });
  });
}

test("Admin: approve eines unbekannten Tenants antwortet 404, eines bekannten 200", async () => {
  await bekanntUndUnbekannt("approve", "active");
});

test("Admin: suspend eines unbekannten Tenants antwortet 404, eines bekannten 200", async () => {
  await bekanntUndUnbekannt("suspend", "suspended");
});
