import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { importNachKonfiguration } from "../gemeinsam/umgebung-import.js";
import { postgresVorhanden, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { startServer } from "../helpers.js";

const ZEITGRENZE_MS = 240_000;
const MANDANT = "t_meldung_sperre";
const KONTEXT_SQL = "SELECT set_config('app.current_tenant', $1, false)";
const MANDANT_SPERREN_SQL = "INSERT INTO tenant (id, status) VALUES ($1, 'active') ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id";
const ANRUF_SCHREIBEN_SQL = "UPDATE call SET summary = 'Flush' WHERE id = $1";
const WARTENDE_SQL = "SELECT count(*)::int AS anzahl FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'";
const MELDUNGEN_SQL = "SELECT count(*)::int AS anzahl FROM notification WHERE call_id = $1";

const anzahlVon = async (verbindung, sql, parameter) => {
  const { rows } = await verbindung.query(sql, parameter);
  return rows[0].anzahl;
};

async function verbinde(adresse, t) {
  const verbindung = new pg.Client({ connectionString: adresse });
  verbindung.on("error", () => {});
  await verbindung.connect();
  t.after(() => verbindung.end().catch(() => {}));
  return verbindung;
}

test("Die Abbruch-Meldung wartet auf den Flush einer anderen Instanz, statt mit ihm in einen Deadlock (40P01) zu laufen", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden() || !process.env[POSTGRES_VARIABLE]) return;
  const db = await echteDatenbankMitRolle(t);
  await (await startServer({ env: pgStartUmgebung(db.adresse) })).stop();
  const verwaltung = await verbinde(db.adresse, t);
  const flush = await verbinde(db.adresse, t);
  const [{ addNotification, createCall, oeffneSpeicher, persistCall }] = await importNachKonfiguration(
    {},
    { store: { storeBackend: "pg", databaseUrl: db.adresse } },
    () => import("../../src/store.js"),
  );
  await oeffneSpeicher();
  await verwaltung.query(KONTEXT_SQL, [MANDANT]);
  await verwaltung.query("INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)", [MANDANT]);
  const call = createCall({ direction: "outbound", from: "+4930555000403", to: "+4915112340013", goal: "Test", tenantId: MANDANT });
  await persistCall(call.id);

  await flush.query(KONTEXT_SQL, [MANDANT]);
  await flush.query("BEGIN");
  await flush.query(MANDANT_SPERREN_SQL, [MANDANT]);
  const meldung = addNotification("Anruf abgebrochen", "Der Anruf wurde abgebrochen.", call.id);
  const meldungGeschrieben = meldung.then(() => null, (fehler) => fehler);
  await zeilenBis(
    () => anzahlVon(verwaltung, WARTENDE_SQL),
    (anzahl) => anzahl >= 1,
  );
  let flushFehler = null;
  try {
    await flush.query(ANRUF_SCHREIBEN_SQL, [call.id]);
    await flush.query("COMMIT");
  } catch (fehler) {
    flushFehler = fehler;
    await flush.query("ROLLBACK");
  }
  const meldungFehler = await meldungGeschrieben;
  assert.equal(meldungFehler?.code, undefined);
  assert.equal(flushFehler?.code, undefined);
  assert.equal(await anzahlVon(verwaltung, MELDUNGEN_SQL, [call.id]), 1);
});
