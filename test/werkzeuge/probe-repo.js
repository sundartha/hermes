import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const RUNNER = join(REPO_ROOT, "test/testbaenke-run.mjs");
export const AFFECTED_TESTS_TOOL = join(REPO_ROOT, "tools/betroffene-tests.mjs");
export const PRUEFLEITER_TOOL = join(REPO_ROOT, "tools/pruefleiter.mjs");
export const ESLINT_BIN = join(REPO_ROOT, "node_modules/eslint/bin/eslint.js");
export const PRE_PUSH_HOOK = join(REPO_ROOT, ".githooks/pre-push");

const INHERITED_TEST_RUNNER_VARIABLE = "NODE_TEST_CONTEXT";
const GIT_VARIABLE_PREFIX = "GIT_";
const PROBE_AUTHOR = ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid"];
const PROBE_COMMIT_SETTINGS = ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];

export function isolatedEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== INHERITED_TEST_RUNNER_VARIABLE && !name.startsWith(GIT_VARIABLE_PREFIX),
    ),
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

function git(directory, args) {
  const result = runIn(directory, "git", args);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

export function commitAll(directory, message) {
  git(directory, ["add", "."]);
  git(directory, [...PROBE_AUTHOR, ...PROBE_COMMIT_SETTINGS, "commit", "-q", "-m", message]);
}

export function probeRepository(context, files) {
  const directory = probeDirectory(context, files);
  git(directory, ["init", "-q"]);
  commitAll(directory, "Basis");
  return directory;
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

export function failingTest(name, expected, importPath) {
  const importLine = importPath ? [`import ${JSON.stringify(importPath)};`] : [];
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    ...importLine,
    `test(${JSON.stringify(name)}, () => {`,
    `  assert.equal("tatsaechlich", ${JSON.stringify(expected)});`,
    "});",
    "",
  ].join("\n");
}

export const HOOKS_DIRECTORY = join(REPO_ROOT, ".claude/hooks");
export const BLOCKING_EXIT_CODE = 2;

export function runHook(hook, { cwd, input, environment = {} }) {
  const interpreter = hook.endsWith(".sh") ? "bash" : process.execPath;
  return spawnSync(interpreter, [join(HOOKS_DIRECTORY, hook)], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify(input),
    env: { ...isolatedEnvironment(), ...environment },
  });
}
