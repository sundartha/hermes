// P6a: Provider-Threading. Der Provider eines Inbound-Calls wird EINMAL aus dem
// Signatur-Header abgeleitet, auf dem Call-Record gespeichert (call.provider) und
// von Render (TeXML/TwiML) + SMS-From durchgereicht. Beweist: Telnyx-Inbound
// rendert end-to-end TeXML (nicht TwiML), Twilio bleibt byte-identisch. Offline
// (state-ops/registry direkt + Server-Kindprozess; die pg-Persistenz von
// call.provider deckt store-pg.test.js ab - pglite + Server-Spawn bewusst getrennte
// Dateien, sonst hielten beide Handles den Test-Worker am Leben).
import { test } from "node:test";
import assert from "node:assert/strict";
import { providerFromHeaders } from "../src/telephony/registry.js";
import { makeDefaultState, createCall } from "../src/store/state-ops.js";
import { OWNER_TENANT_ID, PROVIDER, DEFAULT_PROVIDER } from "../src/store/defaults.js";
import { startServer, OWNER_TEST_NUMBER } from "./helpers.js";

const TELNYX_NR = "+13125550100";
const TELNYX_HEADERS = { "telnyx-signature-ed25519": "sig", "telnyx-timestamp": "1" };

// ---- providerFromHeaders (rein, Header -> Provider) ----
test("providerFromHeaders: Twilio-Header -> twilio", () => {
  assert.equal(providerFromHeaders({ "x-twilio-signature": "x" }), PROVIDER.TWILIO);
});

test("providerFromHeaders: Telnyx-Header (Signatur + Timestamp) -> telnyx", () => {
  assert.equal(providerFromHeaders(TELNYX_HEADERS), PROVIDER.TELNYX);
});

test("providerFromHeaders: kein erkannter Header -> null (Aufrufer faellt auf Default)", () => {
  assert.equal(providerFromHeaders({}), null);
  assert.equal(providerFromHeaders(undefined), null);
  // Nur telnyx-timestamp ohne Signatur reicht NICHT (beide Header noetig).
  assert.equal(providerFromHeaders({ "telnyx-timestamp": "1" }), null);
});

// ---- call.provider: Default + gesetzt (json-Pfad via state-ops) ----
test("createCall: Inbound mit provider=telnyx -> call.provider=telnyx", () => {
  const s = makeDefaultState();
  const call = createCall(s, { direction: "inbound", from: "+49150", to: TELNYX_NR, tenantId: OWNER_TENANT_ID, provider: PROVIDER.TELNYX });
  assert.equal(call.provider, PROVIDER.TELNYX);
});

test("createCall: ohne provider (Outbound) -> DEFAULT_PROVIDER (twilio)", () => {
  const s = makeDefaultState();
  const call = createCall(s, { direction: "outbound", from: "+15005550006", to: "+49150" });
  assert.equal(call.provider, DEFAULT_PROVIDER);
});

// ---- Render-Threading end-to-end: Telnyx-Inbound -> TeXML, Twilio -> TwiML ----
// Diskriminator: der Twilio-Renderer setzt speechModel="deepgram_nova-2-general"
// am Gather (Twilio-spezifisch); der Telnyx-Renderer NICHT. SKIP_TWILIO_SIGNATURE_CHECK
// (BASE_ENV) ueberspringt die Signaturpruefung -> der Provider ergibt sich allein aus
// der Header-PRAESENZ, nicht aus einer gueltigen Signatur.
test("Telnyx-Inbound -> TeXML-Greeting (kein speechModel) + call.provider=telnyx", async () => {
  // Owner-Telnyx-Nummer im Store (statt frueher TELNYX_NUMBER-Env): To routet darauf.
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
    assert.equal(calls[0].provider, PROVIDER.TELNYX, "call.provider aus dem Telnyx-Header abgeleitet");
  } finally {
    await srv.stop();
  }
});

test("Twilio-Inbound -> TwiML-Greeting (speechModel) + call.provider=twilio (byte-identisch)", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "tw1", From: "+4915112345678", To: OWNER_TEST_NUMBER.e164 }),
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /speechModel/, "Twilio-Pfad rendert unveraendert TwiML");
    const calls = srv.readStore().calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].provider, DEFAULT_PROVIDER, "ohne Provider-Header -> Default twilio");
  } finally {
    await srv.stop();
  }
});
