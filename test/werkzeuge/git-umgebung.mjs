import { spawnSync } from "node:child_process";

const GIT_CONFIG_VARIABLE = /^GIT_CONFIG_/;

function localGitVariables() {
  const run = spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" });
  return run.stdout.split("\n").filter(Boolean);
}

export function withoutGitVariables(environment) {
  const local = new Set(localGitVariables());
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !local.has(name) && !GIT_CONFIG_VARIABLE.test(name),
    ),
  );
}
