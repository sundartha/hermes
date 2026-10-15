import { spawnSync } from "node:child_process";
import { argv } from "node:process";

import { nimmSperreAuchFuerKindprozesse, stand } from "./schwerlauf/sperre.mjs";

const EXIT_ABBRUCH = 1;
const EXIT_AUFRUF = 2;
const TRENNER = "--";
const STAND = "--stand";
const ERSTES_ARGUMENT = 2;
const AUFRUF = "Aufruf: node tools/schwerlauf.mjs -- <befehl> [<argument> ...] | --stand";

async function main(argumente) {
  if (argumente.length === 1 && argumente[0] === STAND) {
    console.log(await stand());
    return 0;
  }
  const [trenner, befehl, ...rest] = argumente;
  if (trenner !== TRENNER || befehl === undefined) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  await nimmSperreAuchFuerKindprozesse([befehl, ...rest].join(" "));
  const lauf = spawnSync(befehl, rest, { stdio: "inherit" });
  if (lauf.error) throw lauf.error;
  return lauf.status ?? EXIT_ABBRUCH;
}

try {
  process.exitCode = await main(argv.slice(ERSTES_ARGUMENT));
} catch (fehler) {
  console.error(`Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_ABBRUCH;
}
