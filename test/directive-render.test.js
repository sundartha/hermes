import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives } from "../src/telephony/adapters/twilio/render.js";
import { say, gather, hangup, redirect, stream } from "../src/telephony/directives.js";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';

test("Turn-Direktiven -> TwiML byte-identisch (Gather + Say + Redirect)", () => {
  const action = "/voice/turn?callId=call_abc";
  const out = renderDirectives([gather({ promptText: "Hallo & willkommen <bei> Jonas?", action }), redirect(action)]);
  assert.equal(out,
    XML + '<Response>' +
    '<Gather input="speech" language="de-DE" speechTimeout="auto" speechModel="deepgram_nova-2-general" actionOnEmptyResult="true" action="/voice/turn?callId=call_abc" method="POST">' +
    '<Say voice="Polly.Vicki-Neural" language="de-DE">Hallo &amp; willkommen &lt;bei&gt; Jonas?</Say>' +
    '</Gather>' +
    '<Redirect method="POST">/voice/turn?callId=call_abc</Redirect>' +
    '</Response>');
});

test("Gather ohne Prompt -> leeres Gather + Redirect (Bestandsverhalten)", () => {
  const action = "/voice/turn?callId=x";
  const out = renderDirectives([gather({ promptText: "", action }), redirect(action)]);
  assert.equal(out,
    XML + '<Response>' +
    '<Gather input="speech" language="de-DE" speechTimeout="auto" speechModel="deepgram_nova-2-general" actionOnEmptyResult="true" action="/voice/turn?callId=x" method="POST"/>' +
    '<Redirect method="POST">/voice/turn?callId=x</Redirect>' +
    '</Response>');
});

test("Say + Hangup -> TwiML byte-identisch (Budget/EndCall)", () => {
  const out = renderDirectives([say("Das Demo-Budget ist aufgebraucht. Auf Wiederhoeren."), hangup()]);
  assert.equal(out,
    XML + '<Response>' +
    '<Say voice="Polly.Vicki-Neural" language="de-DE">Das Demo-Budget ist aufgebraucht. Auf Wiederhoeren.</Say>' +
    '<Hangup/></Response>');
});

test("Stream-Direktive -> Connect/Stream/Parameter byte-identisch (Realtime)", () => {
  const out = renderDirectives([stream({ url: "wss://agent.test/media", params: [
    { name: "call_id", value: "call_abc" }, { name: "stream_token", value: "tok_123" }] })]);
  assert.equal(out,
    XML + '<Response><Connect><Stream url="wss://agent.test/media">' +
    '<Parameter name="call_id" value="call_abc"/>' +
    '<Parameter name="stream_token" value="tok_123"/>' +
    '</Stream></Connect></Response>');
});

test("Bare Hangup -> TwiML byte-identisch (inaktiver/fehlender Call)", () => {
  assert.equal(renderDirectives([hangup()]), XML + '<Response><Hangup/></Response>');
});

test("Unbekanntes voiceProfile -> wirft (fail-closed, kein stiller Default-Voice)", () => {
  assert.throws(() => renderDirectives([say("x", "kein-profil")]), /unbekanntes voiceProfile/);
});

// G3-Drift (Twilio): speechTimeoutSec wird vom Twilio-Renderer ignoriert -> TwiML
// byte-identisch zum auto-Bestand (Override ist Telnyx-only, Live laeuft Telnyx).
test("G3-Drift (Twilio): speechTimeoutSec aendert das TwiML-Gather NICHT (bleibt auto)", () => {
  const withOverride = renderDirectives([gather({ promptText: "x", action: "/voice/turn?callId=c", speechTimeoutSec: 2 })]);
  const without = renderDirectives([gather({ promptText: "x", action: "/voice/turn?callId=c" })]);
  assert.equal(withOverride, without, "Twilio ignoriert den Override (byte-identisch)");
  assert.match(withOverride, /speechTimeout="auto"/, "Twilio bleibt auf auto");
});
