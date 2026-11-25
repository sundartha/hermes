import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { makeOnboardRoutes } from "../../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "../operator-route-app.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { resolveOnboardCountry, timezoneForCountry } from "../../src/geo/resolve.ts";
import { makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

async function startApp() {
  const { store } = await makePgTestStore();
  const config = withConfigNamespaces({
    maxNumbers: 5,
    maxNumbersPerTenant: 1,
    provisioningEnabled: false,
    provisioningCountry: "AT",
    forceNumberCountry: "",
    geoEnabled: false,
    defaultTenantBudgetCents: 0,
  });
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store,
      config,
      audit: () => {},
      provisioning: {
        queueProvisioning: async () => ({ ok: true, jobId: "job_x" }),
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

const post = (app, body) =>
  abrufMitFrist(`${app.base}/api/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("POST /api/onboard: country als Liste mit Ländercode ergibt das konfigurierte Rückfall-Land, nicht FR", async () => {
  const app = await startApp();
  try {
    const res = await post(app, { tenantId: "t_liste", country: ["fr"] });
    assert.equal((await res.json()).country, "AT");
  } finally {
    await app.close();
  }
});

test("POST /api/onboard: country als Text wird weiter übernommen", async () => {
  const app = await startApp();
  try {
    const res = await post(app, { tenantId: "t_text", country: " fr " });
    assert.equal((await res.json()).country, "FR");
  } finally {
    await app.close();
  }
});

test("resolveOnboardCountry: Reihenfolge Eingabe, Vorschlag, Rückfall, Standard", () => {
  const faelle = [
    [{ userCountry: "fr", proposedCountry: "AT", fallbackCountry: "US" }, "FR"],
    [{ userCountry: "x", proposedCountry: "at", fallbackCountry: "US" }, "AT"],
    [{ userCountry: null, proposedCountry: undefined, fallbackCountry: "US" }, "US"],
    [{ userCountry: 49, proposedCountry: ["at"] }, "DE"],
    [{ fallbackCountry: "" }, "DE"],
    [undefined, "DE"],
  ];
  for (const [eingabe, erwartet] of faelle) assert.equal(resolveOnboardCountry(eingabe), erwartet);
});

test("timezoneForCountry: bekannte Länder, unbekannte und leere Werte fallen auf die Standard-Zeitzone", () => {
  assert.equal(timezoneForCountry("at"), timezoneForCountry("AT"));
  const standard = timezoneForCountry("ZZ");
  assert.equal(timezoneForCountry(null), standard);
  assert.equal(timezoneForCountry(undefined), standard);
  assert.equal(timezoneForCountry(""), standard);
  assert.notEqual(timezoneForCountry("US"), standard);
});
