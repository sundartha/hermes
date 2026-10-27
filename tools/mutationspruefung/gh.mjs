import { spawnSync } from "node:child_process";
import { env } from "node:process";

const STANDARD_REPO = "sundartha/hermes";
const EXIT_GRUEN = 0;
export const MAX_GH_AUSGABE = 268_435_456;
export const LAUF_FERTIG = "completed";

export function ghRepo() {
  return env.GITHUB_REPOSITORY || STANDARD_REPO;
}

export function gh(argumente) {
  const lauf = spawnSync("gh", argumente, { encoding: "utf8", maxBuffer: MAX_GH_AUSGABE });
  if (lauf.status === EXIT_GRUEN) return lauf.stdout;
  throw new Error(`gh ${argumente.join(" ")} endete mit Exit ${lauf.status}: ${String(lauf.stderr ?? "").trim()}`);
}
