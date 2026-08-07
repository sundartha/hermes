// P4 GAP-03/GAP-04: die Stripe-Webhook-Route sendet die Plattform-Alarm-SMS, wenn
// applyStripeWebhookSerialized einen outcome.alarm zurueckgibt (routes/stripe-webhook.js).
// Rein, offline (Muster test/stripe-webhook-route-secret.test.js: makeStripeWebhookRoute
// direkt, echter HMAC-Header, kein Server-Spawn).
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeStripeWebhookRoute } from "../src/routes/stripe-webhook.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { BOOTSTRAP_TENANT_ID, NUMBER_STATUS } from "../src/store/defaults.js";

const SECRET = "whsec_alarm_relay_test_0123456789";
const CUSTOMER = "cus_alarm1";
const TENANT = "t_alarm1";

function signHeader(body, secret, ts) {
  const mac = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${mac}`;
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// charge.dispute.created (money-events.js: alarm=true) mit customer=CUSTOMER -> loest
// den Tenant ueber findTenantByCustomer auf, MONEY_ACTION.WARN schreibt nichts an den
// Store, aber der Alarm-Wunsch geht an outcome.alarm zurueck.
function disputeBody() {
  return JSON.stringify({
    id: "evt_alarm1",
    type: "charge.dispute.created",
    data: { object: { customer: CUSTOMER } },
  });
}

function fakeStore(sender) {
  return {
    findTenantByCustomer: (cid) => (cid === CUSTOMER ? { id: TENANT } : null),
    findTenantBySubscription: () => null,
    load: () => ({ numbers: sender ? [sender] : [] }),
  };
}

const BOOTSTRAP_SENDER = {
  tenantId: BOOTSTRAP_TENANT_ID,
  status: NUMBER_STATUS.ACTIVE,
  provider: "telnyx",
  e164: "+491700000000",
};

function fakeMessaging(overrides = {}) {
  const calls = [];
  const base = { sendSms: async (args) => { calls.push(args); } };
  return { calls, messaging: () => ({ ...base, ...overrides }) };
}

async function post(handler, body) {
  const ts = Math.floor(Date.now() / 1000);
  const req = { rawBody: Buffer.from(body), headers: { "stripe-signature": signHeader(body, SECRET, ts) } };
  const res = fakeRes();
  await handler(req, res);
  return res;
}

test("outcome.alarm -> Route sendet die SMS ueber messaging()", async () => {
  const { calls, messaging } = fakeMessaging();
  const handler = makeStripeWebhookRoute({
    config: withConfigNamespaces({
      paymentEnabled: true,
      stripeWebhookSecret: SECRET,
      platformAlertSmsTo: "+491711234567",
    }),
    store: fakeStore(BOOTSTRAP_SENDER),
    audit: () => {},
    accounts: {},
    sessions: {},
    billing: {},
    provision: async () => {},
    messaging,
  });
  const res = await post(handler, disputeBody());
  assert.deepEqual(res.body, { received: true }, "Antwort bleibt received:true");
  assert.equal(calls.length, 1, "genau eine SMS gesendet");
  assert.match(calls[0].body, /type=charge\.dispute\.created/);
  assert.match(calls[0].body, new RegExp(`tenant=${TENANT}`));
});

test("ohne PLATFORM_ALERT_SMS_TO: kein Versand, kein Wurf, Antwort bleibt received:true", async () => {
  const { calls, messaging } = fakeMessaging();
  const handler = makeStripeWebhookRoute({
    config: withConfigNamespaces({
      paymentEnabled: true,
      stripeWebhookSecret: SECRET,
      platformAlertSmsTo: "",
    }),
    store: fakeStore(BOOTSTRAP_SENDER),
    audit: () => {},
    accounts: {},
    sessions: {},
    billing: {},
    provision: async () => {},
    messaging,
  });
  const res = await post(handler, disputeBody());
  assert.deepEqual(res.body, { received: true });
  assert.equal(calls.length, 0, "kein Versand ohne Empfaenger");
});

test("werfendes messaging() (fehlender Bootstrap-Absender) beeintraechtigt die Antwort NICHT (fail-soft)", async () => {
  const { calls, messaging } = fakeMessaging();
  const handler = makeStripeWebhookRoute({
    config: withConfigNamespaces({
      paymentEnabled: true,
      stripeWebhookSecret: SECRET,
      platformAlertSmsTo: "+491711234567",
    }),
    store: fakeStore(null), // keine aktive Bootstrap-Nummer -> resolveSender() liefert null
    audit: () => {},
    accounts: {},
    sessions: {},
    billing: {},
    provision: async () => {},
    messaging,
  });
  const res = await post(handler, disputeBody());
  assert.deepEqual(res.body, { received: true }, "Antwort bleibt received:true trotz fehlendem Absender");
  assert.equal(calls.length, 0, "kein Absender -> kein Versand");
});
