import { existsSync } from "node:fs";
import { dirname, relative, sep } from "node:path";

import { git, realPath, repositoryRoot } from "./lib.mjs";

const PRODUCT_CODE = "src/";

export const BUILD_ROLE = "bau";
export const AENDERUNG_HINWEIS =
  "Beginne mit dem Skill aenderung: erst Fragen, dann Einstufung, dann Pitch bzw. Dokumente, dann lauf.";

export function mainCheckout(directory) {
  const common = git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return common.ok ? dirname(common.text) : repositoryRoot(directory);
}

function existingDirectory(path) {
  const parent = dirname(path);
  return existsSync(parent) || parent === path ? parent : existingDirectory(parent);
}

export function productCodePath(target, checkout) {
  const directory = existingDirectory(target);
  if (realPath(mainCheckout(directory)) !== checkout) return null;
  const root = realPath(repositoryRoot(directory));
  const path = relative(root, target).split(sep).join("/");
  return path.toLowerCase().startsWith(PRODUCT_CODE) ? path : null;
}
