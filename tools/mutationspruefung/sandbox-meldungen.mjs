import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process, { env, pid } from "node:process";

import { leseFaelle } from "./erstlauf-bericht.mjs";

export const SANDBOX_MELDUNGEN = "MUTATIONSPRUEFUNG_SANDBOXMELDUNGEN";
let angelegt = false;

export function sandboxMeldungsdatei() {
  if (!angelegt) {
    angelegt = true;
    env[SANDBOX_MELDUNGEN] = join(tmpdir(), `sandbox-meldungen-${pid}.jsonl`);
    process.on("exit", () => rmSync(env[SANDBOX_MELDUNGEN], { force: true }));
  }
  return env[SANDBOX_MELDUNGEN];
}

export function sandboxMeldung(datei, namen) {
  const ziel = env[SANDBOX_MELDUNGEN];
  if (ziel === undefined) return undefined;
  return leseFaelle(ziel).findLast((fall) => fall.datei === datei && namen.includes(fall.name))?.meldung;
}
