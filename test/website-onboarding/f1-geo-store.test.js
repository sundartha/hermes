import { test, before } from "node:test";
import assert from "node:assert/strict";
import { neuePglite } from "../pglite-helfer.js";
import { tempDataDir } from "../helpers.js";
import { importNachUmgebung } from "../gemeinsam/umgebung-import.js";
import {
  makeDefaultState,
  registerTenant,
  seedBootstrapNumber,
  requestNumber,
  setTenantGeo,
  findTenant,
  numberRecordByE164,
} from "../../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, TENANT_STATUS } from "../../src/begriffe/mandant.ts";
import { DEFAULT_COUNTRY } from "../../src/begriffe/sprache-zeit.ts";
import { applySchema, migrate } from "../../src/db/migrate.js";

const A = "tenant_a";
const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 5 };

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

let makePgStore;
let makePgTestStore;
let jsonBackend;
let defaultSettings;
before(async () => {
  [{ makePgStore }, { makePgTestStore }, jsonBackend, { defaultSettings }] = await importNachUmgebung(
    { DATA_DIR: tempDataDir() },
    () => import("../../src/store/pg.js"),
    () => import("../pg-helpers.js"),
    () => import("../../src/store/json.js"),
    () => import("../../src/store.js"),
  );
});

test("defaultSettings() traegt keine language mehr", () => {
  assert.equal("language" in defaultSettings(), false);
  assert.equal(DEFAULT_COUNTRY, "DE");
});

test("numberRecordByE164: aktive Nummer -> voller Record (tenantId); inaktiv/unbekannt -> null", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: A, status: "active" }];
  s.numbers = [
    {
      id: "n_fr",
      e164: "+33111",
      tenantId: A,
      provider: "telnyx",
      status: "active",
      country: "FR",
    },
    {
      id: "n_req",
      e164: "+33222",
      tenantId: A,
      provider: "telnyx",
      status: "requested",
      country: "FR",
    },
  ];
  const rec = numberRecordByE164(s, "+33111");
  assert.equal(rec.tenantId, A);
  assert.equal(
    numberRecordByE164(s, "+33222"),
    null,
    "nicht-aktive Nummer routet nicht (fail-closed)",
  );
  assert.equal(numberRecordByE164(s, "+49000"), null, "unbekannte Nummer -> null");
  assert.equal(numberRecordByE164(s, ""), null, "leere e164 -> null");
});

test("seedBootstrapNumber: Default-Land = DE (bestehende Aufrufe verhaltens-erhaltend)", () => {
  const s = makeDefaultState();
  seedBootstrapNumber(s, "+491511234567", BOOTSTRAP_TENANT_ID);
  const num = s.numbers.find((n) => n.e164 === "+491511234567");
  assert.equal(num.country, DEFAULT_COUNTRY);
});

test("seedBootstrapNumber: explizites country landet auf dem Record (FR/+33)", () => {
  const s = makeDefaultState();
  seedBootstrapNumber(s, "+33123456789", BOOTSTRAP_TENANT_ID, undefined, "FR");
  const num = s.numbers.find((n) => n.e164 === "+33123456789");
  assert.equal(num.country, "FR");
});

test("requestNumber: Default-Land = DE", () => {
  const s = makeDefaultState();
  const res = requestNumber(s, { tenantId: BOOTSTRAP_TENANT_ID, ...CAPS });
  assert.equal(res.ok, true);
  assert.equal(res.wert.number.country, DEFAULT_COUNTRY);
});

test("requestNumber: explizites country (FR) landet auf der angefragten Nummer", () => {
  const s = makeDefaultState();
  const res = requestNumber(s, {
    tenantId: BOOTSTRAP_TENANT_ID,
    country: "FR",
    ...CAPS,
  });
  assert.equal(res.ok, true);
  assert.equal(res.wert.number.country, "FR");
  assert.equal(res.wert.number.e164, null, "requested ohne Kauf -> e164 null (Geo aendert das nicht)");
});

test("setTenantGeo: selektiver Patch - country setzen laesst defaultLanguage unberuehrt; spaeterer Patch setzt nur language", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  setTenantGeo(s, A, { country: "FR" });
  assert.equal(findTenant(s, A).country, "FR");
  assert.equal(
    "defaultLanguage" in findTenant(s, A),
    false,
    "defaultLanguage unberuehrt (kein undefined-Feld)",
  );
  setTenantGeo(s, A, { defaultLanguage: "fr" });
  assert.equal(findTenant(s, A).country, "FR", "country bleibt erhalten");
  assert.equal(findTenant(s, A).defaultLanguage, "fr");
});

test("setTenantGeo: fehlender Tenant wirft (fail-closed, kein stilles No-Op)", () => {
  const s = makeDefaultState();
  assert.throws(() => setTenantGeo(s, "ghost", { country: "FR" }), /nicht gefunden/);
});

test("setTenantGeo: Owner ohne Geo-Patch bleibt byte-identisch (kein leeres Feld, Read-Fallback)", () => {
  const s = makeDefaultState();
  const before = { ...findTenant(s, BOOTSTRAP_TENANT_ID) };
  setTenantGeo(s, BOOTSTRAP_TENANT_ID, {});
  assert.deepEqual(findTenant(s, BOOTSTRAP_TENANT_ID), before, "leerer Patch aendert nichts");
  assert.equal("country" in findTenant(s, BOOTSTRAP_TENANT_ID), false, "kein country-Feld am Owner");
  assert.equal(
    "defaultLanguage" in findTenant(s, BOOTSTRAP_TENANT_ID),
    false,
    "kein defaultLanguage-Feld am Owner",
  );
});

test("json-Fassade exportiert setTenantGeo (Re-Export-Landmine)", () => {
  assert.equal(typeof jsonBackend.setTenantGeo, "function", "json.setTenantGeo fehlt");
});

test("json-Roundtrip: setTenantGeo via Fassade persistiert -> Tenant-Record traegt country/defaultLanguage", () => {
  jsonBackend.setTenantGeo(BOOTSTRAP_TENANT_ID, { country: "FR", defaultLanguage: "fr" });
  const owner = jsonBackend.load().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID);
  assert.equal(owner.country, "FR");
  assert.equal(owner.defaultLanguage, "fr");
});

test("pg: Number-Land ueberlebt Flush + Re-Hydrierung", async () => {
  const { store, db } = await makePgTestStore();
  const s = store.load();
  s.numbers.push({
    id: "num_fr",
    e164: "+33999000111",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
    status: "active",
    providerNumberId: null,
    country: "FR",
  });
  await store.save();
  const reopened = await reopen(db);
  const num = reopened.load().numbers.find((n) => n.id === "num_fr");
  assert.equal(num.country, "FR");
});

test("pg: Bestands-Nummer ohne country (pre-migration) hydriert zu null, nicht undefined (R7)", async () => {
  const { db } = await makePgTestStore();
  await db.query(
    `INSERT INTO number (id, tenant_id, e164, provider, status) VALUES ($1,$2,$3,'telnyx','active')`,
    ["num_legacy", BOOTSTRAP_TENANT_ID, "+15005550006"],
  );
  const reopened = await reopen(db);
  const num = reopened.load().numbers.find((n) => n.id === "num_legacy");
  assert.equal(num.country, null, "fehlendes country -> null (kein undefined-Drift)");
});

const LEGACY_TENANT = "t_legacy";
const LEGACY_US_E164 = "+12025550123";
const LEGACY_FR_E164 = "+33123456789";
const LEGACY_AT_E164 = "+436601234567";
const LEGACY_DE_E164 = "+4915112340001";

async function seedAndMigrate(numbers) {
  const conn = await neuePglite();
  await applySchema(conn);
  await conn.query(`INSERT INTO tenant (id, status) VALUES ($1, $2)`, [
    LEGACY_TENANT,
    TENANT_STATUS.ACTIVE,
  ]);
  for (const n of numbers) {
    await conn.query(
      `INSERT INTO number (id, tenant_id, e164, provider, status, country)
       VALUES ($1, $2, $3, 'telnyx', 'active', $4)`,
      [n.id, LEGACY_TENANT, n.e164, n.country],
    );
  }
  await migrate(conn, LEGACY_TENANT);
  const rows = async () =>
    (await conn.query(`SELECT id, country FROM number ORDER BY id`)).rows;
  return { conn, rows };
}

test("GAP-34 (SOLL, rot) - fehlendes Land wird aus der DID-Vorwahl abgeleitet, ohne Vorwahl bleibt es leer (E2: kein Raten)", async () => {
  const { rows } = await seedAndMigrate([
    { id: "num_de_legacy", e164: LEGACY_DE_E164, country: null },
    { id: "num_ohne_did", e164: null, country: null },
  ]);
  assert.deepEqual(
    await rows(),
    [
      { id: "num_de_legacy", country: "DE" },
      { id: "num_ohne_did", country: null },
    ],
    "eine Bestandsnummer mit eindeutiger Vorwahl bleibt ohne Land - und eine ohne Vorwahl darf keines bekommen",
  );
});

test("pg: setTenantGeo ueberlebt Flush + Re-Hydrierung (nur-nicht-null hydriert)", async () => {
  const { store, db } = await makePgTestStore();
  store.setTenantGeo(BOOTSTRAP_TENANT_ID, { country: "FR", defaultLanguage: "fr" });
  await store.save();
  const reopened = await reopen(db);
  const owner = reopened.load().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID);
  assert.equal(owner.country, "FR");
  assert.equal(owner.defaultLanguage, "fr");
});

test("pg: Owner ohne Geo behaelt KEIN country/defaultLanguage-Feld nach Re-Hydrierung (Owner byte-identisch)", async () => {
  const { db } = await makePgTestStore();
  const reopened = await reopen(db);
  const owner = reopened.load().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID);
  assert.equal("country" in owner, false, "kein country-Feld am frischen Owner");
  assert.equal("defaultLanguage" in owner, false, "kein defaultLanguage-Feld am frischen Owner");
});

test("pg: doppelter applySchema/init bleibt fehlerfrei (idempotente ADD COLUMN IF NOT EXISTS)", async () => {
  const db = await neuePglite();
  await reopen(db);
  const second = await reopen(db);
  assert.ok(second.load().settings[BOOTSTRAP_TENANT_ID]);
});
