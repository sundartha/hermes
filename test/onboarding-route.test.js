import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { OWNER_TEST_NUMBER } from "./helpers.js";

const postJson = (app, path, body) =>
  fetch(`${app.base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function baseState() {
  const state = makeDefaultState();
  state.numbers.push({
    id: "num_owner_seed",
    e164: OWNER_TEST_NUMBER.e164,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: OWNER_TEST_NUMBER.provider,
    status: "active",
    providerNumberId: null,
  });
  return state;
}

function onboardConfig(overrides = {}) {
  return withConfigNamespaces({
    maxNumbers: 5,
    maxNumbersPerTenant: 1,
    provisioningEnabled: false,
    provisioningCountry: "DE",
    forceNumberCountry: "",
    geoEnabled: false,
    defaultTenantBudgetCents: 0,
    ...overrides,
  });
}

function fakeProvisioning() {
  const calls = { queueProvisioning: [], drainRuns: 0 };
  return {
    calls,
    queueProvisioning: async (numberId, tenantId) => {
      calls.queueProvisioning.push({ numberId, tenantId });
      return { ok: true, jobId: "job_test1" };
    },
    runProvisioningDrainExclusive: async () => {
      calls.drainRuns++;
    },
  };
}

async function startOnboardApp({ state = baseState(), config = onboardConfig(), provisioning = fakeProvisioning() } = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store: {
        load: () => state,
        save: () => {},
        withStoreLock: (fn) => Promise.resolve().then(fn),
        resolveTenant: () => null,
      },
      config,
      audit: () => {},
      provisioning,
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    state,
    provisioning,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function waitForDrainRun(app, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (app.provisioning.calls.drainRuns < 1) {
    if (Date.now() > deadline) throw new Error("runProvisioningDrainExclusive wurde nicht angestossen");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("Dry-Run (Default): onboard registriert + fragt an, Nummer bleibt 'requested', KEIN Geld", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, "/api/onboard", { tenantId: "t_user1" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, "requested");
    assert.equal(json.provisioning, "disabled");
    assert.ok(
      app.state.tenants.find((t) => t.id === "t_user1"),
      "Tenant registriert",
    );
    const num = app.state.numbers.find((n) => n.id === json.numberId);
    assert.equal(num.status, "requested");
    assert.equal(num.e164, null, "requested Nummer hat keine e164 (kein Kauf)");
    assert.equal(num.tenantId, "t_user1");
    assert.deepEqual(app.provisioning.calls.queueProvisioning, [], "Dry-Run ruft das Provisioning-Double nie");
  } finally {
    await app.close();
  }
});

const TENANT_ID_REQUIRED_MESSAGE = "tenantId ist Pflicht (nicht leer, ohne Whitespace, <=254 Zeichen)";

test("Fehlende tenantId -> 400 mit dem geteilten requireValidTenantId-Text (POST /api/onboard)", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, "/api/onboard", {});
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, TENANT_ID_REQUIRED_MESSAGE);
  } finally {
    await app.close();
  }
});

test("Fehlende tenantId -> 400 mit demselben Text wie /api/onboard (POST /api/onboard/retry)", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, "/api/onboard/retry", {});
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, TENANT_ID_REQUIRED_MESSAGE);
  } finally {
    await app.close();
  }
});

test("Globaler Cap (Kosten-Notbremse) blockt -> 429", async () => {
  const app = await startOnboardApp({ config: onboardConfig({ maxNumbers: 1 }) });
  try {
    const res = await postJson(app, "/api/onboard", { tenantId: "t_user1" });
    assert.equal(res.status, 429);
  } finally {
    await app.close();
  }
});

test("Per-Tenant-Cap blockt die zweite Nummer desselben Tenants -> 409", async () => {
  const app = await startOnboardApp({ config: onboardConfig({ maxNumbers: 10, maxNumbersPerTenant: 1 }) });
  try {
    assert.equal((await postJson(app, "/api/onboard", { tenantId: "t_user1" })).status, 200);
    const second = await postJson(app, "/api/onboard", { tenantId: "t_user1" });
    assert.equal(second.status, 409);
  } finally {
    await app.close();
  }
});

test("S1-9a: ungueltige privateNumber -> 400, kein persist_error-503", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, "/api/onboard", { tenantId: "t_pn", privateNumber: "not-a-number" });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /privateNumber ungueltig/);
  } finally {
    await app.close();
  }
});

test("S1-9b: gueltige privateNumber -> 200 (Dry-Run), Nummer wird am Tenant persistiert", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, "/api/onboard", { tenantId: "t_pn2", privateNumber: "+4915112345678" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, "requested");
    assert.equal(json.provisioning, "disabled");
    const tenant = app.state.tenants.find((t) => t.id === "t_pn2");
    assert.equal(tenant.privateNumber, "+4915112345678");
  } finally {
    await app.close();
  }
});

test("PROVISIONING_ENABLED: Route antwortet SOFORT 'queued', queueProvisioning bekommt numberId+tenantId, Drain angestossen", async () => {
  const app = await startOnboardApp({ config: onboardConfig({ provisioningEnabled: true, maxNumbers: 10 }) });
  try {
    const res = await postJson(app, "/api/onboard", { tenantId: "t_user1" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, "requested");
    assert.equal(json.provisioning, "queued");
    assert.equal(json.jobId, "job_test1");

    assert.deepEqual(app.provisioning.calls.queueProvisioning, [
      { numberId: json.numberId, tenantId: "t_user1" },
    ]);
    await waitForDrainRun(app);
  } finally {
    await app.close();
  }
});
