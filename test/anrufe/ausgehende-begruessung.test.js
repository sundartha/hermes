import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runOutbound,
  runOutboundKeepOpen,
  HANGUP_TAG as HANGUP,
  assertDisclosureInGather,
} from "../_outbound-harness.js";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

const DISCLOSURE_PREFIX = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel.";
const SAY_OPEN = '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">';

test("/voice/outbound rendert Offenlegung als Say-Praefix im Gather (Regel 2, LLM-frei G2)", async () => {
  const { body: twiml, status } = await runOutbound({ provider: "telnyx" });
  assert.equal(status, HTTP_OK);

  const sayIdx = twiml.indexOf(SAY_OPEN + DISCLOSURE_PREFIX);
  const gatherIdx = twiml.indexOf("<Gather");
  assert.ok(sayIdx !== -1, `Offenlegung als Say-Praefix fehlt im Outbound-TeXML: ${twiml}`);
  assert.ok(gatherIdx !== -1, `Gather fehlt im Outbound-TeXML: ${twiml}`);
  assert.ok(gatherIdx < sayIdx, `Offenlegungs-Say muss IM Gather stehen: ${twiml}`);
  assert.ok(!twiml.includes("<Hangup/>"), `/voice/outbound darf nicht auflegen: ${twiml}`);
});

const EN_DISCLOSURE_PREFIX =
  "Hello, this is an AI assistant calling on behalf of Jonas Beispiel. This conversation will be summarised for the person I represent.";
const EN_SAY_OPEN = '<Say voice="Azure.en-GB-SoniaNeural" language="en-GB">';

test("LAW-03 (gruen, Wiring-Regressionspin): /voice/outbound rendert die EN-Offenlegung als Say-Praefix im Gather", async () => {
  const { body: twiml, status } = await runOutbound({
    provider: "telnyx",
    call: { language: "en" },
  });
  assert.equal(status, HTTP_OK);

  const sayIdx = twiml.indexOf(EN_SAY_OPEN + EN_DISCLOSURE_PREFIX);
  const gatherIdx = twiml.indexOf("<Gather");
  assert.ok(sayIdx !== -1, `EN-Offenlegung als Say-Praefix fehlt im Outbound-TeXML: ${twiml}`);
  assert.ok(gatherIdx !== -1, `Gather fehlt im Outbound-TeXML: ${twiml}`);
  assert.ok(gatherIdx < sayIdx, `EN-Offenlegungs-Say muss IM Gather stehen: ${twiml}`);
  assert.ok(!twiml.includes("<Hangup/>"), `/voice/outbound darf nicht auflegen: ${twiml}`);
});

test("/voice/outbound (telnyx): LLM-frei -> Offenlegung im <Gather>, kein <Hangup> (G2)", async () => {
  const { body, status, contentType } = await runOutbound({ provider: "telnyx" });
  assert.equal(status, HTTP_OK);
  assert.ok(contentType?.includes("text/xml"), `Antwort ist kein XML: ${contentType}`);
  assertDisclosureInGather(body);
  assert.ok(!body.includes(HANGUP), `/voice/outbound darf nicht auflegen: ${body}`);
});

const FAKE_MP3_BYTES = Buffer.from("ID3\u0001\u0002\u0003", "latin1");

async function startFakeElevenLabsOrigin() {
  const requests = [];
  const ursprung = await starteAttrappe((anfrage, antwort) => {
    anfrage.resume();
    anfrage.on("end", () => {
      requests.push({ method: anfrage.method, url: anfrage.url });
      antwort.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
      antwort.end(FAKE_MP3_BYTES);
    });
  });
  return { ...ursprung, requests };
}

const PLAY_TTS_ENV_BASE = {
  ELEVENLABS_API_KEY: "test-elevenlabs-key",
  ELEVENLABS_VOICE_ID: "voice-1",
};

test("Flag AN: /voice/outbound (Telnyx) rendert <Play> statt <Say>; Token liefert die Bytes GENAU EINMAL", async () => {
  const origin = await startFakeElevenLabsOrigin();
  try {
    const { body, srv } = await runOutboundKeepOpen({
      provider: "telnyx",
      env: {
        ...PLAY_TTS_ENV_BASE,
        ELEVENLABS_PLAY_TTS_ENABLED: "true",
        ELEVENLABS_API_BASE: origin.url,
      },
    });
    try {
      assert.match(body, /<Play>https:\/\/agent\.test\/voice\/tts\/[A-Za-z0-9_-]+<\/Play>/);
      assert.doesNotMatch(body, /<Say\b/, "kein <Say> mehr, wenn Play-TTS greift");
      assert.equal(origin.requests.length, 1, "genau EIN Synth-Call pro Turn");
      assert.match(origin.requests[0].url, /output_format=/, "output_format ist Query-Parameter");

      const token = body.match(/\/voice\/tts\/([A-Za-z0-9_-]+)/)[1];
      const first = await fetch(`${srv.localUrl}/voice/tts/${token}`);
      assert.equal(first.status, HTTP_OK);
      assert.equal(first.headers.get("content-type"), "audio/mpeg");
      const gotBytes = Buffer.from(await first.arrayBuffer());
      assert.deepEqual(gotBytes, FAKE_MP3_BYTES);

      const second = await fetch(`${srv.localUrl}/voice/tts/${token}`);
      assert.equal(
        second.status,
        HTTP_NOT_FOUND,
        "zweiter Abruf desselben Tokens -> 404 (EINMALIG)",
      );
    } finally {
      await srv.stop();
    }
  } finally {
    await origin.close();
  }
});

test("Flag AUS: /voice/outbound (Telnyx) bleibt byte-identisch auf dem Azure-<Say>-Bestand (kein <Play>)", async () => {
  const { body } = await runOutbound({ provider: "telnyx" });
  assert.match(body, /<Say voice="Azure\.de-DE-KatjaNeural"/, "Azure-Bestand unveraendert");
  assert.doesNotMatch(body, /<Play>/, "Gate aus -> kein Play-Zweig");
});
