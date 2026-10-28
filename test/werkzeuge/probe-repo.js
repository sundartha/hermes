import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { env } from "node:process";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const RUNNER = join(REPO_ROOT, "test/testbaenke-run.mjs");
export const AFFECTED_TESTS_TOOL = join(REPO_ROOT, "tools/betroffene-tests.mjs");
export const PRUEFLEITER_TOOL = join(REPO_ROOT, "tools/pruefleiter.mjs");
export const FILE_LENGTH_TOOL = join(REPO_ROOT, "tools/dateilaenge.mjs");
export const TEST_RATIO_TOOL = join(REPO_ROOT, "tools/testverhaeltnis.mjs");
export const DEPENDENCY_TOOL = join(REPO_ROOT, "tools/abhaengigkeiten.mjs");
export const ESLINT_BIN = join(REPO_ROOT, "node_modules/eslint/bin/eslint.js");
export const PRE_PUSH_HOOK = join(REPO_ROOT, ".githooks/pre-push");

const INHERITED_TEST_RUNNER_VARIABLE = "NODE_TEST_CONTEXT";
const GIT_VARIABLE_PREFIX = "GIT_";
const CLAUDE_CONFIGURATION_VARIABLE = "CLAUDE_CONFIG_DIR";
const EXECUTABLE_MODE = 0o755;
const PROBE_AUTHOR = ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid"];
const PROBE_COMMIT_SETTINGS = ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];

export function isolatedEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        name !== INHERITED_TEST_RUNNER_VARIABLE &&
        name !== CLAUDE_CONFIGURATION_VARIABLE &&
        !name.startsWith(GIT_VARIABLE_PREFIX),
    ),
  );
}

export function writeFiles(directory, files) {
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

function setzeUmgebung(context, werte) {
  const vorher = new Map(Object.keys(werte).map((name) => [name, env[name]]));
  Object.assign(env, werte);
  context.after(() => {
    vorher.forEach((alt, name) => {
      if (alt === undefined) delete env[name];
      else env[name] = alt;
    });
  });
}

export function ersatzClaude(context, skript, werte = {}) {
  const ordner = probeDirectory(context, { "claude.mjs": skript });
  chmodSync(join(ordner, "claude.mjs"), EXECUTABLE_MODE);
  const ziel = join(ordner, "ziel.txt");
  setzeUmgebung(context, { HERMES_CLAUDE: join(ordner, "claude.mjs"), ERSATZ_ZIEL: ziel, ...werte });
  return ziel;
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

export function commitPaths(directory, paths, message) {
  git(directory, ["add", ...paths]);
  git(directory, [...PROBE_AUTHOR, ...PROBE_COMMIT_SETTINGS, "commit", "-q", "-m", message]);
}

export function commitAll(directory, message) {
  commitPaths(directory, ["."], message);
}

export function mitUpstreamMaster(directory) {
  git(directory, ["update-ref", "refs/remotes/upstream/master", "HEAD"]);
  return directory;
}

export function probeRepository(context, files) {
  const directory = probeDirectory(context, files);
  git(directory, ["init", "-q"]);
  commitAll(directory, "Basis");
  return directory;
}

export function echterCiLokalSchritt(name) {
  const { schritte } = JSON.parse(readFileSync(join(REPO_ROOT, "tools/ci-lokal.json"), "utf8"));
  const { befehl } = schritte.find((schritt) => schritt.name === name);
  return befehl.replace("tools/basis-vergleich.mjs", JSON.stringify(join(REPO_ROOT, "tools/basis-vergleich.mjs")));
}

export function repoMitCiLokalListe(context, schritte) {
  const repo = probeRepository(context, { "tools/ci-lokal.json": JSON.stringify({ schritte, nurCi: {} }) });
  writeFiles(repo, { "neu.txt": "neu\n" });
  commitAll(repo, "Neu");
  return repo;
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
const HOOK_SCRIPT_PATH = /\.claude\/hooks\/([\w-]+\.(?:mjs|sh))/;

export function hookScript(command) {
  return HOOK_SCRIPT_PATH.exec(command)?.[1] ?? command;
}

export function runHook(hook, { cwd, input, environment = {} }) {
  const interpreter = hook.endsWith(".sh") ? "bash" : process.execPath;
  return spawnSync(interpreter, [join(HOOKS_DIRECTORY, hook)], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify(input),
    env: { ...isolatedEnvironment(), ...environment },
  });
}
