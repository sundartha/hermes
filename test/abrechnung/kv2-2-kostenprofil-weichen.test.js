import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  placeCall,
  captureConsole,
  TELNYX_TEST_OWNER_NUMBER,
} from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import * as ops from "../../src/store/state-ops.js";
import { KOSTENPROFIL, KOSTENPROFILE } from "../../src/billing/kostenarten.ts";
import { startInboundHarness, ownerNumberSeed } from "../helpers/inbound-router-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteErfolgreicheAttrappe } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;

function callWithTwilioSid(calls, twilioSid) {
  return calls.find((call) => call.twilioSid === twilioSid);
}

function inboundSeed() {
  return ownerNumberSeed(TELNYX_TEST_OWNER_NUMBER);
}

async function postIncoming(harness, callSid) {
  return abrufMitFrist(`${harness.url}/voice/incoming`, {
    method: "POST",
    body: new URLSearchParams({
      CallSid: callSid,
      From: "+4915112345678",
      To: TELNYX_TEST_OWNER_NUMBER.e164,
    }),
  });
}

test("KV2-2-c4: Inbound-Budget-Zweig setzt costProfile=telnyx_inbound_budget", async () => {
  const harness = await startInboundHarness({ seed: inboundSeed() });
  try {
    const res = await postIncoming(harness, "CAbudget");
    assert.equal(res.status, HTTP_OK);
    const calls = harness.store.load().calls;
    const call = callWithTwilioSid(calls, "CAbudget");
    assert.equal(call.costProfile, KOSTENPROFIL.TELNYX_INBOUND_BUDGET);
  } finally {
    await harness.stop();
  }
});

test("KV2-2-c7: der Inbound-Zweig liefert ein Profil aus der Registry", async () => {
  const budgetHarness = await startInboundHarness({ seed: inboundSeed() });
  try {
    await postIncoming(budgetHarness, "CAc7b");
    const { calls } = budgetHarness.store.load();
    const profil = callWithTwilioSid(calls, "CAc7b").costProfile;
    assert.ok(Object.hasOwn(KOSTENPROFILE, profil), `Profil '${profil}' steht nicht in der Registry`);
  } finally {
    await budgetHarness.stop();
  }
});

function seedCallState() {
  const state = ops.makeDefaultState();
  const call = ops.createCall(state, {
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  return { state, callId: call.id };
}

test("KV2-2-b1: ein unbekannter Profilwert wirft", () => {
  const { state, callId } = seedCallState();
  assert.throws(
    () => ops.recordCostProfile(state, callId, "quatsch"),
    /unbekanntes Kostenprofil/,
  );
});

test("KV2-2-b2: ein fehlendes Profil (null) wirft NICHT, changed=false, WARN-Zeile, call.costProfile bleibt null", async () => {
  const { state, callId } = seedCallState();
  let result;
  const lines = await captureConsole(() => {
    result = ops.recordCostProfile(state, callId, null);
  });
  assert.equal(result.changed, false);
  assert.equal(result.call.costProfile, null);
  assert.ok(
    lines.some((line) => line.includes("[kostenprofil] fehlt")),
    `WARN-Zeile fehlt: ${JSON.stringify(lines)}`,
  );
});

test("KV2-2-b3 (Regression): ein Anruf entsteht auch ohne jeden recordCostProfile-Aufruf", () => {
  const { state, callId } = seedCallState();
  const call = ops.getCall(state, callId);
  assert.equal(call.status, "active");
  assert.equal(call.costProfile, null);
});

test("KV2-2-b4 (set-once): zweimal setzen - der erste Wert bleibt, changed=false beim zweiten", () => {
  const { state, callId } = seedCallState();
  const first = ops.recordCostProfile(state, callId, KOSTENPROFIL.TELNYX_BUDGET);
  assert.equal(first.changed, true);
  assert.equal(first.call.costProfile, KOSTENPROFIL.TELNYX_BUDGET);
  const second = ops.recordCostProfile(state, callId, KOSTENPROFIL.EL_CONVAI_SIP);
  assert.equal(second.changed, false);
  assert.equal(second.call.costProfile, KOSTENPROFIL.TELNYX_BUDGET, "der erste Wert bleibt");
});

test("KV2-2-e1: costProfile-Weiche bewegt weder usage.costCents noch usageEvents", async () => {
  const attrappe = await starteErfolgreicheAttrappe("kv22", [BOOTSTRAP_TENANT_ID]);
  const srv = await startServer({ env: attrappe.env, ownerNumber: TELNYX_TEST_OWNER_NUMBER });
  try {
    const ownerUsage = () => srv.readStore().usage.owner;
    const vorherCostCents = ownerUsage().costCents;
    const vorherEvents = JSON.stringify(srv.readStore().usageEvents ?? []);
    const res = await placeCall(srv);
    assert.equal(res.status, HTTP_OK);
    assert.equal(
      ownerUsage().costCents,
      vorherCostCents,
      "das Setzen des Kostenprofils darf usage.costCents NICHT veraendern",
    );
    assert.equal(JSON.stringify(srv.readStore().usageEvents ?? []), vorherEvents);
  } finally {
    await srv.stop();
    await attrappe.close();
  }
});
