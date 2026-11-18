import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { prodEnv } from "../prod-env.js";

const KONFIG = new URL("../../src/config.js", import.meta.url).href;

function ladeConfig(zusatz) {
  const skript = `process.env = Object.assign(${JSON.stringify(prodEnv())}, ${JSON.stringify(zusatz)}, { __undef: 1 });
for (const [k, v] of Object.entries(${JSON.stringify(zusatz)})) if (v === "__undefined__") delete process.env[k]; else if (v === "__null0__") process.env[k] = 0;
const { config } = await import(${JSON.stringify(KONFIG)});
process.stdout.write(JSON.stringify({ a: config.billing.betterstackAlertUrl, v: config.telnyx.telnyxElevenLabs.voiceId, r: config.werkzeug.renderApiKey }));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", skript], { encoding: "utf8", env: { NODE_ENV: "test" } }));
}

test("Alarm-URL: nur ein fehlender Wert wird zu leerem Text, ein gesetzter Wert bleibt unverändert", () => {
  assert.equal(ladeConfig({ BETTERSTACK_ALERT_URL: "__null0__" }).a, 0);
  assert.equal(ladeConfig({ BETTERSTACK_ALERT_URL: "__undefined__" }).a, "");
});

test("Telnyx-Stimme: nur ein fehlender Wert wird zu leerem Text, ein gesetzter Wert bleibt unverändert", () => {
  assert.equal(ladeConfig({ TELNYX_ELEVENLABS_VOICE_ID: "__null0__" }).v, 0);
  assert.equal(ladeConfig({ TELNYX_ELEVENLABS_VOICE_ID: "__undefined__" }).v, "");
});

test("Render-Schlüssel: Leerraum wird abgeschnitten", () => {
  assert.equal(ladeConfig({ RENDER_API_KEY: "  abc  " }).r, "abc");
});
