import assert from "node:assert/strict";
import test from "node:test";

import { postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import {
  ABRECHNUNG_SQL,
  HTTP_OK,
  NUTZUNG_SQL,
  SCHLUESSEL_SPERRE_SQL,
  ZUSTAND_FEHLT,
  elAuflegen,
  ereignis,
  mitAnbieter,
  platziereUndHebeAb,
  zaehleMarke,
} from "./vorspann-zwei-instanzen-hilfen.js";

const ZEITGRENZE_MS = 120_000;

test("Ein spätes zweites Auflegen auf der anderen Instanz löst weder Rückfall noch zweites Auflegen noch zweite Buchung aus", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async (srv) => {
    const { callId } = await platziereUndHebeAb(srv);
    assert.equal((await ereignis(srv.signer, srv.a, { callId, art: "call.hangup", kennung: "a" })).status, HTTP_OK);
    await zeilenBis(async () => (await srv.sql(ABRECHNUNG_SQL, [callId])).rows, (zeilen) => zeilen[0].billed_at !== null);
    await zeilenBis(async () => elAuflegen(srv.aufrufe), (liste) => liste.length === 1);
    const nutzungVorher = (await srv.sql(NUTZUNG_SQL)).rows;
    const marke = `[vorspann] verarbeitet ${JSON.stringify({ callId, ereignis: "aufgelegt" })}`;
    assert.equal(zaehleMarke([srv.b], marke), 0);
    assert.equal((await ereignis(srv.signer, srv.b, { callId, art: "call.hangup", kennung: "b" })).status, HTTP_OK);
    await zeilenBis(async () => zaehleMarke([srv.b], marke), (anzahl) => anzahl === 1);
    assert.equal(zaehleMarke([srv.a, srv.b], ZUSTAND_FEHLT), 0);
    assert.equal(elAuflegen(srv.aufrufe).length, 1);
    assert.deepEqual((await srv.sql(NUTZUNG_SQL)).rows, nutzungVorher);
  });
});


test("Ein spätes zweites Auflegen auf einer Instanz, die den Anrufstatus nicht lesen kann, protokolliert den Lesefehler und tut nichts", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async (srv) => {
    const { callId } = await platziereUndHebeAb(srv);
    assert.equal((await ereignis(srv.signer, srv.a, { callId, art: "call.hangup", kennung: "a" })).status, HTTP_OK);
    await zeilenBis(async () => (await srv.sql(ABRECHNUNG_SQL, [callId])).rows, (zeilen) => zeilen[0].billed_at !== null);
    await zeilenBis(async () => elAuflegen(srv.aufrufe), (liste) => liste.length === 1);
    const nutzungVorher = (await srv.sql(NUTZUNG_SQL)).rows;
    const marke = `[vorspann] verarbeitet ${JSON.stringify({ callId, ereignis: "aufgelegt" })}`;
    await srv.sql("BEGIN");
    try {
      await srv.sql(SCHLUESSEL_SPERRE_SQL);
      assert.equal((await ereignis(srv.signer, srv.b, { callId, art: "call.hangup", kennung: "b" })).status, HTTP_OK);
      await zeilenBis(async () => zaehleMarke([srv.b], marke), (anzahl) => anzahl === 1);
    } finally {
      await srv.sql("ROLLBACK");
    }
    assert.equal(zaehleMarke([srv.b], `lesen fehlgeschlagen call=${callId}`), 1);
    assert.equal(zaehleMarke([srv.a, srv.b], ZUSTAND_FEHLT), 0);
    assert.equal(elAuflegen(srv.aufrufe).length, 1);
    assert.deepEqual((await srv.sql(NUTZUNG_SQL)).rows, nutzungVorher);
  });
});

