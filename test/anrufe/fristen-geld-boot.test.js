import { test, after } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir, waitUntil } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "t_geld_boot";
const MANDANT_ZWEI = "t_geld_boot_zwei";
const ANRUF = "call_geld_boot";
const ANRUF_ZWEI = "call_geld_boot_zwei";
const CARRIER_ID = "CA_geld_boot";
const TELNYX_BASIS = "https://telnyx.geld-boot.invalid";
const KONTO = "AC_geld_boot";
const FRIST_BIS_BEENDET_MS = 10_000;
const MAX_DAUER_S = 60;
const BUDGET_FAILURE_REASON = "budget-exhausted";

function umgebungSetzen() {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://geld-boot-attrappe.invalid/hermes",
    SESSION_SECRET: "geld-boot-signierwert",
    TELNYX_API_KEY: "KEYtest-geld-boot",
    TELNYX_API_BASE: TELNYX_BASIS,
    TELNYX_ACCOUNT_SID: KONTO,
    FRISTEN_TAKT_MS: "40",
    DEFAULT_TENANT_BUDGET_CENTS: "100",
    VOICE_TARIFF_INBOUND_CENTS: "20",
  });
}

async function datenbankAnlegen(storeHolen) {
  const anlegen = aufraeumenVormerken(storeHolen);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE geld_boot_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO geld_boot_app;
    SET ROLE geld_boot_app;`);
  poolAufPglite(db);
  return db;
}

function aussenweltAbfangen() {
  const auflegen = [];
  globalThis.fetch = async (url, optionen = {}) => {
    const ziel = new URL(String(url));
    const methode = (optionen.method ?? "GET").toUpperCase();
    if (ziel.origin === TELNYX_BASIS && methode === "POST" && ziel.pathname.includes("/Calls/CA_geld_boot")) {
      const stellen = ziel.pathname.split("/");
      auflegen.push(stellen.at(-1));
      return new Response("{}", { status: 200 });
    }
    throw new Error(`Testaufbau: kein Zugriff nach außen (${methode} ${ziel.origin}${ziel.pathname})`);
  };
  return auflegen;
}

async function mandantAnlegen(store, { id, nummer }) {
  store.load().tenants.push({ id, status: "active", kycLevel: "card", ownerName: "Geld Boot" });
  store.load().numbers.push({
    id: `num_${id}`,
    tenantId: id,
    e164: nummer,
    provider: "telnyx",
    status: "active",
    providerNumberId: `pnum_${id}`,
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  store.save();
  await store.drainFlushes();
}

async function fremderAnruf(db, { id = ANRUF, carrierId = CARRIER_ID, mandant = MANDANT, laeuftSeitS = 600 }) {
  await db.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.current_tenant', $1, true)", [mandant]);
    await tx.query(
      `INSERT INTO call (id, tenant_id, stream_token, twilio_sid, direction, status, started_at, answered_at,
         provider, max_duration_s, frist_hoechstdauer_at)
       VALUES ($1, $2, $3, $4, 'inbound', 'active', (now() - $6 * interval '1 second')::text, to_char((now() - $6 * interval '1 second') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'telnyx', $5, now() + interval '1 hour')`,
      [id, mandant, `tok_${id}`, carrierId, MAX_DAUER_S, laeuftSeitS],
    );
  });
}

async function zeile(db, id = ANRUF, mandant = MANDANT) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.current_tenant', $1, true)", [mandant]);
    const { rows } = await tx.query("SELECT status, failure_reason, billed_at, frist_geld_at FROM call WHERE id = $1", [id]);
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
await mandantAnlegen(store, { id: MANDANT, nummer: "+4915799990051" });
await mandantAnlegen(store, { id: MANDANT_ZWEI, nummer: "+4915799990055" });
const server = await serverImportieren();
after(() => {
  server.closeAllConnections();
  server.close();
});

test("Kriterium 3: ein vom Boot-Takt gefundener Anruf, dessen Mandant die Kostendecke erreicht hat und den dieser Prozess nie gesehen hat, endet mit dem Budget-Grund, einmal aufgelegt, einmal abgerechnet", async () => {
  await fremderAnruf(db, {});
  assert.equal(store.getCall(ANRUF), null);
  await waitUntil(() => store.getCall(ANRUF)?.status === "completed", { timeoutMs: FRIST_BIS_BEENDET_MS });
  await store.drainFlushes();
  const ende = await zeile(db);
  assert.equal(ende.status, "completed");
  assert.equal(ende.failure_reason, BUDGET_FAILURE_REASON);
  assert.notEqual(ende.billed_at, null);
  assert.deepEqual(auflegen, [CARRIER_ID]);
});

test("Kriterium 3: ein fremder Anruf unter der Kostendecke bleibt nach der Pruefung im Spiegel dieses Prozesses ungebunden, und endet sein Besitzer ihn, zaehlt er hier nicht mehr", async () => {
  await fremderAnruf(db, { id: ANRUF_ZWEI, carrierId: "CA_geld_boot_zwei", mandant: MANDANT_ZWEI, laeuftSeitS: 10 });
  let geprueft = false;
  await waitUntil(
    () => {
      zeile(db, ANRUF_ZWEI, MANDANT_ZWEI).then((gelesen) => {
        geprueft = gelesen.frist_geld_at !== null;
      });
      return geprueft;
    },
    { timeoutMs: FRIST_BIS_BEENDET_MS },
  );
  assert.equal(store.getCall(ANRUF_ZWEI), null);
  await db.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.current_tenant', $1, true)", [MANDANT_ZWEI]);
    await tx.query("UPDATE call SET status = 'completed' WHERE id = $1", [ANRUF_ZWEI]);
  });
  assert.deepEqual(store.activeCallsFor(MANDANT_ZWEI), []);
  assert.equal((await zeile(db, ANRUF_ZWEI, MANDANT_ZWEI)).status, "completed");
});
