import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { say, gather, hangup, redirect, VOICE_PROFILE } from "../src/telephony/directives.js";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';

test("Gather + Say + Redirect -> TeXML byte-identisch (inkl. XML-Escaping)", () => {
  const action = "/voice/turn?callId=call_abc";
  const out = renderDirectives([
    gather({ promptText: "Hallo & willkommen <bei> Jonas?", action }),
    redirect(action),
  ]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="de-DE" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=call_abc" method="POST">' +
      '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">Hallo &amp; willkommen &lt;bei&gt; Jonas?</Say>' +
      "</Gather>" +
      '<Redirect method="POST">/voice/turn?callId=call_abc</Redirect>' +
      "</Response>",
  );
});

test("Gather ohne Prompt -> self-closing Gather + Redirect", () => {
  const action = "/voice/turn?callId=x";
  const out = renderDirectives([gather({ promptText: "", action }), redirect(action)]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="de-DE" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=x" method="POST"/>' +
      '<Redirect method="POST">/voice/turn?callId=x</Redirect>' +
      "</Response>",
  );
});

test("Telnyx-Gather aktiviert STT (transcriptionEngine gesetzt, sonst kein SpeechResult)", () => {
  const out = renderDirectives([gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1" })]);
  assert.match(out, /<Gather\b[^>]*\binput="speech"/, "Sprach-Eingabe aktiv");
  assert.match(
    out,
    /<Gather\b[^>]*\btranscriptionEngine="Deepgram"/,
    "STT-Engine gesetzt (Deepgram Nova-3)",
  );
  assert.match(out, /<Gather\b[^>]*\bmodel="deepgram\/nova-3"/, "Deepgram-Modell gesetzt");
  assert.match(
    out,
    /<Gather\b[^>]*\blanguage="de-DE"/,
    "Sprachcode fuer Deutsch = volles Locale de-DE (nicht 'de' allein)",
  );
  assert.match(
    out,
    /<Gather\b[^>]*\bspeechTimeout="auto"/,
    "End-of-Speech-Erkennung aktiv (Gather postet nach Sprechende prompt zurueck)",
  );
});

test("Say + Hangup -> TeXML byte-identisch (Budget/EndCall)", () => {
  const out = renderDirectives([
    say("Das Demo-Budget ist aufgebraucht. Auf Wiederhören."),
    hangup(),
  ]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">Das Demo-Budget ist aufgebraucht. Auf Wiederhören.</Say>' +
      "<Hangup/></Response>",
  );
});

test("Bare Hangup -> TeXML byte-identisch (inaktiver/fehlender Call)", () => {
  assert.equal(renderDirectives([hangup()]), XML + "<Response><Hangup/></Response>");
});

test("Unbekanntes voiceProfile -> wirft (fail-closed, kein stiller Default-Voice)", () => {
  assert.throws(() => renderDirectives([say("x", "kein-profil")]), /unbekanntes voiceProfile/);
});

test('G3: Folge-Gather mit speechTimeoutSec -> speechTimeout="2" (positiver Integer, nicht auto)', () => {
  const out = renderDirectives([
    gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1", speechTimeoutSec: 2 }),
  ]);
  assert.match(out, /<Gather\b[^>]*\bspeechTimeout="2"/, "festes Endpointing 2s");
  assert.doesNotMatch(out, /speechTimeout="auto"/, "kein auto mehr im Folge-Gather");
  assert.match(out, /model="deepgram\/nova-3" speechTimeout="2"/, "Attribut-Reihenfolge stabil");
});

test('G3-Drift: Gather ohne speechTimeoutSec bleibt auf speechTimeout="auto"', () => {
  const out = renderDirectives([gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1" })]);
  assert.match(out, /<Gather\b[^>]*\bspeechTimeout="auto"/, "Default bleibt auto (Erst-Gather)");
});

const FR = VOICE_PROFILE.FR_FEMALE_NEURAL;

test("FR: Gather + Say + Redirect -> TeXML mit fr-FR-STT + Azure.fr-FR-DeniseNeural (Akzente erhalten, ' escaped)", () => {
  const action = "/voice/turn?callId=call_fr";
  const out = renderDirectives([
    gather({ promptText: "Bonjour, c'est l'assistant IA. Ça va?", action, voiceProfile: FR }),
    redirect(action),
  ]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="fr-FR" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=call_fr" method="POST">' +
      '<Say voice="Azure.fr-FR-DeniseNeural" language="fr-FR">Bonjour, c&apos;est l&apos;assistant IA. Ça va?</Say>' +
      "</Gather>" +
      '<Redirect method="POST">/voice/turn?callId=call_fr</Redirect>' +
      "</Response>",
  );
});

test("FR: Gather ohne Prompt -> self-closing Gather mit fr-FR-STT (kein stilles de-DE)", () => {
  const action = "/voice/turn?callId=call_fr";
  const out = renderDirectives([
    gather({ promptText: "", action, voiceProfile: FR }),
    redirect(action),
  ]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="fr-FR" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=call_fr" method="POST"/>' +
      '<Redirect method="POST">/voice/turn?callId=call_fr</Redirect>' +
      "</Response>",
  );
});

test("FR/R9: Gather-STT-Locale ist fr-FR (volles BCP-47, nicht 'fr'); Nova-3 mehrsprachig", () => {
  const out = renderDirectives([
    gather({ promptText: "Oui?", action: "/voice/turn?callId=c1", voiceProfile: FR }),
  ]);
  assert.match(out, /<Gather\b[^>]*\blanguage="fr-FR"/, "FR-STT = volles Locale fr-FR");
  assert.doesNotMatch(out, /language="fr"[ />]/, "nicht das blosse 'fr' (Englisch-Falle)");
  assert.match(
    out,
    /<Gather\b[^>]*\bmodel="deepgram\/nova-3"/,
    "Deepgram Nova-3 (mehrsprachig, FR inkl.)",
  );
});

test("FR: Say + Hangup -> TeXML mit Azure.fr-FR-DeniseNeural + fr-FR (Akzent erhalten)", () => {
  const out = renderDirectives([say("Le budget est épuisé. Au revoir.", FR), hangup()]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Say voice="Azure.fr-FR-DeniseNeural" language="fr-FR">Le budget est épuisé. Au revoir.</Say>' +
      "<Hangup/></Response>",
  );
});

test('FR/G3: Folge-Gather mit speechTimeoutSec -> fr-FR + speechTimeout="2" (Reihenfolge stabil)', () => {
  const out = renderDirectives([
    gather({
      promptText: "Oui?",
      action: "/voice/turn?callId=c1",
      voiceProfile: FR,
      speechTimeoutSec: 2,
    }),
  ]);
  assert.match(
    out,
    /language="fr-FR" transcriptionEngine="Deepgram" model="deepgram\/nova-3" speechTimeout="2"/,
    "FR-Locale + festes Endpointing, Reihenfolge stabil",
  );
  assert.doesNotMatch(out, /speechTimeout="auto"/, "kein auto mehr im Folge-Gather");
});

test("FR/Fail-closed: leeres Gather mit unbekanntem Profil wirft (STT-Locale aus Profil)", () => {
  assert.throws(
    () => renderDirectives([gather({ promptText: "", action: "/x", voiceProfile: "kein-profil" })]),
    /unbekanntes voiceProfile/,
  );
});

const EN = VOICE_PROFILE.EN_FEMALE_NEURAL;

test("EN: Gather + Say + Redirect -> TeXML mit en-GB-STT + Azure.en-GB-SoniaNeural", () => {
  const action = "/voice/turn?callId=call_en";
  const out = renderDirectives([
    gather({ promptText: "Hello, how can I help?", action, voiceProfile: EN }),
    redirect(action),
  ]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="en-GB" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=call_en" method="POST">' +
      '<Say voice="Azure.en-GB-SoniaNeural" language="en-GB">Hello, how can I help?</Say>' +
      "</Gather>" +
      '<Redirect method="POST">/voice/turn?callId=call_en</Redirect>' +
      "</Response>",
  );
});

test("EN: Say + Hangup -> TeXML mit Azure.en-GB-SoniaNeural + en-GB", () => {
  const out = renderDirectives([say("The demo budget has been used up. Goodbye.", EN), hangup()]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Say voice="Azure.en-GB-SoniaNeural" language="en-GB">The demo budget has been used up. Goodbye.</Say>' +
      "<Hangup/></Response>",
  );
});

test("EN/R9: Gather-STT-Locale ist en-GB (volles BCP-47, nicht 'en'); Nova-3 mehrsprachig", () => {
  const out = renderDirectives([
    gather({ promptText: "Yes?", action: "/voice/turn?callId=c1", voiceProfile: EN }),
  ]);
  assert.match(out, /<Gather\b[^>]*\blanguage="en-GB"/, "EN-STT = volles Locale en-GB");
  assert.doesNotMatch(out, /language="en"[ />]/, "nicht das blosse 'en' (Englisch-Falle)");
  assert.match(
    out,
    /<Gather\b[^>]*\bmodel="deepgram\/nova-3"/,
    "Deepgram Nova-3 (mehrsprachig, EN inkl.)",
  );
});

const CJK_SPEECH = "田中様、お電話ありがとうございます";
test("FMT-24 (Mechanismus, gruen) - CJK-Text passiert escapeXml und den Say-Renderpfad unveraendert", () => {
  const out = renderDirectives([say(CJK_SPEECH, VOICE_PROFILE.DE_FEMALE_NEURAL), hangup()]);
  assert.ok(out.includes(`>${CJK_SPEECH}</Say>`), "CJK byte-identisch im Say-Element");
  assert.doesNotMatch(out, /&#\d+;|&x[0-9a-f]+;/i, "keine numerische Escape-Sequenz");
  assert.ok(Buffer.byteLength(out, "utf8") > out.length, "UTF-8 mehrbyte, kein Zeichen verloren");
});
