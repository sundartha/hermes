import { test } from "node:test";
import assert from "node:assert/strict";
import { providerFromHeaders } from "../src/telephony/registry.js";
import { makeDefaultState, createCall } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, PROVIDER, DEFAULT_PROVIDER } from "../src/store/defaults.js";
import { startServer } from "./helpers.js";

const TELNYX_NR = "+13125550100";
const TELNYX_HEADERS = { "telnyx-signature-ed25519": "sig", "telnyx-timestamp": "1" };

test("C-P3: providerFromHeaders - x-twilio-signature ist keine Provider-Quelle -> null", () => {
  assert.equal(providerFromHeaders({ "x-twilio-signature": "x" }), null);
});

test("providerFromHeaders: Telnyx-Header (Signatur + Timestamp) -> telnyx", () => {
  assert.equal(providerFromHeaders(TELNYX_HEADERS), PROVIDER.TELNYX);
});

test("providerFromHeaders: kein erkannter Header -> null (Aufrufer faellt auf Default)", () => {
  assert.equal(providerFromHeaders({}), null);
  assert.equal(providerFromHeaders(undefined), null);
  assert.equal(providerFromHeaders({ "telnyx-timestamp": "1" }), null);
});

test("C-P1 A: DEFAULT_PROVIDER ist Telnyx (Rueckfall bewusst gesetzt)", () => {
  assert.equal(DEFAULT_PROVIDER, PROVIDER.TELNYX);
});

test("createCall: Inbound mit provider=telnyx -> call.provider=telnyx", () => {
  const s = makeDefaultState();
  const call = createCall(s, {
    direction: "inbound",
    from: "+49150",
    to: TELNYX_NR,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: PROVIDER.TELNYX,
  });
  assert.equal(call.provider, PROVIDER.TELNYX);
});

test("createCall: ohne provider (Outbound) -> DEFAULT_PROVIDER (Telnyx)", () => {
  const s = makeDefaultState();
  const call = createCall(s, {
    direction: "outbound",
    from: "+15005550006",
    to: "+49150",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  assert.equal(call.provider, DEFAULT_PROVIDER);
});

test("createCall ohne tenantId -> Throw, kein Default-Bucket (P3 fail-closed)", () => {
  const s = makeDefaultState();
  assert.throws(
    () => createCall(s, { direction: "outbound", from: "+491", to: "+490" }),
    /tenantId ist Pflicht/,
  );
  assert.equal(s.calls.length, 0, "kein Call ohne Tenant angelegt");
});

test("createCall mit explizitem tenantId -> Call dem Tenant zugeordnet (P3)", () => {
  const s = makeDefaultState();
  const call = createCall(s, { direction: "inbound", from: "+491", to: "+490", tenantId: "B" });
  assert.equal(call.tenantId, "B");
});

test("Telnyx-Inbound -> TeXML-Greeting (kein speechModel) + call.provider=telnyx", async () => {
  const srv = await startServer({ ownerNumber: { e164: TELNYX_NR, provider: PROVIDER.TELNYX } });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      headers: TELNYX_HEADERS,
      body: new URLSearchParams({ CallSid: "tx1", From: "+4915112345678", To: TELNYX_NR }),
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /<Gather/, "Telnyx-Inbound fuehrt in den Gespraechs-Turn");
    assert.ok(!body.includes("speechModel"), "TeXML traegt KEIN Twilio-speechModel");
    const calls = srv.readStore().calls;
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].provider,
      PROVIDER.TELNYX,
      "call.provider aus dem Telnyx-Header abgeleitet",
    );
  } finally {
    await srv.stop();
  }
});

test("C-P1 B: Inbound ohne Provider-Header -> Telnyx-Pfad (TeXML, kein speechModel)", async () => {
  const srv = await startServer({ ownerNumber: { e164: TELNYX_NR, provider: PROVIDER.TELNYX } });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "dp1", From: "+4915112345678", To: TELNYX_NR }),
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /transcriptionEngine="Deepgram"/, "Rueckfall rendert TeXML (Telnyx)");
    assert.ok(!body.includes("speechModel"), "kein Twilio-TwiML-Attribut");
    assert.equal(srv.readStore().calls[0].provider, PROVIDER.TELNYX);
  } finally {
    await srv.stop();
  }
});
