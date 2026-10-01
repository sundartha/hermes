import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeAccounts, SESSION_COOKIE_NAME } from "../../src/web-auth.js";
import { tenantIdForSubject } from "../../src/store/defaults.js";
import { makePgTestStore } from "../pg-helpers.js";

const SIGNIERWERT = "negativtest";
const PUBLIC_URL = "https://hermes-negativtest.invalid";
const KUNDE = { sub: "negativtest-kunde", email: "kunde@negativtest.invalid" };
const ACTIVE = "active";
const STANDIN_DEPENDENCIES = [
  "callFinish lifecycle provisioning outboundGates callQuotaDenial requestTenant requireTenant",
  "conversationWatchdog ttsStore directiveSynth voiceRender costTruing messaging consultDelivery",
  "elevenLabsOutbound inboundBridges accountsRef auditStoreRef durableAuditFor",
].flatMap((line) => line.split(" "));

const standIn = new Proxy(function standIn() {}, {
  get: (_target, key) => (key === "then" ? undefined : standIn),
  apply: () => standIn,
});

async function silently(work) {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => {};
  try {
    return await work();
  } finally {
    Object.assign(console, { log, warn, error });
  }
}

async function configured(dataDir) {
  const { config } = await import("../../src/config.js");
  Object.assign(config.server, {
    dataDir,
    webDistDir: join(dataDir, "web"),
    publicUrl: PUBLIC_URL,
  });
  Object.assign(config.auth, { sessionSecret: SIGNIERWERT, devLoginEnabled: true });
  Object.assign(config.tenancy, { multiTenant: true, selfServiceEnabled: true });
  return config;
}

export async function startHermesMitAnmeldung(context) {
  const dataDir = mkdtempSync(join(tmpdir(), "hermes-anmeldung-"));
  const config = await configured(dataDir);
  const { store, runner } = await makePgTestStore();
  const { buildApp } = await import("../../src/app.js");
  config.store.storeBackend = "pg";
  const dependencies = {
    ...Object.fromEntries(STANDIN_DEPENDENCIES.map((name) => [name, standIn])),
    config,
    store,
    audit: () => {},
    createPortalRunner: async () => runner,
  };
  const { app } = await silently(() => buildApp(dependencies));
  const server = await new Promise((done) => {
    const listening = app.listen(0, "127.0.0.1", () => done(listening));
  });
  context.after(() => {
    server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, store, tenantId: tenantIdForSubject(KUNDE.sub), accounts: makeAccounts(runner) };
}

export async function anmelden(hermes) {
  const response = await fetch(`${hermes.url}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(KUNDE),
    redirect: "manual",
  });
  await hermes.accounts.setStatus(hermes.tenantId, ACTIVE);
  const cookie = response.headers
    .getSetCookie()
    .find((line) => line.startsWith(SESSION_COOKIE_NAME));
  return cookie.split(";")[0];
}
