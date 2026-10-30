import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd } from "node:process";

import { BELEG_DATEI, belegZeilen } from "../auftrag/absicherungsbeleg.mjs";

const ERSTES_ARGUMENT = 2;
const EXIT_ZAHL = /^\d+$/;
const [basis, ordner] = argv.slice(ERSTES_ARGUMENT);
const exitZeile = readFileSync(join(ordner, "exit-code"), "utf8").trim();
if (!EXIT_ZAHL.test(exitZeile)) throw new Error(`exit-code ist keine Ganzzahl: ${JSON.stringify(exitZeile)}`);
const urteil = Number(exitZeile);
const beleg = belegZeilen({ root: cwd(), basis, urteil });
writeFileSync(join(ordner, BELEG_DATEI), `${JSON.stringify(beleg)}\n`);
