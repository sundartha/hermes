import assert from "node:assert/strict";
import { test } from "node:test";

import { echteDatenbank } from "../gemeinsam/echtes-postgres.js";
import { echtWarten } from "../echt-warten.js";
import { ABLAGE_TABELLE, sitzungenBeschrieben, wartendeAufAblage, wartendeBisLesungen } from "./wartende-auf-ablage.js";

const ANLEGEN_SQL = `CREATE TABLE ${ABLAGE_TABELLE} (anker text)`;
const SPERRE_SQL = `LOCK TABLE ${ABLAGE_TABELLE} IN ACCESS EXCLUSIVE MODE`;
const LESEN_SQL = `SELECT * FROM ${ABLAGE_TABELLE}`;
const PID_SQL = "SELECT pg_backend_pid() AS pid";

const sqlAuf = (verbindung) => (text) => verbindung.query(text);

async function pidVon(verbindung) {
  const { rows: [zeile] } = await verbindung.query(PID_SQL);
  return zeile.pid;
}

async function legeTabelleAn(datenbank) {
  const verbindung = await datenbank.verbinden();
  await verbindung.query(ANLEGEN_SQL);
  return verbindung;
}

test("WARTENDE-DB: eine Sitzung, die in Datenbank B auf die Ablage wartet, zählt nur in B", async (t) => {
  const datenbankA = await echteDatenbank(t);
  const datenbankB = await echteDatenbank(t);
  if (!datenbankA || !datenbankB) return;
  const leseA = await legeTabelleAn(datenbankA);
  const sperreB = await legeTabelleAn(datenbankB);
  const leseB = await datenbankB.verbinden();
  const wartendePid = await pidVon(leseB);
  await sperreB.query("BEGIN");
  try {
    await sperreB.query(SPERRE_SQL);
    const wartend = leseB.query(LESEN_SQL).catch((fehler) => fehler);
    const inB = await wartendeBisLesungen(sqlAuf(sperreB), echtWarten);
    assert.equal(inB.length, 1, `Positiv-Kontrolle: B sieht genau eine Wartende; Sitzungen in B: ${await sitzungenBeschrieben(sqlAuf(sperreB))}`);
    assert.equal(inB[0].pid, wartendePid, "die Wartende in B ist die Lese-Sitzung");
    assert.deepEqual(await wartendeAufAblage(sqlAuf(leseA)), [], "A sieht die Wartende aus B nicht");
    await sperreB.query("ROLLBACK");
    assert.ok(!((await wartend) instanceof Error), "die Wartende läuft nach dem Freigeben durch");
  } finally {
    await sperreB.query("ROLLBACK").catch(() => undefined);
  }
});
