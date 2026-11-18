import { test } from "node:test";
import assert from "node:assert/strict";
import { prodEnv } from "../prod-env.js";

async function ladeConfig(zusatz) {
  const vorher = process.env;
  process.env = { ...prodEnv(), ...zusatz };
  try {
    return (await import(`../../src/config.js?nullish=${Math.random()}`)).config;
  } finally {
    process.env = vorher;
  }
}

test("Alarm-URL: nur ein fehlender Wert wird zu leerem Text, ein gesetzter Wert bleibt unverändert", async () => {
  const gesetzt = await ladeConfig({ BETTERSTACK_ALERT_URL: 0 });
  assert.equal(gesetzt.billing.betterstackAlertUrl, 0);
  const fehlt = await ladeConfig({ BETTERSTACK_ALERT_URL: undefined });
  assert.equal(fehlt.billing.betterstackAlertUrl, "");
});

test("Telnyx-Stimme: nur ein fehlender Wert wird zu leerem Text, ein gesetzter Wert bleibt unverändert", async () => {
  const gesetzt = await ladeConfig({ TELNYX_ELEVENLABS_VOICE_ID: 0 });
  assert.equal(gesetzt.telnyx.telnyxElevenLabs.voiceId, 0);
  const fehlt = await ladeConfig({ TELNYX_ELEVENLABS_VOICE_ID: undefined });
  assert.equal(fehlt.telnyx.telnyxElevenLabs.voiceId, "");
});

test("Render-Schlüssel: Leerraum wird abgeschnitten", async () => {
  assert.equal((await ladeConfig({ RENDER_API_KEY: "  abc  " })).werkzeug.renderApiKey, "abc");
});
