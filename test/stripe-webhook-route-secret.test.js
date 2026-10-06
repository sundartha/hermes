import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeStripeWebhookRoute } from "../src/routes/stripe-webhook.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "whsec_route_secret_test_0123456789";
const WRONG_SECRET = "whsec_wrong_0123456789";
const RAW_BODY = Buffer.from("not-json");

function signHeader(body, secret, ts) {
  const mac = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${mac}`;
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

function makeAuditSpy() {
  const calls = [];
  const audit = (...args) => calls.push(args);
  return { audit, calls };
}

test("stripe-webhook-Route: korrektes config.billing.stripeWebhookSecret -> Signatur besteht, faellt am JSON.parse (400 bad payload, kein Audit-Reject)", async () => {
  const { audit, calls } = makeAuditSpy();
  const handler = makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: SECRET }),
    store: {},
    audit,
    accounts: {},
    sessions: {},
    billing: {},
    provision: async () => {},
  });
  const ts = Math.floor(Date.now() / 1000);
  const req = {
    rawBody: RAW_BODY,
    headers: { "stripe-signature": signHeader(RAW_BODY, SECRET, ts) },
  };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "bad payload" });
  assert.equal(
    calls.some(([event]) => event === "stripe_webhook_rejected"),
    false,
    "Signatur bestand -> kein Reject-Audit, der Fehler liegt danach beim Parsen",
  );
});

test("stripe-webhook-Route: falsches Secret -> Signaturpruefung schlaegt fehl (400 invalid signature, Audit-Reject, fail-closed)", async () => {
  const { audit, calls } = makeAuditSpy();
  const handler = makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: SECRET }),
    store: {},
    audit,
    accounts: {},
    sessions: {},
    billing: {},
    provision: async () => {},
  });
  const ts = Math.floor(Date.now() / 1000);
  const req = {
    rawBody: RAW_BODY,
    headers: { "stripe-signature": signHeader(RAW_BODY, WRONG_SECRET, ts) },
  };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "invalid signature" });
  assert.equal(
    calls.some(([event]) => event === "stripe_webhook_rejected"),
    true,
    "falsches Secret -> Signatur faellt durch -> Audit-Reject (fail-closed)",
  );
});
