// P7: MediaTransport (Port 4) - Charakterisierungs-/Dichtheits-Tests. Rein, offline,
// KEIN Server-Spawn, KEIN pglite. Pinnt den Twilio-Frame-Aufbau byte-identisch
// (Verhaltens-Erhaltung der aus bridge.js gezogenen Inline-Objekte) und das neue,
// doku-basierte Telnyx-Mapping (snake_case stream_id, Outbound/clear ohne stream_id).
import { test } from "node:test";
import assert from "node:assert/strict";
import { twilioMedia } from "../src/telephony/adapters/twilio/media.js";
import { telnyxMedia } from "../src/telephony/adapters/telnyx/media.js";

test("Twilio buildMediaFrame/clearPlayback byte-identisch (Dichtheit Realtime)", () => {
  assert.deepEqual(
    twilioMedia.buildMediaFrame({ payload: "AAA", streamRef: "MZ1" }),
    { event: "media", streamSid: "MZ1", media: { payload: "AAA" } }
  );
  assert.deepEqual(twilioMedia.clearPlayback({ streamRef: "MZ1" }), { event: "clear", streamSid: "MZ1" });
});

test("Twilio parseMediaFrame start -> neutrales MediaFrame", () => {
  const frame = twilioMedia.parseMediaFrame({
    event: "start",
    start: { streamSid: "MZ1", callSid: "CA1", customParameters: { call_id: "c1", stream_token: "t1" } },
  });
  assert.deepEqual(frame, {
    event: "start",
    streamRef: "MZ1",
    callId: "c1",
    streamToken: "t1",
    providerCallRef: "CA1",
  });
});

test("Twilio parseMediaFrame media/stop/unbekannt", () => {
  assert.deepEqual(twilioMedia.parseMediaFrame({ event: "media", media: { payload: "X" } }), {
    event: "media",
    payload: "X",
  });
  assert.deepEqual(twilioMedia.parseMediaFrame({ event: "stop" }), { event: "stop" });
  assert.deepEqual(twilioMedia.parseMediaFrame({ event: "mark" }), { event: "other" });
});

test("Telnyx Outbound-Frames OHNE stream_id (Doku-Symmetrie)", () => {
  assert.deepEqual(telnyxMedia.buildMediaFrame({ payload: "X" }), { event: "media", media: { payload: "X" } });
  assert.deepEqual(telnyxMedia.clearPlayback(), { event: "clear" });
});

test("Telnyx parseMediaFrame start -> dasselbe neutrale MediaFrame wie Twilio", () => {
  const fromCustom = telnyxMedia.parseMediaFrame({
    event: "start",
    start: { stream_id: "ST1", call_control_id: "CC1", customParameters: { call_id: "c1", stream_token: "t1" } },
  });
  assert.deepEqual(fromCustom, {
    event: "start",
    streamRef: "ST1",
    callId: "c1",
    streamToken: "t1",
    providerCallRef: "CC1",
  });
  // dynamic_variables als zweite belegte Parameter-Quelle (Annahme im Adapter)
  const fromDynamic = telnyxMedia.parseMediaFrame({
    event: "start",
    start: { stream_id: "ST2", dynamic_variables: { call_id: "c2", stream_token: "t2" } },
  });
  assert.deepEqual(fromDynamic, {
    event: "start",
    streamRef: "ST2",
    callId: "c2",
    streamToken: "t2",
    providerCallRef: undefined,
  });
});

test("Frame-Roundtrip beide Adapter: u-law base64 unveraendert", () => {
  const payload = "//79/Pv6+fj39g=="; // beispielhaftes u-law base64
  const twilioOut = twilioMedia.buildMediaFrame({
    payload: twilioMedia.parseMediaFrame({ event: "media", media: { payload } }).payload,
    streamRef: "MZ1",
  });
  assert.equal(twilioOut.media.payload, payload);

  const telnyxOut = telnyxMedia.buildMediaFrame({
    payload: telnyxMedia.parseMediaFrame({ event: "media", media: { payload } }).payload,
  });
  assert.equal(telnyxOut.media.payload, payload);
});
