import { realpathSync } from "node:fs";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

export async function startAlsHauptmodul({ modul, main, abbruch, exitAbbruch }) {
  if (modul !== pathToFileURL(realpathSync(argv[1] ?? ".")).href) return;
  try {
    process.exitCode = await main();
  } catch (fehler) {
    console.error(`${abbruch}${fehler.message}`);
    process.exitCode = exitAbbruch;
  }
}
