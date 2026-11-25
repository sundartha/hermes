import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const FREMDE_KENNUNG = "fremd-host:00000000-0000-4000-8000-0000000000f1";
const TAKT_MS = 10_000;
const TAKT_FRIST_MS = 30_000;
const TOTER = "tot-host:00000000-0000-4000-8000-0000000000f2";
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
mock.timers.enable({ apis: ["setInterval"] });
const server = await serverImportieren();

async function besitzerVon(callId) {
  const { rows } = await db.query("SELECT instanz FROM call WHERE id = $1", [callId]);
  return rows[0].instanz;
}

test("Instanzzahl: zwei lebende Instanzen bei SERVER_INSTANCES=1 geben beim Start genau eine Warnung, der Start laeuft weiter", (t) => {
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const treffer = zeilen.filter((zeile) => zeile.includes("SERVER_INSTANCES"));
  assert.deepEqual(treffer.map((zeile) => zeile.slice(0, WARNUNG.length)), [WARNUNG]);
  assert.ok(server.address());
});

test("Instanzzahl: der Takt, den der Start mit der Warnung aufsetzt, uebernimmt den Anruf einer ausgefallenen Instanz", async () => {
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, max_duration_s, instanz)
     VALUES ('call_instanz_zahl', 't_instanz_zahl', 'token', 'outbound', 'active', now()::text, 3600, $1)`,
    [TOTER],
  );
  mock.timers.tick(TAKT_MS);
  const frist = AbortSignal.timeout(TAKT_FRIST_MS);
  while ((await besitzerVon("call_instanz_zahl")) === TOTER) {
    assert.ok(!frist.aborted, "der Takt hat den Anruf nicht uebernommen");
    await new Promise((fertig) => setImmediate(fertig));
  }
  assert.notEqual(await besitzerVon("call_instanz_zahl"), TOTER);
});
