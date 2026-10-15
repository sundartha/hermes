import { join } from "node:path";

import { REPO_ROOT, runIn } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");

export const EXIT_ROT = 1;

export function werkzeug(repo, basis, ...argumente) {
  return runIn(repo, process.execPath, [WERKZEUG, "--basis", basis, ...argumente]);
}
