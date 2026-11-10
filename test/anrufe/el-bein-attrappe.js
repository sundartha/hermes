import http from "node:http";

import { makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const AUDIO_BYTES = 200_000;
const NUMMER_PRAEFIX = "+4915112377";
const EINMAL = 1;
const NUMMER_STELLEN = 3;

export const calleeVon = (callId) => `cc_callee_${callId}`;
export const elVon = (callId) => `cc_el_${callId}`;

export async function starteAttrappe(vorElAntwort = async () => {}) {
  const pfade = [];
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", async () => {
      pfade.push(req.url);
      if (req.url.startsWith("/v1/text-to-speech/")) {
        res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
        return res.end(Buffer.alloc(AUDIO_BYTES, 1));
      }
      const befehl = req.url === "/v2/calls" ? JSON.parse(roh).command_id : "";
      const istEl = befehl.endsWith("-el");
      if (istEl) await vorElAntwort();
      const callId = befehl.replace(/^vorspann-/, "").replace(/-el$/, "");
      const kennung = istEl ? elVon(callId) : calleeVon(callId);
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { call_control_id: kennung, result: "ok" } }));
    });
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  return {
    pfade,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((fertig) => server.close(fertig));
    },
  };
}

export function vorspannUmgebung({ attrappe, signer, publicUrl, kennung }) {
  return {
    ...elInboundInitSpawnEnv(`agent_${kennung}`),
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    TELNYX_CALL_CONTROL_APP_ID: `cc_app_${kennung}`,
    ELEVENLABS_API_KEY: `test-key-${kennung}`,
    ELEVENLABS_API_BASE: attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: `phnum_global_${kennung}`,
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: attrappe.url,
    TELNYX_API_KEY: `KEYtest-${kennung}`,
    TELNYX_CONNECTION_ID: `conn_${kennung}`,
    TELNYX_ACCOUNT_SID: `acct_${kennung}`,
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    PUBLIC_URL: publicUrl,
  };
}

export function neueAnrufNummer(zaehler) {
  return `${NUMMER_PRAEFIX}${String(zaehler + EINMAL).padStart(NUMMER_STELLEN, "0")}`;
}

export async function legeAnruf(srv, nummer) {
  const antwort = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: nummer, objective: "Termin am Donnerstag vereinbaren" }),
  });
  return (await antwort.json()).callId;
}

export function hebeAb(srv, signer, callId) {
  const roh = JSON.stringify({ data: { id: `evt-3553-${callId}`, event_type: "call.answered", payload: { call_control_id: calleeVon(callId) } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": signer.sign(zeit, roh) },
    body: roh,
  });
}

export { makeTelnyxSigner };
