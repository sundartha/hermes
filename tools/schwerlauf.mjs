import { spawnSync } from "node:child_process";
import { argv } from "node:process";
import { parseArgs } from "node:util";

import { nimmSperreAuchFuerKindprozesse, stand } from "./schwerlauf/sperre.mjs";

const EXIT_ABBRUCH = 1;
const EXIT_AUFRUF = 2;
const TRENNER = "--";
const ERSTES_ARGUMENT = 2;
const OPTIONEN = {
  stand: { type: "boolean", default: false },
  allein: { type: "boolean", default: false },
};
const AUFRUF =
  "Aufruf: node tools/schwerlauf.mjs [--allein] -- <befehl> [<argument> ...] | --stand";

function optionenAus(vorne) {
  try {
    return parseArgs({ args: vorne, options: OPTIONEN }).values;
  } catch {
    return null;
  }
}

function aufruf(argumente) {
  const trenner = argumente.indexOf(TRENNER);
  const vorne = trenner === -1 ? argumente : argumente.slice(0, trenner);
  const [befehl, ...rest] = trenner === -1 ? [] : argumente.slice(trenner + 1);
  const values = optionenAus(vorne);
  if (values === null) return null;
  if (values.stand) return trenner === -1 && vorne.length === 1 ? { stand: true } : null;
  if (befehl === undefined) return null;
  return { allein: values.allein, befehl, rest };
}

async function main(argumente) {
  const auftrag = aufruf(argumente);
  if (auftrag === null) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  if (auftrag.stand) {
    console.log(await stand());
    return 0;
  }
  const { allein, befehl, rest } = auftrag;
  const anlass = [befehl, ...rest].join(" ");
  await nimmSperreAuchFuerKindprozesse(anlass, { allein });
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
