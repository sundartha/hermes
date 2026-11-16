import assert from "node:assert/strict";
import { test } from "node:test";

import { startRecordingAnthropicMock } from "../_outbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { mitDatenbankVorDemStart, signierteZustellung } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ZIEL = "+4915112349977";
const FREMDER_MANDANT = "t_runde_fremd";
const EIGENES_ERGEBNIS = "Termin am Montag um zehn";
const FREMDES_ERGEBNIS = "Geheimnis des Fremden";
const MANDANT_SQL = "INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)";
const FREIGABE_SQL = "UPDATE settings SET allow_call_memory = true WHERE tenant_id = $1";
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, answered_at, max_duration_s, provider, result)
  VALUES ($1, $2, $3, 'outbound', $4, '+4930555000302', $5, 'Testziel', $6, $6, 600, 'telnyx', $7)`;

const ergebnis = (outcome) => JSON.stringify({ outcome, facts: [] });

test("Eine Gespraechsrunde auf einer Instanz nennt dem Modell das Ergebnis eines frueheren Anrufs derselben Nummer und keines eines anderen Mandanten", async (t) => {
  const modell = await startRecordingAnthropicMock();
  try {
    await mitDatenbankVorDemStart(t, { env: { ANTHROPIC_BASE_URL: modell.url } }, async ({ sql, signer, starte }) => {
      assert.equal((await sql(FREIGABE_SQL, [BOOTSTRAP_TENANT_ID])).rowCount, 1);
      const instanz = await starte();
      await sql(MANDANT_SQL, [FREMDER_MANDANT]);
      const frueher = new Date(Date.now() - 3_600_000).toISOString();
      const jetzt = new Date().toISOString();
      await sql(ANRUF_SQL, ["call_runde_alt", BOOTSTRAP_TENANT_ID, "tok_alt", "completed", ZIEL, frueher, ergebnis(EIGENES_ERGEBNIS)]);
      await sql(ANRUF_SQL, ["call_runde_fremd", FREMDER_MANDANT, "tok_fremd", "completed", ZIEL, frueher, ergebnis(FREMDES_ERGEBNIS)]);
      await sql(ANRUF_SQL, ["call_runde_jetzt", BOOTSTRAP_TENANT_ID, "tok_jetzt", "active", ZIEL, jetzt, null]);
      const zustellung = signierteZustellung(signer, { callId: "call_runde_jetzt", felder: { SpeechResult: "Hallo" } });
      const antwort = await abrufMitFrist(`${instanz.localUrl}${zustellung.pfad}`, zustellung.optionen);
      assert.equal(antwort.status, HTTP_OK);
      assert.equal(modell.bodies.length, 1);
      const system = JSON.stringify(modell.bodies[0].system);
      assert.ok(system.includes(EIGENES_ERGEBNIS), system);
      assert.ok(!system.includes(FREMDES_ERGEBNIS), system);
    });
  } finally {
    await modell.close();
  }
});
