import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, adminOnly, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeBillingRoutes } from "../src/routes/api-billing.js";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState, registerTenant, tenantActiveSubscriber, platformTtsUsageView } from "../src/store/state-ops.js";
import { TENANT_STATUS, KYC_LEVEL } from "../src/store/defaults.js";

const SECRET = "auth-p6-web-secret-0123456789";
const ADMIN_EMAILS = ["admin@x"];

const PROBE_TENANT_ID = "t_p6_probe";
const RETRY_TENANT_ID = "t_p6_retry";
const OPERATOR_ROUTES = [
  { method: "POST", path: "/api/onboard", body: { tenantId: PROBE_TENANT_ID } },
  { method: "POST", path: "/api/onboard/retry", body: { tenantId: RETRY_TENANT_ID } },
  { method: "POST", path: "/api/billing/flush-meters", body: {} },
  { method: "POST", path: "/api/billing/cost-truing/sweep", body: {} },
  { method: "GET", path: "/api/billing/cost-drift" },
  { method: "GET", path: "/api/billing/platform-costs" },
];

const OPERATOR_CONFIG = withConfigNamespaces({
  paymentEnabled: true,
  maxNumbers: 10,
  maxNumbersPerTenant: 5,
  provisioningEnabled: false,
  provisioningCountry: "DE",
  forceNumberCountry: "",
  geoEnabled: false,
  defaultTenantBudgetCents: 0,
  numberMonthlyCostCents: 92,
  platformFixedCostUsdCentsPerMonth: 600,
  ttsCharacterQuota: 39981,
  ttsCharacterQuotaWarnPercent: 0,
  ttsQuotaCycleAnchorDay: 1,
  voiceTariffDomesticPrefixes: ["+49", "+33", "+44"],
  voiceTariffDomesticCents: 0,
  providerToBucketRateMicro: 920000,
  costCalibrationMinSamples: 20,
  costDriftWarnPercent: 50,
});

async function setup() {
  const { db, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  await accounts.upsertOnFirstLogin({ sub: "admin1", email: "admin@x" });
  await accounts.setStatus("t_admin1", "active");
  const adminSession = (
    await sessions.create({ sub: "admin1", tenantId: "t_admin1", ttlSeconds: 3600 })
  ).id;

  await accounts.upsertOnFirstLogin({ sub: "adminrole1", email: "adminrole@x" });
  await accounts.setStatus("t_adminrole1", "active");
  await accounts.setRole("adminrole@x", "admin");
  const adminRoleSession = (
    await sessions.create({ sub: "adminrole1", tenantId: "t_adminrole1", ttlSeconds: 3600 })
  ).id;

  await accounts.upsertOnFirstLogin({ sub: "cust1", email: "cust@x" });
  await accounts.setStatus("t_cust1", "active");
  const custSession = (
    await sessions.create({ sub: "cust1", tenantId: "t_cust1", ttlSeconds: 3600 })
  ).id;

  const operatorAuth = {
    webAuthMw: webAuth({ secret: SECRET, sessions, accounts }),
    adminMw: adminOnly({ adminEmails: ADMIN_EMAILS }),
  };

  const state = makeDefaultState();
  registerTenant(state, RETRY_TENANT_ID, { country: "DE" });
  const retryTenant = state.tenants.find((t) => t.id === RETRY_TENANT_ID);
  retryTenant.status = TENANT_STATUS.ACTIVE;
  retryTenant.kycLevel = KYC_LEVEL.CARD;

  const store = {
    state,
    load: () => state,
    save: () => {},
    withStoreLock: (fn) => Promise.resolve().then(fn),
    resolveTenant: () => null,
    tenantActiveSubscriber: (tenantId, minLevel) => tenantActiveSubscriber(state, tenantId, minLevel),
    platformTtsUsageView: (nowIso) => platformTtsUsageView(state, OPERATOR_CONFIG.billing, nowIso),
  };

  const billingDouble = { log: [] };
  const costTruingDouble = {
    calls: [],
    runCostTruingSweep: async ({ trigger }) => {
      costTruingDouble.calls.push(trigger);
      return {
        skipped: false,
        candidates: 0,
        coveragePercent: 0,
        measured: 0,
        incomplete: 0,
        noEstimate: 0,
        unavailable: 0,
        skippedCalls: 0,
        failed: 0,
      };
    },
  };
  const provisioningDouble = {
    log: [],
    queueProvisioning: async (numberId, tenantId) => {
      provisioningDouble.log.push(["queueProvisioning", numberId, tenantId]);
      return { ok: true, jobId: "job_p6" };
    },
    runProvisioningDrainExclusive: async () => {
      provisioningDouble.log.push(["drain"]);
    },
    triggerTenantProvisioning: async (tenantId) => {
      provisioningDouble.log.push(["retry", tenantId]);
      return { ok: true, numberId: "num_p6_retry", reason: "dry_run", jobId: "job_p6_retry" };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    makeBillingRoutes({
      config: OPERATOR_CONFIG,
      store,
      audit: () => {},
      billing: billingDouble,
      tenant: {},
      costTruing: costTruingDouble,
      operatorAuth,
    }),
  );
  app.use(
    makeOnboardRoutes({
      store,
      config: OPERATOR_CONFIG,
      audit: () => {},
      provisioning: provisioningDouble,
      operatorAuth,
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    db,
    state,
    billingDouble,
    costTruingDouble,
    provisioningDouble,
    adminSession,
    adminRoleSession,
    custSession,
    close: () => new Promise((r) => server.close(r)),
  };
}

function request(app, route, sessionId) {
  const headers = { "Content-Type": "application/json" };
  if (sessionId) headers.Cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(sessionId, SECRET))}`;
  return fetch(`${app.base}${route.path}`, {
    method: route.method,
    headers,
    ...(route.method === "GET" ? {} : { body: JSON.stringify(route.body || {}) }),
  });
}

async function assertNoSideEffects(app) {
  assert.ok(
    !app.state.tenants.some((t) => t.id === PROBE_TENANT_ID),
    "state.tenants enthaelt kein " + PROBE_TENANT_ID,
  );
  assert.deepEqual(app.billingDouble.log, [], "kein Billing-Double-Aufruf");
  assert.deepEqual(app.costTruingDouble.calls, [], "kein Sweep-Double-Aufruf");
  assert.deepEqual(app.provisioningDouble.log, [], "kein Provisioning-Double-Aufruf");
}

test("AUTH-P6-1: ohne Sitzung -> 401 auf allen sechs Routen, kein Basic-Challenge, keine Seiteneffekte", async () => {
  const app = await setup();
  try {
    for (const route of OPERATOR_ROUTES) {
      const res = await request(app, route, null);
      assert.equal(res.status, 401, `${route.method} ${route.path}`);
      assert.deepEqual(await res.json(), { error: "Unauthorized" }, `${route.method} ${route.path}`);
      assert.equal(
        res.headers.get("www-authenticate"),
        null,
        `${route.method} ${route.path}: das ist webAuthGateMiddleware, nicht das Basic-Auth-Gate`,
      );
    }
    await assertNoSideEffects(app);
  } finally {
    await app.close();
  }
});

test("AUTH-P6-2: aktive Nicht-Admin-Sitzung -> 403 auf allen sechs Routen, keine Seiteneffekte", async () => {
  const app = await setup();
  try {
    for (const route of OPERATOR_ROUTES) {
      const res = await request(app, route, app.custSession);
      assert.equal(res.status, 403, `${route.method} ${route.path}`);
      assert.deepEqual(await res.json(), { error: "Forbidden" }, `${route.method} ${route.path}`);
    }
    await assertNoSideEffects(app);
  } finally {
    await app.close();
  }
});

async function assertOperatorSuccess(app, sessionId) {
  for (const route of OPERATOR_ROUTES) {
    const res = await request(app, route, sessionId);
    assert.notEqual(res.status, 401, `${route.method} ${route.path}`);
    assert.notEqual(res.status, 403, `${route.method} ${route.path}`);
    assert.notEqual(res.status, 404, `${route.method} ${route.path}`);
    const json = await res.json();
    if (route.path === "/api/onboard") {
      assert.equal(res.status, 200);
      assert.equal(json.status, "requested");
      assert.equal(json.provisioning, "disabled");
    } else if (route.path === "/api/onboard/retry") {
      assert.equal(res.status, 200);
      assert.equal(json.numberId, "num_p6_retry");
    } else if (route.path === "/api/billing/flush-meters") {
      assert.equal(res.status, 200);
      assert.deepEqual(json, { sent: 0, failed: 0, skipped: 0, skipReason: "no_flush_epoch" });
    } else if (route.path === "/api/billing/cost-truing/sweep") {
      assert.equal(res.status, 200);
      assert.equal(typeof json.coveragePercent, "number");
    } else if (route.path === "/api/billing/cost-drift") {
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(json.prefixes));
    } else if (route.path === "/api/billing/platform-costs") {
      assert.equal(res.status, 200);
      assert.equal(json.currency, "EUR");
    }
  }
}

test("AUTH-P6-3: Admin per ADMIN_EMAILS-Allowlist -> Erfolg auf allen sechs Routen", async () => {
  const app = await setup();
  try {
    await assertOperatorSuccess(app, app.adminSession);
  } finally {
    await app.close();
  }
});

test("AUTH-P6-4: Admin per role='admin' (E-Mail NICHT in der Allowlist) -> Erfolg auf allen sechs Routen", async () => {
  const app = await setup();
  try {
    await assertOperatorSuccess(app, app.adminRoleSession);
  } finally {
    await app.close();
  }
});
