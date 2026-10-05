import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { planProfileFor } from "../../src/plans.js";
import { KYC_LEVEL } from "../../src/store/defaults.js";
import { TELNYX_TEST_OWNER_NUMBER, placeCall, seedState, startServer } from "../helpers.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const CALLS_PER_HOUR = "1";
const GERMAN_PREMIUM = "+4990012345678";
const SATELLITE = "+8812345678901";
const ORDINARY_TARGET = "+4915112340080";
const FIRST_TARGET = "+4915112340081";
const SECOND_TARGET = "+4915112340082";
const CUSTOMER = "t_sg09";
const CUSTOMER_SUBJECT = "sub-sg09";

const hermes = {};

before(async () => {
  hermes.srv = await startServer({
    env: { FAKE_ORIGINATE: "true", MAX_CALLS_PER_HOUR: CALLS_PER_HOUR },
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
    seed: seedState({
      tenants: [
        {
          id: CUSTOMER,
          idpSubject: CUSTOMER_SUBJECT,
          status: "active",
          ownerName: "Kundin Neun",
          kycLevel: KYC_LEVEL.CARD,
        },
      ],
      numbers: [
        {
          id: "num_sg09",
          e164: "+4915110000099",
          tenantId: CUSTOMER,
          provider: "telnyx",
          status: "active",
          providerNumberId: null,
        },
      ],
      profiles: { [CUSTOMER]: planProfileFor("business") },
    }),
  });
});

after(async () => {
  await hermes.srv?.stop();
});

function callsTo(target) {
  const { calls } = hermes.srv.readStore();
  return calls.filter((call) => call.to === target);
}

function customerCalls(target) {
  return fetch(`${hermes.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Identity": CUSTOMER_SUBJECT },
    body: JSON.stringify({ to: target, objective: "Rueckruf vereinbaren" }),
  });
}

test("SG-08 Anruf an eine Premium-Nummer wird vor dem Wählen abgelehnt", async () => {
  for (const target of [GERMAN_PREMIUM, SATELLITE]) {
    const res = await placeCall(hermes.srv, target);
    assert.equal(res.status, HTTP_FORBIDDEN, target);
    assert.deepEqual(callsTo(target), [], target);
  }

  const ordinary = await placeCall(hermes.srv, ORDINARY_TARGET);
  assert.equal(ordinary.status, HTTP_OK);
  assert.equal(callsTo(ORDINARY_TARGET).length, 1);
  assert.deepEqual(callsTo(GERMAN_PREMIUM), []);
});

test("SG-09 Anruf über dem Stundenlimit des Mandanten wird abgelehnt", async () => {
  const first = await customerCalls(FIRST_TARGET);
  assert.equal(first.status, HTTP_OK);
  assert.equal(callsTo(FIRST_TARGET).length, 1);

  const second = await customerCalls(SECOND_TARGET);
  assert.equal(second.status, HTTP_TOO_MANY_REQUESTS);
  assert.deepEqual(callsTo(SECOND_TARGET), []);
});
