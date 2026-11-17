import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { LOCALES, SUPPORTED_LANGUAGES } from "../../src/i18n/locales.js";
import { ROOT } from "../helpers.js";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";

const ENTFALLEN = ["endCallWait", "unknownTool", "takeMessageResult", "takeMessageDuplicateResult"];
const BLEIBT = ["openingBootstrap", "silentTurn", "consultDeclined", "consultAnswered"];

test("Sprachdateien: die entfallenen turnControl-Texte fehlen, die lebenden bleiben", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const turnControl = LOCALES[lang].prompt.turnControl;
    for (const schluessel of ENTFALLEN) {
      assert.equal(schluessel in turnControl, false, `${lang}: ${schluessel}`);
    }
    for (const schluessel of BLEIBT) {
      assert.ok(schluessel in turnControl, `${lang}: ${schluessel}`);
    }
  }
});

test("MAX_EMPTY_TURNS=4 startet unveraendert, die Konfiguration kennt maxEmptyTurns nicht mehr", () => {
  const script = [
    'import("./src/config.js").then(({ config, CONFIG_NAMESPACES, configFatalErrors }) => {',
    "process.stdout.write(JSON.stringify({ fehler: configFatalErrors(), voice: config.voice, liste: CONFIG_NAMESPACES.voice }));",
    "});",
  ].join("\n");
  const env = kindUmgebung({ NODE_ENV: "test", MAX_EMPTY_TURNS: "4" });
  const ist = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, env, encoding: "utf8" }));
  assert.deepEqual(ist.fehler, []);
  assert.equal("maxEmptyTurns" in ist.voice, false);
  assert.equal(ist.liste.includes("maxEmptyTurns"), false);
  assert.ok(ist.liste.includes("sttSpeechTimeoutSec"));
});

test(".env.example fuehrt MAX_EMPTY_TURNS nicht mehr", () => {
  const text = readFileSync(`${ROOT}/.env.example`, "utf8");
  assert.equal(text.includes("MAX_EMPTY_TURNS"), false);
  assert.ok(text.includes("CALLER_SUBSTANCE_MIN_LEN"));
});
