import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { startServer, seedState, startIdp } from "./helpers.js";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState, tenantActiveSubscriber } from "../src/store/state-ops.js";
import { KYC_LEVEL, NUMBER_STATUS } from "../src/store/defaults.js";

function subscriberTenant(id, idpSubject) {
  return { id, status: "active", idpSubject, ownerName: `${id} Tester`, kycLevel: KYC_LEVEL.CARD };
}

function neverCalledProvisioning() {
  return {
    triggerTenantProvisioning: async () => {
      throw new Error("triggerTenantProvisioning darf hier NIE aufgerufen werden (Geld-Safety-Guard davor)");
    },
  };
}

function fixedResultProvisioning(result) {
  return { triggerTenantProvisioning: async () => result };
}

async function startRetryApp({ state, provisioning }) {
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store: {
        load: () => state,
        save: () => {},
        withStoreLock: (fn) => Promise.resolve().then(fn),
        resolveTenant: () => null,
        tenantActiveSubscriber: (tenantId, minLevel) => tenantActiveSubscriber(state, tenantId, minLevel),
      },
      config: withConfigNamespaces({
        maxNumbers: 100,
        maxNumbersPerTenant: 100,
        provisioningEnabled: false,
        provisioningCountry: "DE",
        forceNumberCountry: "",
        geoEnabled: false,
        defaultTenantBudgetCents: 0,
      }),
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
    close: () => new Promise((r) => server.close(r)),
  };
}

const retryInProcess = (app, body) =>
  fetch(`${app.base}/api/onboard/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("(a) active subscriber ohne Nummer -> 200 dry_run + numberId", async () => {
  const state = { ...makeDefaultState(), tenants: [subscriberTenant("t_retry", "sub-r")] };
  const app = await startRetryApp({
    state,
    provisioning: fixedResultProvisioning({ ok: true, numberId: "num_dryrun1", reason: "dry_run" }),
  });
  try {
    const res = await retryInProcess(app, { tenantId: "t_retry" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.reason, "dry_run", "PROVISIONING_ENABLED aus -> Dry-Run, kein echter Kauf");
    assert.ok(json.numberId, "eine 'requested' Nummer wurde angefragt");
  } finally {
    await app.close();
  }
});

test("(b) Tenant mit lebender Nummer -> 409 already_provisioned", async () => {
  const state = {
    ...makeDefaultState(),
    tenants: [subscriberTenant("t_live", "sub-l")],
    numbers: [
      { id: "n_live", tenantId: "t_live", status: NUMBER_STATUS.ACTIVE, e164: "+4915123000001", provider: "telnyx" },
    ],
  };
  const app = await startRetryApp({
    state,
    provisioning: fixedResultProvisioning({ ok: false, reason: "already_provisioned" }),
  });
  try {
    const res = await retryInProcess(app, { tenantId: "t_live" });
    assert.equal(res.status, 409);
  } finally {
    await app.close();
  }
});

test("(c) suspendierter/unbekannter Tenant -> 403 (Geld-Safety, kein Kauf)", async () => {
  const state = {
    ...makeDefaultState(),
    tenants: [{ id: "t_susp", status: "suspended", idpSubject: "sub-s", ownerName: "S", kycLevel: KYC_LEVEL.CARD }],
  };
  const app = await startRetryApp({ state, provisioning: neverCalledProvisioning() });
  try {
    assert.equal((await retryInProcess(app, { tenantId: "t_susp" })).status, 403, "suspendiert -> 403");
    assert.equal((await retryInProcess(app, { tenantId: "t_unknown" })).status, 403, "unbekannt -> 403");
  } finally {
    await app.close();
  }
});

const PW = "retry-secret";

const env = (idp) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: idp.issuer,
  MULTI_TENANT: "true",
  DASHBOARD_PASSWORD: PW,
  MAX_NUMBERS: "100",
  MAX_NUMBERS_PER_TENANT: "100",
});

const retry = (srv, body, headers = {}) =>
  fetch(`${srv.localUrl}/api/onboard/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("(d) proxied ohne Admin-Sitzung -> 404 (Route ohne operatorAuth nicht gemountet)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: env(idp),
    seed: seedState({ tenants: [subscriberTenant("t_auth", "sub-a")] }),
  });
  try {
    const res = await retry(srv, { tenantId: "t_auth" }, { "X-Forwarded-For": "1.2.3.4" });
    assert.equal(res.status, 404);
  } finally {
    await srv.stop();
    await idp.close();
  }
});
