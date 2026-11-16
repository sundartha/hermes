import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { nowSeconds } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { mitInstanzenAufPostgres, zeilenBis } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const BEENDET_AUF_A = "call_flush_beendet_a";
const AKTIV_AUF_B = "call_flush_aktiv_b";
const LANG_VERGANGEN = "2020-01-01T00:00:00.000Z";
const ZIEL = "+4915112345678";
const ABSENDER = "+4930555000300";
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, answered_at, max_duration_s, provider)
  VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, $8, $8, 60, 'telnyx')`;
const SEGMENT_SQL =
  "INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1, $2, $3, $4, now()::text)";
const STATUS_SQL = "SELECT status FROM call WHERE id = $1";
const ZAHL_SQL = "SELECT count(*)::int AS n FROM call WHERE id = $1";
const SEGMENTE_SQL = "SELECT count(*)::int AS n FROM transcript_segment WHERE call_id = $1";

async function legeAnruf(sql, id, status) {
  await sql(ANRUF_SQL, [id, BOOTSTRAP_TENANT_ID, `tok_${id}`, status, ABSENDER, ZIEL, "Termin", LANG_VERGANGEN]);
}

function signierterStatus(signer, callId) {
  const rumpf = new URLSearchParams({ CallStatus: "ringing", CallSid: `CA_${callId}` }).toString();
  const zeitstempel = String(nowSeconds());
  return {
    pfad: `/voice/status?callId=${callId}`,
    optionen: {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf),
        "telnyx-timestamp": zeitstempel,
      },
      body: rumpf,
    },
  };
}

test("Ein Flush auf Instanz B loescht den auf Instanz A beendeten Anruf samt Transkript nicht", async (t) => {
  await mitInstanzenAufPostgres(t, {}, async ({ instanzen: [, b], sql, signer }) => {
    await legeAnruf(sql, BEENDET_AUF_A, "completed");
    await sql(SEGMENT_SQL, [BEENDET_AUF_A, BOOTSTRAP_TENANT_ID, "agent", "Auf Wiederhoeren"]);
    await legeAnruf(sql, AKTIV_AUF_B, "active");
    const zustellung = signierterStatus(signer, AKTIV_AUF_B);
    const antwort = await abrufMitFrist(`${b.localUrl}${zustellung.pfad}`, zustellung.optionen);
    assert.equal(antwort.status, HTTP_OK);
    const status = await zeilenBis(
      async () => (await sql(STATUS_SQL, [AKTIV_AUF_B])).rows[0].status,
      (wert) => wert !== "active",
    );
    assert.equal(status, "failed");
    assert.equal((await sql(ZAHL_SQL, [BEENDET_AUF_A])).rows[0].n, 1);
    assert.equal((await sql(SEGMENTE_SQL, [BEENDET_AUF_A])).rows[0].n, 1);
    const gelesen = await abrufMitFrist(`${b.localUrl}/api/calls/${BEENDET_AUF_A}`);
    assert.equal(gelesen.status, HTTP_OK);
    const anruf = await gelesen.json();
    assert.equal(anruf.transcript[0].text, "Auf Wiederhoeren");
  });
});
