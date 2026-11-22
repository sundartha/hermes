import { test, after } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "t_kauf_takt";
const MANDANT_AKTIV = "t_kauf_takt_aktiv";
const NUMMER_ID = "num_kauf_takt";
const AUFTRAG_ID = "job_kauf_takt";
const BESITZER = "ausgefallen-host:00000000-0000-4000-8000-0000000000d4";
const TELNYX_BASIS = "https://telnyx.kauf-takt.invalid";
const ERSATZ = "+12025550192";
const WARTE_FRIST_MS = 40_000;
const EINMAL = 1;

function umgebungSetzen() {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://kauf-takt-attrappe.invalid/hermes",
    SESSION_SECRET: "kauf-takt-signierwert",
    PROVISIONING_ENABLED: "true",
    PROVISIONING_REDRIVE_MAX_AGE_MS: "3600000",
    TELNYX_API_KEY: "KEYtest-kauf-takt",
    TELNYX_API_BASE: TELNYX_BASIS,
    TELNYX_CONNECTION_ID: "kauf-takt-verbindung",
  });
}

async function datenbankAnlegen(storeHolen) {
  const anlegen = aufraeumenVormerken(storeHolen);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE kauf_takt_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO kauf_takt_app;
    SET ROLE kauf_takt_app;`);
  poolAufPglite(db);
  return db;
}

const alsJson = (koerper) => new Response(JSON.stringify(koerper), { status: 200 });

function aussenweltAbfangen() {
  const bestellungen = [];
  globalThis.fetch = async (url, optionen = {}) => {
    const ziel = new URL(String(url));
    const methode = (optionen.method ?? "GET").toUpperCase();
    if (ziel.origin === TELNYX_BASIS && methode === "GET" && ziel.pathname === "/v2/available_phone_numbers")
      return alsJson({ data: [{ phone_number: ERSATZ }] });
    if (ziel.origin === TELNYX_BASIS && methode === "POST" && ziel.pathname === "/v2/number_orders") {
      bestellungen.push(ziel.pathname);
      throw new Error("Testaufbau: Bestellung nicht fortgefuehrt");
    }
    throw new Error(`Testaufbau: Zugriff nach außen gesperrt (${methode} ${ziel.origin}${ziel.pathname})`);
  };
  return bestellungen;
}

async function mandantMitAktiverNummer(store) {
  const zustand = store.load();
  zustand.tenants.push({ id: MANDANT_AKTIV, status: "active", kycLevel: "card", ownerName: "Kauf Takt Aktiv" });
  zustand.numbers.push({ id: "num_kauf_takt_aktiv", tenantId: MANDANT_AKTIV, e164: "+12025550193", provider: "telnyx", status: "active", providerNumberId: "pn_aktiv", country: "US", language: "en", paymentIntentId: null });
  store.save();
  await store.drainFlushes();
}

async function mandantMitOffenemAuftrag(store, db) {
  const zustand = store.load();
  zustand.tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Kauf Takt" });
  zustand.numbers.push({ id: NUMMER_ID, tenantId: MANDANT, e164: null, provider: "telnyx", status: "requested", country: "US", language: "en", providerNumberId: null, paymentIntentId: null });
  store.save();
  await store.drainFlushes();
  await db.query("SELECT set_config('app.current_tenant', $1, false)", [MANDANT]);
  await db.query(
    `INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, created_at, instanz)
     VALUES ($1, $2, $3, 'provision_number', 'queued', $4, 0, now(), $5)`,
    [AUFTRAG_ID, MANDANT, NUMMER_ID, `provision_${NUMMER_ID}`, BESITZER],
  );
  await db.query("INSERT INTO instanz_lebenszeichen (kennung, gemeldet_um) VALUES ($1, now())", [BESITZER]);
}

function protokollMitschreiben() {
  const zeilen = [];
  for (const stufe of ["log", "warn", "error"]) {
    const original = console[stufe].bind(console);
    console[stufe] = (...teile) => {
      zeilen.push(teile.map(String).join(" "));
      original(...teile);
    };
  }
  return zeilen;
}

async function bisErfuellt(pruefung, was) {
  const frist = AbortSignal.timeout(WARTE_FRIST_MS);
  while (!(await pruefung())) {
    assert.ok(!frist.aborted, `nicht erreicht: ${was}`);
    await new Promise((fertig) => setImmediate(fertig));
  }
}

let store = null;
umgebungSetzen();
const db = await datenbankAnlegen(() => store);
const bestellungen = aussenweltAbfangen();
const protokoll = protokollMitschreiben();
store = await import("../../src/store.js");
await store.oeffneSpeicher();
await mandantMitAktiverNummer(store);
await mandantMitOffenemAuftrag(store, db);
const server = await serverImportieren();
after(() => {
  server.closeAllConnections();
  server.close();
});

test("Nummernkauf im Takt: der Start laesst den Auftrag der lebenden Instanz liegen, nach deren Ausfall bestellt der Takt einmal und traegt die eigene Kennung ein", async () => {
  await bisErfuellt(() => protokoll.includes(`[provision-reconcile] fremd job=${AUFTRAG_ID}`), "der Start erkennt den fremden Auftrag");
  assert.deepEqual(bestellungen, []);
  await db.query("DELETE FROM instanz_lebenszeichen WHERE kennung = $1", [BESITZER]);
  await bisErfuellt(() => bestellungen.length >= EINMAL, "der Takt bestellt die Nummer des ausgefallenen Besitzers");
  await db.query("SELECT set_config('app.current_tenant', $1, false)", [MANDANT]);
  const { rows } = await db.query("SELECT instanz FROM provisioning_job WHERE id = $1", [AUFTRAG_ID]);
  const lage = await store.besitzLage();
  assert.equal(rows[0].instanz, lage.eigene);
  assert.equal(bestellungen.length, EINMAL);
});
