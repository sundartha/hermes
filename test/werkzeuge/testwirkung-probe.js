import { rmSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

export const EXIT_GRUEN = 0;
export const EXIT_ROT = 1;
const WERKZEUG = join(REPO_ROOT, "tools/testwirkung.mjs");
const ALS_MODUL = { "package.json": '{ "type": "module" }\n' };

export function pruefeZwischen(context, vorher, nachher) {
  return pruefeMitEntfernten(context, vorher, { nachher });
}

export function pruefeMitEntfernten(context, vorher, { nachher, entfernt = [] }) {
  const repo = probeRepository(context, { ...ALS_MODUL, ...vorher });
  writeFiles(repo, nachher);
  for (const datei of entfernt) rmSync(join(repo, datei));
  commitAll(repo, "Änderung");
  return runIn(repo, process.execPath, [WERKZEUG, "--basis", "HEAD~1"]);
}
