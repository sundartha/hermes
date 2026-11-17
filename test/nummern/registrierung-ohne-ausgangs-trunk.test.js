import test from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog } from "../helpers.js";
import { EL_REGISTRIERUNG_BOOT_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const BOOT_ENV = Object.freeze({
  PROVISIONING_ENABLED: "true",
  ELEVENLABS_API_KEY: EL_REGISTRIERUNG_BOOT_SCHLUESSEL,
  ELEVENLABS_AGENT_ID: "agent_boot",
});

test("Boot: mit PROVISIONING_ENABLED allein ist die Nummernregistrierung eingehaengt", async () => {
  const srv = await startServer({ env: BOOT_ENV });
  try {
    await waitForLog(srv, /\[boot\] ElevenLabs-Nummernregistrierung: eingehaengt/);
    assert.doesNotMatch(srv.stdout, /NICHT eingehaengt/);
    assert.doesNotMatch(srv.stdout, /TELNYX_SIP_TRUNK/);
  } finally {
    await srv.stop();
  }
});

test("Boot: ohne PROVISIONING_ENABLED nennt die Warnung nur diesen einen Schalter", async () => {
  const srv = await startServer({ env: { ...BOOT_ENV, PROVISIONING_ENABLED: "false" } });
  try {
    await waitForLog(srv, /ElevenLabs-Nummernregistrierung NICHT eingehaengt/);
    assert.match(
      srv.stdout,
      /NICHT eingehaengt \(PROVISIONING_ENABLED muss true sein\) - neue DIDs werden nicht bei ElevenLabs registriert, ausgehende Anrufe von DIDs ohne Registrierung brechen ab\./,
    );
  } finally {
    await srv.stop();
  }
});
