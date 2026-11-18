import { test, after } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir, waitUntil } from "../helpers.js";
import { CONVERSATION_FAILED_UNVERIFIED_ORIGINATION } from "../fixtures/elevenlabs-conversations.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "t_abfrage_boot";
const ANRUF = "call_abfrage_boot";
const ANRUF_FEHLER = "call_abfrage_fehler";
const ANRUF_NEU = "call_abfrage_neu";
const ANRUF_KETTE = "call_abfrage_kette";
const ANRUF_WEG = "call_abfrage_weg";
const EL_BASIS = "https://el.abfrage-boot.invalid";
const FRIST_BIS_ABRUF_MS = 10_000;
const ABFRAGE_FRIST_MS = 60_000;
const FEHLER_ZEILE = `[fristen] Abfrage-Frist schreiben fehlgeschlagen: ${ANRUF_FEHLER} `;

function umgebungSetzen() {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://abfrage-boot-attrappe.invalid/hermes",
    SESSION_SECRET: "abfrage-boot-signierwert",
    TELNYX_API_KEY: "KEYtest-abfrage-boot",
    TELNYX_API_BASE: "https://telnyx.abfrage-boot.invalid",
    TELNYX_ACCOUNT_SID: "AC_abfrage_boot",
    FRISTEN_TAKT_MS: "40",
    ELEVENLABS_API_KEY: "el-abfrage-boot",
    ELEVENLABS_API_BASE: EL_BASIS,
    ELEVENLABS_RESULT_POLL_MS: "60000",
  });
}

async function datenbankAnlegen(storeHolen) {
  const anlegen = aufraeumenVormerken(storeHolen);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE abfrage_boot_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO abfrage_boot_app;
    SET ROLE abfrage_boot_app;`);
  poolAufPglite(db);
  return db;
}

const imMandanten = (db, anweisung, parameter = []) =>
  db.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.current_tenant', $1, true)", [MANDANT]);
    return (await tx.query(anweisung, parameter)).rows;
  });

const fristVon = async (db, id) =>
  (await imMandanten(db, "SELECT frist_abfrage_at AS frist, now() AS jetzt FROM call WHERE id = $1", [id]))[0];

const fremderAnruf = (db, id) =>
  imMandanten(
    db,
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, answered_at, provider, max_duration_s,
       elevenlabs_conversation_id, frist_abfrage_at)
     VALUES ($1, $2, $3, 'inbound', 'active', now()::text, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'telnyx', 600, $4, now() - interval '1 minute')`,
    [id, MANDANT, `tok_${id}`, `conv_${id}`],
  );

async function beenden(db, id) {
  await imMandanten(db, "UPDATE call SET status = 'completed' WHERE id = $1", [id]);
  const gespiegelt = store.getCall(id);
  if (gespiegelt) gespiegelt.status = "completed";
}

const abrufeVon = (id) => abrufe.filter((konversation) => konversation === `conv_${id}`).length;

async function einenTaktAbwarten(id) {
  await fremderAnruf(db, id);
  await waitUntil(() => abrufeVon(id) > 0, { timeoutMs: FRIST_BIS_ABRUF_MS });
  await beenden(db, id);
}

let store = null;
const fehlerzeilen = [];
const abrufe = [];
const fristenBeimAbruf = [];
umgebungSetzen();
const db = await datenbankAnlegen(() => store);
const echtesError = console.error.bind(console);
console.error = (...teile) => {
  fehlerzeilen.push(teile.map(String).join(" "));
  echtesError(...teile);
};
globalThis.fetch = async (url) => {
  const ziel = new URL(String(url));
  if (ziel.origin !== EL_BASIS) throw new Error(`Testaufbau: kein Zugriff nach außen (${ziel.origin}${ziel.pathname})`);
  const konversation = ziel.pathname.split("/").at(-1);
  if (konversation === `conv_${ANRUF}`) fristenBeimAbruf.push(await fristVon(db, ANRUF));
  abrufe.push(konversation);
  const antwort =
    konversation === `conv_${ANRUF_NEU}` && abrufe.filter((eintrag) => eintrag === konversation).length === 1
      ? CONVERSATION_FAILED_UNVERIFIED_ORIGINATION
      : { status: "in-progress", transcript: [], metadata: {} };
  return new Response(JSON.stringify(antwort), { status: 200 });
};
store = await import("../../src/store.js");
await store.oeffneSpeicher();
store.load().tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Abfrage Boot" });
store.load().numbers.push({
  id: "num_abfrage_boot",
  tenantId: MANDANT,
  e164: "+4915799990061",
  provider: "telnyx",
  status: "active",
  providerNumberId: "pnum_abfrage_boot",
  country: "DE",
  language: "de",
  paymentIntentId: null,
});
store.save();
await store.drainFlushes();
await db.exec(`CREATE FUNCTION abfrage_fehler() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'schreiben verweigert'; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER abfrage_fehler BEFORE UPDATE OF frist_abfrage_at ON call FOR EACH ROW
  WHEN (NEW.id = '${ANRUF_FEHLER}') EXECUTE FUNCTION abfrage_fehler();
  CREATE FUNCTION abfrage_weg() RETURNS trigger AS $$ BEGIN DELETE FROM call WHERE id = NEW.id; RETURN NULL; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER abfrage_weg AFTER UPDATE OF frist_abfrage_lease_bis ON call FOR EACH ROW
  WHEN (NEW.id = '${ANRUF_WEG}') EXECUTE FUNCTION abfrage_weg()`);
const server = await serverImportieren();
after(() => {
  server.closeAllConnections();
  server.close();
});

test("Kriterium 5: der Boot-Takt fragt die Abfrage eines Anrufs, den dieser Prozess nie gesehen hat, ohne Neuaufbau an; die Frist steht beim Abruf schon in der Zukunft, danach auf jetzt plus Abruf-Frist plus Uebernahmezeit, und es folgt keine zweite Abfrage", async () => {
  await fremderAnruf(db, ANRUF);
  assert.equal(store.getCall(ANRUF), null);
  await waitUntil(() => abrufe.includes(`conv_${ANRUF}`), { timeoutMs: FRIST_BIS_ABRUF_MS });
  await einenTaktAbwarten("sonde_a");
  await einenTaktAbwarten("sonde_b");
  const { frist, jetzt } = await fristVon(db, ANRUF);
  await beenden(db, ANRUF);
  assert.deepEqual(abrufe.filter((konversation) => konversation === `conv_${ANRUF}`), [`conv_${ANRUF}`]);
  assert.equal(fristenBeimAbruf.length, 1);
  assert.ok(fristenBeimAbruf[0].frist.getTime() > fristenBeimAbruf[0].jetzt.getTime());
  assert.ok(frist.getTime() > jetzt.getTime() + ABFRAGE_FRIST_MS - FRIST_BIS_ABRUF_MS, frist.toISOString());
  assert.ok(frist.getTime() <= jetzt.getTime() + ABFRAGE_FRIST_MS, frist.toISOString());
});

test("Kriterium 5: scheitert das Schreiben der Frist, steht der Fehler mit Anruf-ID im Log und der Abruf laeuft trotzdem", async () => {
  await fremderAnruf(db, ANRUF_FEHLER);
  await waitUntil(() => abrufe.includes(`conv_${ANRUF_FEHLER}`), { timeoutMs: FRIST_BIS_ABRUF_MS });
  await beenden(db, ANRUF_FEHLER);
  assert.ok(fehlerzeilen.some((zeile) => zeile.startsWith(FEHLER_ZEILE)), fehlerzeilen.join("\n"));
});

const frischFaellig = (db, id) =>
  imMandanten(db, "UPDATE call SET status = 'active', frist_abfrage_at = now() - interval '1 minute', frist_abfrage_lease_bis = NULL WHERE id = $1", [id]);

test("Kriterium 5: fuehrt dieser Prozess die Abfrage-Kette eines Anrufs schon, startet der Boot-Takt bei erneut faelliger Frist keine zweite", async () => {
  await fremderAnruf(db, ANRUF_KETTE);
  await waitUntil(() => abrufeVon(ANRUF_KETTE) === 1, { timeoutMs: FRIST_BIS_ABRUF_MS });
  await frischFaellig(db, ANRUF_KETTE);
  await waitUntil(() => abrufeVon(ANRUF_KETTE) === 2, { timeoutMs: FRIST_BIS_ABRUF_MS });
  await einenTaktAbwarten("sonde_c");
  await einenTaktAbwarten("sonde_d");
  await beenden(db, ANRUF_KETTE);
  assert.equal(abrufeVon(ANRUF_KETTE), 2);
});

test("Kriterium 5: ist die Abfrage-Kette eines Anrufs in diesem Prozess zu Ende, fragt der Boot-Takt bei erneut faelliger Frist wieder ab", async () => {
  await fremderAnruf(db, ANRUF_NEU);
  await waitUntil(() => store.getCall(ANRUF_NEU)?.status === "failed", { timeoutMs: FRIST_BIS_ABRUF_MS });
  assert.equal(abrufeVon(ANRUF_NEU), 1);
  store.getCall(ANRUF_NEU).status = "active";
  await frischFaellig(db, ANRUF_NEU);
  await waitUntil(() => abrufeVon(ANRUF_NEU) === 2, { timeoutMs: FRIST_BIS_ABRUF_MS });
  await beenden(db, ANRUF_NEU);
});

test("Kriterium 5: ist der Anruf einer faelligen Abfrage beim Start der Abfrage schon aus der Datenbank verschwunden, fragt der Boot-Takt nicht an und meldet keinen Fehler", async () => {
  await fremderAnruf(db, ANRUF_WEG);
  await einenTaktAbwarten("sonde_e");
  await einenTaktAbwarten("sonde_f");
  assert.deepEqual(await imMandanten(db, "SELECT id FROM call WHERE id = $1", [ANRUF_WEG]), []);
  assert.equal(abrufeVon(ANRUF_WEG), 0);
  assert.deepEqual(fehlerzeilen.filter((zeile) => zeile.includes(ANRUF_WEG)), []);
});
