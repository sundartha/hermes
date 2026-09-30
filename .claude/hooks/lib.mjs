import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { env } from "node:process";

const BLOCK_EXIT_CODE = 2;
const STDIN = 0;
const GIT_CONFIG_VARIABLE = /^GIT_CONFIG_/;

export function readInput() {
  try {
    return JSON.parse(readFileSync(STDIN, "utf8"));
  } catch {
    return {};
  }
}

export function block(lines) {
  console.error(lines.join("\n"));
  process.exit(BLOCK_EXIT_CODE);
}

export function withoutGitVariables(environment) {
  const run = spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" });
  const local = new Set((run.stdout ?? "").split("\n").filter(Boolean));
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !local.has(name) && !GIT_CONFIG_VARIABLE.test(name),
    ),
  );
}

export function git(directory, args, extraEnvironment = {}) {
  const run = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: { ...withoutGitVariables(env), ...extraEnvironment },
  });
  return { ok: run.status === 0, text: (run.stdout ?? "").trim() };
}

export function startDirectory(input) {
  return input.cwd ?? process.cwd();
}

export function repositoryRoot(directory) {
  const top = git(directory, ["rev-parse", "--show-toplevel"]);
  return top.ok ? top.text : directory;
}

export function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    return resolve(realPath(parent), path.slice(parent.length + 1));
  }
}

export function isInside(path, directory) {
  return path === directory || path.startsWith(directory + sep);
}
