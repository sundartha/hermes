import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { prodEnv } from "./prod-env.js";
import { normalizePrivateNumber } from "../src/store/state-ops.js";
import { resolveOnboardCountry, tenantGeoForCountry } from "../src/geo/resolve.js";
import { setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";

test("Schritt 1a: Onboard country=US + passende US-Privatnummer darf nicht am +49-Gate scheitern (ex E2E-05)", async () => {
  assert.doesNotThrow(
    () => normalizePrivateNumber("+14155550123", "US"),
    "SOLL: eine passende US-Privatnummer darf unter country=US nicht am +49-Default-Gate scheitern",
  );
  const e164 = normalizePrivateNumber("+14155550123", "US");
  assert.equal(e164, "+14155550123");

  const srv = await startServer({
    env: prodEnv(),
    seed: seedState({
      tenants: [{ id: "t_e2e05a", status: "active", country: "US", privateNumber: e164 }],
    }),
  });
  try {
    const health = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(health.status, 200, "Server bootet unter Produktionswerten mit einem US-Tenant");
  } finally {
    await srv.stop();
  }
});

test("Schritt 1b: Onboard country=US liefert language=en ueber den Weltdefault (ex E2E-05)", async () => {
  setWorldDefaultLanguageEnabled(true);
  try {
    const country = resolveOnboardCountry({
      userCountry: "US",
      proposedCountry: null,
      fallbackCountry: "DE",
    });
    assert.equal(country, "US");
    const geo = tenantGeoForCountry(country);
    assert.equal(
      geo.defaultLanguage,
      "en",
      `SOLL: ein US-Onboard muss language=en liefern (gemessen: "${geo.defaultLanguage}")`,
    );

    const srv = await startServer({
      env: prodEnv({ WORLD_DEFAULT_LANGUAGE_ENABLED: "true" }),
      seed: seedState({
        tenants: [{ id: "t_e2e05b", status: "active", country, defaultLanguage: geo.defaultLanguage }],
      }),
    });
    try {
      const health = await fetch(`${srv.localUrl}/healthz`);
      assert.equal(health.status, 200, "Server bootet unter Produktionswerten mit einem US/en-Tenant");
    } finally {
      await srv.stop();
    }
  } finally {
    setWorldDefaultLanguageEnabled(true);
  }
});
