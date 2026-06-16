// P5: Telnyx-TeXML-Renderer byte-exakt (Snapshot, analog directive-render.test.js).
// Nagelt Voice-Bezeichner (Azure.de-DE-KatjaNeural), STT-Engine (Deepgram Nova-3),
// Attribut-Reihenfolge und das XML-Escaping fest. Grenzfaelle: Gather mit/ohne Prompt,
// bare Hangup, unbekanntes voiceProfile -> wirft. STREAM-Rendering (ab P7) in
// telnyx-stream-render.test.js. Offline.
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
    '<Gather input="speech" language="de" transcriptionEngine="Deepgram" model="deepgram/nova-3" action="/voice/turn?callId=call_abc" method="POST">' +
    '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">Hallo &amp; willkommen &lt;bei&gt; Jonas?</Say>' +
    '</Gather>' +
    '<Redirect method="POST">/voice/turn?callId=call_abc</Redirect>' +
    '</Response>');
});

test("Gather ohne Prompt -> self-closing Gather + Redirect", () => {
  const action = "/voice/turn?callId=x";
  const out = renderDirectives([gather({ promptText: "", action }), redirect(action)]);
  assert.equal(out,
    XML + '<Response>' +
    '<Gather input="speech" language="de" transcriptionEngine="Deepgram" model="deepgram/nova-3" action="/voice/turn?callId=x" method="POST"/>' +
    '<Redirect method="POST">/voice/turn?callId=x</Redirect>' +
    '</Response>');
});

// Regression (Inbound-Audio-Bug 2026-06-15): Ohne transcriptionEngine transkribiert
// Telnyx `<Gather input="speech">` NICHT -> kein SpeechResult -> Agent hoert den
// Angerufenen nie. Diese Invariante schuetzt vor erneutem stillem Weglassen. Seit
// 2026-06-16 ist die Engine "Deepgram" (Nova-3, language="de").
test("Telnyx-Gather aktiviert STT (transcriptionEngine gesetzt, sonst kein SpeechResult)", () => {
  const out = renderDirectives([gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1" })]);
  assert.match(out, /<Gather\b[^>]*\binput="speech"/, "Sprach-Eingabe aktiv");
  assert.match(out, /<Gather\b[^>]*\btranscriptionEngine="Deepgram"/, "STT-Engine gesetzt (Deepgram Nova-3)");
  assert.match(out, /<Gather\b[^>]*\bmodel="deepgram\/nova-3"/, "Deepgram-Modell gesetzt");
  assert.match(out, /<Gather\b[^>]*\blanguage="de"/, "Deepgram-Sprachcode fuer Deutsch (de, nicht de-DE)");
});

test("Say + Hangup -> TeXML byte-identisch (Budget/EndCall)", () => {
  const out = renderDirectives([say("Das Demo-Budget ist aufgebraucht. Auf Wiederhoeren."), hangup()]);
  assert.equal(out,
    XML + '<Response>' +
    '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">Das Demo-Budget ist aufgebraucht. Auf Wiederhoeren.</Say>' +
    '<Hangup/></Response>');
});

test("Bare Hangup -> TeXML byte-identisch (inaktiver/fehlender Call)", () => {
  assert.equal(renderDirectives([hangup()]), XML + '<Response><Hangup/></Response>');
});

test("Unbekanntes voiceProfile -> wirft (fail-closed, kein stiller Default-Voice)", () => {
  assert.throws(() => renderDirectives([say("x", "kein-profil")]), /unbekanntes voiceProfile/);
});
