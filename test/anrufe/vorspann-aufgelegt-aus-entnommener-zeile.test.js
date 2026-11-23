import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { nowSeconds } from "../helpers.js";
import { postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { CALLEE_BEIN, EL_BEIN, HTTP_OK, elAuflegen, mitAnbieter, platziereUndHebeAb, zaehleMarke } from "./vorspann-zwei-instanzen-hilfen.js";

const ZEITGRENZE_MS = 120_000;
const WARTENDE_SQL = "SELECT count(*)::int AS anzahl FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()";
const ZEILE_SPERREN_SQL = "SELECT 1 FROM vorspann_zustand WHERE call_id = $1 FOR UPDATE";
const AUFGELEGT_SETZEN_SQL = "UPDATE vorspann_zustand SET aufgelegt = $2::jsonb WHERE call_id = $1";
const calleeAuflegen = (aufrufe) => aufrufe.auflegen.filter((url) => url.includes(CALLEE_BEIN));

function hangup(signer, srv, { callId, bein }) {
  const rumpf = JSON.stringify({
    data: { id: `evt-hangup-${callId}-${bein}`, event_type: "call.hangup", payload: { call_control_id: bein, status: "ok" } },
  });
  const zeitstempel = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf), "telnyx-timestamp": zeitstempel },
    body: rumpf,
  });
}

async function hangupMitZwischenaenderung({ a, sql, signer, aufrufe }, { vorher, bein }) {
  const { callId } = await platziereUndHebeAb({ a, b: a, sql, signer, aufrufe });
  await sql(AUFGELEGT_SETZEN_SQL, [callId, JSON.stringify([vorher])]);
  await sql("BEGIN");
  await sql(ZEILE_SPERREN_SQL, [callId]);
  const antwort = hangup(signer, a, { callId, bein });
  await zeilenBis(async () => (await sql(WARTENDE_SQL)).rows[0].anzahl, (anzahl) => anzahl >= 1);
  await sql(AUFGELEGT_SETZEN_SQL, [callId, "[]"]);
  await sql("COMMIT");
  assert.equal((await antwort).status, HTTP_OK);
}

test("Hangup des Callee-Beins legt das EL-Bein auf, auch wenn eine andere Instanz es nach dem Laden aus aufgelegt herausgenommen hat", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async (srv) => {
    await hangupMitZwischenaenderung(srv, { vorher: EL_BEIN, bein: CALLEE_BEIN });
    await zeilenBis(async () => srv.aufrufe, (aufrufe) => elAuflegen(aufrufe).length === 1);
  });
});

test("Hangup des EL-Beins legt das Callee-Bein auf, auch wenn eine andere Instanz es nach dem Laden aus aufgelegt herausgenommen hat", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async (srv) => {
    await hangupMitZwischenaenderung(srv, { vorher: CALLEE_BEIN, bein: EL_BEIN });
    await zeilenBis(async () => srv.aufrufe, (aufrufe) => calleeAuflegen(aufrufe).length === 1);
  });
});

test("Hangup eines Beins legt das andere Bein nicht noch einmal auf, wenn es wirklich schon aufgelegt ist", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async ({ a, sql, signer, aufrufe }) => {
    const { callId } = await platziereUndHebeAb({ a, b: a, sql, signer, aufrufe });
    await sql(AUFGELEGT_SETZEN_SQL, [callId, JSON.stringify([EL_BEIN])]);
    assert.equal((await hangup(signer, a, { callId, bein: CALLEE_BEIN })).status, HTTP_OK);
    await zeilenBis(async () => (await sql("SELECT count(*)::int AS anzahl FROM vorspann_zustand WHERE call_id = $1", [callId])).rows[0].anzahl, (anzahl) => anzahl === 0);
    assert.deepEqual(elAuflegen(aufrufe), []);
  });
});

test("Hangup eines Beins, dessen Zeile eine andere Instanz inzwischen entnommen hat, legt kein Bein auf und endet ohne Fehler", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async ({ a, sql, signer, aufrufe }) => {
    const { callId } = await platziereUndHebeAb({ a, b: a, sql, signer, aufrufe });
    await sql("BEGIN");
    await sql(ZEILE_SPERREN_SQL, [callId]);
    const antwort = hangup(signer, a, { callId, bein: CALLEE_BEIN });
    await zeilenBis(async () => (await sql(WARTENDE_SQL)).rows[0].anzahl, (anzahl) => anzahl >= 1);
    await sql("DELETE FROM vorspann_zustand WHERE call_id = $1", [callId]);
    await sql("COMMIT");
    assert.equal((await antwort).status, HTTP_OK);
    assert.equal(zaehleMarke([a], "ereignis fehlgeschlagen"), 0);
    assert.deepEqual(elAuflegen(aufrufe), []);
    assert.deepEqual(calleeAuflegen(aufrufe), []);
  });
});
