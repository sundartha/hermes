// P13/Q1: wireWebLogin loggt im Erfolgsfall einen eigenen positiven Boot-Marker
// ("[boot] Web-Login aktiv"), damit der guardedBoot-Fail-open-Zustand (AC5) nicht mehr
// unsichtbar bleibt. Ein pg-Happy-Path-Spawn ist offline nicht herstellbar (keine
// erreichbare DB; pglite in einem Kindprozess ist Lehre p6a-Stall) - darum in-process,
// exakt der boot-guard.test.js-DI-Stil: wireWebLogin ueber guardedBoot mit einem
// gefaelschten createPortalRunner aufrufen (spiegelt den echten Wurzel-Aufruf).
//
// S2-15/S2-16: der Runner ist auf pglite umgestellt (Muster web-auth-pg.test.js) - ein
// leerer {rows:[]}-Stub reicht fuer reines Mount-Wiring, bricht aber am Dev-Login-Pfad
// (mintSession -> accounts.upsertOnFirstLogin -> echtes INSERT...RETURNING). Jeder Test
// baut sein EIGENES frisches PGlite (P12-Unabhaengigkeit). Der Fault-Path-Test bleibt
// unveraendert (createPortalRunner wirft, VOR jeder DB-Beruehrung).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/db/migrate.js";
import { guardedBoot } from "../src/boot-guard.js";
import { wireWebLogin } from "../src/wiring/web-login.js";
import { SESSION_COOKIE_NAME } from "../src/web-auth.js";
import { tenantIdForSubject } from "../src/store/defaults.js";

// Frischer pglite-Runner mit angewandtem Schema (Muster web-auth-pg.test.js setup()).
// KEIN Fake mehr an der Pruefstelle: accounts.upsertOnFirstLogin/sessions.create laufen
// gegen das echte Schema.
async function makePgliteRunner() {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  return { withClient: (fn) => fn({ query: (t, p) => db.query(t, p) }) };
}

// PA-14: isSelfServiceLive(cfg) liest cfg.tenancy.<key>. PA-17: makeOidc (web-auth.js)
// liest cfg.auth.{workosApiBase,oidcClientId,oidcClientSecret}. PA-18: wireWebLogin
// selbst liest cfg.auth.{sessionSecret,adminEmails,loginRateLimitPerMin,
// sessionTtlSeconds,loginCookieTtlSeconds,devLoginEnabled}, cfg.server.{publicUrl,
// webDistDir}, cfg.provisioning.releaseGraceMs; gemountete Self-Service-Routen lesen
// cfg.billing.paymentEnabled (S2-16 Zweig 1). Die Attrappe traegt seither DIESELBE
// Namespace-Form wie der echte config-Export (kein Hybrid mehr) - ein flacher Override
// (z.B. `{ ...baseConfig, devLoginEnabled: true }`) traefe sonst NUR einen wirkungslosen
// Flach-Nachbarn statt den gelesenen Namespace-Pfad (Lehre: eine Attrappe mit falscher
// Config-Form testet den Aufruf, nicht den gelesenen Wert - stillschweigend gruen).
// storeBackend bleibt flach: wireWebLogin selbst liest es nicht (nur app.js VOR dem Aufruf).
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
  // SEC-P3: die gemounteten Self-Service-Routen lesen jetzt zusaetzlich
  // config.safety.csrfEnforce (Herkunftspruefung, s. mountSelfServiceRoutes). Produktions-
  // Default true - dieselbe Attrappen-Namespace-Form wie billing/tenancy oben.
  safety: { csrfEnforce: true },
  // 312k-Phase 5: wireWebLogin liest jetzt zusaetzlich config.mail.smtpHost (Gate fuer den
  // SMTP-Mailer-Bau, s. wiring/web-login.js) - leer = kein Mailer (Auslieferungszustand,
  // Muster workosManagementApiKey oben).
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

// Startet deps.app auf einem freien Port und liefert URL + close (gemeinsamer
// Bootstrap fuer die Mount-/Route-Beweise unten).
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

  // Mount-Beweis: /api/portal/state existiert -> ohne Session 401 (webAuth fail-closed),
  // NICHT 404 (was ein nicht gemounteter Block waere).
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

// ---- S2-15: Dev-Login-Redirect-Verdrahtung Ende-zu-Ende gegen echtes Schema --------

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

// ---- S2-16: Self-Service-Mount-Beweis, beide Richtungen des Flag-Gates -------------

test("S2-16: selfServiceEnabled+multiTenant mountet /api/self-service/state (401 statt 404); Flags aus -> 404", async () => {
  // Zweig 1: Flags AN -> Route existiert, webAuth fail-closed 401 (kein 404).
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

  // Zweig 2: Flags AUS (baseConfig) -> Route nicht gemountet -> 404.
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

// ---- LANG-02 (i18n-Testkatalog, kanonisch D27, tasks/i18n-tests/01-sprachaufloesung.md:140) --
//
// P8 A3-Migration: dieser Test war "SOLL (rot)" (Web-Login setzte country/defaultLanguage
// nie). Mit P8 (resolveOrCreateTenant, src/web-auth.js, schreibt jetzt country/
// default_language/timezone im INSERT-Zweig ueber makeAccounts' signupGeo) ist der
// Zielzustand erreicht - der Test wandert von test:gates (Launch-Katalog) nach npm test
// (Regressionsschutz).
//
// Direkter DB-Read statt fakeStore.ensureTenant: der fakeStore in diesem File ist ein reiner
// Wiring-Stub (No-Op-Methoden), der Tenant selbst entsteht in resolveOrCreateTenant() auf der
// pglite-Instanz hinter createPortalRunner - dieselbe Quelle, die accounts.upsertOnFirstLogin
// (mintSession, POST /auth/dev-login) tatsaechlich beschreibt.
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
    // Kein Body -> devLoginEnabled-Shim faellt auf den Default-sub "dev-user" zurueck
    // (src/web-auth.js:324, identisch zu S2-15 oben).
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
  // P8/FMT-28: die P8-Abnahme "ein Login-Lauf legt einen Tenant mit gesetztem
  // country + timezone an" gehoert an genau diese eine Stelle (kein Duplikat-Test, G5).
  assert.notEqual(rows[0].timezone, null, "Web-Login-Pfad setzt tenant.timezone");
});
