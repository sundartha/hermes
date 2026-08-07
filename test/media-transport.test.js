// P7: MediaTransport (Port 4) - Charakterisierungs-/Dichtheits-Tests. Rein, offline,
// KEIN Server-Spawn, KEIN pglite. Pinnt das doku-basierte Telnyx-Mapping (snake_case
// stream_id, Outbound/clear ohne stream_id).
//
// C-P4: die Twilio-Haelfte ist mit dem Adapter entfallen. Zwei Aussagen, die es NUR
// dort gab, sind hier auf Telnyx uebernommen statt geloescht worden - sie gehoeren dem
// PORT, nicht dem Anbieter: das neutrale Event-Mapping fuer media/stop/unbekannt und
// die Haertung T-P3-01 (malformter start-Frame).
import { test } from "node:test";
import assert from "node:assert/strict";
import { telnyxMedia } from "../src/telephony/adapters/telnyx/media.js";

test("Telnyx Outbound-Frames OHNE stream_id (Doku-Symmetrie)", () => {
  assert.deepEqual(telnyxMedia.buildMediaFrame({ payload: "X" }), {
    event: "media",
    media: { payload: "X" },
  });
  assert.deepEqual(telnyxMedia.clearPlayback(), { event: "clear" });
});

test("Telnyx parseMediaFrame start -> neutrales MediaFrame", () => {
  const fromCustom = telnyxMedia.parseMediaFrame({
    event: "start",
    start: {
      stream_id: "ST1",
      call_control_id: "CC1",
      customParameters: { call_id: "c1", stream_token: "t1" },
    },
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

// Aus der Twilio-Haelfte uebernommen (C-P4): das neutrale Event-Vokabular ist eine
// PORT-Aussage - media traegt die Payload durch, stop bleibt stop, alles Unbekannte
// faellt auf OTHER statt einen Roh-Event nach oben zu lassen.
test("Telnyx parseMediaFrame media/stop/unbekannt -> neutrales Vokabular", () => {
  assert.deepEqual(telnyxMedia.parseMediaFrame({ event: "media", media: { payload: "X" } }), {
    event: "media",
    payload: "X",
  });
  assert.deepEqual(telnyxMedia.parseMediaFrame({ event: "stop" }), { event: "stop" });
  assert.deepEqual(telnyxMedia.parseMediaFrame({ event: "mark" }), { event: "other" });
});

test("Frame-Roundtrip: u-law base64 unveraendert", () => {
  const payload = "//79/Pv6+fj39g=="; // beispielhaftes u-law base64
  const telnyxOut = telnyxMedia.buildMediaFrame({
    payload: telnyxMedia.parseMediaFrame({ event: "media", media: { payload } }).payload,
  });
  assert.equal(telnyxOut.media.payload, payload);
});

// T-P3-01 (OT-2): malformter start-Frame OHNE .start-Objekt darf NICHT werfen (der
// TypeError entkaeme sonst zum ws-Emitter -> Prozess-Crash). Bis C-P4 stand diese ID am
// Twilio-Adapter, weil DORT die Haertung nachgezogen wurde; die Aussage gilt dem Port und
// steht seither hier. Der Adapter liefert ein wohlgeformtes neutrales Frame mit
// undefined-Feldern.
test("Telnyx parseMediaFrame start OHNE .start -> kein Throw, neutrales Frame (T-P3-01)", () => {
  assert.deepEqual(telnyxMedia.parseMediaFrame({ event: "start" }), {
    event: "start",
    streamRef: undefined,
    callId: undefined,
    streamToken: "",
    providerCallRef: undefined,
  });
});
