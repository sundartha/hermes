import { env } from "node:process";

import { VORRANG_PUSH, VORRANG_VARIABLE } from "../schwerlauf/sperre.mjs";
import { EXIT_GRUEN, EXIT_ROT } from "./befehle.mjs";
import { git } from "./git.mjs";
import { fuehreAus } from "./pruefungen.mjs";
import { MASTER } from "./worktrees.mjs";
import { MELDUNG, zweckBlock } from "./zweck.mjs";

function ciLokalBefunde(cwd, basis) {
  const lauf = fuehreAus(MELDUNG.CI_LOKAL, ["npm", "--silent", "run", "ci:lokal", "--", "--basis", basis], { cwd, env: { ...env, [VORRANG_VARIABLE]: VORRANG_PUSH } });
  console.log(lauf.ausgabe.trimEnd());
  return lauf.exitCode === 0 ? [] : [`ci-lokal gegen die Basis ${basis} endete mit Exit ${lauf.exitCode}; die roten Schritte stehen oben.`];
}

export function phasenbasis(root) {
  try {
    return git(["merge-base", "HEAD", MASTER], { cwd: root }).trim();
  } catch {
    return null;
  }
}

export function ciLokalAmPhasenende(cwd, basis) {
  const befunde = basis === null ? [`${MASTER} fehlt oder hat keinen gemeinsamen Commit mit HEAD; ohne die Basis des PRs kann ci-lokal nicht prüfen.`] : ciLokalBefunde(cwd, basis);
  if (befunde.length === 0) return EXIT_GRUEN;
  for (const befund of [...befunde, ...zweckBlock(MELDUNG.CI_LOKAL)]) console.error(befund);
  return EXIT_ROT;
}

export const OHNE_NEUEN_AUFTRAG = "jeder Auftrag war schon gebaut, lauf hat keinen neuen gebaut";
export const TEILLAUF = "teillauf fährt ci-lokal nie, das tut phase einmal am Ende der Phase";

export function ciLokalNichtGelaufen(root, grund) {
  const basis = phasenbasis(root) ?? MASTER;
  console.log(`ci-lokal nicht gelaufen: ${grund}. Vor dem Push selbst fahren: SCHWERLAUF_VORRANG=push node tools/ci-lokal.mjs --basis ${basis}`);
  return EXIT_GRUEN;
}
