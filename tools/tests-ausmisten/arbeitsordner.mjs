import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { git } from "./pfade.mjs";

const EIGENER_CACHE = ".cache";
export const SANDBOXORDNER = ".mutationspruefung";

function verlinkeModule(quelle, ziel) {
  mkdirSync(ziel);
  for (const eintrag of readdirSync(quelle)) {
    if (eintrag !== EIGENER_CACHE) symlinkSync(join(quelle, eintrag), join(ziel, eintrag));
  }
}

export function legeSandboxordnerAn(wurzel) {
  const ordner = join(wurzel, SANDBOXORDNER);
  mkdirSync(ordner, { recursive: true });
  writeFileSync(join(ordner, ".gitignore"), "*\n");
  return ordner;
}

export function legeArbeitsordnerAn(ziel, rev) {
  git(["worktree", "add", "--detach", "-q", ziel, rev]);
  try {
    const module = join(git(["rev-parse", "--show-toplevel"]).trim(), "node_modules");
    if (existsSync(module)) verlinkeModule(module, join(ziel, "node_modules"));
  } catch (fehler) {
    entferneArbeitsordner(ziel);
    throw fehler;
  }
  return ziel;
}

export function entferneArbeitsordner(ziel) {
  git(["worktree", "remove", "--force", ziel]);
}
