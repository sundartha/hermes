import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { PaymentAuthenticationRequiredError } from "../src/billing/errors.js";
import { makeStripeStub } from "./helpers.js";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
import { makeProvisioningOrchestrator } from "../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../src/worker/provisioning.js";
import {
  makeDefaultState,
  registerTenant,
  setTenantStripe,
  requestNumber,
  findNumber,
  recordProvisioningJob,
  markProvisioningJob,
} from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const withStripeStub = makeStripeStub(config, "sk_test_gpp1");

const DECLINE_HTTP_STATUS = 402;
const DECLINE_BODY = {
  error: {
    code: "card_declined",
    decline_code: "insufficient_funds",
    type: "card_error",
    message: "Your card was declined.",
  },
};
const KUNDENMAIL = "kunde@example.invalid";
const DECLINE_BODY_MIT_PII = {
  error: {
    ...DECLINE_BODY.error,
    payment_method: {
      id: "pm_gpp1",
      type: "link",
      billing_details: {
        email: KUNDENMAIL,
        name: "Max Mustermann",
        address: { line1: "Musterstrasse 1", city: "Muenster" },
      },
    },
  },
};

function declineResponse(body) {
  return async () => ({
    ok: false,
    status: DECLINE_HTTP_STATUS,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

const HOLD_ARGS = {
  tenantRef: "t_gpp1",
  amountCents: 300,
  currency: "eur",
  customerId: "cus_gpp1",
  paymentMethodId: "pm_gpp1",
  idempotencyKey: "gpp1-hold",
};

const SUBSCRIPTION_ARGS = {
  tenantRef: "t_gpp1",
  customerId: "cus_gpp1",
  priceId: "price_gpp1",
  paymentMethodId: "pm_gpp1",
  idempotencyKey: "gpp1-sub",
};

async function placeHoldRejection(body) {
  return withStripeStub(declineResponse(body), async () => {
    try {
      await stripeBilling.placeHold(HOLD_ARGS);
      throw new Error("KEIN FEHLER - der abgelehnte Hold lief als Erfolg durch");
    } catch (err) {
      return err;
    }
  });
}

test("GP-P1: placeHold-402 traegt den Ablehnungsgrund als getyptes Feld", async () => {
  const err = await placeHoldRejection(DECLINE_BODY);
  assert.deepEqual(err.providerDecline, {
    code: "card_declined",
    declineCode: "insufficient_funds",
    type: "card_error",
  });
});

test("GP-P1: die Meldung traegt HTTP 402 UND decline_code=insufficient_funds", async () => {
  const err = await placeHoldRejection(DECLINE_BODY);
  assert.match(err.message, /HTTP 402/);
  assert.match(err.message, /decline_code=insufficient_funds/);
});

test("GP-P1 Positiv-Kontrolle: Kundendaten aus dem Fehlerkoerper stehen weder in .message noch am Feld", async () => {
  const err = await placeHoldRejection(DECLINE_BODY_MIT_PII);
  assert.doesNotMatch(err.message, /example\.invalid|Mustermann|Musterstrasse/);
  const feldAlsText = JSON.stringify(err.providerDecline);
  assert.doesNotMatch(feldAlsText, /example\.invalid|Mustermann|Musterstrasse/);
  assert.deepEqual(err.providerDecline, {
    code: "card_declined",
    declineCode: "insufficient_funds",
    type: "card_error",
  });
});

test("GP-P1: Freitext in error.code faellt auf null, statt in die Meldung zu wandern", async () => {
  const body = {
    error: { ...DECLINE_BODY.error, code: `Declined for ${KUNDENMAIL}` },
  };
  const err = await placeHoldRejection(body);
  assert.equal(err.providerDecline.code, null);
  assert.doesNotMatch(err.message, /example\.invalid/);
});

test("GP-P1: leerer/unparsbarer Fehlerkoerper -> Meldung byte-identisch zum Bestand", async () => {
  const err = await withStripeStub(
    async () => ({
      ok: false,
      status: DECLINE_HTTP_STATUS,
      json: async () => {
        throw new Error("kein JSON");
      },
      text: async () => "",
    }),
    async () => {
      try {
        await stripeBilling.placeHold(HOLD_ARGS);
        throw new Error("KEIN FEHLER");
      } catch (err2) {
        return err2;
      }
    },
  );
  assert.equal(err.message, "Stripe placeHold fehlgeschlagen: HTTP 402");
  assert.deepEqual(err.providerDecline, { code: null, declineCode: null, type: null });
});

test("GP-P1: der 3-D-Secure-Fall behaelt seinen Fehlertyp UND bekommt das Feld", async () => {
  const body = {
    error: {
      type: "card_error",
      code: "authentication_required",
      decline_code: "authentication_required",
      message: "Your card was declined. This transaction requires authentication.",
      payment_intent: { status: "requires_payment_method" },
    },
  };
  const err = await placeHoldRejection(body);
  assert.ok(err instanceof PaymentAuthenticationRequiredError);
  assert.equal(err.providerDecline.code, "authentication_required");
});

test("GP-P1 (Frage 6): createSubscription-402 protokolliert keine Kundendaten mehr", async () => {
  const err = await withStripeStub(declineResponse(DECLINE_BODY_MIT_PII), async () => {
    try {
      await stripeBilling.createSubscription(SUBSCRIPTION_ARGS);
      throw new Error("KEIN FEHLER");
    } catch (err2) {
      return err2;
    }
  });
  assert.match(err.message, /HTTP 402/);
  assert.match(err.message, /decline_code=insufficient_funds/);
  assert.doesNotMatch(err.message, /example\.invalid|Mustermann|Musterstrasse/);
  assert.doesNotMatch(err.message, /"billing_details"/);
});

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };

function meteringStub() {
  return { recordNumberMonthMeter() {}, recordDueNumberMonthMeters: () => ({}) };
}

function makeFakeStore(state) {
  return {
    load: () => state,
    save() {},
    async withStoreLock(fn) {
      return fn();
    },
  };
}

function fakeProvisioner() {
  return {
    async searchNumbers() {
      return [{ e164: "+4915799990000" }];
    },
    async orderNumber() {
      throw new Error("GP-P1: darf nie erreicht werden - der Hold muss vorher scheitern");
    },
  };
}

test("GP-P1 (Frage 8): der Enum-Anhang landet in job.lastError", async () => {
  const state = makeDefaultState();
  registerTenant(state, "t_gpp1_8");
  setTenantStripe(state, "t_gpp1_8", {
    customerId: "cus_gpp1_8",
    paymentMethodId: "pm_gpp1_8",
    paymentMethodType: "card",
  });
  const number = requestNumber(state, { tenantId: "t_gpp1_8", country: "DE", ...CAPS }).number;

  const store = makeFakeStore(state);
  const queue = makeMemoryQueue();
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: withConfigNamespaces({
      paymentEnabled: true,
      numberSetupFeeCents: 92,
      paymentCurrency: "eur",
      provisioningEnabled: false,
    }),
    queue,
    billing: stripeBilling,
    metering: meteringStub(),
    numberProvisioning: () => fakeProvisioner(),
    handleProvisionJob,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob,
    markProvisioningJob,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber,
  });

  await withStripeStub(declineResponse(DECLINE_BODY_MIT_PII), async () => {
    const enqueued = await orchestrator.queueProvisioning(number.id, "t_gpp1_8");
    assert.equal(enqueued.ok, true, "Job-Spur persistiert");
    await orchestrator.runProvisioningDrainExclusive();
  });

  const job = state.provisioningJobs.find((j) => j.numberId === number.id);
  assert.equal(job.status, "failed");
  assert.match(job.lastError, /decline_code=insufficient_funds/);
  assert.doesNotMatch(job.lastError, /example\.invalid|Mustermann/);
});
