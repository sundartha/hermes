// F1 Geo-Location (Phase 6) - Onboard-Wiring: Land/Sprache bei der Registrierung
// landen auf tenant (country/defaultLanguage) UND number-Request (country/language).
// Die pg-Persistenz DERSELBEN Felder ist in f1-geo-store.test.js (pglite-Roundtrip)
// abgedeckt (R12: beide Backends ueber die Suite).
//
// Der IP-Geo-VORSCHLAG laeuft im Default (GEO_ENABLED aus) ueber den Null-Adapter und
// der maxmind-Adapter ist heute fail-safe null (Dep-Regel) - der IP->Land-Pfad ist
// daher per Stub UNIT-getestet (resolveOnboardCountry/makeStubGeoLookup in
// f1-geo-port.test.js). Hier wird der AUTORITATIVE User-Override (body.country) end-to-
// end persistiert und der Fallback-Pfad (kein body.country -> DE/de byte-identisch).
//
// AUTH-P6: /api/onboard ist seither eine Betreiber-Route (webAuthMw+adminMw, nur MIT
// operatorAuth gemountet) - ein echter Spawn-Server (json/kein SESSION_SECRET) mountet
// sie darum gar nicht mehr. Migriert auf In-Process-Mount von makeOnboardRoutes (Muster
// onboarding-route.test.js). Die vormaligen Env-Schalter (GEO_ENABLED,
// PROVISIONING_COUNTRY, FORCE_NUMBER_COUNTRY) werden zu Feldern des Config-Doubles.
// Router pro Test frisch gebaut (nicht pro Datei) - geoLookupAdapter() wird bei der
// Router-Konstruktion in makeOnboardRoutes gebaut.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState } from "../src/store/state-ops.js";
import { DEFAULT_COUNTRY, setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";

// BASE_ENV pinnte WORLD_DEFAULT_LANGUAGE_ENABLED=true (Spawn-Server, s. Bestand). Ohne
// Spawn liest config.js beim Import den PROZESS-ECHTEN Env-Wert (hier unbekannt/unset)
// und drueckt ihn beim Laden EINMAL in defaults.js (setWorldDefaultLanguageEnabled,
// Wiring-Kommentar dort) - der Code-Default "en" wuerde dadurch sonst still auf "de"
// zurueckfallen. Direkt gesetzt (dieselbe Funktion, die config.js beim Boot ruft):
// keine Env-Var-vor-Import-Choreografie noetig (Muster
// test/p10-world-default-language-switch.test.js, Achse A).
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

// User-Wahl (body.country=FR) ist autoritativ (R4): FR/fr landen auf Tenant + Number.
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

// GB -> en (zweite Sprache, beweist die generische Tabelle ueber DE/FR hinaus).
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

// LANG-23 (tasks/i18n-tests/01-sprachaufloesung.md, Nebenlaeufigkeit): zwei gleichzeitige
// Onboardings duerfen sich nicht vermischen. registerTenant -> setTenantGeo ->
// requestNumber -> save laufen in EINEM withStoreLock-Abschnitt ohne fremdes await
// dazwischen (src/store.js, src/routes/api-onboard.js). Promise.all statt sequenziell -
// sequenziell wuerde die Invariante gar nicht beruehren.
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

// LAW-22 (tasks/i18n-tests/09-recht-und-compliance.md, Nebenlaeufigkeit): zwei
// gleichzeitige US-Onboards. Abgrenzung zu LANG-23 daneben (kein Duplikat, G5): dort
// verschiedene Laender - der Sprach-Mix ist die Sonde. Bei IDENTISCHEM Land waere ein
// Cross-Talk in der Sprache gar nicht sichtbar; die pruefbare Isolation ist hier die
// RECORD-Identitaet (zwei Tenants, zwei verschiedene Nummern, kein Ueberschreiben).
// R-G: die Katalog-Erwartung "je isoliert DE-Sprache" ist seit P10 falsch - US -> "en".
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

// Geo aus (Default) + kein body.country -> Fallback DE/de (byte-identisch zum Bestand).
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

// Ungueltiges/gespooftes country-Feld -> ignoriert, fail-safe Fallback DE (kein Muell
// im Store, keine Allowlist-Lockerung). Beweist: nichts Autoritatives durch Eingabe-Muell.
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

// PROVISIONING_COUNTRY als Fallback (ohne body.country, Geo aus): Onboard erbt das
// konfigurierte Land statt hart DE. Beweist die Praezedenz-Stufe config-Fallback.
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

// Beleg: src/routes/api-onboard.js:141-152,168,172-173; src/i18n/locales.js:268-280;
// tasks/i18n-tests/06-nummern-provisioning.md ("DID-02"). A3-Migration (P10): US ist
// nicht eigens in LANGUAGE_FOR_COUNTRY eingetragen (bewusst) - der Weltdefault traegt
// US mit (languageForCountry("US") -> "en").
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

// FORCE_NUMBER_COUNTRY=US: das KAUF-Land ist entkoppelt vom Herkunftsland. Ein DE-User
// bekommt eine US-Nummer (number.country=US), aber die Sprache bleibt am Herkunftsland
// (de): number.language=de, tenant.country/defaultLanguage=DE/de (Quelle fuer Sprache/
// Analytics). Beweist: Geo-/Sprach-Erkennung bleibt aktiv, nur die Kauf-Land-Wahl wird
// neutralisiert. Laufzeit-Sprache liest number.language (resolveCallLanguage) -> de.
//
// Traegt zugleich LANG-06 des i18n-Launch-Testkatalogs (Welle W1, Mechanismus/gruen,
// Spezifikation in tasks/i18n-tests/01-sprachaufloesung.md): US-DID plus de-Sprache bleibt
// gepinnt, damit die bewusste Entkopplung von Kauf-Land und Sprache nicht lautlos kippt.
// Deshalb EINMAL hier (G5) statt als zweite Fassung in einer eigenen Datei.
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
