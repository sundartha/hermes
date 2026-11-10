import { test } from "node:test";
import assert from "node:assert/strict";

import { makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAttrappe } from "./attrappen-server.js";
import {
  mitHermesAufPostgresHartNeustartbar,
  postgresVorhanden,
  rufeAnMit,
  zeilenBis,
} from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const ZEITGRENZE_MS = 180_000;
const AUDIO_BYTES = 200_000;
const ZIEL = "+4915112399001";
const KENNUNG_SQL = "SELECT el_call_control_id AS kennung FROM call WHERE id = $1";

const koerperVon = (anfrage) =>
  new Promise((fertig) => {
    let roh = "";
    anfrage.on("data", (teil) => (roh += teil));
    anfrage.on("end", () => fertig(roh));
  });

async function starteTelnyxUndTtsAttrappe() {
  return starteAttrappe(async (req, res) => {
    const roh = await koerperVon(req);
    if (req.url.startsWith("/v1/text-to-speech/")) {
      res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
      return res.end(Buffer.alloc(AUDIO_BYTES, 1));
    }
    const befehl = req.url === "/v2/calls" ? JSON.parse(roh).command_id : "";
    const kennung = befehl.replace(/^vorspann-/, "");
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { call_control_id: `cc_${kennung}`, sid: "v3:el-bein", result: "ok" } }));
  });
}

const umgebungFuer = (attrappe, signer) => ({
  ...elInboundInitSpawnEnv("agent_el_bein_pg"),
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  TELNYX_CALL_CONTROL_APP_ID: "cc_app_el_bein",
  ELEVENLABS_API_BASE: attrappe.url,
  TELNYX_API_BASE: attrappe.url,
  TELNYX_API_KEY: "KEYtest-el-bein",
  TELNYX_CONNECTION_ID: "conn_el_bein",
  TELNYX_ACCOUNT_SID: "acct_el_bein",
  SKIP_TWILIO_SIGNATURE_CHECK: "false",
  TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
  PUBLIC_URL: "https://agent.test",
});

function sendeAbgehoben(srv, signer, callId) {
  const roh = JSON.stringify({
    data: { id: `evt-el-bein-${callId}`, event_type: "call.answered", payload: { call_control_id: `cc_${callId}` } },
  });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": signer.sign(zeit, roh) },
    body: roh,
  });
}

test(
  "3553-K2: nach der Wahl des EL-Beins steht die Kennung in der Datenbank und ueberlebt einen harten Neustart",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const attrappe = await starteTelnyxUndTtsAttrappe();
    const signer = makeTelnyxSigner();
    try {
      await mitHermesAufPostgresHartNeustartbar(t, { env: umgebungFuer(attrappe, signer) }, async ({ srv, sql, neustartHart }) => {
        const { callId } = await (await rufeAnMit(srv, { to: ZIEL })).json();
        const erwartet = `cc_${callId}-el`;
        const gewaehlt = () => sql(KENNUNG_SQL, [callId]).then((ergebnis) => ergebnis.rows);
        assert.deepEqual(await gewaehlt(), [{ kennung: null }]);
        assert.equal((await sendeAbgehoben(srv, signer, callId)).status, HTTP_OK);
        assert.deepEqual(await zeilenBis(gewaehlt, ([zeile]) => zeile.kennung !== null), [{ kennung: erwartet }]);
        await neustartHart();
        assert.deepEqual(await gewaehlt(), [{ kennung: erwartet }]);
      });
    } finally {
      await attrappe.close();
    }
  },
);
