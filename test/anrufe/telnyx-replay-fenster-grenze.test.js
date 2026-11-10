import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { config } from "../../src/config.js";
import { makeVoiceRoutes } from "../../src/routes/voice.js";
import { inboundSignatureVerifier } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { FESTE_UHR_MS, makeTelnyxSigner, mitFesterUhr } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_FORBIDDEN = 403;
const MS_PER_S = 1000;
const FENSTER_S = 300;
const BODY = "From=%2B4915112345678";

async function statusUndText(versatzS) {
  const signer = makeTelnyxSigner();
  config.telephony.telnyxPublicKey = signer.publicKeyBase64;
  const ts = String(FESTE_UHR_MS / MS_PER_S + versatzS);
  const app = express();
  app.use(express.urlencoded({ extended: false, verify: (req, _res, buf) => Object.assign(req, { rawBody: buf }) }));
  app.use(
    makeVoiceRoutes({
      store: {},
      config: withConfigNamespaces({ skipTwilioSignatureCheck: false, publicUrl: "https://agent.test" }),
      voiceRender: { render: () => "ok" },
      directiveSynth: {},
      lifecycle: {},
      inboundBridges: {},
      providerFromHeaders: () => "telnyx",
      inboundSignatureVerifier,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/voice/unbekannt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "telnyx-signature-ed25519": signer.sign(ts, Buffer.from(BODY)),
        "telnyx-timestamp": ts,
      },
      body: BODY,
    });
    return { status: res.status, text: await res.text() };
  } finally {
    server.close();
  }
}

test("Telnyx-Webhook genau 300 s vor der Serveruhr wird angenommen", mitFesterUhr(async () => {
  const res = await statusUndText(-FENSTER_S);
  assert.notEqual(res.status, HTTP_FORBIDDEN);
  assert.notEqual(res.text, "invalid inbound signature");
}));

test("Telnyx-Webhook genau 300 s nach der Serveruhr wird angenommen", mitFesterUhr(async () => {
  const res = await statusUndText(FENSTER_S);
  assert.notEqual(res.status, HTTP_FORBIDDEN);
  assert.notEqual(res.text, "invalid inbound signature");
}));

test("Telnyx-Webhook 301 s vor der Serveruhr wird mit 403 abgelehnt", mitFesterUhr(async () => {
  const res = await statusUndText(-FENSTER_S - 1);
  assert.equal(res.status, HTTP_FORBIDDEN);
  assert.equal(res.text, "invalid inbound signature");
}));

test("Telnyx-Webhook 301 s nach der Serveruhr wird mit 403 abgelehnt", mitFesterUhr(async () => {
  const res = await statusUndText(FENSTER_S + 1);
  assert.equal(res.status, HTTP_FORBIDDEN);
  assert.equal(res.text, "invalid inbound signature");
}));
