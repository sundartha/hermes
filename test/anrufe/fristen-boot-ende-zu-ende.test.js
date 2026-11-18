import { test, after } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir, waitUntil } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "t_frist_boot";
const ANRUF = "call_frist_boot";
const CARRIER_ID = "CA_frist_boot";
const TELNYX_BASIS = "https://telnyx.frist-boot.invalid";
const KONTO = "AC_frist_boot";
const FRIST_BIS_BEENDET_MS = 10_000;
const MAX_DAUER_S = 60;
const CAP_FAILURE_REASON = "max-duration-cap";

function umgebungSetzen() {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://frist-boot-attrappe.invalid/hermes",
    SESSION_SECRET: "frist-boot-signierwert",
    TELNYX_API_KEY: "KEYtest-frist-boot",
    TELNYX_API_BASE: TELNYX_BASIS,
    TELNYX_ACCOUNT_SID: KONTO,
    FRISTEN_TAKT_MS: "40",
  });
}

async function datenbankAnlegen(storeHolen) {
  const anlegen = aufraeumenVormerken(storeHolen);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE frist_boot_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO frist_boot_app;
    SET ROLE frist_boot_app;`);
  poolAufPglite(db);
  return db;
}

function aussenweltAbfangen() {
  const auflegen = [];
  globalThis.fetch = async (url, optionen = {}) => {
    const ziel = new URL(String(url));
    const methode = (optionen.method ?? "GET").toUpperCase();
    if (ziel.origin === TELNYX_BASIS && methode === "POST" && ziel.pathname.includes("/Calls/CA_frist_boot")) {
      auflegen.push(ziel.pathname.split("/").at(-1));
      return new Response("{}", { status: 200 });
    }
    throw new Error(`Testaufbau: Zugriff nach außen gesperrt (${methode} ${ziel.origin}${ziel.pathname})`);
  };
  return auflegen;
}

async function mandantAnlegen(store) {
  store.load().tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Frist Boot" });
  store.load().numbers.push({
    id: "num_frist_boot",
    tenantId: MANDANT,
    e164: "+4915799990041",
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_frist_boot",
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  store.save();
  await store.drainFlushes();
}

async function fremderAnruf(db, { id = ANRUF, carrierId = CARRIER_ID, fristSql }) {
  await db.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.current_tenant', $1, true)", [MANDANT]);
    await tx.query(
      `INSERT INTO call (id, tenant_id, stream_token, twilio_sid, direction, status, started_at, answered_at,
         provider, max_duration_s, frist_hoechstdauer_at)
       VALUES ($1, $2, $3, $4, 'inbound', 'active', now()::text, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'telnyx', $5, ${fristSql})`,
      [id, MANDANT, `tok_${id}`, carrierId, MAX_DAUER_S],
    );
  });
}

async function zeile(db, id = ANRUF) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.current_tenant', $1, true)", [MANDANT]);
    const { rows } = await tx.query("SELECT status, failure_reason, billed_at FROM call WHERE id = $1", [id]);
    return rows[0];
  });
}

let store = null;
const fehlerzeilen = [];
umgebungSetzen();
const db = await datenbankAnlegen(() => store);
const auflegen = aussenweltAbfangen();
const echtesError = console.error.bind(console);
console.error = (...teile) => {
  fehlerzeilen.push(teile.map(String).join(" "));
  echtesError(...teile);
};
store = await import("../../src/store.js");
await store.oeffneSpeicher();
await mandantAnlegen(store);
const server = await serverImportieren();
after(() => {
  server.closeAllConnections();
  server.close();
});

test("Kriterium 1: ein vom Boot-Takt gefundener Anruf mit abgelaufener Frist, den dieser Prozess nie gesehen hat, endet mit dem Kappungsgrund, einmal aufgelegt, einmal abgerechnet", async () => {
  await fremderAnruf(db, { fristSql: "now() - interval '1 minute'" });
  assert.equal(store.getCall(ANRUF), null);
  await waitUntil(() => store.getCall(ANRUF)?.status === "completed", { timeoutMs: FRIST_BIS_BEENDET_MS });
  await store.drainFlushes();
  const ende = await zeile(db);
  assert.equal(ende.status, "completed");
  assert.equal(ende.failure_reason, CAP_FAILURE_REASON);
  assert.notEqual(ende.billed_at, null);
  assert.deepEqual(auflegen, [CARRIER_ID]);
});


test("Kriterium 1: ein Anruf, dessen Frist noch nicht abgelaufen ist, bleibt vom Boot-Takt unberuehrt, auch wenn daneben einer endet", async () => {
  const laeuft = "call_frist_boot_laeuft";
  await fremderAnruf(db, { id: laeuft, carrierId: "CA_frist_boot_laeuft", fristSql: "now() + interval '1 hour'" });
  await fremderAnruf(db, { id: "call_frist_boot_zweit", carrierId: "CA_frist_boot_zweit", fristSql: "now() - interval '1 second'" });
  await waitUntil(() => store.getCall("call_frist_boot_zweit")?.status === "completed", { timeoutMs: FRIST_BIS_BEENDET_MS });
  assert.equal((await zeile(db, laeuft)).status, "active");
  assert.deepEqual(auflegen, [CARRIER_ID, "CA_frist_boot_zweit"]);
});
