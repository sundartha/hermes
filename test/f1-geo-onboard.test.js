import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState } from "../src/store/state-ops.js";
import { DEFAULT_COUNTRY, setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";

setWorldDefaultLanguageEnabled(true);

function onboardConfig(overrides = {}) {
  return withConfigNamespaces({
    maxNumbers: 20,
    maxNumbersPerTenant: 5,
    provisioningEnabled: false,
    provisioningCountry: "DE",
    forceNumberCountry: "",
    geoEnabled: false,
    defaultTenantBudgetCents: 0,
    ...overrides,
  });
}

async function startOnboardApp({ state = makeDefaultState(), config = onboardConfig() } = {}) {
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
    state,
    close: () => new Promise((r) => server.close(r)),
  };
}

const postJson = (app, body) =>
  fetch(`${app.base}/api/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("Onboard mit body.country=FR -> tenant.country/defaultLanguage UND number.country/language = FR/fr", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, { tenantId: "t_fr", country: "FR" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.country, "FR");
    assert.equal(json.language, "fr");

    const tenant = app.state.tenants.find((t) => t.id === "t_fr");
    assert.equal(tenant.country, "FR", "tenant.country persistiert");
    assert.equal(tenant.defaultLanguage, "fr", "tenant.defaultLanguage persistiert");
    const num = app.state.numbers.find((n) => n.id === json.numberId);
    assert.equal(num.country, "FR", "number.country persistiert");
    assert.equal(num.language, "fr", "number.language persistiert");
  } finally {
    await app.close();
  }
});

test("Onboard mit body.country=GB -> en (country->language-Tabelle generisch)", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, { tenantId: "t_gb", country: "gb" });
    const json = await res.json();
    assert.equal(json.country, "GB", "case-insensitiv normalisiert");
    assert.equal(json.language, "en");
    assert.equal(app.state.tenants.find((t) => t.id === "t_gb").defaultLanguage, "en");
    assert.equal(app.state.numbers.find((n) => n.id === json.numberId).language, "en");
  } finally {
    await app.close();
  }
});

test("LANG-23 (Mechanismus, gruen) - parallele Onboards bleiben isoliert (kein Geo-/Sprach-Mix)", async () => {
  const app = await startOnboardApp();
  try {
    const [frRes, gbRes] = await Promise.all([
      postJson(app, { tenantId: "t_par_fr", country: "FR" }),
      postJson(app, { tenantId: "t_par_gb", country: "GB" }),
    ]);
    assert.equal(frRes.status, 200);
    assert.equal(gbRes.status, 200);
    const frJson = await frRes.json();
    const gbJson = await gbRes.json();
    assert.equal(frJson.language, "fr");
    assert.equal(gbJson.language, "en");

    assert.equal(app.state.tenants.find((t) => t.id === "t_par_fr").defaultLanguage, "fr");
    assert.equal(app.state.tenants.find((t) => t.id === "t_par_gb").defaultLanguage, "en");
    const frNum = app.state.numbers.find((n) => n.id === frJson.numberId);
    const gbNum = app.state.numbers.find((n) => n.id === gbJson.numberId);
    assert.equal(frNum.language, "fr");
    assert.equal(gbNum.language, "en");
    assert.notEqual(frJson.numberId, gbJson.numberId, "keine geteilte Nummer zwischen den Tenants");
  } finally {
    await app.close();
  }
});

test("LAW-22 (Mechanismus, gruen) - zwei parallele US-Onboards bleiben isoliert (je US/en, eigene Nummer)", async () => {
  const app = await startOnboardApp();
  try {
    const [resA, resB] = await Promise.all([
      postJson(app, { tenantId: "t_us_par_a", country: "US" }),
      postJson(app, { tenantId: "t_us_par_b", country: "US" }),
    ]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    const [jsonA, jsonB] = await Promise.all([resA.json(), resB.json()]);
    for (const json of [jsonA, jsonB]) {
      assert.equal(json.country, "US");
      assert.equal(json.language, "en");
    }
    for (const id of ["t_us_par_a", "t_us_par_b"]) {
      const tenant = app.state.tenants.find((t) => t.id === id);
      assert.ok(tenant, `${id} ist angelegt (kein Record ging im Rennen verloren)`);
      assert.equal(tenant.country, "US");
      assert.equal(tenant.defaultLanguage, "en");
    }
    assert.notEqual(jsonA.numberId, jsonB.numberId, "keine geteilte Nummer zwischen den beiden Tenants");
  } finally {
    await app.close();
  }
});

test("Onboard ohne country (Geo aus) -> Fallback DE/de (byte-identisch)", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, { tenantId: "t_de" });
    const json = await res.json();
    assert.equal(json.country, DEFAULT_COUNTRY);
    assert.equal(json.language, "de");
    const tenant = app.state.tenants.find((t) => t.id === "t_de");
    assert.equal(tenant.country, "DE");
    assert.equal(tenant.defaultLanguage, "de");
    assert.equal(app.state.numbers.find((n) => n.id === json.numberId).language, "de");
  } finally {
    await app.close();
  }
});

test("Onboard mit ungueltigem country -> ignoriert, Fallback DE/de (fail-safe)", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, { tenantId: "t_junk", country: "ZZZ!" });
    const json = await res.json();
    assert.equal(json.country, DEFAULT_COUNTRY);
    assert.equal(json.language, "de");
    assert.equal(app.state.tenants.find((t) => t.id === "t_junk").country, "DE");
  } finally {
    await app.close();
  }
});

test("Onboard ohne country erbt PROVISIONING_COUNTRY (Fallback-Stufe) -> FR/fr", async () => {
  const app = await startOnboardApp({ config: onboardConfig({ provisioningCountry: "FR" }) });
  try {
    const res = await postJson(app, { tenantId: "t_cfg" });
    const json = await res.json();
    assert.equal(json.country, "FR");
    assert.equal(json.language, "fr");
  } finally {
    await app.close();
  }
});

test("Onboard mit body.country=US -> tenant/number.language = 'en' (ueber den Weltdefault) (ex DID-02)", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, { tenantId: "t_us", country: "US" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.country, "US");
    assert.equal(json.language, "en");

    const tenant = app.state.tenants.find((t) => t.id === "t_us");
    assert.equal(tenant.country, "US", "tenant.country persistiert");
    assert.equal(tenant.defaultLanguage, "en", "tenant.defaultLanguage persistiert");
    const num = app.state.numbers.find((n) => n.id === json.numberId);
    assert.equal(num.country, "US", "number.country persistiert");
    assert.equal(num.language, "en", "number.language persistiert");
  } finally {
    await app.close();
  }
});

test("FORCE_NUMBER_COUNTRY=US: number.country US, Sprache + tenant am Herkunftsland (DE)", async () => {
  const app = await startOnboardApp({ config: onboardConfig({ forceNumberCountry: "US" }) });
  try {
    const res = await postJson(app, { tenantId: "t_force", country: "DE" });
    const json = await res.json();
    assert.equal(json.country, "DE", "Antwort meldet das Herkunftsland");
    assert.equal(json.language, "de", "Sprache am Herkunftsland");
    const tenant = app.state.tenants.find((t) => t.id === "t_force");
    assert.equal(tenant.country, "DE", "tenant.country = Herkunftsland (nicht US)");
    assert.equal(tenant.defaultLanguage, "de");
    const num = app.state.numbers.find((n) => n.id === json.numberId);
    assert.equal(num.country, "US", "number.country = erzwungenes Kauf-Land");
    assert.equal(num.language, "de", "number.language bleibt Herkunftssprache");
  } finally {
    await app.close();
  }
});
