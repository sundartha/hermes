import assert from "node:assert/strict";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { nowSeconds } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import {
  WEBHOOK_ZUSTELLUNG_SECRET,
  mitDatenbankVorDemStart,
  mitInstanzHinterRelais,
  zeilenBis,
} from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ANRUF = "call_status1";
const ANRUF_HAENGT = "call_status2";
const EINE_ZUSAMMENFASSUNG = 1;
const RUHEZEIT_MS = 3_000;
const ANTWORT_FRIST_MS = 3_000;
const SEGMENT_SQL =
  "INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1, $2, $3, $4, now()::text)";
const STATUS_SQL = "SELECT status FROM call WHERE id = $1";
const OHNE_ERKENNUNG = "[webhook-idempotenz] wiederholte_zustellung weg=status art=ohne_erkennung grund=frist";

function signierterEndstatus(signer, callId) {
  const rumpf = new URLSearchParams({ CallStatus: "completed", CallSid: `CA_${callId}` }).toString();
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

const senden = async (instanz, zustellung) => {
  const antwort = await abrufMitFrist(`${instanz.localUrl}${zustellung.pfad}`, zustellung.optionen);
  return { status: antwort.status, text: await antwort.text() };
};

test("Status-Endzustellung gleichzeitig an zwei Instanzen: dieselbe Antwort, die Zusammenfassung entsteht genau einmal", async (t) => {
  await mitDatenbankVorDemStart(
    t,
    { anrufe: [ANRUF], env: { WEBHOOK_ZUSTELLUNG_SECRET } },
    async ({ sql, signer, modell, starte }) => {
      await sql(SEGMENT_SQL, [ANRUF, BOOTSTRAP_TENANT_ID, "caller", "Ich moechte einen Termin"]);
      await sql(SEGMENT_SQL, [ANRUF, BOOTSTRAP_TENANT_ID, "agent", "Gern, wann passt es Ihnen?"]);
      const [a, b] = [await starte(), await starte()];
      const vorher = modell.count();
      const zustellung = signierterEndstatus(signer, ANRUF);
      const [vonA, vonB] = await Promise.all([senden(a, zustellung), senden(b, zustellung)]);
      assert.equal(vonA.status, HTTP_OK);
      assert.deepEqual(vonB, vonA);
      await zeilenBis(async () => modell.count() - vorher, (anzahl) => anzahl >= EINE_ZUSAMMENFASSUNG);
      await echtWarten(RUHEZEIT_MS);
      assert.equal(modell.count() - vorher, EINE_ZUSAMMENFASSUNG);
    },
  );
});

test("Status-Endzustellung bei hängender Ablage: die Instanz verarbeitet sie trotzdem und antwortet rechtzeitig", async (t) => {
  await mitInstanzHinterRelais(t, { anrufe: [ANRUF_HAENGT] }, async ({ a, sql, signer, relais }) => {
    relais.anhalten();
    const beginn = Date.now();
    const antwort = await senden(a, signierterEndstatus(signer, ANRUF_HAENGT));
    assert.equal(antwort.status, HTTP_OK);
    assert.ok(Date.now() - beginn <= ANTWORT_FRIST_MS);
    assert.ok(a.stdout.includes(OHNE_ERKENNUNG), a.stdout);
    relais.fortsetzen();
    const stand = await zeilenBis(
      async () => (await sql(STATUS_SQL, [ANRUF_HAENGT])).rows[0].status,
      (status) => status === "completed",
    );
    assert.equal(stand, "completed");
  });
});
