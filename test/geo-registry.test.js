// S1-15: geoLookupAdapter() waehlt den Geo-Lookup-Adapter config-getrieben (fail-closed
// analog telephony/registry.js). Identitaetsvergleich gegen nullGeoLookup in beiden
// Zweigen. config.provisioning.geoEnabled wird pro Test gesetzt/wiederhergestellt (Muster
// wie config.billing.stripeApiBase in stripe-setup-checkout.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { geoLookupAdapter } from "../src/geo/registry.js";
import { nullGeoLookup } from "../src/geo/stub.js";

function withGeoEnabled(value, fn) {
  const original = config.provisioning.geoEnabled;
  config.provisioning.geoEnabled = value;
  try {
    return fn();
  } finally {
    config.provisioning.geoEnabled = original;
  }
}

test("S1-15a: GEO_ENABLED aus -> geoLookupAdapter() ist IDENTISCH zu nullGeoLookup", () => {
  withGeoEnabled(false, () => {
    assert.equal(geoLookupAdapter(), nullGeoLookup);
  });
});

test("S1-15b: GEO_ENABLED an -> geoLookupAdapter() ist NICHT nullGeoLookup, aber eine Funktion", () => {
  withGeoEnabled(true, () => {
    const adapter = geoLookupAdapter();
    assert.notEqual(adapter, nullGeoLookup);
    assert.equal(typeof adapter, "function");
  });
});

// VOICE-05 (i18n-Launch-Testkatalog, tasks/i18n-tests/03-telefonie-render.md): ohne
// GEO_ENABLED in der Env ist der IP-Land-Vorschlag strukturell null - proposedCountry in
// src/routes/api-onboard.js steht hinter genau diesem Flag. Getestet wird hier NUR die
// bislang ungetestete Haelfte: der boolEnv-Fallback bei FEHLENDER Var. Die Kette danach
// (geoLookupAdapter -> nullGeoLookup -> immer null) tragen S1-15a oben und
// "nullGeoLookup: loest NIE auf" in f1-geo-port.test.js; hier bewusst nicht wiederholt (G5).
// Frischer config-Import mit Query-String-Cache-Buster, weil config EINMAL beim Import aus
// process.env gebaut wird (Muster PA-11 in config-shape.test.js). Unter NODE_ENV=test ist
// dotenv aus -> keine .env-Interferenz.
test("VOICE-05 (Mechanismus, gruen) - ohne GEO_ENABLED in der Env bleibt geoEnabled false (Default AUS)", async () => {
  const saved = process.env.GEO_ENABLED;
  try {
    delete process.env.GEO_ENABLED;
    const fresh = await import("../src/config.js?voice05");
    assert.equal(fresh.config.provisioning.geoEnabled, false);
  } finally {
    if (saved === undefined) delete process.env.GEO_ENABLED;
    else process.env.GEO_ENABLED = saved;
  }
});
