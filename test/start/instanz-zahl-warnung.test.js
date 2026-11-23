import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";
import { instanzZahlFindings } from "../../src/boot-guard.ts";

const FREMDE_KENNUNG = "fremd-host:00000000-0000-4000-8000-0000000000f1";
const WARNUNG = "[boot] Konfig-Warnung: SERVER_INSTANCES=1, aber 2 Instanzen leben";

const tabelle = [
  { fall: "weniger lebende als eingestellt", eingabe: { serverInstanzen: 3, eigene: "a", lebende: ["a", "b"] }, erwartet: 0 },
  { fall: "genau so viele lebende wie eingestellt", eingabe: { serverInstanzen: 2, eigene: "a", lebende: ["a", "b"] }, erwartet: 0 },
  { fall: "eine mehr als eingestellt", eingabe: { serverInstanzen: 1, eigene: "a", lebende: ["a", "b"] }, erwartet: 1 },
  { fall: "Lebenszeichen nicht lesbar", eingabe: { serverInstanzen: 1, eigene: "a", lebende: null }, erwartet: 0 },
  { fall: "eigene Kennung fehlt noch in der Liste und zaehlt mit", eingabe: { serverInstanzen: 1, eigene: "a", lebende: ["b"] }, erwartet: 1 },
  { fall: "eigene Kennung wird nicht doppelt gezaehlt", eingabe: { serverInstanzen: 2, eigene: "a", lebende: ["a", "a", "b"] }, erwartet: 0 },
];

for (const { fall, eingabe, erwartet } of tabelle) {
  test(`Instanzzahl: ${fall} ergibt ${erwartet} Befund(e)`, () => {
    const befunde = instanzZahlFindings(eingabe);
    assert.equal(befunde.length, erwartet);
    for (const befund of befunde) assert.equal(befund.fatal, false);
  });
}

test("Instanzzahl: der Befund nennt SERVER_INSTANCES und beide Zahlen", () => {
  const [befund] = instanzZahlFindings({ serverInstanzen: 1, eigene: "a", lebende: ["a", "b", "c"] });
  assert.equal(
    befund.message,
    "SERVER_INSTANCES=1, aber 3 Instanzen leben - das Rate-Limit je Instanz ist dann in Summe zu gross. SERVER_INSTANCES auf die tatsaechliche Instanzzahl setzen.",
  );
});

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "pg",
  DATABASE_URL: "postgres://instanz-zahl-attrappe.invalid/hermes",
  SESSION_SECRET: "instanz-zahl-signierwert",
  SERVER_INSTANCES: "1",
  PROVISIONING_ENABLED: "true",
  TELNYX_API_KEY: "KEYtest-instanz-zahl",
  TELNYX_API_BASE: "https://telnyx.instanz-zahl.invalid",
  TELNYX_CONNECTION_ID: "instanz-zahl-verbindung",
  TELNYX_SIP_TRUNK_USERNAME: "instanz-zahl-sip",
  TELNYX_SIP_TRUNK_PASSWORD: "instanz-zahl-sip-wort",
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_NUMBER_REGISTRATION_ENABLED: "true",
  ELEVENLABS_API_KEY: "instanz-zahl-el-schluessel",
  ELEVENLABS_AGENT_ID: "agent_instanz_zahl",
  ELEVENLABS_API_BASE: "https://elevenlabs.instanz-zahl.invalid",
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
stand.numbers.push({
  id: "num_instanz_zahl",
  tenantId: "t_instanz_zahl",
  e164: "+4915799990041",
  provider: "telnyx",
  status: "active",
  providerNumberId: "pnum_instanz_zahl",
  country: "DE",
  language: "de",
  paymentIntentId: null,
});
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
