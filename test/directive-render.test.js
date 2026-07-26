import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives } from "../src/telephony/adapters/twilio/render.js";
import {
  say,
  gather,
  hangup,
  redirect,
  stream,
  VOICE_PROFILE,
} from "../src/telephony/directives.js";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';

test("Turn-Direktiven -> TwiML byte-identisch (Gather + Say + Redirect)", () => {
  const action = "/voice/turn?callId=call_abc";
  const out = renderDirectives([
    gather({ promptText: "Hallo & willkommen <bei> Jonas?", action }),
    redirect(action),
  ]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="de-DE" speechTimeout="auto" speechModel="deepgram_nova-2-general" actionOnEmptyResult="true" action="/voice/turn?callId=call_abc" method="POST">' +
      '<Say voice="Polly.Vicki-Neural" language="de-DE">Hallo &amp; willkommen &lt;bei&gt; Jonas?</Say>' +
      "</Gather>" +
      '<Redirect method="POST">/voice/turn?callId=call_abc</Redirect>' +
      "</Response>",
  );
});

test("Gather ohne Prompt -> leeres Gather + Redirect (Bestandsverhalten)", () => {
  const action = "/voice/turn?callId=x";
  const out = renderDirectives([gather({ promptText: "", action }), redirect(action)]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="de-DE" speechTimeout="auto" speechModel="deepgram_nova-2-general" actionOnEmptyResult="true" action="/voice/turn?callId=x" method="POST"/>' +
      '<Redirect method="POST">/voice/turn?callId=x</Redirect>' +
      "</Response>",
  );
});

test("Say + Hangup -> TwiML byte-identisch (Budget/EndCall)", () => {
  const out = renderDirectives([
    say("Das Demo-Budget ist aufgebraucht. Auf Wiederhören."),
    hangup(),
  ]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Say voice="Polly.Vicki-Neural" language="de-DE">Das Demo-Budget ist aufgebraucht. Auf Wiederhören.</Say>' +
      "<Hangup/></Response>",
  );
});

test("Stream-Direktive -> Connect/Stream/Parameter byte-identisch (Realtime)", () => {
  const out = renderDirectives([
    stream({
      url: "wss://agent.test/media",
      params: [
        { name: "call_id", value: "call_abc" },
        { name: "stream_token", value: "tok_123" },
      ],
    }),
  ]);
  assert.equal(
    out,
    XML +
      '<Response><Connect><Stream url="wss://agent.test/media">' +
      '<Parameter name="call_id" value="call_abc"/>' +
      '<Parameter name="stream_token" value="tok_123"/>' +
      "</Stream></Connect></Response>",
  );
});

test("Bare Hangup -> TwiML byte-identisch (inaktiver/fehlender Call)", () => {
  assert.equal(renderDirectives([hangup()]), XML + "<Response><Hangup/></Response>");
});

test("Unbekanntes voiceProfile -> wirft (fail-closed, kein stiller Default-Voice)", () => {
  assert.throws(() => renderDirectives([say("x", "kein-profil")]), /unbekanntes voiceProfile/);
});

// G3-Drift (Twilio): speechTimeoutSec wird vom Twilio-Renderer ignoriert -> TwiML
// byte-identisch zum auto-Bestand (Override ist Telnyx-only, Live laeuft Telnyx).
test("G3-Drift (Twilio): speechTimeoutSec aendert das TwiML-Gather NICHT (bleibt auto)", () => {
  const withOverride = renderDirectives([
    gather({ promptText: "x", action: "/voice/turn?callId=c", speechTimeoutSec: 2 }),
  ]);
  const without = renderDirectives([gather({ promptText: "x", action: "/voice/turn?callId=c" })]);
  assert.equal(withOverride, without, "Twilio ignoriert den Override (byte-identisch)");
  assert.match(withOverride, /speechTimeout="auto"/, "Twilio bleibt auf auto");
});

// --- F1 Phase 3: FR-Sprachpfad. STT-Locale UND TTS-Voice kommen aus dem voiceProfile
// des Aufrufers (eine Quelle: TWILIO_VOICE). DE-Snapshots oben bleiben byte-identisch
// (Default-Profil), die FR-Snapshots sind neu. Akzente sind keine XML-Sonderzeichen und
// passieren den Render-Pfad unveraendert (UTF-8); der Twilio-SDK escaped den ASCII-' nicht.
const FR = VOICE_PROFILE.FR_FEMALE_NEURAL;

test("FR: Turn-Direktiven -> TwiML mit fr-FR-STT + Polly.Lea-Neural (Akzente erhalten)", () => {
  const action = "/voice/turn?callId=call_fr";
  const out = renderDirectives([
    gather({ promptText: "Bonjour, c'est l'assistant IA. Ça va?", action, voiceProfile: FR }),
    redirect(action),
  ]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="fr-FR" speechTimeout="auto" speechModel="deepgram_nova-2-general" actionOnEmptyResult="true" action="/voice/turn?callId=call_fr" method="POST">' +
      '<Say voice="Polly.Lea-Neural" language="fr-FR">Bonjour, c\'est l\'assistant IA. Ça va?</Say>' +
      "</Gather>" +
      '<Redirect method="POST">/voice/turn?callId=call_fr</Redirect>' +
      "</Response>",
  );
});

// R9: Die STT-Locale haengt am Profil, NICHT am inneren Say. Ein leeres FR-Gather muss
// daher trotzdem fr-FR transkribieren (sonst stiller Rueckfall auf de-DE/Englisch).
test("FR: Gather ohne Prompt -> leeres Gather mit fr-FR-STT (kein stilles de-DE)", () => {
  const action = "/voice/turn?callId=call_fr";
  const out = renderDirectives([
    gather({ promptText: "", action, voiceProfile: FR }),
    redirect(action),
  ]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="fr-FR" speechTimeout="auto" speechModel="deepgram_nova-2-general" actionOnEmptyResult="true" action="/voice/turn?callId=call_fr" method="POST"/>' +
      '<Redirect method="POST">/voice/turn?callId=call_fr</Redirect>' +
      "</Response>",
  );
});

test("FR: Say + Hangup -> TwiML mit Polly.Lea-Neural + fr-FR (Akzent erhalten)", () => {
  const out = renderDirectives([say("Le budget est épuisé. Au revoir.", FR), hangup()]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Say voice="Polly.Lea-Neural" language="fr-FR">Le budget est épuisé. Au revoir.</Say>' +
      "<Hangup/></Response>",
  );
});

// Fail-closed gilt jetzt AUCH fuer das leere Gather: die STT-Locale kommt aus dem Profil,
// ein unbekanntes Profil wirft (vorher rendete ein promptloses Gather still durch).
test("FR/Fail-closed: leeres Gather mit unbekanntem Profil wirft (STT-Locale aus Profil)", () => {
  assert.throws(
    () => renderDirectives([gather({ promptText: "", action: "/x", voiceProfile: "kein-profil" })]),
    /unbekanntes voiceProfile/,
  );
});

// --- F1 Phase 4: EN-Sprachpfad (GB-Englisch). STT-Locale + TTS-Voice aus dem Profil
// (TWILIO_VOICE). en-GB als volles BCP-47 (R9); Polly.Amy-Neural als GB-Stimme.
//
// Traegt zugleich VOICE-02 des i18n-Launch-Testkatalogs (Welle W1, Mechanismus/gruen,
// Spezifikation in tasks/i18n-tests/03-telefonie-render.md). Der Katalogfall verlangt exakt
// diese Assertion - deshalb steht sie hier EINMAL (G5) statt als zweite Fassung in einer
// eigenen Datei. Achtung: der Pin gilt fuer den Sprachcode "en", nicht fuer "Englisch
// generell" - Owner-Entscheidung 7.5 macht en-US spaeter zu einem eigenen Bundle.
const EN = VOICE_PROFILE.EN_FEMALE_NEURAL;

test("EN: Turn-Direktiven -> TwiML mit en-GB-STT + Polly.Amy-Neural", () => {
  const action = "/voice/turn?callId=call_en";
  const out = renderDirectives([
    gather({ promptText: "Hello, how can I help?", action, voiceProfile: EN }),
    redirect(action),
  ]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="en-GB" speechTimeout="auto" speechModel="deepgram_nova-2-general" actionOnEmptyResult="true" action="/voice/turn?callId=call_en" method="POST">' +
      '<Say voice="Polly.Amy-Neural" language="en-GB">Hello, how can I help?</Say>' +
      "</Gather>" +
      '<Redirect method="POST">/voice/turn?callId=call_en</Redirect>' +
      "</Response>",
  );
});

test("EN: Say + Hangup -> TwiML mit Polly.Amy-Neural + en-GB", () => {
  const out = renderDirectives([say("The demo budget has been used up. Goodbye.", EN), hangup()]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Say voice="Polly.Amy-Neural" language="en-GB">The demo budget has been used up. Goodbye.</Say>' +
      "<Hangup/></Response>",
  );
});

test("EN/R9: leeres Gather traegt en-GB-STT (volles BCP-47, nicht 'en')", () => {
  const out = renderDirectives([
    gather({ promptText: "", action: "/voice/turn?callId=c1", voiceProfile: EN }),
  ]);
  assert.match(out, /<Gather\b[^>]*\blanguage="en-GB"/, "EN-STT = volles Locale en-GB");
  assert.doesNotMatch(out, /language="en"[ />]/, "nicht das blosse 'en'");
});

// VOICE-22 (tasks/i18n-tests/03-telefonie-render.md): das Twilio-STT-Modell ist ein Literal
// in gatherOpts und darf NICHT sprachabhaengig werden - nur `language` kommt aus dem Profil.
// Die DE/FR/EN-Snapshots oben enthalten den Wert je einzeln; erst diese Schleife formuliert
// ihn als sprachuebergreifende Invariante (ein neues Profil erbt sie automatisch).
const TWILIO_STT_MODEL = "deepgram_nova-2-general";
test("VOICE-22 (Mechanismus, gruen) - Twilio-Gather traegt fuer JEDES Voice-Profil dasselbe STT-Modell", () => {
  for (const profile of Object.values(VOICE_PROFILE)) {
    const out = renderDirectives([gather({ action: "/voice/turn?callId=c1", voiceProfile: profile })]);
    assert.match(
      out,
      new RegExp(`<Gather\\b[^>]*\\bspeechModel="${TWILIO_STT_MODEL}"`),
      `speechModel fehlt/weicht ab fuer ${profile}`,
    );
  }
});
