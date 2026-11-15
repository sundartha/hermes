import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

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
const FRIST_BIS_UMLEITUNG_MS = 20_000;
const WIEDERHOLT_LOG = /\[webhook-idempotenz\] wiederholte_zustellung weg=el-bein art=antwort_wiederholt/;
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

function warteBis(bedingung, quellen) {
  if (bedingung()) return Promise.resolve(true);
  return new Promise((fertig) => {
    const frist = AbortSignal.timeout(FRIST_BIS_UMLEITUNG_MS);
    const ende = () => {
      frist.removeEventListener("abort", ende);
      for (const quelle of quellen) quelle.off("data", pruefe);
      fertig(bedingung());
    };
    const pruefe = () => bedingung() && ende();
    frist.addEventListener("abort", ende);
    for (const quelle of quellen) quelle.on("data", pruefe);
  });
}

const ausgabenVon = (instanzen) => instanzen.flatMap((instanz) => [instanz.child.stdout, instanz.child.stderr]);

const senden = async (instanz, zustellung) =>
  (await abrufMitFrist(`${instanz.localUrl}${zustellung.pfad}`, zustellung.optionen)).status;

function starteTelnyxAttrappe(umleitungen, ereignisse) {
  return starteAttrappe((anfrage, antwort) => {
    anfrage.resume();
    anfrage.on("end", () => {
      if (anfrage.url === UMLEITUNGS_PFAD) {
        umleitungen.push(anfrage.url);
        ereignisse.emit("data");
      }
      antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
      antwort.end("{}");
    });
  });
}

test("el-bein gleichzeitig an zwei Instanzen: die Umleitung in den Rückfall wird genau einmal ausgelöst", async (t) => {
  const umleitungen = [];
  const ereignisse = new EventEmitter();
  const telnyx = await starteTelnyxAttrappe(umleitungen, ereignisse);
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
    await warteBis(
      () => umleitungen.length > 0 && WIEDERHOLT_LOG.test(a.stdout + b.stdout),
      [ereignisse, ...ausgabenVon([a, b])],
    );
    assert.equal(umleitungen.length, EINE_UMLEITUNG);
    assert.match(a.stdout + b.stdout, WIEDERHOLT_LOG);
  });
});
