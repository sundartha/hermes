import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { befundeMeldenUndScheitern } from "../../tools/auftrag/zweck.mjs";

const EXIT_ROT = 1;

export function befundeMitPraefixMeldenUndScheitern({ praefix, befunde, zweck }) {
  befundeMeldenUndScheitern(befunde.map((befund) => `${praefix} ${befund}`), zweck);
  return EXIT_ROT;
}

export function alsHauptprogramm(adresse, praefix, lauf) {
  if (fileURLToPath(adresse) !== resolve(process.argv[1] || "")) return;
  try {
    process.exit(lauf());
  } catch (err) {
    console.error(`${praefix} Fehler (fail-closed): ${err.message}`);
    process.exit(EXIT_ROT);
  }
}
