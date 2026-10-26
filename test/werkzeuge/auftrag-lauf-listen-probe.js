import { symlinkSync } from "node:fs";
import { join } from "node:path";

import { BASIS, starte } from "./auftrag-lauf-probe.js";
import { BASE_FILES, MANIFEST_BOTH, RENAMED_FILES } from "./feste-pfade-probe.js";
import { REPO_ROOT, runIn } from "./probe-repo.js";

const OHNE = new Set(["package.json", ".github/CODEOWNERS", "scripts/pin.js", ".githooks/pre-commit", "src/schema.sql"]);
const SCHUTZ = Object.fromEntries(Object.entries(BASE_FILES).filter(([pfad]) => !OHNE.has(pfad)));
const PAKET = JSON.parse(BASIS["package.json"]);
export const MUTANT = "src/text.ts:2:10 MethodExpression → text";
const ERSATZ_MUTATION = `const mutant = ${JSON.stringify(MUTANT)};
if (!process.argv.includes("--alter-stand") && !process.argv.includes(mutant)) process.exitCode = 1;
console.log(process.exitCode ? "Verstoß: Mutant überlebt: " + mutant : "grün: keiner überlebt");
`;
export const MIT_MUTATION = { skripte: { "test:mutation": "node mutation.mjs" }, zusatz: { "mutation.mjs": ERSATZ_MUTATION } };

function dateien(skripte) {
  return {
    ...SCHUTZ,
    ...MANIFEST_BOTH,
    "package.json": JSON.stringify({ ...PAKET, scripts: { ...PAKET.scripts, lint: "node -e 0 --", ...skripte } }),
    "eslint.config.js": RENAMED_FILES["eslint.config.js"],
    ".gitignore": `${BASIS[".gitignore"]}node_modules\n`,
  };
}

export function listenLauf(context, { auftrag, drehbuch, listen, skripte = {}, zusatz = {} }) {
  const vorbereiten = (repo) => symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
  return starte(context, { auftrag, drehbuch, dateien: { ...dateien(skripte), ...listen, ...zusatz }, vorbereiten });
}

export function zeigt(repo, pfad) {
  return runIn(repo, "git", ["show", `HEAD:${pfad}`]).stdout;
}

export function grenzenBau(beleg) {
  return beleg.pruefungen.filter(({ name }) => name === "grenzen bau").map(({ exitCode }) => exitCode);
}
