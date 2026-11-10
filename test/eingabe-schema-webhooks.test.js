import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { ESLint } from "eslint";

import { interpretStripeEvent, verifyStripeSignature, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";
import { makeStripeWebhookRoute } from "../src/routes/stripe-webhook.js";
import { EL_CALL_BINDING_SIP_HEADER, EL_CALL_BINDING_VARIABLE } from "../src/elevenlabs/inbound-initiation.js";
import { INIT_WEBHOOK_TOKEN_MIN_LENGTH } from "../src/elevenlabs/inbound-path-decision.js";
import { INBOUND_EL_SCOPE } from "../src/elevenlabs/inbound-scope.js";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER, makeElevenLabsInitWebhookRoutes } from "../src/routes/webhooks-elevenlabs-init.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { EL_INBOUND_ACCESS_BOOT_ENV, storeOpsFacade } from "./helpers.js";
import { INBOUND_TO, initBindungsKoerper, seedWartenderElCall } from "./_iel-inbound-harness.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { STRIPE_ROUTEN_GEHEIMNIS } from "./gemeinsam/erfundene-geheimnisse.js";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGEL = "hermes/eingabe-nur-mit-schema";
const eslint = new ESLint({ cwd: WURZEL });

async function befunde(datei) {
  const [ergebnis] = await eslint.lintFiles([resolve(WURZEL, datei)]);
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

test("Eingaberegel: der Stripe-Webhook prüft die Nutzlast ohne typeof", async () => {
  assert.deepEqual(await befunde("src/billing/webhook.js"), []);
});
test("Eingaberegel: der ElevenLabs-Init-Webhook prüft die Nutzlast ohne typeof", async () => {
  assert.deepEqual(await befunde("src/elevenlabs/inbound-initiation.js"), []);
});
test("Eingaberegel: sie sieht typeof in den beiden Webhook-Dateien", async () => {
  for (const datei of ["src/billing/webhook.js", "src/elevenlabs/inbound-initiation.js"]) {
    const [ergebnis] = await eslint.lintText('export const a = (wert) => typeof wert === "string";\n', {
      filePath: resolve(WURZEL, datei),
    });
    assert.equal(ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL).length, 1, datei);
  }
});

const HTTP_BAD_REQUEST = 400;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const MS_PER_SECOND = 1000;
const SECRET = STRIPE_ROUTEN_GEHEIMNIS;
const BODY = JSON.stringify({ id: "evt_s", type: "ping" });

function fakeRes() {
  const res = { statusCode: HTTP_OK, body: null };
  res.status = (code) => Object.assign(res, { statusCode: code });
  res.json = (body) => Object.assign(res, { body });
  return res;
}

async function stripeAntwort(headers) {
  const handler = makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: SECRET }),
    store: {},
    audit: () => {},
    accounts: {},
    sessions: {},
    billing: {},
    provision: async () => {},
  });
  const res = fakeRes();
  await handler({ rawBody: Buffer.from(BODY), headers }, res);
  return res;
}

function signiert(t, mac) {
  const echt = crypto.createHmac("sha256", SECRET).update(`${t}.${BODY}`).digest("hex");
  return `t=${t},v1=${mac ?? echt}`;
}

test("Stripe-Route: Signaturkopf fehlt, ist leer oder hat falsche Länge -> 400 invalid signature", async () => {
  const jetzt = Math.floor(Date.now() / MS_PER_SECOND);
  for (const header of [undefined, "", signiert(jetzt, "ab"), signiert(jetzt, "0".repeat(64))]) {
    const res = await stripeAntwort({ "stripe-signature": header });
    assert.equal(res.statusCode, HTTP_BAD_REQUEST, JSON.stringify(header));
    assert.deepEqual(res.body, { error: "invalid signature" });
  }
});

test("Stripe-Route: gültige Signatur -> received", async () => {
  const jetzt = Math.floor(Date.now() / MS_PER_SECOND);
  const res = await stripeAntwort({ "stripe-signature": signiert(jetzt) });
  assert.equal(res.statusCode, HTTP_OK);
  assert.deepEqual(res.body, { received: true });
});

test("Stripe: Signaturkopf, der kein Text ist, gilt als ungültig", () => {
  const nowS = Math.floor(Date.now() / MS_PER_SECOND);
  for (const signatureHeader of [5, null, ["t=1"], {}]) {
    assert.equal(verifyStripeSignature({ rawBody: BODY, signatureHeader, secret: SECRET, nowS }), false);
  }
});

const aboMit = (zahlungsmittel) => ({
  type: SUBSCRIPTION_EVENT.UPDATED,
  data: { object: { id: "sub_x", status: "active", metadata: { tenant_ref: "t_x" }, default_payment_method: zahlungsmittel } },
});

test("Stripe: Zahlungsmittel-Nutzlast ergibt dieselbe Kennung und Art wie bisher", () => {
  const tabelle = [
    ["pm_1", "pm_1", null],
    [{ id: "pm_2", type: "card" }, "pm_2", "card"],
    [{ id: "pm_3", type: "Karte!" }, "pm_3", null],
    [{ type: "card" }, null, "card"],
    [{ id: "pm_4", type: "" }, "pm_4", null],
    [null, null, null],
    [undefined, null, null],
    [7, null, null],
    ["", "", null],
  ];
  for (const [eingabe, id, art] of tabelle) {
    const ergebnis = interpretStripeEvent(aboMit(eingabe));
    assert.equal(ergebnis.paymentMethodId, id, JSON.stringify(eingabe));
    assert.equal(ergebnis.paymentMethodType, art, JSON.stringify(eingabe));
  }
});

const INIT_TOKEN = "i".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH);
const AGENT_ID = "agent_schema";

function initConfig() {
  return {
    voice: {
      elevenLabsInbound: {
        enabled: true,
        tenantIds: [BOOTSTRAP_TENANT_ID],
        scope: INBOUND_EL_SCOPE.ALLOWLIST,
        sipUser: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER,
        sipPassword: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD,
        initWebhookToken: INIT_TOKEN,
      },
      elevenLabsOutbound: { agentId: AGENT_ID },
    },
    telnyx: { telnyxElevenLabs: { voiceId: "" } },
  };
}

async function initAntwort(baueKoerper) {
  const state = ops.makeDefaultState();
  state.tenants[0].ownerName = "Jonas Beispiel";
  state.numbers.push({
    id: "num_s",
    e164: INBOUND_TO,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
    status: "active",
    providerNumberId: null,
  });
  const call = seedWartenderElCall(state, { answeredVorS: 2 });
  const store = {
    ...storeOpsFacade(state),
    bindInboundElConversation: (id, bindung) => ops.bindInboundElConversation(state, id, bindung),
    numberRecordByE164: (e164) => ops.numberRecordByE164(state, e164),
    tenantTimezone: (id) => ops.tenantTimezone(state, id),
    tenantContext: (id) => ops.tenantContext(state, "", id),
  };
  const app = express();
  app.use(express.json());
  app.use(makeElevenLabsInitWebhookRoutes({ store, config: initConfig(), bridges: { clearDeadlines: () => {} }, now: () => Date.parse("2026-09-15T10:00:00.000Z") }));
  const server = http.createServer(app);
  await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  try {
    const url = `http://127.0.0.1:${server.address().port}${ELEVENLABS_INIT_PATH}`;
    const basis = initBindungsKoerper({ bindung: undefined, agentId: AGENT_ID, conversationId: "conv_s" });
    const res = await abrufMitFrist(url, {
      method: "POST",
      headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
      body: JSON.stringify({ ...basis, ...baueKoerper(call.streamToken) }),
    });
    return res.status;
  } finally {
    await new Promise((resolveServer) => server.close(resolveServer));
  }
}

test("ElevenLabs-Init-Route: Bindungs-Token aus den Kopfzeilen, ungültige Formen wie bisher", async () => {
  const name = EL_CALL_BINDING_SIP_HEADER;
  const faelle = [
    [(t) => ({ sip_headers: [{ name, value: t }] }), HTTP_OK],
    [(t) => ({ sip_headers: [{ name: name.toUpperCase(), value: t }] }), HTTP_OK],
    [(t) => ({ sip_headers: { [name]: t } }), HTTP_OK],
    [() => ({ sip_headers: [{ name, value: 5 }] }), HTTP_NOT_FOUND],
    [(t) => ({ sip_headers: [{ name: 5, value: t }] }), HTTP_NOT_FOUND],
    [(t) => ({ sip_headers: [null, 3, { name, value: t }] }), HTTP_OK],
    [() => ({ sip_headers: { [name]: 5 } }), HTTP_NOT_FOUND],
    [(t) => ({ sip_headers: undefined, dynamic_variables: { [EL_CALL_BINDING_VARIABLE]: t } }), HTTP_OK],
  ];
  for (const [baue, erwartet] of faelle) {
    assert.equal(await initAntwort(baue), erwartet, baue.toString());
  }
});
