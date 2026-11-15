import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ROOT } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";

const SKRIPT =
  'import("./src/config.js").then(({ config }) => process.stdout.write(JSON.stringify(config.voice.anbieterAttrappe)));';
const EL_ATTRAPPE = "http://el.test";
const TELNYX_ATTRAPPE = "http://telnyx.test/";

function lade(umgebung) {
  const env = kindUmgebung({ NODE_ENV: "test", ...umgebung });
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", SKRIPT], { cwd: ROOT, env, encoding: "utf8" }));
}

const FAELLE = [
  ["beide Anbieter echt", {}, false],
  ["nur ElevenLabs auf Attrappe", { ELEVENLABS_API_BASE: EL_ATTRAPPE }, false],
  ["nur Telnyx auf Attrappe", { TELNYX_API_BASE: TELNYX_ATTRAPPE }, false],
  ["beide auf Attrappe", { ELEVENLABS_API_BASE: EL_ATTRAPPE, TELNYX_API_BASE: TELNYX_ATTRAPPE }, true],
  ["ElevenLabs-Standard mit Schrägstrich und Telnyx-Attrappe", { ELEVENLABS_API_BASE: "https://api.elevenlabs.io/", TELNYX_API_BASE: TELNYX_ATTRAPPE }, false],
  ["Telnyx-Standard mit Schrägstrich und ElevenLabs-Attrappe", { ELEVENLABS_API_BASE: EL_ATTRAPPE, TELNYX_API_BASE: "https://api.telnyx.com/" }, false],
];

test("Konfiguration Anbieter-Attrappe: Tabelle der Adressen", () => {
  for (const [name, umgebung, erwartet] of FAELLE) {
    assert.equal(lade(umgebung), erwartet, name);
  }
});
