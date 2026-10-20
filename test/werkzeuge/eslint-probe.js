import { symlinkSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, probeRepository } from "./probe-repo.js";

const ESLINT_UMGEBUNG = {
  ".gitignore": "node_modules\n",
  "package.json": JSON.stringify({ type: "module" }),
  "eslint.config.js": 'export default [{ rules: { "no-var": "error" } }];\n',
};

export function probeMitEslint(context, dateien) {
  const wurzel = probeRepository(context, { ...ESLINT_UMGEBUNG, ...dateien });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(wurzel, "node_modules"));
  return wurzel;
}
