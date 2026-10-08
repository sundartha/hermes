import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execPath } from "node:process";

import { REPO_ROOT, probeDirectory } from "../probe-repo.js";

export const GITLEAKS_VERSION = "8.30.1";
export const FUND = ["FUND", "FUER", "GITLEAKS"].join("-");
export const WERKZEUG_PRUEFUNGEN = ["lint-neue-funktionen", "kommentar-wanderung", "neue-kommentare"];
const AUSFUEHRBAR = 0o755;
const LINT_BINS = ["eslint", "commitlint"];

function stummel(protokoll, name) {
  return [
    'import { appendFileSync, existsSync } from "node:fs";',
    'import { argv } from "node:process";',
    "",
    `appendFileSync(${JSON.stringify(protokoll)}, \`${name} \${argv.slice(2).join(" ")}\\n\`);`,
    `process.exitCode = existsSync(${JSON.stringify(`.rot-${name}`)}) ? 1 : 0;`,
    "",
  ].join("\n");
}

export function vorpruefDateien(protokoll) {
  const werkzeuge = Object.fromEntries(
    WERKZEUG_PRUEFUNGEN.map((name) => [`tools/${name}.mjs`, stummel(protokoll, name)]),
  );
  return {
    ".gitignore": "node_modules\n",
    "package.json": `${JSON.stringify({ type: "module", scripts: { lint: "eslint ." } })}\n`,
    "eslint.config.js": 'export default [{ rules: { "no-unused-vars": "error" } }];\n',
    "commitlint.config.mjs":
      'export default { rules: { "header-max-length": [2, "always", 72] } };\n',
    "gitleaks.toml": 'title = "probe"\n',
    ...werkzeuge,
  };
}

export function verlinkeLintWerkzeuge(ordner) {
  const bins = join(ordner, "node_modules", ".bin");
  mkdirSync(bins, { recursive: true });
  for (const name of LINT_BINS) {
    symlinkSync(join(REPO_ROOT, "node_modules", ".bin", name), join(bins, name));
  }
}

export function scheinGitleaks(context, { protokoll, version = GITLEAKS_VERSION }) {
  const ordner = probeDirectory(context, {});
  const datei = join(ordner, "gitleaks");
  const zeilen = [
    `#!${execPath}`,
    'import { appendFileSync } from "node:fs";',
    'import { execFileSync } from "node:child_process";',
    'import { argv } from "node:process";',
    "const [befehl, ...rest] = argv.slice(2);",
    `if (befehl === "version") console.log(${JSON.stringify(version)});`,
    "else {",
    `  appendFileSync(${JSON.stringify(protokoll)}, \`gitleaks \${argv.slice(2).join(" ")}\\n\`);`,
    '  const bereich = rest.find((wert) => wert.startsWith("--log-opts=")).split("=")[1];',
    '  const verlauf = execFileSync("git", ["log", "-p", bereich], { encoding: "utf8" });',
    `  process.exitCode = verlauf.includes(${JSON.stringify(FUND)}) ? 1 : 0;`,
    "}",
    "",
  ];
  writeFileSync(datei, zeilen.join("\n"));
  chmodSync(datei, AUSFUEHRBAR);
  return datei;
}

export function aufrufe(protokoll) {
  try {
    return readFileSync(protokoll, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
