import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState } from "../src/store/state-ops.js";

function throwingSaveStore(state) {
  return {
    load: () => state,
    save: () => {
      const err = new Error("EACCES: permission denied, open 'store.json.tmp'");
      err.code = "EACCES";
      throw err;
    },
    withStoreLock: (fn) => Promise.resolve().then(fn),
    resolveTenant: () => null,
  };
}

test("T-P1-05: Onboard-Save-Failure -> 503, Request resolved (kein unhandledRejection), Fehler geloggt", async () => {
  const state = makeDefaultState();
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store: throwingSaveStore(state),
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
  const base = `http://127.0.0.1:${server.address().port}`;

  let unhandled = null;
  const onUnhandled = (reason) => (unhandled = reason);
  process.once("unhandledRejection", onUnhandled);

  const origError = console.error;
  const errorLines = [];
  console.error = (...a) => errorLines.push(a.map(String).join(" "));

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    let res;
    try {
      res = await fetch(`${base}/api/onboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: "t-persist-fail" }),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    assert.equal(res.status, 503, "Persistenz-Fehler -> definierter 503");
    const body = await res.json();
    assert.match(body.error, /Persistenz fehlgeschlagen/, "klare, secret-freie Fehlermeldung");
    assert.equal(unhandled, null, "kein unhandledRejection-Ereignis (Request resolved sauber)");
    assert.ok(
      errorLines.some((l) => l.includes("[onboard] Persistenz fehlgeschlagen")),
      "Fehler ist geloggt (mem/disk-Divergenz sichtbar)",
    );
  } finally {
    console.error = origError;
    process.removeListener("unhandledRejection", onUnhandled);
    await new Promise((r) => server.close(r));
  }
});
