// S1-15: geoLookupAdapter() waehlt den Geo-Lookup-Adapter config-getrieben (fail-closed
// analog telephony/registry.js). Identitaetsvergleich gegen nullGeoLookup in beiden
// Zweigen. config.geoEnabled wird pro Test gesetzt/wiederhergestellt (Muster wie
// config.stripeApiBase in stripe-setup-checkout.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { geoLookupAdapter } from "../src/geo/registry.js";
import { nullGeoLookup } from "../src/geo/stub.js";

function withGeoEnabled(value, fn) {
  const original = config.geoEnabled;
  config.geoEnabled = value;
  try {
    return fn();
  } finally {
    config.geoEnabled = original;
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
