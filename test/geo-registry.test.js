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
