import { existsSync, readFileSync, rmSync } from "node:fs";

import { haltPfad } from "./bericht.mjs";

export const EXIT_HALT = 75;
const OHNE_ANGABE = "ohne Angabe";

function grundDer(pfad) {
  try {
    return readFileSync(pfad, "utf8").trim() || OHNE_ANGABE;
  } catch {
    return OHNE_ANGABE;
  }
}

export function verbraucheHalt(root, phase) {
  const pfad = haltPfad(root, phase);
  if (!existsSync(pfad)) return null;
  const grund = grundDer(pfad);
  rmSync(pfad, { force: true, recursive: true });
  return grund;
}

export function meldeHalt(grund, auftrag) {
  console.error(`lauf: Halt angefordert (${grund}); Auftrag ${auftrag} nicht begonnen, Exit ${EXIT_HALT}. Derselbe Befehl macht bei Auftrag ${auftrag} weiter.`);
  return EXIT_HALT;
}
