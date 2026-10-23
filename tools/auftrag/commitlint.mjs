import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { fuehreAus } from "./pruefungen.mjs";
import { PRUEFUNG } from "./zweck.mjs";

const COMMITLINT = fileURLToPath(new URL("../../node_modules/@commitlint/cli/cli.js", import.meta.url));
const KONFIGURATION = fileURLToPath(new URL("../../commitlint.config.mjs", import.meta.url));

export function pruefeNachricht(nachricht, root) {
  return fuehreAus(PRUEFUNG.COMMITLINT, [execPath, COMMITLINT, "--config", KONFIGURATION], { cwd: root, env, eingabe: nachricht });
}
