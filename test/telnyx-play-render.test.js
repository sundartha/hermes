// Snapshot-Tests fuer den <Play>-Zweig des Telnyx-Renderers (Play-TTS, audioUrl/
// promptAudioUrl). Pur (kein Env, kein Spawn), analog telnyx-render.test.js. Pinnt:
// (1) gather() mit promptAudioUrl -> <Gather>...<Play>url</Play>...</Gather>, KEIN
// innerer <Say>; (2) say() mit audioUrl -> <Play>url</Play> statt <Say>; (3) Fallback
// OHNE audioUrl/promptAudioUrl bleibt byte-identisch zum Azure-<Say>-Bestand; (4) URL
// mit XML-Sonderzeichen wird escaped. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { say, gather, hangup } from "../src/telephony/directives.js";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';
const PLAY_URL = "https://agent.test/voice/tts/tok123";

test("gather() mit promptAudioUrl -> <Play> statt innerem <Say>", () => {
  const action = "/voice/turn?callId=c1";
  const out = renderDirectives([
    gather({ promptText: "Hallo?", action, promptAudioUrl: PLAY_URL }),
  ]);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="de-DE" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=c1" method="POST">' +
      `<Play>${PLAY_URL}</Play>` +
      "</Gather>" +
      "</Response>",
  );
  assert.doesNotMatch(out, /<Say\b/, "kein innerer Say, wenn promptAudioUrl gesetzt ist");
});

test("say() mit audioUrl -> <Play>url</Play> statt <Say>text</Say>", () => {
  const out = renderDirectives([say("Hallo Welt", undefined, PLAY_URL), hangup()]);
  assert.equal(out, XML + "<Response>" + `<Play>${PLAY_URL}</Play>` + "<Hangup/></Response>");
});

test("Fallback OHNE audioUrl/promptAudioUrl bleibt byte-identisch zum Azure-<Say>-Bestand", () => {
  const action = "/voice/turn?callId=c1";
  const withAudioAbsent = renderDirectives([
    gather({ promptText: "Hallo?", action }),
    say("Tschuess", undefined),
  ]);
  const reference =
    XML +
    "<Response>" +
    '<Gather input="speech" language="de-DE" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=c1" method="POST">' +
    '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">Hallo?</Say>' +
    "</Gather>" +
    '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">Tschuess</Say>' +
    "</Response>";
  assert.equal(
    withAudioAbsent,
    reference,
    "undefiniertes audioUrl/promptAudioUrl aendert die XML nicht",
  );
});

test("URL mit & und < wird korrekt XML-escaped", () => {
  const dirtyUrl = "https://agent.test/voice/tts/tok?a=1&b=<x>";
  const out = renderDirectives([say("Hi", undefined, dirtyUrl)]);
  assert.match(out, /<Play>https:\/\/agent\.test\/voice\/tts\/tok\?a=1&amp;b=&lt;x&gt;<\/Play>/);
});
