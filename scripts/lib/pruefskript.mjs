import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT_ROT = 1;

export function alsHauptprogramm(adresse, praefix, lauf) {
  if (fileURLToPath(adresse) !== resolve(process.argv[1] || "")) return;
  try {
    process.exit(lauf());
  } catch (err) {
    console.error(`${praefix} Fehler (fail-closed): ${err.message}`);
    process.exit(EXIT_ROT);
  }
}
