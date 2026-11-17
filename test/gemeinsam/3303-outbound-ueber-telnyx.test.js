import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  TELNYX_TEST_PEER_NUMBER,
  seedCall,
  seedState,
  startServer,
} from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const AGENT_ID = "agent_3303_h4";
const OBJECTIVE = "Termin am Donnerstag vereinbaren";
const TRAEGER_SID = "v3:ob-3303";
const EL_START_PFAD = "/v1/convai/sip-trunk/outbound-call";
const TEXML_ANRUF_PFAD = "/v2/texml/calls/conn_3303";
const UEBER_TELNYX = KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI;

const sendeJson = (res, status, nutzlast) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(nutzlast));
};

async function starteAttrappe(antwort) {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      anfragen.push({ method: req.method, path: req.url, roh });
      sendeJson(res, HTTP_OK, antwort(req));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { anfragen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const elAntwort = (req) => (req.url.startsWith(EL_START_PFAD) ? { success: true, conversation_id: "conv_3303_h4" } : {});
const telnyxAntwort = () => ({ data: { sid: TRAEGER_SID } });

const startsBei = (attrappe, pfad) => attrappe.anfragen.filter((anfrage) => anfrage.method === "POST" && anfrage.path.startsWith(pfad));

const ELEVENLABS_UMGEBUNG = (url) => ({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_API_KEY: "test-key",
  ELEVENLABS_API_BASE: url,
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3303",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});
const TELNYX_UMGEBUNG = (url) => ({
  TELNYX_API_BASE: url,
  TELNYX_API_KEY: "KEYtest-3303",
  TELNYX_CONNECTION_ID: "conn_3303",
  TELNYX_ACCOUNT_SID: "acct_3303",
});
const SCHALTER_AN = { ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true" };

async function mitServer({ env = {}, seed }, run) {
  const el = await starteAttrappe(elAntwort);
  const telnyx = await starteAttrappe(telnyxAntwort);
  const srv = await startServer({
    env: { ...elInboundInitSpawnEnv(AGENT_ID), ...ELEVENLABS_UMGEBUNG(el.url), ...TELNYX_UMGEBUNG(telnyx.url), ...env },
    seed,
  });
  try {
    await run({ srv, el, telnyx });
  } finally {
    await srv.stop();
    await telnyx.close();
    await el.close();
  }
}

const anrufStarten = (srv) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: OBJECTIVE }),
  });

const voiceOutbound = (srv, callId, felder = {}) =>
  abrufMitFrist(`${srv.localUrl}/voice/outbound?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallSid: TRAEGER_SID, ...felder }).toString(),
  });

test("3303-K11: nicht aktiver oder schon gebundener Anruf -> kein Dial, keine SIP-Zugangsdaten", async () => {
  const bereitsGebunden = seedCall({
    id: "call_3303_gebunden",
    provider: "telnyx",
    costProfile: UEBER_TELNYX,
    streamToken: "g".repeat(32),
    answeredAt: new Date().toISOString(),
    elevenlabsConversationId: "conv_3303_gebunden",
    elBoundAt: new Date().toISOString(),
  });
  const beendet = seedCall({ id: "call_3303_beendet", provider: "telnyx", costProfile: UEBER_TELNYX, streamToken: "b".repeat(32), status: "failed", endedAt: new Date().toISOString() });
  await mitServer({ env: SCHALTER_AN, seed: seedState({ calls: [bereitsGebunden, beendet] }) }, async ({ srv }) => {
    const geheimnis = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD;
    const beendetXml = await (await voiceOutbound(srv, beendet.id)).text();
    assert.match(beendetXml, /<Hangup\s*\/>/);
    for (const xml of [beendetXml, await (await voiceOutbound(srv, bereitsGebunden.id)).text()]) {
      assert.doesNotMatch(xml, /<Dial|<Sip|<Gather/);
      assert.ok(!xml.includes(geheimnis), xml);
      assert.doesNotMatch(xml, /elevenlabs/i);
    }
  });
});

test("3303-K12: Gates laufen vor beiden Waehlwegen -> OUTBOUND_FROZEN und erschoepfte Kostendecke waehlen nie", async () => {
  const kostendeckeLeer = seedState({ calls: [] });
  kostendeckeLeer.tenantBudgets = [{ tenantId: TENANT_ID, budgetCents: 0, hardCapCents: 0 }];
  for (const [name, env, seed, status] of [
    ["frozen", { OUTBOUND_FROZEN: "true" }, undefined, HTTP_FORBIDDEN],
    ["kostendecke", {}, kostendeckeLeer, HTTP_PAYMENT_REQUIRED],
  ]) {
    await mitServer({ env: { ...SCHALTER_AN, ...env }, seed }, async ({ srv, el, telnyx }) => {
      const antwort = await anrufStarten(srv);
      assert.equal(antwort.status, status, name);
      assert.equal(startsBei(telnyx, TEXML_ANRUF_PFAD).length, 0, name);
      assert.equal(startsBei(el, EL_START_PFAD).length, 0, name);
    });
  }
});
