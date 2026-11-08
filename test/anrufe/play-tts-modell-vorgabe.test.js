import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

import { FAKE_FIRST_CHUNK } from "../helpers/fake-tts-stream.mjs";
import { startServer, seedWithTelnyxNumber, postTelnyxIncoming } from "../helpers.js";
import { playTtsEnv } from "../gemeinsam/play-tts-server.mjs";

const HTTP_OK = 200;
const NEUES_MODELL = "eleven_v4_turbo";
const ALTES_MODELL = "eleven_v3_conversational";
const UEBERSCHRIEBEN = "eleven_flash_v2_5";

async function startAufzeichnenderOrigin() {
  const aufrufe = [];
  const server = http.createServer((req, res) => {
    const teile = [];
    req.on("data", (teil) => teile.push(teil));
    req.on("end", () => {
      aufrufe.push({ url: req.url, body: JSON.parse(Buffer.concat(teile).toString("utf8")) });
      res.setHeader("content-type", "audio/mpeg");
      res.end(Buffer.from(FAKE_FIRST_CHUNK));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    aufrufe,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function synthetisiereMit(modellEnv) {
  const origin = await startAufzeichnenderOrigin();
  const srv = await startServer({
    seed: seedWithTelnyxNumber({ language: "de" }),
    env: { ...playTtsEnv(origin.url), ELEVENLABS_MODEL: modellEnv },
  });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "CAmodellvorgabe" });
    assert.equal(res.status, HTTP_OK);
    assert.match(await res.text(), /<Play>/);
    return origin.aufrufe;
  } finally {
    await srv.stop();
    await origin.close();
  }
}

test("ohne ELEVENLABS_MODEL sendet die Play-TTS eleven_v4_turbo und nur text und model_id", async () => {
  const aufrufe = await synthetisiereMit("");
  assert.equal(aufrufe.length, 1);
  assert.match(aufrufe[0].url, /^\/v1\/text-to-speech\/[^/]+\/stream/);
  assert.deepEqual(Object.keys(aufrufe[0].body).sort(), ["model_id", "text"]);
  assert.equal(aufrufe[0].body.model_id, NEUES_MODELL);
});

test("gesetztes ELEVENLABS_MODEL bleibt gueltig, Leerraum wird abgeschnitten", async () => {
  const aufrufe = await synthetisiereMit(`  ${UEBERSCHRIEBEN} `);
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].body.model_id, UEBERSCHRIEBEN);
});

test("render.yaml und .env.example fuehren eleven_v4_turbo als ELEVENLABS_MODEL", () => {
  const render = fs.readFileSync(new URL("../../render.yaml", import.meta.url), "utf8");
  const beispiel = fs.readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  assert.match(render, /key: ELEVENLABS_MODEL\n\s+value: "eleven_v4_turbo"/);
  assert.match(beispiel, /^ELEVENLABS_MODEL=eleven_v4_turbo\b/m);
  assert.ok(!render.includes(ALTES_MODELL));
  assert.ok(!beispiel.includes(ALTES_MODELL));
});
