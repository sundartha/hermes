import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/db/migrate.js";
import { guardedBoot } from "../src/boot-guard.js";
import { wireWebLogin } from "../src/wiring/web-login.js";
import { SESSION_COOKIE_NAME } from "../src/web-auth.js";
import { tenantIdForSubject } from "../src/store/defaults.js";

async function makePgliteRunner() {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  return { withClient: (fn) => fn({ query: (t, p) => db.query(t, p) }) };
}

const baseConfig = {
  storeBackend: "pg",
  tenancy: { selfServiceEnabled: false, multiTenant: false },
  auth: {
    workosApiBase: "https://api.workos.test",
    oidcClientId: "wl_client",
    oidcClientSecret: "wl_secret",
    sessionSecret: "s",
    adminEmails: [],
    loginRateLimitPerMin: 30,
    sessionTtlSeconds: 3600,
    loginCookieTtlSeconds: 600,
    devLoginEnabled: false,
  },
  server: { publicUrl: "http://localhost", webDistDir: "" },
  provisioning: { releaseGraceMs: 0 },
  billing: { paymentEnabled: false },
  safety: { csrfEnforce: true },
  mail: { smtpHost: "" },
};

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
    const res = await fetch(`${srv.url}/api/portal/state`);
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
    const res = await fetch(`${srv.url}/auth/dev-login`, { method: "POST", redirect: "manual" });
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
    const res = await fetch(`${srvOn.url}/api/self-service/state`);
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
    const res = await fetch(`${srvOff.url}/api/self-service/state`);
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
    const res = await fetch(`${srv.url}/auth/dev-login`, { method: "POST", redirect: "manual" });
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
