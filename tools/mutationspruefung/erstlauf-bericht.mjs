import { existsSync, readFileSync, realpathSync } from "node:fs";
import { cwd } from "node:process";
import { relative } from "node:path";

const ERGEBNISSE = new Set(["test:pass", "test:fail"]);
const ZEILENENDE = "\n";

function relativ(datei) {
  try {
    return relative(realpathSync(cwd()), realpathSync(datei));
  } catch {
    return datei;
  }
}

export default async function* erstlaufBericht(quelle) {
  for await (const { type: art, data: daten } of quelle) {
    if (!ERGEBNISSE.has(art) || daten.file === undefined) continue;
    const fehler = daten.details?.error;
    yield `${JSON.stringify({ datei: relativ(daten.file), name: daten.name, rot: art === "test:fail", suite: daten.details?.type === "suite", meldung: fehler?.cause?.message ?? fehler?.message })}\n`;
  }
}

export function leseFaelle(datei) {
  return existsSync(datei) ? readFileSync(datei, "utf8").split(ZEILENENDE).filter(Boolean).map((zeile) => JSON.parse(zeile)) : [];
}
