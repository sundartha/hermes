import { strict as assert } from "node:assert";
import { test } from "node:test";

import { EINE_STIMME_ID } from "../../src/elevenlabs/stimme-festlegen.ts";
import { makeAusgabeWaechter } from "../../scripts/iel-geheimnisse-ausgabe.mjs";
import { stimmenBeleg } from "../../scripts/iel-geheimnisse-belege.mjs";

const EL_BASIS = "http://el.test";
const TTS_MUSTER = /\/v1\/text-to-speech\/([^/]+)\/stream/;
const MODELL = "eleven_v3_conversational";

function jsonAntwort(koerper) {
  return new Response(JSON.stringify(koerper), { status: 200, headers: { "content-type": "application/json" } });
}

test("Stimmen-Beleg prueft genau die eine Stimme, nicht eine je Sprache", async () => {
  const stimmen = [];
  const fetchImpl = async (adresse) => {
    const url = String(adresse);
    const tts = TTS_MUSTER.exec(url);
    if (tts) {
      stimmen.push(decodeURIComponent(tts[1]));
      return new Response("audio", { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    if (url.includes("/env-vars/ELEVENLABS_VOICE_ID")) return jsonAntwort({ value: EINE_STIMME_ID });
    if (url.includes("/env-vars/ELEVENLABS_MODEL")) return jsonAntwort({ value: MODELL });
    if (url.includes("/v1/convai/agents/")) {
      return jsonAntwort({ conversation_config: { tts: { voice_id: EINE_STIMME_ID, model_id: MODELL } } });
    }
    return jsonAntwort({});
  };
  const kanal = { write: () => {} };
  const abh = {
    fetchImpl,
    waechter: makeAusgabeWaechter({ stdout: kanal, stderr: kanal }),
    renderApiKey: "render-test",
    elKonto: { apiKey: "el-test", apiBase: EL_BASIS, agentId: "agent-test" },
    ttsAusgabeformat: "mp3_44100_128",
  };

  const urteil = await stimmenBeleg(abh);

  assert.equal(urteil.gruen, true);
  assert.deepEqual(stimmen, [EINE_STIMME_ID]);
});
