import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { makeTelnyxSigner, nowSeconds, waitUntil } from "../helpers.js";
import { mitHermesAufPostgresHartNeustartbar, neueAnrufe, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const HTTP_SERVER_FEHLER = 500;
const ZEITGRENZE_MS = 180_000;
const WARTE_FRIST_MS = 10_000;
const AUDIO_BYTES = 200_000;
const EINMAL = 1;
const APP_ID = "cc_app_3553";
const AGENT_ID = "agent_3553";
const SPALTE_SQL = "SELECT el_call_control_id FROM call WHERE id = $1";

const koerper = (anfrage) => JSON.parse(anfrage.roh);
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
const aktionen = (anfragen, bein, aktion) => anfragen.filter((anfrage) => anfrage.path === `/v2/calls/${bein}/actions/${aktion}`);
const callIdAus = (anfrage) => koerper(anfrage).command_id.replace(/^vorspann-/, "").replace(/-el$/, "");

function antworte(res, anfrage) {
  if (anfrage.path.startsWith("/v1/text-to-speech/")) {
    res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
    return res.end(Buffer.alloc(AUDIO_BYTES, 1));
  }
  if (anfrage.path === "/v2/calls") {
    const bein = koerper(anfrage).command_id.endsWith("-el") ? elVon(callIdAus(anfrage)) : calleeVon(callIdAus(anfrage));
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data: { call_control_id: bein } }));
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: { sid: "v3:ob-3553", result: "ok" } }));
}

async function starteTelnyxAttrappe() {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      const anfrage = { path: req.url, roh };
      anfragen.push(anfrage);
      try {
        antworte(res, anfrage);
      } catch {
        res.writeHead(HTTP_SERVER_FEHLER);
        res.end();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    anfragen,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

const umgebung = (attrappe, signer) => ({
  ...elInboundInitSpawnEnv(AGENT_ID),
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  TELNYX_CALL_CONTROL_APP_ID: APP_ID,
  ELEVENLABS_API_BASE: attrappe.url,
  TELNYX_API_BASE: attrappe.url,
  TELNYX_API_KEY: "KEYtest-3553",
  TELNYX_CONNECTION_ID: "conn_3553",
  TELNYX_ACCOUNT_SID: "acct_3553",
  SKIP_TWILIO_SIGNATURE_CHECK: "false",
  TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
  PUBLIC_URL: "https://agent.test",
});

function meldeAbgehoben(srv, signer, callId) {
  const roh = JSON.stringify({ data: { id: `evt-3553-${callId}`, event_type: "call.answered", payload: { call_control_id: calleeVon(callId) } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": signer.sign(zeit, roh) },
    body: roh,
  });
}

async function bisSpalteGesetzt(sql, callId) {
  const [zeile] = await zeilenBis(
    async () => (await sql(SPALTE_SQL, [callId])).rows,
    (zeilen) => zeilen.length === EINMAL && zeilen[0].el_call_control_id !== null,
  );
  return zeile.el_call_control_id;
}

test(
  "EL-Bein-Kennung: nach gewaehltem EL-Bein und hartem Neustart legt cancel_call beide Beine auf",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    const attrappe = await starteTelnyxAttrappe();
    t.after(() => attrappe.close());
    const signer = makeTelnyxSigner();
    await mitHermesAufPostgresHartNeustartbar(t, { env: umgebung(attrappe, signer) }, async ({ srv, sql, neustartHart }) => {
      const { rufeAn } = neueAnrufe();
      const { callId } = await (await rufeAn(srv)).json();
      assert.equal((await meldeAbgehoben(srv, signer, callId)).status, HTTP_OK);
      assert.equal(await bisSpalteGesetzt(sql, callId), elVon(callId));
      const neu = await neustartHart();
      const antwort = await abrufMitFrist(`${neu.srv.localUrl}/api/calls/${callId}/cancel`, { method: "POST" });
      assert.equal(antwort.status, HTTP_OK);
      await waitUntil(() => aktionen(attrappe.anfragen, elVon(callId), "hangup").length === EINMAL, { timeoutMs: WARTE_FRIST_MS });
      await waitUntil(() => aktionen(attrappe.anfragen, calleeVon(callId), "hangup").length === EINMAL, { timeoutMs: WARTE_FRIST_MS });
    });
  },
);
