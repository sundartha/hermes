// P5: Telnyx-TeXML-Renderer byte-exakt (Snapshot, analog directive-render.test.js).
// Nagelt Voice-Bezeichner (Azure.de-DE-KatjaNeural), STT-Engine (Deepgram Nova-3),
// Attribut-Reihenfolge und das XML-Escaping fest. Grenzfaelle: Gather mit/ohne Prompt,
// bare Hangup, unbekanntes voiceProfile -> wirft. STREAM-Rendering (ab P7) in
// telnyx-stream-render.test.js. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { say, gather, hangup, redirect, VOICE_PROFILE } from "../src/telephony/directives.js";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';

test("Gather + Say + Redirect -> TeXML byte-identisch (inkl. XML-Escaping)", () => {
  const action = "/voice/turn?callId=call_abc";
  const out = renderDirectives([gather({ promptText: "Hallo & willkommen <bei> Jonas?", action }), redirect(action)]);
  assert.equal(out,
    XML + '<Response>' +
    '<Gather input="speech" language="de-DE" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=call_abc" method="POST">' +
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
    '<Gather input="speech" language="de-DE" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=x" method="POST"/>' +
    '<Redirect method="POST">/voice/turn?callId=x</Redirect>' +
    '</Response>');
});

// Regression (Inbound-Audio-Bug 2026-06-15): Ohne transcriptionEngine transkribiert
// Telnyx `<Gather input="speech">` NICHT -> kein SpeechResult -> Agent hoert den
// Angerufenen nie. Diese Invariante schuetzt vor erneutem stillem Weglassen. Seit
// 2026-06-16 ist die Engine "Deepgram" (Nova-3); language MUSS das volle Locale "de-DE"
// sein - "de" allein faellt Telnyx-seitig auf Englisch zurueck -> leeres Transcript
// (echte STT-Records, 2026-06-20). Diese Invariante schuetzt vor Rueckfall auf "de".
test("Telnyx-Gather aktiviert STT (transcriptionEngine gesetzt, sonst kein SpeechResult)", () => {
  const out = renderDirectives([gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1" })]);
  assert.match(out, /<Gather\b[^>]*\binput="speech"/, "Sprach-Eingabe aktiv");
  assert.match(out, /<Gather\b[^>]*\btranscriptionEngine="Deepgram"/, "STT-Engine gesetzt (Deepgram Nova-3)");
  assert.match(out, /<Gather\b[^>]*\bmodel="deepgram\/nova-3"/, "Deepgram-Modell gesetzt");
  assert.match(out, /<Gather\b[^>]*\blanguage="de-DE"/, "Sprachcode fuer Deutsch = volles Locale de-DE (nicht 'de' allein)");
  assert.match(out, /<Gather\b[^>]*\bspeechTimeout="auto"/, "End-of-Speech-Erkennung aktiv (Gather postet nach Sprechende prompt zurueck)");
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

// G3: gesetztes speechTimeoutSec ersetzt "auto" an derselben Attribut-Position
// (Reihenfolge vertraglich). Folge-Gather im /voice/turn.
test("G3: Folge-Gather mit speechTimeoutSec -> speechTimeout=\"2\" (positiver Integer, nicht auto)", () => {
  const out = renderDirectives([gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1", speechTimeoutSec: 2 })]);
  assert.match(out, /<Gather\b[^>]*\bspeechTimeout="2"/, "festes Endpointing 2s");
  assert.doesNotMatch(out, /speechTimeout="auto"/, "kein auto mehr im Folge-Gather");
  // Reihenfolge unveraendert: model direkt vor speechTimeout (Snapshot-Invariante).
  assert.match(out, /model="deepgram\/nova-3" speechTimeout="2"/, "Attribut-Reihenfolge stabil");
});

// G3-Drift (Pre-Mortem a): OHNE speechTimeoutSec bleibt der Gather byte-identisch
// auf "auto" - schuetzt das Outbound-Erst-Gather + Inbound-Greeting vor dem
// G2-Deadlock-Regress.
test("G3-Drift: Gather ohne speechTimeoutSec bleibt auf speechTimeout=\"auto\"", () => {
  const out = renderDirectives([gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1" })]);
  assert.match(out, /<Gather\b[^>]*\bspeechTimeout="auto"/, "Default bleibt auto (Erst-Gather)");
});

// --- F1 Phase 3: FR-Sprachpfad. STT-Locale UND TTS-Voice kommen aus dem voiceProfile
// des Aufrufers (eine Quelle: TELNYX_VOICE). DE-Snapshots oben bleiben byte-identisch
// (Default-Profil), die FR-Snapshots sind neu. Akzente sind keine XML-Sonderzeichen und
// passieren escapeXml unveraendert; der ASCII-' wird wie im Bestand zu &apos; escaped.
const FR = VOICE_PROFILE.FR_FEMALE_NEURAL;

test("FR: Gather + Say + Redirect -> TeXML mit fr-FR-STT + Azure.fr-FR-DeniseNeural (Akzente erhalten, ' escaped)", () => {
  const action = "/voice/turn?callId=call_fr";
  const out = renderDirectives([gather({ promptText: "Bonjour, c'est l'assistant IA. Ça va?", action, voiceProfile: FR }), redirect(action)]);
  assert.equal(out,
    XML + '<Response>' +
    '<Gather input="speech" language="fr-FR" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=call_fr" method="POST">' +
    '<Say voice="Azure.fr-FR-DeniseNeural" language="fr-FR">Bonjour, c&apos;est l&apos;assistant IA. Ça va?</Say>' +
    '</Gather>' +
    '<Redirect method="POST">/voice/turn?callId=call_fr</Redirect>' +
    '</Response>');
});

// R9-Falle fuer FR: die STT-Locale haengt am Profil, NICHT am inneren Say. Ein leeres
// FR-Gather muss trotzdem fr-FR transkribieren - sonst faellt Telnyx still auf Englisch.
test("FR: Gather ohne Prompt -> self-closing Gather mit fr-FR-STT (kein stilles de-DE)", () => {
  const action = "/voice/turn?callId=call_fr";
  const out = renderDirectives([gather({ promptText: "", action, voiceProfile: FR }), redirect(action)]);
  assert.equal(out,
    XML + '<Response>' +
    '<Gather input="speech" language="fr-FR" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=call_fr" method="POST"/>' +
    '<Redirect method="POST">/voice/turn?callId=call_fr</Redirect>' +
    '</Response>');
});

// R9 explizit: FR-STT-Locale MUSS das volle BCP-47 "fr-FR" sein (nicht das blosse "fr",
// das Telnyx wie bei "de" auf Englisch zuruckfallen liesse). Nova-3 deckt FR mit ab.
test("FR/R9: Gather-STT-Locale ist fr-FR (volles BCP-47, nicht 'fr'); Nova-3 mehrsprachig", () => {
  const out = renderDirectives([gather({ promptText: "Oui?", action: "/voice/turn?callId=c1", voiceProfile: FR })]);
  assert.match(out, /<Gather\b[^>]*\blanguage="fr-FR"/, "FR-STT = volles Locale fr-FR");
  assert.doesNotMatch(out, /language="fr"[ />]/, "nicht das blosse 'fr' (Englisch-Falle)");
  assert.match(out, /<Gather\b[^>]*\bmodel="deepgram\/nova-3"/, "Deepgram Nova-3 (mehrsprachig, FR inkl.)");
});

test("FR: Say + Hangup -> TeXML mit Azure.fr-FR-DeniseNeural + fr-FR (Akzent erhalten)", () => {
  const out = renderDirectives([say("Le budget est épuisé. Au revoir.", FR), hangup()]);
  assert.equal(out,
    XML + '<Response>' +
    '<Say voice="Azure.fr-FR-DeniseNeural" language="fr-FR">Le budget est épuisé. Au revoir.</Say>' +
    '<Hangup/></Response>');
});

// G3 komponiert mit FR: gesetztes speechTimeoutSec ersetzt "auto" an derselben Position,
// die FR-Locale bleibt davon unberuehrt (Attribut-Reihenfolge stabil).
test("FR/G3: Folge-Gather mit speechTimeoutSec -> fr-FR + speechTimeout=\"2\" (Reihenfolge stabil)", () => {
  const out = renderDirectives([gather({ promptText: "Oui?", action: "/voice/turn?callId=c1", voiceProfile: FR, speechTimeoutSec: 2 })]);
  assert.match(out, /language="fr-FR" transcriptionEngine="Deepgram" model="deepgram\/nova-3" speechTimeout="2"/, "FR-Locale + festes Endpointing, Reihenfolge stabil");
  assert.doesNotMatch(out, /speechTimeout="auto"/, "kein auto mehr im Folge-Gather");
});

// Fail-closed gilt jetzt AUCH fuer das leere Gather: die STT-Locale kommt aus dem Profil,
// ein unbekanntes Profil wirft (vorher rendete ein promptloses Gather still durch).
test("FR/Fail-closed: leeres Gather mit unbekanntem Profil wirft (STT-Locale aus Profil)", () => {
  assert.throws(() => renderDirectives([gather({ promptText: "", action: "/x", voiceProfile: "kein-profil" })]), /unbekanntes voiceProfile/);
});

// --- F1 Phase 4: EN-Sprachpfad. Azure.en-GB-SoniaNeural + en-GB-STT; Nova-3 deckt EN ab.
const EN = VOICE_PROFILE.EN_FEMALE_NEURAL;

test("EN: Gather + Say + Redirect -> TeXML mit en-GB-STT + Azure.en-GB-SoniaNeural", () => {
  const action = "/voice/turn?callId=call_en";
  const out = renderDirectives([gather({ promptText: "Hello, how can I help?", action, voiceProfile: EN }), redirect(action)]);
  assert.equal(out,
    XML + '<Response>' +
    '<Gather input="speech" language="en-GB" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=call_en" method="POST">' +
    '<Say voice="Azure.en-GB-SoniaNeural" language="en-GB">Hello, how can I help?</Say>' +
    '</Gather>' +
    '<Redirect method="POST">/voice/turn?callId=call_en</Redirect>' +
    '</Response>');
});

test("EN: Say + Hangup -> TeXML mit Azure.en-GB-SoniaNeural + en-GB", () => {
  const out = renderDirectives([say("The demo budget has been used up. Goodbye.", EN), hangup()]);
  assert.equal(out,
    XML + '<Response>' +
    '<Say voice="Azure.en-GB-SoniaNeural" language="en-GB">The demo budget has been used up. Goodbye.</Say>' +
    '<Hangup/></Response>');
});

test("EN/R9: Gather-STT-Locale ist en-GB (volles BCP-47, nicht 'en'); Nova-3 mehrsprachig", () => {
  const out = renderDirectives([gather({ promptText: "Yes?", action: "/voice/turn?callId=c1", voiceProfile: EN })]);
  assert.match(out, /<Gather\b[^>]*\blanguage="en-GB"/, "EN-STT = volles Locale en-GB");
  assert.doesNotMatch(out, /language="en"[ />]/, "nicht das blosse 'en' (Englisch-Falle)");
  assert.match(out, /<Gather\b[^>]*\bmodel="deepgram\/nova-3"/, "Deepgram Nova-3 (mehrsprachig, EN inkl.)");
});
