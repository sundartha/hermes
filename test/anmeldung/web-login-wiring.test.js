import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { neuePglite } from ".././pglite-helfer.js";
import { applySchema } from "../../src/db/migrate.js";
import { guardedBoot } from "../../src/boot-guard.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { SESSION_COOKIE_NAME } from "../../src/web-auth.js";
import { tenantIdForSubject } from "../../src/store/defaults.js";
import { webLoginBasisKonfiguration } from ".././gemeinsam/web-login-konfiguration.js";
import { abrufMitFrist } from ".././gemeinsam/antwortfrist.mjs";

async function makePgliteRunner() {
  const db = await neuePglite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  return { withClient: (fn) => fn({ query: (t, p) => db.query(t, p) }) };
}

const baseConfig = webLoginBasisKonfiguration("https://api.workos.test");

const fakeStore = {
  ensureTenant() {},
  bindSubToTenant() {},
  withStoreLock: async (fn) => fn(),
  load: () => ({}),
  save() {},
};

const noopAudit = () => {};

function captureConsole() {
  const logs = { out: "", err: "" };
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => (logs.out += a.map(String).join(" ") + "\n");
  console.error = (...a) => (logs.err += a.map(String).join(" ") + "\n");
  return {
    logs,
    restore: () => {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

async function makeDeps(overrides) {
  const runner = await makePgliteRunner();
  return {
    app: express(),
    config: baseConfig,
    store: fakeStore,
    audit: noopAudit,
    provision: async () => ({}),
    createPortalRunner: () => runner,
    stripeWebhookPath: "/webhooks/stripe",
    appPath: "/app",
    ...overrides,
  };
}

async function listen(app) {
  const srv = app.listen(0);
  await new Promise((resolve) => srv.once("listening", resolve));
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}

test("P13/Q1: wireWebLogin Happy-Path loggt '[boot] Web-Login aktiv', kein 'deaktiviert'", async () => {
  const deps = await makeDeps();
  const capture = captureConsole();
  let active;
  try {
    active = await guardedBoot("Web-Login/Portal", () => wireWebLogin(deps));
  } finally {
    capture.restore();
  }
  assert.equal(active, true);
  assert.match(capture.logs.out, /\[boot\] Web-Login aktiv/);
  assert.doesNotMatch(capture.logs.err, /deaktiviert/);

  const srv = await listen(deps.app);
  try {
    const res = await abrufMitFrist(`${srv.url}/api/portal/state`);
    assert.equal(res.status, 401);
  } finally {
    await srv.close();
  }
});

test("P13/Q1: wireWebLogin Fault-Path -> guardedBoot false, kein Marker, 'deaktiviert' geloggt", async () => {
  const deps = await makeDeps({
    createPortalRunner: async () => {
      throw new Error("boom");
    },
  });
  const capture = captureConsole();
  let active;
  try {
    active = await guardedBoot("Web-Login/Portal", () => wireWebLogin(deps));
  } finally {
    capture.restore();
  }
  assert.equal(active, false);
  assert.doesNotMatch(capture.logs.out, /Web-Login aktiv/);
  assert.match(capture.logs.err, /deaktiviert/);
});

test("S2-15: devLoginEnabled -> POST /auth/dev-login mintet Session, 302-Redirect + Session-Cookie", async () => {
  const deps = await makeDeps({
    config: { ...baseConfig, auth: { ...baseConfig.auth, devLoginEnabled: true } },
  });
  const capture = captureConsole();
  try {
    await guardedBoot("Web-Login/Portal", () => wireWebLogin(deps));
  } finally {
    capture.restore();
  }
  const srv = await listen(deps.app);
  try {
    const res = await abrufMitFrist(`${srv.url}/auth/dev-login`, { method: "POST", redirect: "manual" });
    assert.equal(res.status, 302);
    assert.match(res.headers.get("set-cookie") || "", new RegExp(`${SESSION_COOKIE_NAME}=`));
  } finally {
    await srv.close();
  }
});

test("S2-16: selfServiceEnabled+multiTenant mountet /api/self-service/state (401 statt 404); Flags aus -> 404", async () => {
  const depsOn = await makeDeps({
    config: { ...baseConfig, tenancy: { selfServiceEnabled: true, multiTenant: true } },
  });
  const captureOn = captureConsole();
  try {
    await guardedBoot("Web-Login/Portal", () => wireWebLogin(depsOn));
  } finally {
    captureOn.restore();
  }
  const srvOn = await listen(depsOn.app);
  try {
    const res = await abrufMitFrist(`${srvOn.url}/api/self-service/state`);
    assert.equal(res.status, 401, "gemountet + webAuth fail-closed");
  } finally {
    await srvOn.close();
  }

  const depsOff = await makeDeps();
  const captureOff = captureConsole();
  try {
    await guardedBoot("Web-Login/Portal", () => wireWebLogin(depsOff));
  } finally {
    captureOff.restore();
  }
  const srvOff = await listen(depsOff.app);
  try {
    const res = await abrufMitFrist(`${srvOff.url}/api/self-service/state`);
    assert.equal(res.status, 404, "ohne Flags nicht gemountet");
  } finally {
    await srvOff.close();
  }
});

test("Web-Login legt den Tenant mit country/defaultLanguage/timezone an (ex LANG-02)", async () => {
  const runner = await makePgliteRunner();
  const deps = await makeDeps({
    config: { ...baseConfig, auth: { ...baseConfig.auth, devLoginEnabled: true } },
    createPortalRunner: () => runner,
  });
  const capture = captureConsole();
  try {
    await guardedBoot("Web-Login/Portal", () => wireWebLogin(deps));
  } finally {
    capture.restore();
  }
  const srv = await listen(deps.app);
  try {
    const res = await abrufMitFrist(`${srv.url}/auth/dev-login`, { method: "POST", redirect: "manual" });
    assert.equal(res.status, 302, "Dev-Login muss die Session mint-Kette durchlaufen");
  } finally {
    await srv.close();
  }

  const tenantId = tenantIdForSubject("dev-user");
  const { rows } = await runner.withClient((c) =>
    c.query("SELECT country, default_language, timezone FROM tenant WHERE id = $1", [tenantId]),
  );
  assert.equal(rows.length, 1, "Dev-Login muss den Tenant angelegt haben");
  assert.notEqual(rows[0].country, null, "Web-Login-Pfad setzt tenant.country");
  assert.notEqual(rows[0].default_language, null, "Web-Login-Pfad setzt tenant.defaultLanguage");
  assert.notEqual(rows[0].timezone, null, "Web-Login-Pfad setzt tenant.timezone");
});

const { default: pg } = await import("pg");
const { config } = await import("../../src/config.js");
const { poolAufPglite } = await import(".././abrechnung/server-mit-testdatenbank.js");
const { pgliteAlsRolleOhneSuperuser } = await import(".././pg-helpers.js");
const { appOhneAbhaengigkeiten } = await import(".././gemeinsam/app-ohne-abhaengigkeiten.js");

const DEV_LOGIN_SUB = "dev-user";
const WEITERLEITUNG = 302;

function pgStartKonfiguration(auth = {}) {
  return {
    ...config,
    store: { ...config.store, storeBackend: "pg" },
    auth: { ...config.auth, sessionSecret: "nie-web-login-sitzungsgeheimnis", ...auth },
  };
}

function pgPoolAufPglite(t, db) {
  const echterPool = pg.Pool;
  t.after(() => {
    pg.Pool = echterPool;
  });
  return poolAufPglite(db);
}

function appAusBuildApp(t, zusatz) {
  return appOhneAbhaengigkeiten(t, { store: fakeStore, audit: noopAudit, ...zusatz });
}

test("[NIE1] Start mit pg und SESSION_SECRET ohne eingespritzten createPortalRunner bietet /auth/login an und baut den Portal-Pool aus src/portal-pool.js", async (t) => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await applySchema(db);
  const pools = pgPoolAufPglite(t, db);
  const basis = await appAusBuildApp(t, { config: pgStartKonfiguration() });

  assert.equal(pools.length, 1, "genau ein Portal-Pool beim Start");
  assert.equal(pools[0].optionen.connectionString, config.store.databaseUrl);
  const res = await abrufMitFrist(`${basis}/auth/login`, { redirect: "manual" });
  assert.equal(res.status, WEITERLEITUNG);
  assert.match(res.headers.get("location") || "", /code_challenge=/);
});

test("[NIE2] ein über buildApp durchgereichter createPortalRunner wird von wireWebLogin unverändert benutzt", async (t) => {
  const runner = await makePgliteRunner();
  const aufrufe = [];
  const pools = pgPoolAufPglite(t, await neuePglite());
  const basis = await appAusBuildApp(t, {
    config: pgStartKonfiguration({ devLoginEnabled: true }),
    createPortalRunner: async (...argumente) => {
      aufrufe.push(argumente);
      return runner;
    },
  });

  assert.equal(aufrufe.length, 1, "der eingespritzte Runner baut den Portal-Zugang genau einmal");
  assert.equal(
    pools.length,
    0,
    "kein Portal-Pool aus src/portal-pool.js neben dem eingespritzten Runner",
  );
  const res = await abrufMitFrist(`${basis}/auth/dev-login`, {
    method: "POST",
    redirect: "manual",
  });
  assert.equal(res.status, WEITERLEITUNG);
  const { rows } = await runner.withClient((verbindung) =>
    verbindung.query("SELECT id FROM tenant WHERE id = $1", [tenantIdForSubject(DEV_LOGIN_SUB)]),
  );
  assert.equal(rows.length, 1, "der Login schreibt in die Datenbank des eingespritzten Runners");
});
