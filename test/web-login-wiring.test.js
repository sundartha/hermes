// P13/Q1: wireWebLogin loggt im Erfolgsfall einen eigenen positiven Boot-Marker
// ("[boot] Web-Login aktiv"), damit der guardedBoot-Fail-open-Zustand (AC5) nicht mehr
// unsichtbar bleibt. Ein pg-Happy-Path-Spawn ist offline nicht herstellbar (keine
// erreichbare DB; pglite in einem Kindprozess ist Lehre p6a-Stall) - darum in-process,
// exakt der boot-guard.test.js-DI-Stil: wireWebLogin ueber guardedBoot mit einem
// gefaelschten createPortalRunner aufrufen (spiegelt den echten Wurzel-Aufruf).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { guardedBoot } from "../src/boot-guard.js";
import { wireWebLogin } from "../src/wiring/web-login.js";

// Minimaler Fake-Runner: makeAccounts/Sessions/AuditStore/PortalStore speichern ihn nur
// (lazy) - erst der jeweilige Route-Handler queryt. Beim reinen Wiring wird er nicht
// angefragt, darum reicht ein triviales withClient.
const fakeRunner = () => ({ withClient: async (fn) => fn({ query: async () => ({ rows: [] }) }) });

const baseConfig = {
  sessionSecret: "s",
  storeBackend: "pg",
  releaseGraceMs: 0,
  selfServiceEnabled: false,
  multiTenant: false,
  adminEmails: [],
  loginRateLimitPerMin: 30,
  sessionTtlSeconds: 3600,
  loginCookieTtlSeconds: 600,
  publicUrl: "http://localhost",
  webDistDir: "",
  paymentEnabled: false,
  devLoginEnabled: false,
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

function makeDeps(overrides) {
  return {
    app: express(),
    config: baseConfig,
    store: fakeStore,
    audit: noopAudit,
    provision: async () => ({}),
    createPortalRunner: fakeRunner,
    stripeWebhookPath: "/webhooks/stripe",
    customerPortalPath: "/tenant.html",
    appPath: "/app",
    ...overrides,
  };
}

test("P13/Q1: wireWebLogin Happy-Path loggt '[boot] Web-Login aktiv', kein 'deaktiviert'", async () => {
  const deps = makeDeps();
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

  // Mount-Beweis: /api/portal/state existiert -> ohne Session 401 (webAuth fail-closed),
  // NICHT 404 (was ein nicht gemounteter Block waere).
  const srv = deps.app.listen(0);
  try {
    await new Promise((resolve) => srv.once("listening", resolve));
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/portal/state`);
    assert.equal(res.status, 401);
  } finally {
    srv.close();
  }
});

test("P13/Q1: wireWebLogin Fault-Path -> guardedBoot false, kein Marker, 'deaktiviert' geloggt", async () => {
  const deps = makeDeps({
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
