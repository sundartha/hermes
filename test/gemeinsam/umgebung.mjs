import { spawnSync } from "node:child_process";

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
