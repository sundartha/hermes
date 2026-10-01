import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { argv, cwd, env } from "node:process";

import { abnahmeBefehl } from "./befehle.mjs";
import { fuehreAus, rotUrteil } from "./pruefungen.mjs";

const GUT = 0;
const SCHLECHT = 1;
const NICHT_AUSFUEHRBAR = 125;
const ERSTES_ARGUMENT = 2;

const [abnahme, kopie, erwarteterFehler] = argv.slice(ERSTES_ARGUMENT);
const verfolgt = spawnSync("git", ["ls-files", "--error-unmatch", abnahme], { encoding: "utf8" }).status === 0;
mkdirSync(dirname(abnahme), { recursive: true });
writeFileSync(abnahme, readFileSync(kopie));
try {
  const lauf = fuehreAus("abnahme", abnahmeBefehl({ abnahme }), { cwd: cwd(), env });
  if (lauf.exitCode === 0) process.exitCode = GUT;
  else process.exitCode = rotUrteil(lauf, erwarteterFehler).rot ? SCHLECHT : NICHT_AUSFUEHRBAR;
} finally {
  if (verfolgt) spawnSync("git", ["checkout", "-q", "--", abnahme]);
  else rmSync(abnahme, { force: true });
}
