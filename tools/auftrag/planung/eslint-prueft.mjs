import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";

import { fuehreAus, werkzeugBefehl } from "../../ziele/werkzeuge.mjs";

const KONFIGURATION = "eslint.config.js";
const EXIT_GRUEN = 0;
const ERSTE_DATEI = 2;

function ausserhalb(root, datei) {
  return relative(root, resolve(root, datei)).startsWith("..");
}

async function geprueft(root, dateien) {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: resolve(root, KONFIGURATION) });
  const ignoriert = await Promise.all(dateien.map((datei) => eslint.isPathIgnored(resolve(root, datei))));
  return dateien.filter((datei, stelle) => ausserhalb(root, datei) || !ignoriert[stelle]);
}

export function vonEslintGeprueft(root, dateien) {
  const lauf = fuehreAus(werkzeugBefehl("tools/auftrag/planung/eslint-prueft.mjs", dateien), root);
  if (lauf.status !== EXIT_GRUEN) throw new Error(`ESLint konnte nicht sagen, welche Dateien es prüft: ${lauf.stderr.trim()}`);
  return JSON.parse(lauf.stdout);
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) {
  console.log(JSON.stringify(await geprueft(process.cwd(), process.argv.slice(ERSTE_DATEI))));
}
