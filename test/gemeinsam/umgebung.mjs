import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const GIT_CONFIG_VARIABLE = /^GIT_CONFIG_/;
const GIT_VARIABLE_PREFIX = "GIT_";
const INHERITED_TEST_RUNNER_VARIABLE = "NODE_TEST_CONTEXT";
const CLAUDE_CONFIGURATION_VARIABLE = "CLAUDE_CONFIG_DIR";

function localGitVariables() {
  const run = spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" });
  return run.stdout.split("\n").filter(Boolean);
}

export function withoutGitVariables(environment) {
  const local = new Set(localGitVariables());
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !local.has(name) && !GIT_CONFIG_VARIABLE.test(name)),
  );
}

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

export function ohne(objekt, ...felder) {
  return Object.fromEntries(Object.entries(objekt).filter(([name]) => !felder.includes(name)));
}

const PROBE_GIT = ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];

export function writeFiles(directory, files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

export function probeDirectory(context, files) {
  const directory = mkdtempSync(join(tmpdir(), "probe-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFiles(directory, files);
  return directory;
}

export function runIn(directory, command, args) {
  return spawnSync(command, args, { cwd: directory, encoding: "utf8", env: isolatedEnvironment() });
}

function git(directory, args) {
  const result = runIn(directory, "git", args);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

export function commitAll(directory, message) {
  git(directory, ["add", "."]);
  git(directory, [...PROBE_GIT, "commit", "-q", "-m", message]);
}

export function probeRepository(context, files) {
  const directory = probeDirectory(context, files);
  git(directory, ["init", "-q"]);
  commitAll(directory, "Basis");
  return directory;
}
