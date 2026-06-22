// F1 Geo-Location (Phase 6) - Onboard-Wiring: Land/Sprache bei der Registrierung
// landen auf tenant (country/defaultLanguage) UND number-Request (country/language).
// Server-Kindprozess (json-Backend, kein pglite -> kein Test-Worker-Stall); die
// pg-Persistenz DERSELBEN Felder ist in f1-geo-store.test.js (pglite-Roundtrip)
// abgedeckt (R12: beide Backends ueber die Suite).
//
// Der IP-Geo-VORSCHLAG laeuft im Default (GEO_ENABLED aus) ueber den Null-Adapter und
// der maxmind-Adapter ist heute fail-safe null (Dep-Regel) - der IP->Land-Pfad ist
// daher per Stub UNIT-getestet (resolveOnboardCountry/makeStubGeoLookup in
// f1-geo-port.test.js). Hier wird der AUTORITATIVE User-Override (body.country) end-to-
// end persistiert und der Fallback-Pfad (kein body.country -> DE/de byte-identisch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { DEFAULT_COUNTRY, DEFAULT_LANGUAGE } from "../src/store/defaults.js";

const postJson = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// User-Wahl (body.country=FR) ist autoritativ (R4): FR/fr landen auf Tenant + Number.
test("Onboard mit body.country=FR -> tenant.country/defaultLanguage UND number.country/language = FR/fr", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_fr", country: "FR" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.country, "FR");
    assert.equal(json.language, "fr");

    const store = srv.readStore();
    const tenant = store.tenants.find((t) => t.id === "t_fr");
    assert.equal(tenant.country, "FR", "tenant.country persistiert");
    assert.equal(tenant.defaultLanguage, "fr", "tenant.defaultLanguage persistiert");
    const num = store.numbers.find((n) => n.id === json.numberId);
    assert.equal(num.country, "FR", "number.country persistiert");
    assert.equal(num.language, "fr", "number.language persistiert");
  } finally {
    await srv.stop();
  }
});

// GB -> en (zweite Sprache, beweist die generische Tabelle ueber DE/FR hinaus).
test("Onboard mit body.country=GB -> en (country->language-Tabelle generisch)", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_gb", country: "gb" });
    const json = await res.json();
    assert.equal(json.country, "GB", "case-insensitiv normalisiert");
    assert.equal(json.language, "en");
    const store = srv.readStore();
    assert.equal(store.tenants.find((t) => t.id === "t_gb").defaultLanguage, "en");
    assert.equal(store.numbers.find((n) => n.id === json.numberId).language, "en");
  } finally {
    await srv.stop();
  }
});

// Geo aus (Default) + kein body.country -> Fallback DE/de (byte-identisch zum Bestand).
test("Onboard ohne country (Geo aus) -> Fallback DE/de (byte-identisch)", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_de" });
    const json = await res.json();
    assert.equal(json.country, DEFAULT_COUNTRY);
    assert.equal(json.language, DEFAULT_LANGUAGE);
    const store = srv.readStore();
    const tenant = store.tenants.find((t) => t.id === "t_de");
    assert.equal(tenant.country, "DE");
    assert.equal(tenant.defaultLanguage, "de");
    assert.equal(store.numbers.find((n) => n.id === json.numberId).language, "de");
  } finally {
    await srv.stop();
  }
});

// Ungueltiges/gespooftes country-Feld -> ignoriert, fail-safe Fallback DE (kein Muell
// im Store, keine Allowlist-Lockerung). Beweist: nichts Autoritatives durch Eingabe-Muell.
test("Onboard mit ungueltigem country -> ignoriert, Fallback DE/de (fail-safe)", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_junk", country: "ZZZ!" });
    const json = await res.json();
    assert.equal(json.country, DEFAULT_COUNTRY);
    assert.equal(json.language, DEFAULT_LANGUAGE);
    assert.equal(srv.readStore().tenants.find((t) => t.id === "t_junk").country, "DE");
  } finally {
    await srv.stop();
  }
});

// PROVISIONING_COUNTRY als Fallback (ohne body.country, Geo aus): Onboard erbt das
// konfigurierte Land statt hart DE. Beweist die Praezedenz-Stufe config-Fallback.
test("Onboard ohne country erbt PROVISIONING_COUNTRY (Fallback-Stufe) -> FR/fr", async () => {
  const srv = await startServer({ env: { PROVISIONING_COUNTRY: "FR" } });
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_cfg" });
    const json = await res.json();
    assert.equal(json.country, "FR");
    assert.equal(json.language, "fr");
  } finally {
    await srv.stop();
  }
});
