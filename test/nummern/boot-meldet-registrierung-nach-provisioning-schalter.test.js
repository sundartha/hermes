import test from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog } from "../helpers.js";
import { EL_REGISTRIERUNG_BOOT_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const BOOT_ENV = Object.freeze({
  ELEVENLABS_API_KEY: EL_REGISTRIERUNG_BOOT_SCHLUESSEL,
  ELEVENLABS_AGENT_ID: "agent_boot",
});

test("Boot ohne Provisioning meldet die Nummernregistrierung als nicht eingehaengt und nie als eingehaengt", async () => {
  const srv = await startServer({ env: { ...BOOT_ENV, PROVISIONING_ENABLED: "false" } });
  try {
    await waitForLog(srv, /\[boot\] Konfig-Warnung: ElevenLabs-Nummernregistrierung NICHT eingehaengt/);
    assert.doesNotMatch(srv.stdout, /ElevenLabs-Nummernregistrierung: eingehaengt/);
  } finally {
    await srv.stop();
  }
});

test("Boot mit Provisioning meldet die Nummernregistrierung als eingehaengt und ohne Warnung", async () => {
  const srv = await startServer({ env: { ...BOOT_ENV, PROVISIONING_ENABLED: "true" } });
  try {
    await waitForLog(srv, /\[boot\] ElevenLabs-Nummernregistrierung: eingehaengt/);
    assert.doesNotMatch(srv.stdout, /Nummernregistrierung NICHT eingehaengt/);
  } finally {
    await srv.stop();
  }
});
