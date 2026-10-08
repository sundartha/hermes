import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { git } from "./pfade.mjs";

const EIGENER_CACHE = ".cache";

function verlinkeModule(quelle, ziel) {
  mkdirSync(ziel);
  for (const eintrag of readdirSync(quelle)) {
    if (eintrag !== EIGENER_CACHE) symlinkSync(join(quelle, eintrag), join(ziel, eintrag));
  }
}

export function legeArbeitsordnerAn(ziel, rev) {
  git(["worktree", "add", "--detach", "-q", ziel, rev]);
  const module = join(git(["rev-parse", "--show-toplevel"]).trim(), "node_modules");
  if (existsSync(module)) verlinkeModule(module, join(ziel, "node_modules"));
  return ziel;
}

export function entferneArbeitsordner(ziel) {
  git(["worktree", "remove", "--force", ziel]);
}
