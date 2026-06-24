// W4 — verifyStripeSignature/interpretStripeEvent: reine Krypto + Event-Interpretation
// (node:crypto, kein IO/Netz, F.I.R.S.T.). Deckt gueltige Signatur, falscher HMAC,
// fehlender Header, abgelaufenes Toleranzfenster (>300s) -> fail-closed; das
// Event-Mapping (activate/suspend/ignore) + die Tenant-Aufloesung ueber metadata.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  verifyStripeSignature,
  interpretStripeEvent,
  SUBSCRIPTION_EVENT,
  WEBHOOK_ACTION,
} from "../src/billing/webhook.js";

const SECRET = "whsec_test_0123456789";
const NOW = 1_700_000_000;
const BODY = '{"id":"evt_1","type":"customer.subscription.updated"}';

// Baut einen gueltigen Stripe-Signature-Header fuer (timestamp, body).
function signHeader(body, secret, ts) {
  const mac = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${mac}`;
}

test("verifyStripeSignature: gueltige Signatur im Toleranzfenster -> true", () => {
  const header = signHeader(BODY, SECRET, NOW);
  assert.equal(
    verifyStripeSignature({ rawBody: BODY, signatureHeader: header, secret: SECRET, nowS: NOW }),
    true,
  );
});

test("verifyStripeSignature: falscher HMAC -> false (fail-closed)", () => {
  const header = `t=${NOW},v1=${"0".repeat(64)}`;
  assert.equal(
    verifyStripeSignature({ rawBody: BODY, signatureHeader: header, secret: SECRET, nowS: NOW }),
    false,
  );
});

test("verifyStripeSignature: fehlender/leerer Header -> false", () => {
  for (const header of [undefined, "", "garbage", `v1=${"0".repeat(64)}`]) {
    assert.equal(
      verifyStripeSignature({ rawBody: BODY, signatureHeader: header, secret: SECRET, nowS: NOW }),
      false,
      `Header ${JSON.stringify(header)} -> false`,
    );
  }
});

test("verifyStripeSignature: abgelaufener Timestamp (>300s) -> false (Replay-Schutz)", () => {
  const oldTs = NOW - 301;
  const header = signHeader(BODY, SECRET, oldTs); // HMAC korrekt, aber zu alt
  assert.equal(
    verifyStripeSignature({ rawBody: BODY, signatureHeader: header, secret: SECRET, nowS: NOW }),
    false,
  );
});

test("verifyStripeSignature: fehlendes Secret oder rawBody -> false", () => {
  const header = signHeader(BODY, SECRET, NOW);
  assert.equal(
    verifyStripeSignature({ rawBody: BODY, signatureHeader: header, secret: "", nowS: NOW }),
    false,
  );
  assert.equal(
    verifyStripeSignature({ rawBody: null, signatureHeader: header, secret: SECRET, nowS: NOW }),
    false,
  );
});

test("interpretStripeEvent: subscription.updated -> activate, tenantRef aus metadata", () => {
  const event = {
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_1",
        current_period_end: 1893456000,
        metadata: { tenant_ref: "t_a", plan_slug: "starter" },
      },
    },
  };
  const r = interpretStripeEvent(event);
  assert.equal(r.action, WEBHOOK_ACTION.ACTIVATE);
  assert.equal(r.tenantRef, "t_a");
  assert.equal(r.subscriptionId, "sub_1");
  assert.equal(r.planSlug, "starter");
  assert.equal(r.currentPeriodEnd, 1893456000);
});

test("interpretStripeEvent: subscription.deleted -> suspend", () => {
  const event = {
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: "sub_1", metadata: { tenant_ref: "t_a" } } },
  };
  const r = interpretStripeEvent(event);
  assert.equal(r.action, WEBHOOK_ACTION.SUSPEND);
  assert.equal(r.subscriptionId, "sub_1");
});

test("interpretStripeEvent: invoice.payment_failed -> suspend, subscriptionId aus invoice", () => {
  const event = {
    type: SUBSCRIPTION_EVENT.PAYMENT_FAILED,
    data: { object: { subscription: "sub_9", customer: "cus_9", metadata: {} } },
  };
  const r = interpretStripeEvent(event);
  assert.equal(r.action, WEBHOOK_ACTION.SUSPEND);
  assert.equal(r.subscriptionId, "sub_9");
  assert.equal(r.tenantRef, null, "Invoice traegt kein tenant_ref -> Route loest ueber sub auf");
});

test("interpretStripeEvent: unbekannter Typ -> ignore (idempotent, kein Fehler)", () => {
  const r = interpretStripeEvent({ type: "charge.succeeded", data: { object: {} } });
  assert.equal(r.action, WEBHOOK_ACTION.IGNORE);
});
