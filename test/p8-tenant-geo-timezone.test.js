import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "./helpers.js";
import { makePgTestStore } from "./pg-helpers.js";
import { makePgStore } from "../src/store/pg.js";
import {
  makeDefaultState,
  registerTenant,
  setTenantGeo,
  tenantGeo,
  tenantTimezone,
  findTenant,
} from "../src/store/state-ops.js";
import {
  DEFAULT_TIMEZONE,
  resolveTimezone,
  setWorldDefaultLanguageEnabled,
} from "../src/store/defaults.js";
import { timezoneForCountry, tenantGeoForCountry } from "../src/geo/resolve.js";

const A = "tenant_a";

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

let jsonBackend;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  jsonBackend = await import("../src/store/json.js");
  setWorldDefaultLanguageEnabled(true);
});

test("timezoneForCountry: bekannte Laender -> ihre Zone, unbekannt/leer -> DEFAULT_TIMEZONE", () => {
  assert.equal(timezoneForCountry("DE"), "Europe/Berlin");
  assert.equal(timezoneForCountry("US"), "America/New_York");
  assert.equal(timezoneForCountry("xx"), DEFAULT_TIMEZONE);
  assert.equal(timezoneForCountry(null), DEFAULT_TIMEZONE);
  assert.equal(timezoneForCountry(""), DEFAULT_TIMEZONE);
});

test("tenantGeoForCountry: DE liefert das volle Tripel", () => {
  assert.deepEqual(tenantGeoForCountry("DE"), {
    country: "DE",
    defaultLanguage: "de",
    timezone: "Europe/Berlin",
  });
});

test("tenantGeoForCountry: US -> defaultLanguage 'en' (Weltdefault) + America/New_York", () => {
  const geo = tenantGeoForCountry("US");
  assert.equal(geo.defaultLanguage, "en");
  assert.equal(geo.timezone, "America/New_York");
});

test("resolveTimezone: gueltige IANA-Zone durchgereicht, Muell/leer/non-string -> DEFAULT_TIMEZONE, kein Throw", () => {
  assert.equal(resolveTimezone("Europe/Paris"), "Europe/Paris");
  assert.equal(resolveTimezone("Mars/Olympus"), DEFAULT_TIMEZONE);
  assert.equal(resolveTimezone(""), DEFAULT_TIMEZONE);
  assert.equal(resolveTimezone(null), DEFAULT_TIMEZONE);
  assert.equal(resolveTimezone(42), DEFAULT_TIMEZONE);
  assert.doesNotThrow(() =>
    new Date().toLocaleString("de-DE", { timeZone: resolveTimezone("Mars/Olympus") }),
  );
});

test("setTenantGeo/tenantTimezone: selektiver Patch, tenantGeo() bleibt ohne timezone (D2)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  setTenantGeo(s, A, { timezone: "Pacific/Auckland" });
  assert.equal(tenantTimezone(s, A), "Pacific/Auckland");
  assert.equal(findTenant(s, A).country, undefined, "country bleibt vom timezone-Patch unberuehrt");
  assert.deepEqual(tenantGeo(s, A), { country: null, defaultLanguage: null });

  setTenantGeo(s, A, { country: "FR", defaultLanguage: "fr" });
  assert.deepEqual(tenantGeo(s, A), { country: "FR", defaultLanguage: "fr" });
  assert.equal(tenantTimezone(s, A), "Pacific/Auckland", "timezone bleibt vom geo-Patch unberuehrt");
});

test("tenantTimezone: fehlender Tenant/fehlendes Feld -> null", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  assert.equal(tenantTimezone(s, A), null);
  assert.equal(tenantTimezone(s, "ghost"), null);
});

test("json-Fassade exportiert tenantTimezone (Re-Export-Landmine)", () => {
  assert.equal(typeof jsonBackend.tenantTimezone, "function", "json.tenantTimezone fehlt");
});

test("json-Roundtrip: setTenantGeo({timezone}) via Fassade persistiert", () => {
  jsonBackend.setTenantGeo("owner", { timezone: "Asia/Tokyo" });
  assert.equal(jsonBackend.tenantTimezone("owner"), "Asia/Tokyo");
});

test("pg: setTenantGeo({timezone}) ueberlebt Flush + Re-Hydrierung", async () => {
  const { store, db } = await makePgTestStore();
  store.setTenantGeo("owner", { timezone: "Europe/Paris" });
  await store.save();
  const reopened = await reopen(db);
  assert.equal(reopened.tenantTimezone("owner"), "Europe/Paris");
});

test("pg: Owner ohne Timezone -> tenantTimezone liefert null (kein Backfill)", async () => {
  const { store } = await makePgTestStore();
  assert.equal(store.tenantTimezone("owner"), null);
});
