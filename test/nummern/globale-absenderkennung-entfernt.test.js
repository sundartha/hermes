import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { startServer, waitForLog } from "../helpers.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GLOBALE_KENNUNG = "ELEVENLABS_AGENT_PHONE_NUMBER_ID";
const BOOT_WARNUNG = /\[boot\] Konfig-Warnung.*ELEVENLABS_AGENT_PHONE_NUMBER_ID/;
const EL_OUTBOUND_AN = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_el_test",
  ELEVENLABS_API_KEY: "el-api-key-testgeheim",
  ELEVENLABS_API_BASE: "http://127.0.0.1:9",
});

test("Kriterium 4: die Konfiguration liest ELEVENLABS_AGENT_PHONE_NUMBER_ID nicht mehr", () => {
  const ausgabe = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { config } from "./src/config.js"; console.log(JSON.stringify(Object.keys(config.voice.elevenLabsOutbound)));',
    ],
    { cwd: ROOT, env: { ...process.env, [GLOBALE_KENNUNG]: "phnum_global_test" }, encoding: "utf8" },
  );
  const schluessel = JSON.parse(ausgabe.trim().split("\n").at(-1));
  assert.ok(schluessel.includes("agentId"), "Positiv-Kontrolle: die Konfiguration wurde gelesen");
  assert.ok(!schluessel.includes("agentPhoneNumberId"), "die globale Kennung steht nicht mehr in der Konfiguration");
});

test("Kriterium 4: der Start warnt nicht vor einer leeren globalen Absenderkennung", async () => {
  const srv = await startServer({ env: { ...EL_OUTBOUND_AN, [GLOBALE_KENNUNG]: "" } });
  try {
    await waitForLog(srv, /laeuft auf/);
    assert.doesNotMatch(srv.stdout, BOOT_WARNUNG);
  } finally {
    await srv.stop();
  }
});
