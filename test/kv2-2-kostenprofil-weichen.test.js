// KV2-2: das Kostenprofil an der Engine-Weiche. Abnahmekriterien (b), (c), (e) aus
// tasks/kostenv2/spec-kv2-2.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  placeCall,
  captureConsole,
  TELNYX_TEST_OWNER_NUMBER,
} from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import * as ops from "../src/store/state-ops.js";
import { KOSTENPROFIL, KOSTENPROFILE } from "../src/billing/kostenarten.js";
import { startInboundHarness, ownerNumberSeed } from "./helpers/inbound-router-harness.js";

const HTTP_OK = 200;

const EL_BOOT_ENV = Object.freeze({
  FAKE_ORIGINATE_ELEVENLABS: "true",
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_x",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phone_x",
  ELEVENLABS_API_KEY: "key_x",
});

// Zwei kleine Finder statt verketteter Zugriffe (harness.store.load().calls.find(...)
// bzw. srv.readStore().calls.find(...) waeren eine zu tiefe Aufrufkette, G36).
function callWithId(calls, id) {
  return calls.find((call) => call.id === id);
}
function callWithTwilioSid(calls, twilioSid) {
  return calls.find((call) => call.twilioSid === twilioSid);
}

// ---- Kriterium (c): Inventar-Test ueber die FUENF Weichen-Zweige ----------------------

test("KV2-2-c1: EL-Zweig (api-calls.js) setzt costProfile=el_convai_sip", async () => {
  const srv = await startServer({ env: { ...EL_BOOT_ENV }, ownerNumber: TELNYX_TEST_OWNER_NUMBER });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, HTTP_OK);
    const { callId } = await res.json();
    const calls = srv.readStore().calls;
    const call = callWithId(calls, callId);
    assert.equal(call.costProfile, KOSTENPROFIL.EL_CONVAI_SIP);
    // Gegenprobe: der Zweig lief wirklich (fake_el_-Kennung, s. elevenlabs-anrufstart.test.js).
    assert.match(call.elevenlabsConversationId, /^fake_el_/);
  } finally {
    await srv.stop();
  }
});

// KV2-2-c2 ist mit IE6-S1 als IE6-S1-2 umgezogen (test/ie6-s1-assistant-entfernt.test.js):
// der Telnyx-Assistant-Zweig ist entfernt, dieselbe Weiche faellt jetzt auf den TeXML-
// Zweig zurueck - jetzt mit Rueckfall-Erwartung statt costProfile=telnyx_assistant.

test("KV2-2-c3: TeXML-Zweig (beide Flags aus) setzt costProfile=telnyx_budget", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true" },
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, HTTP_OK);
    const { callId } = await res.json();
    const calls = srv.readStore().calls;
    const call = callWithId(calls, callId);
    assert.equal(call.costProfile, KOSTENPROFIL.TELNYX_BUDGET);
    // Gegenprobe: TeXML-Fake-Praefix (kein _cc_) - der Zweig lief wirklich.
    assert.match(call.twilioSid, /^fake_(?!cc_)/);
  } finally {
    await srv.stop();
  }
});

// Inbound-Seed (Muster geoSeed aus inbound-routing.test.js): eine aktive Owner-Nummer.
function inboundSeed() {
  return ownerNumberSeed(TELNYX_TEST_OWNER_NUMBER);
}

async function postIncoming(harness, callSid) {
  return fetch(`${harness.url}/voice/incoming`, {
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

test("KV2-2-c7: alle drei Weichen-Zweige liefern ein Profil aus der Registry", async () => {
  const elSrv = await startServer({ env: { ...EL_BOOT_ENV }, ownerNumber: TELNYX_TEST_OWNER_NUMBER });
  const texmlSrv = await startServer({ env: { FAKE_ORIGINATE: "true" }, ownerNumber: TELNYX_TEST_OWNER_NUMBER });
  const budgetHarness = await startInboundHarness({ seed: inboundSeed() });
  try {
    const elRes = await placeCall(elSrv);
    const { callId: elCallId } = await elRes.json();
    const texmlRes = await placeCall(texmlSrv);
    const { callId: texmlCallId } = await texmlRes.json();
    await postIncoming(budgetHarness, "CAc7b");

    const elCalls = elSrv.readStore().calls;
    const texmlCalls = texmlSrv.readStore().calls;
    const budgetCalls = budgetHarness.store.load().calls;
    const gefundeneProfile = [
      callWithId(elCalls, elCallId).costProfile,
      callWithId(texmlCalls, texmlCallId).costProfile,
      callWithTwilioSid(budgetCalls, "CAc7b").costProfile,
    ];
    for (const profil of gefundeneProfile) {
      assert.ok(Object.hasOwn(KOSTENPROFILE, profil), `Profil '${profil}' steht nicht in der Registry`);
    }
  } finally {
    await elSrv.stop();
    await texmlSrv.stop();
    await budgetHarness.stop();
  }
});

// ---- Kriterium (b): unbekannt wirft, fehlend wirft NICHT ------------------------------

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

// ---- Kriterium (e): usage.costCents und usage_event byte-identisch --------------------

test("KV2-2-e1: costProfile-Weiche bewegt weder usage.costCents noch usageEvents", async () => {
  // NUR costCents + usageEvents sind das Abnahmekriterium (e) - "calls" (der Zaehler
  // platzierter Anrufe) veraendert sich durch das PLATZIEREN selbst, unabhaengig vom
  // Kostenprofil, und ist deshalb kein Teil dieses Vergleichs.
  const srv = await startServer({ env: { FAKE_ORIGINATE: "true" }, ownerNumber: TELNYX_TEST_OWNER_NUMBER });
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
  }
});
