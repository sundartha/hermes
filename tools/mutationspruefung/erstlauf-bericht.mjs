import { realpathSync } from "node:fs";
import { cwd, env } from "node:process";
import { relative } from "node:path";

import { vergleichDes } from "../auftrag/faelle-bericht.mjs";

const ERGEBNISSE = new Set(["test:pass", "test:fail"]);
const AKTIVER_MUTANT = "__STRYKER_ACTIVE_MUTANT__";

function relativ(datei) {
  try {
    return relative(realpathSync(cwd()), realpathSync(datei));
  } catch {
    return datei;
  }
}

export default async function* erstlaufBericht(quelle) {
  const imMutantenlauf = env[AKTIVER_MUTANT] !== undefined;
  for await (const { type: art, data: daten } of quelle) {
    if (imMutantenlauf || !ERGEBNISSE.has(art) || daten.file === undefined) continue;
    const rot = art === "test:fail";
    const vergleich = rot ? vergleichDes(daten.details?.error) : undefined;
    yield `${JSON.stringify({ datei: relativ(daten.file), name: daten.name, rot, suite: daten.details?.type === "suite", vergleich })}\n`;
  }
}
