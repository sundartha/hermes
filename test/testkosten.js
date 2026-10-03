import { appendFileSync } from "node:fs";
import path from "node:path";

const ZIEL = process.env.TESTKOSTEN_DATEI;
const TESTDATEI = path.relative(process.cwd(), process.argv[1] ?? "");

export function testkostenZaehler(art) {
  const stand = { anzahl: 0, summe: 0 };
  if (ZIEL) {
    process.on("exit", () => {
      if (stand.anzahl === 0) return;
      appendFileSync(ZIEL, `${JSON.stringify({ datei: TESTDATEI, art, ...stand })}\n`);
    });
  }
  return {
    zaehle(menge) {
      stand.anzahl += 1;
      stand.summe += menge;
    },
  };
}
