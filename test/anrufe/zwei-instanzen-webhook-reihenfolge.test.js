import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { antwortVon, mitInstanzenAufPostgres, signierteZustellung, zeilenBis } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ANRUF = "call_kernweg_t4";
const STATUS_SQL = "SELECT status FROM call WHERE id = $1";
const ANGENOMMEN_LOG = `"callId":"${ANRUF}","status":"in-progress"`;

const statusZustellung = (signer, callStatus) => ({
  ...signierteZustellung(signer, { callId: ANRUF, felder: { CallStatus: callStatus, CallSid: `CA_${ANRUF}` } }),
  pfad: `/voice/status?callId=${ANRUF}`,
});

const zeigtEndstatus = async (instanz) => {
  const antwort = await abrufMitFrist(`${instanz.localUrl}/api/calls/${ANRUF}`);
  assert.equal(antwort.status, HTTP_OK);
  return (await antwort.json()).status;
};

const warteAufStatus = (sql, erwartet) =>
  zeilenBis(
    async () => (await sql(STATUS_SQL, [ANRUF])).rows[0].status,
    (status) => status === erwartet,
  );

async function sende(instanz, zustellung) {
  assert.equal((await antwortVon(instanz, zustellung)).status, HTTP_OK);
}

test("T4 A zuerst: Abheben auf Instanz A, danach Auflegen auf Instanz B beendet den Anruf, beide Instanzen zeigen den Endstatus", async (t) => {
  await mitInstanzenAufPostgres(t, { anrufe: [ANRUF] }, async ({ instanzen: [a, b], sql, signer }) => {
    await sende(a, statusZustellung(signer, "in-progress"));
    await zeilenBis(async () => a.stdout, (text) => text.includes(ANGENOMMEN_LOG));
    await sende(b, statusZustellung(signer, "completed"));
    assert.equal(await warteAufStatus(sql, "completed"), "completed");
    assert.equal(await zeigtEndstatus(a), "completed");
    assert.equal(await zeigtEndstatus(b), "completed");
  });
});

test("T4 B zuerst: Auflegen auf Instanz B, danach Abheben auf Instanz A setzt den Anruf nicht wieder auf aktiv", async (t) => {
  await mitInstanzenAufPostgres(t, { anrufe: [ANRUF] }, async ({ instanzen: [a, b], sql, signer }) => {
    await sende(b, statusZustellung(signer, "completed"));
    await warteAufStatus(sql, "completed");
    await sende(a, statusZustellung(signer, "in-progress"));
    await zeilenBis(async () => a.stdout, (text) => text.includes(ANGENOMMEN_LOG));
    assert.equal((await sql(STATUS_SQL, [ANRUF])).rows[0].status, "completed");
    assert.equal(await zeigtEndstatus(a), "completed");
    assert.equal(await zeigtEndstatus(b), "completed");
  });
});
