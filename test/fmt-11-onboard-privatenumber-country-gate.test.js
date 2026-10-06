import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState } from "../src/store/state-ops.js";

async function startOnboardApp() {
  const state = makeDefaultState();
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
      config: withConfigNamespaces({
        maxNumbers: 5,
        maxNumbersPerTenant: 1,
        provisioningEnabled: false,
        provisioningCountry: "DE",
        forceNumberCountry: "",
        geoEnabled: false,
        defaultTenantBudgetCents: 0,
      }),
      audit: () => {},
      provisioning: {
        queueProvisioning: async () => ({ ok: true, jobId: "job_test1" }),
        runProvisioningDrainExclusive: async () => {},
      },
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

const postJson = (app, body) =>
  fetch(`${app.base}/api/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("Onboarding: country=US + passende +1-Nummer passiert das private-Nummer-Gate (ex FMT-11)", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, {
      tenantId: "t_fmt11",
      country: "US",
      privateNumber: "+12025550123",
    });
    const json = await res.json();
    assert.notEqual(
      res.status,
      400,
      `country=US + passende +1-Nummer darf nicht am +49-Default-Gate scheitern (war ${res.status}, error=${json?.error})`,
    );
  } finally {
    await app.close();
  }
});
