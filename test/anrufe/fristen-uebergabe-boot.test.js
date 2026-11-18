import { test, after } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir, waitUntil } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "t_uebergabe_boot";
const ANRUF = "call_uebergabe_boot";
const TRAEGER = "CA_uebergabe_boot";
const TELNYX_BASIS = "https://telnyx.uebergabe-boot.invalid";
const FRIST_BIS_AUFLEGEN_MS = 10_000;

function umgebungSetzen() {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://uebergabe-boot-attrappe.invalid/hermes",
    SESSION_SECRET: "uebergabe-boot-signierwert",
    TELNYX_API_KEY: "KEYtest-uebergabe-boot",
    TELNYX_API_BASE: TELNYX_BASIS,
    TELNYX_ACCOUNT_SID: "AC_uebergabe_boot",
    FRISTEN_TAKT_MS: "40",
  });
}

async function datenbankAnlegen(storeHolen) {
  const anlegen = aufraeumenVormerken(storeHolen);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE uebergabe_boot_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO uebergabe_boot_app;
    SET ROLE uebergabe_boot_app;`);
  poolAufPglite(db);
  return db;
}

const imMandanten = (db, anweisung, parameter = []) =>
  db.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.current_tenant', $1, true)", [MANDANT]);
    return (await tx.query(anweisung, parameter)).rows;
  });

const fremderAnruf = (db, id) =>
  imMandanten(
    db,
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, answered_at, provider, max_duration_s,
       twilio_sid, cost_profile, frist_uebergabe_at)
     VALUES ($1, $2, $3, 'inbound', 'active', now()::text, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'telnyx', 600, $4, 'telnyx_inbound_el_convai', now() - interval '1 minute')`,
    [id, MANDANT, `tok_${id}`, TRAEGER],
  );

const anfragen = [];
let store = null;
umgebungSetzen();
const db = await datenbankAnlegen(() => store);
globalThis.fetch = async (url, optionen = {}) => {
  const ziel = new URL(String(url));
  if (ziel.origin !== TELNYX_BASIS) throw new Error(`Testaufbau: kein Zugriff nach außen (${ziel.origin}${ziel.pathname})`);
  const form = new URLSearchParams(String(optionen.body));
  anfragen.push({ pfad: ziel.pathname, status: form.get("Status"), url: form.get("Url") });
  return new Response("{}", { status: form.get("Url") ? 500 : 200 });
};
store = await import("../../src/store.js");
await store.oeffneSpeicher();
store.load().tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Uebergabe Boot" });
store.load().numbers.push({
  id: "num_uebergabe_boot",
  tenantId: MANDANT,
  e164: "+4915799990071",
  provider: "telnyx",
  status: "active",
  providerNumberId: "pnum_uebergabe_boot",
  country: "DE",
  language: "de",
  paymentIntentId: null,
});
store.save();
await store.drainFlushes();
const server = await serverImportieren();
after(() => {
  server.closeAllConnections();
  server.close();
});

test("Kriterium 6: scheitert die Umleitung eines Anrufs, den dieser Prozess nie gesehen hat, legt der Boot-Takt das Traegerbein ueber die gelesene Zeile auf und leert die Frist", async () => {
  await fremderAnruf(db, ANRUF);
  assert.equal(store.getCall(ANRUF), null);
  await waitUntil(() => anfragen.some((anfrage) => anfrage.status === "completed"), { timeoutMs: FRIST_BIS_AUFLEGEN_MS });
  const aufgelegt = anfragen.filter((anfrage) => anfrage.status === "completed");
  assert.deepEqual(aufgelegt.map((anfrage) => anfrage.pfad.split("/").at(-1)), [TRAEGER]);
  assert.ok(anfragen.some((anfrage) => anfrage.url === `${BASE_ENV.PUBLIC_URL}/voice/el-rueckfall?callId=${ANRUF}&quelle=frist`), JSON.stringify(anfragen));
  await waitUntil(
    async () => (await imMandanten(db, "SELECT frist_uebergabe_at FROM call WHERE id = $1", [ANRUF]))[0].frist_uebergabe_at === null,
    { timeoutMs: FRIST_BIS_AUFLEGEN_MS },
  );
});
