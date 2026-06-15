// P5: Telnyx-TeXML-Renderer byte-exakt (Snapshot, analog directive-render.test.js).
// Nagelt Voice-Bezeichner (Polly.Vicki-Neural), Attribut-Reihenfolge und das
// XML-Escaping fest. Grenzfaelle: Gather mit/ohne Prompt, bare Hangup, unbekanntes
// voiceProfile -> wirft. STREAM-Rendering (ab P7) in telnyx-stream-render.test.js. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { say, gather, hangup, redirect } from "../src/telephony/directives.js";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';

test("Gather + Say + Redirect -> TeXML byte-identisch (inkl. XML-Escaping)", () => {
  const action = "/voice/turn?callId=call_abc";
  const out = renderDirectives([gather({ promptText: "Hallo & willkommen <bei> Jonas?", action }), redirect(action)]);
  assert.equal(out,
    XML + '<Response>' +
    '<Gather input="speech" language="de-DE" action="/voice/turn?callId=call_abc" method="POST">' +
    '<Say voice="Polly.Vicki-Neural" language="de-DE">Hallo &amp; willkommen &lt;bei&gt; Jonas?</Say>' +
    '</Gather>' +
    '<Redirect method="POST">/voice/turn?callId=call_abc</Redirect>' +
    '</Response>');
});

test("Gather ohne Prompt -> self-closing Gather + Redirect", () => {
  const action = "/voice/turn?callId=x";
  const out = renderDirectives([gather({ promptText: "", action }), redirect(action)]);
  assert.equal(out,
    XML + '<Response>' +
    '<Gather input="speech" language="de-DE" action="/voice/turn?callId=x" method="POST"/>' +
    '<Redirect method="POST">/voice/turn?callId=x</Redirect>' +
    '</Response>');
});

test("Say + Hangup -> TeXML byte-identisch (Budget/EndCall)", () => {
  const out = renderDirectives([say("Das Demo-Budget ist aufgebraucht. Auf Wiederhoeren."), hangup()]);
  assert.equal(out,
    XML + '<Response>' +
    '<Say voice="Polly.Vicki-Neural" language="de-DE">Das Demo-Budget ist aufgebraucht. Auf Wiederhoeren.</Say>' +
    '<Hangup/></Response>');
});

test("Bare Hangup -> TeXML byte-identisch (inaktiver/fehlender Call)", () => {
  assert.equal(renderDirectives([hangup()]), XML + '<Response><Hangup/></Response>');
});

test("Unbekanntes voiceProfile -> wirft (fail-closed, kein stiller Default-Voice)", () => {
  assert.throws(() => renderDirectives([say("x", "kein-profil")]), /unbekanntes voiceProfile/);
});
