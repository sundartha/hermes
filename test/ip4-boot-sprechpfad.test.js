import { test } from "node:test";
import assert from "node:assert/strict";

import { inboundSprechpfadBannerLine } from "../src/boot.js";
import { classifySprechpfad, SPRECHPFAD } from "../src/telephony/sprechpfad.js";
import { startServer, seedWithTelnyxNumber, postTelnyxIncoming } from "./helpers.js";

const HTTP_OK = 200;
const RUECKFALL_HINWEIS =
  "play_tts faellt bei erschoepftem Kontingent, Synthese-Fehler oder Anbieter ohne Play-Audio" +
  " fail-safe auf azure_say zurueck";
const SPRECHPFAD_ZEILE = "Inbound-Sprechpfad: (\\w+) \\(";

function bannerZeile(enabled) {
  return inboundSprechpfadBannerLine({ elevenLabsPlayTts: { enabled } });
}

test("IP4-1: die Boot-Zeile nennt bei Flag AUS azure_say", () => {
  assert.equal(
    bannerZeile(false),
    `Inbound-Sprechpfad: azure_say (ELEVENLABS_PLAY_TTS_ENABLED=false) - ${RUECKFALL_HINWEIS}`,
  );
});

test("IP4-2: die Boot-Zeile nennt bei Flag AN play_tts", () => {
  assert.equal(
    bannerZeile(true),
    `Inbound-Sprechpfad: play_tts (ELEVENLABS_PLAY_TTS_ENABLED=true) - ${RUECKFALL_HINWEIS}`,
  );
});

test("IP4-3: die Zeile folgt der AUFGELOESTEN Konfiguration, NICHT der Rohumgebung", () => {
  const vorher = process.env.ELEVENLABS_PLAY_TTS_ENABLED;
  process.env.ELEVENLABS_PLAY_TTS_ENABLED = "true";
  try {
    assert.match(bannerZeile(false), /Inbound-Sprechpfad: azure_say \(/);
  } finally {
    if (vorher === undefined) delete process.env.ELEVENLABS_PLAY_TTS_ENABLED;
    else process.env.ELEVENLABS_PLAY_TTS_ENABLED = vorher;
  }
});

test("IP4-4: die Boot-Zeile stimmt mit dem TeXML ueberein, das derselbe Server rendert", async () => {
  const srv = await startServer({ seed: seedWithTelnyxNumber({ language: "de" }) });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "CAip4boot" });
    assert.equal(res.status, HTTP_OK);
    const texml = await res.text();

    const treffer = srv.stdout.match(new RegExp(SPRECHPFAD_ZEILE, "g"));
    assert.equal(treffer?.length, 1, `genau EINE Sprechpfad-Zeile erwartet:\n${srv.stdout}`);
    const gemeldet = treffer[0].match(new RegExp(SPRECHPFAD_ZEILE))[1];

    assert.equal(classifySprechpfad(texml), gemeldet);
    assert.equal(gemeldet, SPRECHPFAD.AZURE_SAY, "Repo-Defaults: Flag aus");
  } finally {
    await srv.stop();
  }
});
