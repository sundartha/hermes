import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { kindUmgebung } from "./kind-umgebung.mjs";
import { ROOT } from "../helpers.js";

function ladeAusgehend(umgebung) {
  const script = [
    'import("./src/config.ts").then(({ config, configFatalErrors }) => {',
    "process.stdout.write(JSON.stringify({ fehler: configFatalErrors(), ausgehend: config.voice.elevenLabsOutbound }));",
    "});",
  ].join("\n");
  const env = kindUmgebung({ NODE_ENV: "test", ...umgebung });
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, env, encoding: "utf8" }));
}

test("ausgehend-ohne-wegschalter: ELEVENLABS_OUTBOUND_VORSPANN und ELEVENLABS_OUTBOUND_UEBER_TELNYX werden nicht mehr gelesen", () => {
  const ist = ladeAusgehend({ ELEVENLABS_OUTBOUND_VORSPANN: "true", ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true" });
  assert.equal(Object.hasOwn(ist.ausgehend, "vorspann"), false);
  assert.equal(Object.hasOwn(ist.ausgehend, "ueberTelnyx"), false);
});

test("ausgehend-ohne-wegschalter: ein ungueltiger Wert in den entfernten Schaltern verweigert den Start nicht mehr", () => {
  const ist = ladeAusgehend({ ELEVENLABS_OUTBOUND_VORSPANN: "vielleicht", ELEVENLABS_OUTBOUND_UEBER_TELNYX: "vielleicht" });
  assert.deepEqual(ist.fehler, []);
});
