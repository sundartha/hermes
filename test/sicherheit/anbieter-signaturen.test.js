import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";

import express from "express";

import { makeStripeWebhookRoute } from "../../src/routes/stripe-webhook.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { OWNER_TEST_NUMBER, makeTelnyxSigner, nowSeconds, startServer } from "../helpers.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const STALE_SECONDS = 600;
const STRIPE_PATH = "/webhooks/stripe";
const STRIPE_SECRET = "whsec_sg07_echtes_geheimnis";
const FOREIGN_STRIPE_SECRET = `${STRIPE_SECRET}-fremd`;
const INCOMING_CALL = new URLSearchParams({
  CallSid: "CAsg05",
  From: "+4915112345678",
  To: OWNER_TEST_NUMBER.e164,
}).toString();
const STRIPE_EVENT = JSON.stringify({
  id: "evt_sg07",
  type: "sg07.unbekanntes_ereignis",
  data: { object: {} },
});

const telnyx = makeTelnyxSigner();
const hermes = {};

function stripeOnly() {
  const app = express();
  const keepRawBody = (req, _res, buf) => Object.assign(req, { rawBody: buf });
  const route = makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: STRIPE_SECRET }),
    audit: () => {},
  });
  app.post(STRIPE_PATH, express.json({ verify: keepRawBody }), route);
  return new Promise((listening) => {
    const server = app.listen(0, "127.0.0.1", () => listening(server));
  });
}

before(async () => {
  hermes.srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: telnyx.publicKeyBase64 },
  });
  hermes.stripe = await stripeOnly();
});

after(async () => {
  await hermes.srv?.stop();
  hermes.stripe?.close();
});

function sendTelnyx({ signer, timestamp }) {
  return fetch(`${hermes.srv.localUrl}/voice/incoming`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "telnyx-signature-ed25519": signer.sign(timestamp, INCOMING_CALL),
      "telnyx-timestamp": timestamp,
    },
    body: INCOMING_CALL,
  });
}

function sendStripe({ secret, timestamp }) {
  const mac = crypto.createHmac("sha256", secret).update(`${timestamp}.${STRIPE_EVENT}`).digest("hex");
  return fetch(`http://127.0.0.1:${hermes.stripe.address().port}${STRIPE_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${timestamp},v1=${mac}` },
    body: STRIPE_EVENT,
  });
}

test("SG-05 Telnyx-Webhook mit falscher Signatur oder altem Zeitstempel wird mit 403 abgelehnt", async () => {
  const fresh = String(nowSeconds());
  const stale = String(nowSeconds() - STALE_SECONDS);

  const forged = await sendTelnyx({ signer: makeTelnyxSigner(), timestamp: fresh });
  const replayed = await sendTelnyx({ signer: telnyx, timestamp: stale });
  const genuine = await sendTelnyx({ signer: telnyx, timestamp: fresh });

  assert.equal(forged.status, HTTP_FORBIDDEN);
  assert.equal(replayed.status, HTTP_FORBIDDEN);
  assert.equal(genuine.status, HTTP_OK);
});

test("SG-07 Stripe-Webhook mit falscher Signatur oder abgelaufenem Zeitstempel wird abgelehnt", async () => {
  const now = nowSeconds();

  const forged = await sendStripe({ secret: FOREIGN_STRIPE_SECRET, timestamp: now });
  const replayed = await sendStripe({ secret: STRIPE_SECRET, timestamp: now - STALE_SECONDS });
  const genuine = await sendStripe({ secret: STRIPE_SECRET, timestamp: now });

  assert.equal(forged.status, HTTP_BAD_REQUEST);
  assert.equal(replayed.status, HTTP_BAD_REQUEST);
  assert.deepEqual(await genuine.json(), { received: true });
});
