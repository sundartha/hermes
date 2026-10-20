import { ESLint } from "eslint";

import { REPO_WURZEL, vorhandenerPfad } from "../../tools/zwillingspfad.mjs";
import { REPO_ROOT } from "./probe-repo.js";

export const RULE = "hermes/wort-nur-in";

let repoEslint;

export function repoKonfiguration() {
  repoEslint ??= new ESLint({ cwd: REPO_ROOT });
  return repoEslint;
}

export async function repoTreffer(filePath, zeilen) {
  const [ergebnis] = await repoKonfiguration().lintText(`${zeilen.join("\n")}\n`, {
    filePath: vorhandenerPfad(filePath, REPO_WURZEL),
  });
  return ergebnis.messages
    .filter(({ ruleId }) => ruleId === RULE)
    .map(({ line, message }) => `${line} ${message.split(":")[0]}`);
}
