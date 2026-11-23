import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const FREMDE_KENNUNG = "fremd-host:00000000-0000-4000-8000-0000000000f1";
const WARNUNG = "[boot] Konfig-Warnung: SERVER_INSTANCES=1, aber 2 Instanzen leben";

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "pg",
  DATABASE_URL: "postgres://instanz-zahl-attrappe.invalid/hermes",
  SESSION_SECRET: "instanz-zahl-signierwert",
  SERVER_INSTANCES: "1",
});
let store = null;
const db = await aufraeumenVormerken(() => store)(await vorlage("leer", async () => {}, []));
await db.exec(`CREATE ROLE instanz_zahl_app NOSUPERUSER NOBYPASSRLS;
  GRANT CREATE, USAGE ON SCHEMA public TO instanz_zahl_app;
  SET ROLE instanz_zahl_app;`);
poolAufPglite(db, { exklusiv: false });
const zeilen = [];
globalThis.fetch = async (url) => {
  throw new Error(`Testaufbau: Zugriff nach außen gesperrt (${String(url)})`);
};
for (const stufe of ["log", "warn", "error"]) {
  const original = console[stufe].bind(console);
  console[stufe] = (...teile) => {
    zeilen.push(teile.map(String).join(" "));
    original(...teile);
  };
}
store = await import("../../src/store.js");
await store.oeffneSpeicher();
const stand = store.load();
stand.tenants.push({ id: "t_instanz_zahl", status: "active", kycLevel: "card", ownerName: "Instanz Zahl" });
stand.numbers.push({ id: "num_instanz_zahl", tenantId: "t_instanz_zahl", e164: "+4915799990041", provider: "telnyx", status: "active" });
store.save();
await store.drainFlushes();
await db.query("INSERT INTO instanz_lebenszeichen (kennung, gemeldet_um) VALUES ($1, now())", [FREMDE_KENNUNG]);
const server = await serverImportieren();

test("Instanzzahl: zwei lebende Instanzen bei SERVER_INSTANCES=1 geben beim Start genau eine Warnung, der Start laeuft weiter", (t) => {
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const treffer = zeilen.filter((zeile) => zeile.includes("SERVER_INSTANCES"));
  assert.deepEqual(treffer.map((zeile) => zeile.slice(0, WARNUNG.length)), [WARNUNG]);
  assert.ok(server.address());
});
