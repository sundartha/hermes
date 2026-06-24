// F1 Geo-Location (Phase 1 - Store-Schema): country/language auf Number-Record +
// Tenant-Default-Geo (setTenantGeo) + settings.language. Prueft die INVARIANTEN rein
// ueber state-ops (kein Netz, kein Server) PLUS einen json-Fassaden-Roundtrip UND
// einen pg-Roundtrip gegen pglite (Postgres-in-WASM, offline -> F.I.R.S.T.).
//
// Drei Achsen aus der Strategie (docs/strategy/f1-geo-location.md):
//   (A) Geo-Felder additiv NULLABLE + Code-Fallback DE/de (Bestand bricht nicht, R7)
//   (B) settings.language rein (im Dashboard umstellbar)
//   (C) JSON- und PG-Backend konsistent (kein "frischer pg != frischer json", R12)
//
// DATA_DIR wird im before VOR dem ersten json-/config-Import auf ein Temp-Verzeichnis
// gesetzt (Repo-Regel: data/store.json nie anfassen). state-ops/defaults/pg-helpers
// sind config-frei und statisch importierbar.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { tempDataDir } from "./helpers.js";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import {
  makeDefaultState,
  registerTenant,
  seedBootstrapNumber,
  requestNumber,
  setTenantGeo,
  findTenant,
  numberRecordByE164,
  resolveCallLanguage,
  updateSettings,
} from "../src/store/state-ops.js";
import {
  defaultSettings,
  BOOTSTRAP_TENANT_ID,
  DEFAULT_COUNTRY,
  DEFAULT_LANGUAGE,
} from "../src/store/defaults.js";

const A = "tenant_a";
const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 5 };

// Re-hydriert einen frischen Store aus einer BESTEHENDEN pglite-Instanz (Persistenz
// statt nur In-Memory) - Muster aus store-pg.test.js.
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
});

// ---- (B) settings.language im Default ----
// P4-Aenderung (Entscheidung #8): settings.language ist ein OPTIONALES Override mit
// Default null (NICHT mehr 'de'). Ein harter 'de'-Default wuerde number.language in der
// Aufloesungs-Praezedenz immer ueberstimmen (Praezedenz-Bug). null = "nicht gesetzt".
test("defaultSettings() traegt language = null (optionales Override, P4 #8)", () => {
  assert.equal(defaultSettings().language, null);
  assert.equal(DEFAULT_LANGUAGE, "de");
  assert.equal(DEFAULT_COUNTRY, "DE");
});

// ---- (P4) numberRecordByE164: Schwester-Query liefert den vollen Record ----
test("numberRecordByE164: aktive Nummer -> voller Record (tenantId+language); inaktiv/unbekannt -> null", () => {
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
      language: "fr",
    },
    {
      id: "n_req",
      e164: "+33222",
      tenantId: A,
      provider: "telnyx",
      status: "requested",
      country: "FR",
      language: "fr",
    },
  ];
  const rec = numberRecordByE164(s, "+33111");
  assert.equal(rec.tenantId, A);
  assert.equal(rec.language, "fr");
  assert.equal(
    numberRecordByE164(s, "+33222"),
    null,
    "nicht-aktive Nummer routet nicht (fail-closed)",
  );
  assert.equal(numberRecordByE164(s, "+49000"), null, "unbekannte Nummer -> null");
  assert.equal(numberRecordByE164(s, ""), null, "leere e164 -> null");
});

// ---- (P4 #8) resolveCallLanguage: Aufloesungs-Praezedenz, jede Stufe einzeln ----
test("resolveCallLanguage: settings.language-Override schlaegt number.language (hoechste Stufe)", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: A, status: "active", defaultLanguage: "de" }];
  s.settings[A] = { ...defaultSettings(), language: "en" };
  const numberRecord = { language: "fr" };
  assert.equal(resolveCallLanguage(s, { tenantId: A, numberRecord }), "en", "Override gewinnt");
});

test("resolveCallLanguage: ohne Override greift number.language", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: A, status: "active", defaultLanguage: "de" }];
  s.settings[A] = { ...defaultSettings(), language: null };
  assert.equal(resolveCallLanguage(s, { tenantId: A, numberRecord: { language: "fr" } }), "fr");
});

test("resolveCallLanguage: ohne Override + ohne number.language greift tenant.defaultLanguage", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: A, status: "active", defaultLanguage: "fr" }];
  s.settings[A] = { ...defaultSettings(), language: null };
  assert.equal(resolveCallLanguage(s, { tenantId: A, numberRecord: { language: null } }), "fr");
  assert.equal(
    resolveCallLanguage(s, { tenantId: A, numberRecord: null }),
    "fr",
    "kein Record -> Number-Stufe faellt durch",
  );
});

test("resolveCallLanguage: alles leer -> DEFAULT_LANGUAGE (de, letzter Notnagel)", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: A, status: "active" }];
  s.settings[A] = { ...defaultSettings(), language: null };
  assert.equal(resolveCallLanguage(s, { tenantId: A, numberRecord: null }), DEFAULT_LANGUAGE);
});

// ---- (P4 #8) updateSettings: language-Override fail-closed validiert ----
test("updateSettings: bekannte Sprache uebernommen; '' setzt zurueck auf null; Freitext/unbekannt ignoriert", () => {
  const s = makeDefaultState();
  s.settings[BOOTSTRAP_TENANT_ID] = defaultSettings();
  assert.ok(updateSettings(s, BOOTSTRAP_TENANT_ID, { language: "fr" }).changed.includes("language"));
  assert.equal(s.settings[BOOTSTRAP_TENANT_ID].language, "fr");
  // "" -> "automatisch" -> null gespeichert
  updateSettings(s, BOOTSTRAP_TENANT_ID, { language: "" });
  assert.equal(s.settings[BOOTSTRAP_TENANT_ID].language, null);
  // unbekannter Code wird ignoriert (fail-closed, kein Schreiben)
  s.settings[BOOTSTRAP_TENANT_ID].language = "fr";
  const res = updateSettings(s, BOOTSTRAP_TENANT_ID, { language: "xx" });
  assert.ok(!res.changed.includes("language"), "unbekannter Sprachcode wird nicht uebernommen");
  assert.equal(s.settings[BOOTSTRAP_TENANT_ID].language, "fr", "alter Wert bleibt");
});

// ---- (A) Number-Record Geo: seedBootstrapNumber ----
test("seedBootstrapNumber: Default-Geo = DE/de (bestehende Aufrufe verhaltens-erhaltend)", () => {
  const s = makeDefaultState();
  seedBootstrapNumber(s, "+491511234567", BOOTSTRAP_TENANT_ID);
  const num = s.numbers.find((n) => n.e164 === "+491511234567");
  assert.equal(num.country, DEFAULT_COUNTRY);
  assert.equal(num.language, DEFAULT_LANGUAGE);
});

test("seedBootstrapNumber: explizites country/language landet auf dem Record (FR/+33)", () => {
  const s = makeDefaultState();
  seedBootstrapNumber(s, "+33123456789", BOOTSTRAP_TENANT_ID, undefined, "FR", "fr");
  const num = s.numbers.find((n) => n.e164 === "+33123456789");
  assert.equal(num.country, "FR");
  assert.equal(num.language, "fr");
});

// ---- (A) Number-Record Geo: requestNumber ----
test("requestNumber: Default-Geo = DE/de", () => {
  const s = makeDefaultState();
  const res = requestNumber(s, { tenantId: BOOTSTRAP_TENANT_ID, ...CAPS });
  assert.equal(res.ok, true);
  assert.equal(res.number.country, DEFAULT_COUNTRY);
  assert.equal(res.number.language, DEFAULT_LANGUAGE);
});

test("requestNumber: explizites country/language (FR) landet auf der angefragten Nummer", () => {
  const s = makeDefaultState();
  const res = requestNumber(s, {
    tenantId: BOOTSTRAP_TENANT_ID,
    country: "FR",
    language: "fr",
    ...CAPS,
  });
  assert.equal(res.ok, true);
  assert.equal(res.number.country, "FR");
  assert.equal(res.number.language, "fr");
  assert.equal(res.number.e164, null, "requested ohne Kauf -> e164 null (Geo aendert das nicht)");
});

// ---- (A) Tenant-Geo: setTenantGeo selektiver Patch ----
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

// ---- json-Fassade ----
test("json-Fassade exportiert setTenantGeo (Re-Export-Landmine)", () => {
  assert.equal(typeof jsonBackend.setTenantGeo, "function", "json.setTenantGeo fehlt");
});

test("json-Roundtrip: setTenantGeo via Fassade persistiert -> Tenant-Record traegt country/defaultLanguage", () => {
  // Owner existiert in makeDefaultState (load() seedet ihn) -> kein registerTenant noetig.
  jsonBackend.setTenantGeo(BOOTSTRAP_TENANT_ID, { country: "FR", defaultLanguage: "fr" });
  const owner = jsonBackend.load().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID);
  assert.equal(owner.country, "FR");
  assert.equal(owner.defaultLanguage, "fr");
});

// ---- (C) pg-Roundtrip: Number-Geo ----
test("pg: Number-Geo (country/language) ueberlebt Flush + Re-Hydrierung", async () => {
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
    language: "fr",
  });
  await store.save();
  const reopened = await reopen(db);
  const num = reopened.load().numbers.find((n) => n.id === "num_fr");
  assert.equal(num.country, "FR");
  assert.equal(num.language, "fr");
});

test("pg: Bestands-Nummer ohne country/language (pre-migration) hydriert zu null, nicht undefined (R7)", async () => {
  // Eine Zeile DIREKT in die DB schreiben, OHNE country/language (simuliert eine vor
  // der Migration angelegte Nummer). Die nullable Spalten + ?? null halten den
  // Re-Hydrierungs-Shape stabil (Code-Fallback DE/de der Konsumenten greift spaeter).
  const { db } = await makePgTestStore();
  await db.query(
    `INSERT INTO number (id, tenant_id, e164, provider, status) VALUES ($1,$2,$3,'twilio','active')`,
    ["num_legacy", BOOTSTRAP_TENANT_ID, "+4915700099999"],
  );
  const reopened = await reopen(db);
  const num = reopened.load().numbers.find((n) => n.id === "num_legacy");
  assert.equal(num.country, null, "fehlendes country -> null (kein undefined-Drift)");
  assert.equal(num.language, null, "fehlendes language -> null (kein undefined-Drift)");
});

// ---- (C) pg-Roundtrip: Tenant-Geo ----
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

// ---- (B)+(C) pg-Roundtrip: settings.language ----
// P4: frische settings tragen language=null (optionales Override, Spalte NULLABLE) -
// frischer pg == frischer json (beide null, nicht 'de').
test("pg: frische settings tragen language=null (frischer pg == frischer json, P4 #8)", async () => {
  const { store } = await makePgTestStore();
  assert.equal(store.load().settings[BOOTSTRAP_TENANT_ID].language, null);
});

test("pg: settings.language ist via updateSettings umstellbar + ueberlebt Re-Hydrierung", async () => {
  const { store, db } = await makePgTestStore();
  const { changed } = store.updateSettings(BOOTSTRAP_TENANT_ID, { language: "fr" });
  assert.ok(changed.includes("language"), "language in der Whitelist (Default-Feld)");
  assert.equal(store.load().settings[BOOTSTRAP_TENANT_ID].language, "fr");
  await store.save();
  const reopened = await reopen(db);
  assert.equal(
    reopened.load().settings[BOOTSTRAP_TENANT_ID].language,
    "fr",
    "umgestellte Sprache persistiert",
  );
});

// ---- Idempotenz des additiven Schemas ----
test("pg: doppelter applySchema/init bleibt fehlerfrei (idempotente ADD COLUMN IF NOT EXISTS)", async () => {
  const db = new PGlite();
  await reopen(db);
  // Zweiter init auf derselben DB darf nicht an den neuen ALTER-Statements scheitern.
  const second = await reopen(db);
  // P4: frische settings.language ist null (optionales Override), nicht 'de'.
  assert.equal(second.load().settings[BOOTSTRAP_TENANT_ID].language, null);
});
