// OT-3 (P1) AC4: POST /api/onboard behandelt einen Save-I/O-Fehler als definierten
// 5xx (503), NICHT als unhandled async rejection.
//
// AUTH-P6: /api/onboard ist seither eine Betreiber-Route (webAuthMw+adminMw, nur MIT
// operatorAuth gemountet) - migriert auf In-Process-Mount von makeOnboardRoutes mit
// einem Store-Double, dessen save() wirft (Muster onboarding-route.test.js). Die 503-
// und Fehlertext-Zusagen bleiben WORTGLEICH gepinnt; die Zusage "Prozess lebt weiter"
// (vormals srv.child.exitCode) wird zu "der Request resolved, KEIN unhandledRejection-
// Ereignis auf diesem Prozess" (Coverage-Delta C, AUTH-P6-Report) - der Prozess-/Boot-
// Aspekt bleibt in den uebrigen Spawn-Tests gedeckt.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState } from "../src/store/state-ops.js";

// Store-Double, dessen save() IMMER wirft (Muster: das echte atomic-save wirft EACCES
// bei einem schreibgeschuetzten DATA_DIR). withStoreLock bleibt async (Muster real:
// Promise-basiert), damit der Wurf im .then-Callback zur Rejection wird, die der
// Aufrufer (api-onboard.js) faengt - genau der Pfad, den dieser Test beweist.
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

  // Kein unhandledRejection auf DIESEM Prozess waehrend des Requests - der Beweis, dass
  // der Save-Wurf gefangen und in einen definierten 503 uebersetzt wird, statt als
  // unbehandelte Rejection durchzuschlagen (der Wurf-und-Prozess-lebt-Beweis der
  // vormaligen Spawn-Version).
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
