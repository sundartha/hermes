import { spawn } from "node:child_process";
import { once } from "node:events";

import { REPO_ROOT, isolatedEnvironment } from "./probe-repo.js";

export function umgebung() {
  return { ...isolatedEnvironment(), GITHUB_ACTIONS: "true" };
}

export function lokaleUmgebung() {
  const env = isolatedEnvironment();
  delete env.GITHUB_ACTIONS;
  delete env.HERMES_LOKAL_SCHWER;
  return env;
}

export function starte(args, { env, cwd = REPO_ROOT, programm = process.execPath }) {
  const kind = spawn(programm, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const lauf = { kind, stdout: "", stderr: "", ende: once(kind, "exit") };
  kind.stdout.setEncoding("utf8").on("data", (teil) => (lauf.stdout += teil));
  kind.stderr.setEncoding("utf8").on("data", (teil) => (lauf.stderr += teil));
  return lauf;
}
