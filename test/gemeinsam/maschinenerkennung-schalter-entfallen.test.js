import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ROOT } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";

function telephonySchluesselMitGesetztemSchalter() {
  const script = [
    'import("./src/config.ts").then(({ config, configFatalErrors }) => {',
    "process.stdout.write(JSON.stringify({ fehler: configFatalErrors(), schluessel: Object.keys(config.telephony) }));",
    "});",
  ].join("\n");
  const env = kindUmgebung({ NODE_ENV: "test", MACHINE_DETECTION_ENABLED: "true", MACHINE_DETECTION_TIMEOUT_S: "9" });
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, env, encoding: "utf8" }));
}

test("Anrufbeantworter-Schalter gesetzt: Hermes startet ohne Fehler und die Telefonie-Konfiguration kennt ihn nicht", () => {
  const ist = telephonySchluesselMitGesetztemSchalter();
  assert.deepEqual(ist.fehler, []);
  assert.deepEqual(ist.schluessel.sort(), [
    "telnyxAccountSid",
    "telnyxApiBase",
    "telnyxApiKey",
    "telnyxCallControlAppId",
    "telnyxConnectionId",
    "telnyxPublicKey",
  ]);
  assert.equal(ist.schluessel.includes("machineDetection"), false);
});
