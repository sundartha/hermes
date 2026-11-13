import assert from "node:assert/strict";
import { test } from "node:test";

import { umleitenOderAuflegen } from "../../src/elevenlabs/inbound-bridges.ts";
import { captureConsole } from "../helpers.js";

const CALL = { id: "call_fehlertext", provider: "telnyx", twilioSid: "sid_fehlertext" };
const URL = "https://example.test/voice/el-rueckfall";

test("Umleitung gescheitert: die Logzeile nennt den Fehlertext der Umleitung", async () => {
  const zeilen = await captureConsole(() =>
    umleitenOderAuflegen({
      voiceControl: () => ({ redirectCall: () => Promise.reject(new Error("umleitung-defekt")) }),
      endCarrierCall: async () => {},
      call: CALL,
      url: URL,
    }),
  );
  assert.ok(zeilen.includes("[el-inbound] umleitung_fehlgeschlagen call=call_fehlertext: umleitung-defekt"));
});

test("Auflegen gescheitert: die Logzeile nennt den Fehlertext des Auflegens", async () => {
  const zeilen = await captureConsole(() =>
    umleitenOderAuflegen({
      voiceControl: () => ({}),
      endCarrierCall: () => Promise.reject(new Error("auflegen-defekt")),
      call: CALL,
      url: URL,
    }),
  );
  assert.ok(zeilen.includes("[el-inbound] auflegen_fehlgeschlagen call=call_fehlertext: auflegen-defekt"));
});
