import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { importNachKonfiguration } from "../gemeinsam/umgebung-import.js";
import { postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";
import { startServer } from "../helpers.js";

const ZEITGRENZE_MS = 240_000;
const GRENZEN = Object.freeze({ jeAnruf: 2, jeMandant: 4, haltefristMs: 25_000 });
const ANRUF = (callId) => ({ callId, tenantId: "tenant_a", ...GRENZEN });
const ABLAUF_SQL = "UPDATE konsult_platz SET ablauf_um = now() - interval '1 minute' WHERE platz_id = $1";

async function oeffnePostgresPlaetze(t) {
  const db = await echteDatenbankMitRolle(t);
  await (await startServer({ env: pgStartUmgebung(db.adresse) })).stop();
  const verwaltung = new pg.Client({ connectionString: db.adresse });
  verwaltung.on("error", () => {});
  await verwaltung.connect();
  t.after(() => verwaltung.end().catch(() => {}));
  const [{ konsultPlaetze, oeffneSpeicher }, delivery] = await importNachKonfiguration(
    {},
    { store: { storeBackend: "pg", databaseUrl: db.adresse } },
    () => import("../../src/store.js"),
    () => import("../../src/consult/delivery.js"),
  );
  await oeffneSpeicher();
  return { konsultPlaetze, delivery, sql: (text, parameter) => verwaltung.query(text, parameter) };
}

test("Mit Postgres melden die Plaetze der Fassade ihre offenen Abrufe je Anruf", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden() || !process.env[POSTGRES_VARIABLE]) return;
  const { konsultPlaetze, delivery, sql } = await oeffnePostgresPlaetze(t);

  await t.test("offenJeAnruf zaehlt die Plaetze je Anruf und nach dem Freigeben einen weniger", async () => {
    const erster = await konsultPlaetze.belegen(ANRUF("pg-offen-1"));
    await konsultPlaetze.belegen(ANRUF("pg-offen-1"));
    assert.equal(await konsultPlaetze.offenJeAnruf("pg-offen-1"), 2);
    assert.equal(await konsultPlaetze.offenJeAnruf("pg-offen-anderer"), 0);
    await konsultPlaetze.freigeben(erster);
    assert.equal(await konsultPlaetze.offenJeAnruf("pg-offen-1"), 1);
  });

  await t.test("offenJeAnruf zaehlt abgelaufene Plaetze nicht mit", async () => {
    const abgelaufen = await konsultPlaetze.belegen(ANRUF("pg-offen-2"));
    await konsultPlaetze.belegen(ANRUF("pg-offen-2"));
    await sql(ABLAUF_SQL, [abgelaufen]);
    assert.equal(await konsultPlaetze.offenJeAnruf("pg-offen-2"), 1);
  });

  await t.test("openPollCount der Zustellung wirft nicht und liefert die Zahl der offenen Plaetze", async () => {
    const zustellung = delivery.makeConsultDelivery({ store: { konsultPlaetze } });
    await konsultPlaetze.belegen(ANRUF("pg-offen-3"));
    assert.equal(await zustellung.openPollCount("pg-offen-3"), 1);
    assert.equal(await zustellung.openPollCount("pg-offen-anderer"), 0);
  });

  await t.test("Antwortet die Datenbank nicht, liefert offenJeAnruf 0 und protokolliert den Grund", async (u) => {
    await konsultPlaetze.belegen(ANRUF("pg-offen-4"));
    const fehler = u.mock.method(console, "error", () => {});
    await sql("BEGIN");
    await sql("LOCK TABLE konsult_platz IN ACCESS EXCLUSIVE MODE");
    let offen;
    try {
      offen = await konsultPlaetze.offenJeAnruf("pg-offen-4");
    } finally {
      await sql("COMMIT");
    }
    assert.equal(offen, 0);
    assert.equal(fehler.mock.calls.length, 1);
    assert.match(String(fehler.mock.calls[0].arguments[0]), /\[konsult-plaetze\] Datenbank nicht erreichbar/);
    assert.equal(await konsultPlaetze.offenJeAnruf("pg-offen-4"), 1);
  });
});
