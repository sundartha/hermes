import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { brecheAb, mitZweiInstanzenUndGespraechsende, sendeEnde } from "./zwei-instanzen-kernwege-hilfen.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const STATUS_SQL = "SELECT status, failure_reason FROM call WHERE id = $1";
const GESPRAECH = Object.freeze([
  { role: "agent", message: "Guten Tag, ich rufe wegen des Termins an." },
  { role: "user", message: "Ja, worum geht es genau?" },
]);

const ZEILEN_SQL = "SELECT count(*)::int AS anzahl FROM transcript_segment WHERE call_id = $1";
const BENACHRICHTIGUNG_SQL = "SELECT count(*)::int AS anzahl FROM notification WHERE call_id = $1";

const vorspannGesprochen = (sql, callId) =>
  zeilenBis(
    async () => (await sql(ZEILEN_SQL, [callId])).rows[0].anzahl,
    (anzahl) => anzahl >= 1,
  );

const endeVerarbeitet = (sql, callId) =>
  zeilenBis(
    async () => (await sql(BENACHRICHTIGUNG_SQL, [callId])).rows[0].anzahl,
    (anzahl) => anzahl >= 1,
  );

async function zeile(sql, callId) {
  return (await sql(STATUS_SQL, [callId])).rows[0];
}

test("T9 Abbruch auf B, danach Ende auf A: der Anruf bleibt abgebrochen und A ueberschreibt den Fehlergrund nicht", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiInstanzenUndGespraechsende(t, async ({ a, b, sql, rufeAn, beendeGespraech }) => {
    const callId = await rufeAn(a);
    await vorspannGesprochen(sql, callId);
    const abbruch = await brecheAb(b, callId);
    assert.equal(abbruch.status, HTTP_OK);
    assert.equal((await abbruch.json()).status, "cancelled");
    const nachAbbruch = await zeile(sql, callId);
    assert.equal(nachAbbruch.status, "cancelled");
    beendeGespraech(`conv_${callId}`, GESPRAECH);
    await sendeEnde(a, callId);
    await endeVerarbeitet(sql, callId);
    assert.deepEqual(await zeile(sql, callId), nachAbbruch);
  });
});

test("T9 Ende auf A, danach Abbruch auf B: der beendete Anruf bleibt beendet und B meldet seinen Endstatus", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiInstanzenUndGespraechsende(t, async ({ a, b, sql, rufeAn, beendeGespraech }) => {
    const callId = await rufeAn(a);
    await vorspannGesprochen(sql, callId);
    beendeGespraech(`conv_${callId}`, GESPRAECH);
    await sendeEnde(a, callId);
    await endeVerarbeitet(sql, callId);
    const nachEnde = await zeile(sql, callId);
    assert.notEqual(nachEnde.status, "active");
    const abbruch = await brecheAb(b, callId);
    assert.equal(abbruch.status, HTTP_OK);
    assert.equal((await abbruch.json()).status, nachEnde.status);
    assert.deepEqual(await zeile(sql, callId), nachEnde);
  });
});
