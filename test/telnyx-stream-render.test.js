// P7: Telnyx-TeXML-STREAM-Renderer byte-exakt (Snapshot). Nagelt das <Connect><Stream>-
// Markup, die Parameter-Reihenfolge (vertraglich) und das XML-Escaping fest. Ersetzt
// den frueheren "STREAM -> wirft"-Test (Telnyx-Realtime ist ab P7 implementiert). Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { stream } from "../src/telephony/directives.js";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';

test("STREAM -> Connect/Stream/Parameter byte-identisch (Realtime, Telnyx-Pfad)", () => {
  const out = renderDirectives([stream({ url: "wss://agent.test/media/telnyx", params: [
    { name: "call_id", value: "call_abc" }, { name: "stream_token", value: "tok_123" }] })]);
  assert.equal(out,
    XML + '<Response><Connect><Stream url="wss://agent.test/media/telnyx">' +
    '<Parameter name="call_id" value="call_abc"/>' +
    '<Parameter name="stream_token" value="tok_123"/>' +
    '</Stream></Connect></Response>');
});

test("STREAM escaped Sonderzeichen in url/value (&, <)", () => {
  const out = renderDirectives([stream({ url: "wss://agent.test/media/telnyx?a=1&b=2", params: [
    { name: "call_id", value: "<x>&y" }] })]);
  assert.equal(out,
    XML + '<Response><Connect><Stream url="wss://agent.test/media/telnyx?a=1&amp;b=2">' +
    '<Parameter name="call_id" value="&lt;x&gt;&amp;y"/>' +
    '</Stream></Connect></Response>');
});
