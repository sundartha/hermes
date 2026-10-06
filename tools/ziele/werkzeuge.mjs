import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const WERKZEUG_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MAX_AUSGABE = 536_870_912;
const EXIT_OHNE_STATUS = 1;

export function fuehreAus(befehl, root, { eingabe, umgebung } = {}) {
  const [programm, ...argumente] = befehl;
  const lauf = spawnSync(programm, argumente, {
    cwd: root,
    encoding: "utf8",
    input: eingabe,
    env: umgebung,
    maxBuffer: MAX_AUSGABE,
  });
  if (lauf.error) throw new Error(`${programm} ließ sich nicht starten: ${lauf.error.message}`);
  return { status: lauf.status ?? EXIT_OHNE_STATUS, stdout: lauf.stdout, stderr: lauf.stderr };
}

export function nodeBefehl(skript, argumente = []) {
  return [process.execPath, skript, ...argumente];
}

export function paketBefehl(name, argumente = []) {
  return nodeBefehl(join(WERKZEUG_ROOT, "node_modules/.bin", name), argumente);
}

export function werkzeugBefehl(pfad, argumente = []) {
  return nodeBefehl(join(WERKZEUG_ROOT, pfad), argumente);
}

export function eslintBefehl(argumente) {
  return nodeBefehl(join(WERKZEUG_ROOT, "node_modules/eslint/bin/eslint.js"), argumente);
}
