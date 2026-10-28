import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint } from "eslint";

import {
  commitAll,
  DEPENDENCY_TOOL,
  probeRepository,
  REPO_ROOT,
  runIn,
  writeFiles,
} from "./probe-repo.js";

const RULE = "hermes/config-pfade";
const SCRIPT = "scripts/probe-konfig.mjs";
const CONFIG_FILE = "src/config.js";
const EXPORT_LIST = "tools/basis/sammeldatei-exporte.json";
const DEPENDENCY_CONFIG = ".dependency-cruiser.cjs";
const EXIT_FINDING = 1;
const STEPS = ["rawConfig", "CONFIG_NAMESPACES", ".env.example", "render.yaml"];
const UNKNOWN_KEYS = [
  "export const a = (config) => config.publicUrl;",
  "export const b = (config) => config.server.erfundenesBlatt;",
];

function missingSteps(text) {
  return STEPS.filter((step) => !text.includes(step));
}

test("konfiguration: die Meldungen zu einem unbekannten config-Pfad nennen alle drei Schritte", async () => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(`${UNKNOWN_KEYS.join("\n")}\n`, { filePath: SCRIPT });
  const messages = result.messages.filter(({ ruleId }) => ruleId === RULE);
  assert.equal(messages.length, UNKNOWN_KEYS.length);
  for (const { message } of messages) {
    assert.deepEqual(
      missingSteps(message),
      [],
      `Die Meldung nennt nicht alle drei Schritte: ${message}`,
    );
  }
});

test("konfiguration: ein neuer Export in src/config.js nennt alle drei Schritte", (context) => {
  const directory = probeRepository(context, {
    [DEPENDENCY_CONFIG]: readFileSync(join(REPO_ROOT, DEPENDENCY_CONFIG), "utf8"),
    [EXPORT_LIST]: `${JSON.stringify([`${CONFIG_FILE}#alt`])}\n`,
    [CONFIG_FILE]: "export function alt() {}\n",
  });
  writeFiles(directory, { [CONFIG_FILE]: "export function alt() {}\nexport function neu() {}\n" });
  commitAll(directory, "geaendert");
  const result = runIn(directory, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD~1"]);
  assert.equal(result.status, EXIT_FINDING, result.stderr);
  assert.deepEqual(
    missingSteps(result.stderr),
    [],
    `Die Meldung nennt nicht alle drei Schritte: ${result.stderr}`,
  );
});
