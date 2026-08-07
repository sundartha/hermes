// P6a: Provider-Threading. Der Provider eines Inbound-Calls wird EINMAL aus dem
// Signatur-Header abgeleitet, auf dem Call-Record gespeichert (call.provider) und
// von Render (TeXML/TwiML) + SMS-From durchgereicht. Beweist: Telnyx-Inbound rendert
// end-to-end TeXML; ein Request ohne erkannten Provider-Header faellt auf
// DEFAULT_PROVIDER (Telnyx). Offline (state-ops/registry direkt + Server-Kindprozess;
// die pg-Persistenz von call.provider deckt store-pg.test.js ab - pglite + Server-Spawn
// bewusst getrennte Dateien, sonst hielten beide Handles den Test-Worker am Leben).
import { test } from "node:test";
import assert from "node:assert/strict";
import { providerFromHeaders } from "../src/telephony/registry.js";
import { makeDefaultState, createCall } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, PROVIDER, DEFAULT_PROVIDER } from "../src/store/defaults.js";
import { startServer } from "./helpers.js";

const TELNYX_NR = "+13125550100";
const TELNYX_HEADERS = { "telnyx-signature-ed25519": "sig", "telnyx-timestamp": "1" };

// ---- providerFromHeaders (rein, Header -> Provider) ----
// C-P3: x-twilio-signature ist KEINE Provider-Quelle mehr. Diese Zeile ist die
// Gegenprobe-Halterung der Phase: setzt jemand den Twilio-Zweig in
// providerFromHeaders wieder ein, wird genau dieser Test rot.
test("C-P3: providerFromHeaders - x-twilio-signature ist keine Provider-Quelle -> null", () => {
  assert.equal(providerFromHeaders({ "x-twilio-signature": "x" }), null);
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

// ---- C-P1: der Rueckfall-Default selbst (Zusicherung A) ----
// Eine Zeile, eine Aussage: welcher Provider gilt, wenn NICHTS ihn nennt. Alle
// DEFAULT_PROVIDER-Leser haengen daran; ohne diesen Test waere ein Zurueckdrehen
// des Flips nur indirekt sichtbar.
test("C-P1 A: DEFAULT_PROVIDER ist Telnyx (Rueckfall bewusst gesetzt)", () => {
  assert.equal(DEFAULT_PROVIDER, PROVIDER.TELNYX);
});

// ---- call.provider: Default + gesetzt (json-Pfad via state-ops) ----
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

// ---- P3: tenantId ist Pflicht (kein stiller Bootstrap-Default mehr) ----
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

// ---- Render-Threading end-to-end: Telnyx-Inbound -> TeXML ----
// SKIP_TWILIO_SIGNATURE_CHECK (BASE_ENV) ueberspringt die Signaturpruefung -> der
// Provider ergibt sich allein aus der Header-PRAESENZ, nicht aus einer gueltigen
// Signatur.
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
    assert.equal(
      calls[0].provider,
      PROVIDER.TELNYX,
      "call.provider aus dem Telnyx-Header abgeleitet",
    );
  } finally {
    await srv.stop();
  }
});

// C-P1 (Zusicherung B): ein Inbound-Webhook OHNE erkennbaren Provider-Header laeuft auf
// den Telnyx-Pfad. Diskriminator in BEIDE Richtungen: TeXML traegt transcriptionEngine,
// TwiML traegt speechModel - so kann der Test nicht gruen bleiben, wenn der Rueckfall
// auf einen anderen (TwiML-)Renderer kippt.
test("C-P1 B: Inbound ohne Provider-Header -> Telnyx-Pfad (TeXML, kein speechModel)", async () => {
  const srv = await startServer({ ownerNumber: { e164: TELNYX_NR, provider: PROVIDER.TELNYX } });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST", // BEWUSST ohne Signatur-/Provider-Header
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
