import assert from "node:assert/strict";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { TELNYX_GAP10_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { nowSeconds } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { WEBHOOK_ZUSTELLUNG_SECRET, mitDatenbankVorDemStart } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ANRUF = "call_bein1";
const ANRUF_SID = "tnx_bein1";
const KONTO = "acct_bein";
const EINE_UMLEITUNG = 1;
const NACHLAUF_MS = 2_000;
const FRIST_BIS_UMLEITUNG_MS = 20_000;
const TAKT_MS = 200;
const KOSTENPROFIL_SQL =
  "UPDATE call SET cost_profile = 'telnyx_outbound_el_convai', twilio_sid = $2 WHERE id = $1";
const UMLEITUNGS_PFAD = `/v2/texml/Accounts/${KONTO}/Calls/${ANRUF_SID}`;

function signierterBeinStatus(signer) {
  const rumpf = new URLSearchParams({ CallStatus: "in-progress", CallSid: ANRUF_SID }).toString();
  const zeitstempel = String(nowSeconds());
  return {
    pfad: `/voice/el-bein?callId=${ANRUF}`,
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

const senden = async (instanz, zustellung) =>
  (await abrufMitFrist(`${instanz.localUrl}${zustellung.pfad}`, zustellung.optionen)).status;

function starteTelnyxAttrappe(umleitungen) {
  return starteAttrappe((anfrage, antwort) => {
    anfrage.resume();
    anfrage.on("end", () => {
      if (anfrage.url === UMLEITUNGS_PFAD) umleitungen.push(anfrage.url);
      antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
      antwort.end("{}");
    });
  });
}

test("el-bein gleichzeitig an zwei Instanzen: die Umleitung in den Rückfall wird genau einmal ausgelöst", async (t) => {
  const umleitungen = [];
  const telnyx = await starteTelnyxAttrappe(umleitungen);
  t.after(() => telnyx.close());
  const env = {
    TELNYX_API_BASE: telnyx.url,
    TELNYX_API_KEY: TELNYX_GAP10_SCHLUESSEL,
    TELNYX_ACCOUNT_SID: KONTO,
    WEBHOOK_ZUSTELLUNG_SECRET,
  };
  await mitDatenbankVorDemStart(t, { anrufe: [ANRUF], env }, async ({ sql, signer, starte }) => {
    await sql(KOSTENPROFIL_SQL, [ANRUF, ANRUF_SID]);
    await sql("UPDATE call SET answered_at = now()::text WHERE id = $1", [ANRUF]);
    const [a, b] = [await starte(), await starte()];
    const zustellung = signierterBeinStatus(signer);
    const [vonA, vonB] = await Promise.all([senden(a, zustellung), senden(b, zustellung)]);
    assert.equal(vonA, HTTP_OK);
    assert.equal(vonB, HTTP_OK);
    const ende = Date.now() + FRIST_BIS_UMLEITUNG_MS;
    while (umleitungen.length === 0 && Date.now() < ende) await echtWarten(TAKT_MS);
    await echtWarten(NACHLAUF_MS);
    assert.equal(umleitungen.length, EINE_UMLEITUNG);
  });
});
