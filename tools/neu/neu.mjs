import { dirname, resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { legeAn } from "./anlegen.mjs";
import { EXIT_UNERWARTET, NeuFehler } from "./fehler.mjs";

const EXIT_OK = 0;
const ARGUMENTE_AB = 2;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function meldung(plan) {
  const angelegt = plan.dateien.map(({ pfad }) => `angelegt: ${pfad}`);
  const ergaenzt = plan.karten.map(({ pfad }) => `ergänzt: ${pfad}`);
  return [...angelegt, ...ergaenzt, ...plan.hinweise].join("\n");
}

try {
  const { values, positionals } = parseArgs({
    args: argv.slice(ARGUMENTE_AB),
    options: { wurzel: { type: "string" } },
    allowPositionals: true,
  });
  const [art, ziel, name] = positionals;
  const plan = await legeAn({ art, ziel, name, wurzel: resolve(values.wurzel ?? REPO) });
  stdout.write(`${meldung(plan)}\n`);
  exit(EXIT_OK);
} catch (fehler) {
  stderr.write(`${fehler.message}\n`);
  exit(fehler instanceof NeuFehler ? fehler.exitCode : EXIT_UNERWARTET);
}
