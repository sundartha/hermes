import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Linter } from "eslint";

import testRegeln from "../../tools/eslint-rules/tests.js";
import { REPO_ROOT } from "./probe-repo.js";

const TESTREGELN_PLUGIN = "hermes-tests";
const TESTREGELN_URL = pathToFileURL(join(REPO_ROOT, "tools/eslint-rules/tests.js")).href;

export function befundZeilen({ verzeichnis, datei, regel, bestand }, zeilen) {
  const linter = new Linter({ cwd: verzeichnis });
  const konfiguration = {
    plugins: { [TESTREGELN_PLUGIN]: testRegeln },
    rules: { [regel]: ["error", { bestand }] },
  };
  const meldungen = linter.verify(zeilen.join("\n"), konfiguration, {
    filename: join(verzeichnis, datei),
  });
  const abbruch = meldungen.find(({ fatal }) => fatal);
  if (abbruch !== undefined) throw new Error(`Probe nicht lesbar: ${abbruch.message}`);
  const eigene = meldungen.filter(({ ruleId }) => ruleId === regel);
  return eigene.map(({ line }) => zeilen[line - 1].trim());
}

export function konfigurationMitTestregeln(regel, bestand) {
  const regeln = JSON.stringify({ [regel]: ["error", { bestand }] });
  return [
    `import testRegeln from ${JSON.stringify(TESTREGELN_URL)};`,
    `const plugins = { ${JSON.stringify(TESTREGELN_PLUGIN)}: testRegeln };`,
    `export default [{ files: ["test/**"], plugins, rules: ${regeln} }];`,
    "",
  ].join("\n");
}
