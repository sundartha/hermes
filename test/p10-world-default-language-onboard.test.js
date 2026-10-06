import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";
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

test("WORLD_DEFAULT_LANGUAGE_ENABLED=true (Default): Onboard mit country=ES -> language=en", async () => {
  setWorldDefaultLanguageEnabled(true);
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, { tenantId: "t_es_on", country: "ES" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.language, "en");
  } finally {
    await app.close();
  }
});

test("WORLD_DEFAULT_LANGUAGE_ENABLED=false: Onboard mit country=ES -> language=de (Rueckflip ohne Deploy)", async () => {
  setWorldDefaultLanguageEnabled(false);
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, { tenantId: "t_es_off", country: "ES" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.language, "de", "Schalter aus -> Vor-Flip-Verhalten, kein Deploy noetig");
  } finally {
    setWorldDefaultLanguageEnabled(true);
    await app.close();
  }
});
