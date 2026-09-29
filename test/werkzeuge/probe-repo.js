import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const RUNNER = join(REPO_ROOT, "test/testbaenke-run.mjs");

const INHERITED_TEST_RUNNER_VARIABLE = "NODE_TEST_CONTEXT";

function isolatedEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== INHERITED_TEST_RUNNER_VARIABLE),
  );
}

function writeFiles(directory, files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

export function probeDirectory(context, files) {
  const directory = mkdtempSync(join(tmpdir(), "werkzeug-probe-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFiles(directory, files);
  return directory;
}

export function runIn(directory, command, args) {
  return spawnSync(command, args, {
    cwd: directory,
    encoding: "utf8",
    env: isolatedEnvironment(),
  });
}

export function outputLines(text) {
  return text.split("\n").filter((line) => line.trim() !== "");
}

export function passingTest(name) {
  return [
    'import { test } from "node:test";',
    `test(${JSON.stringify(name)}, () => {});`,
    "",
  ].join("\n");
}

export function failingTest(name, expected) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `test(${JSON.stringify(name)}, () => {`,
    `  assert.equal("tatsaechlich", ${JSON.stringify(expected)});`,
    "});",
    "",
  ].join("\n");
}
