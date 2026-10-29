import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd } from "node:process";

import { BELEG_DATEI, belegZeilen } from "../auftrag/absicherungsbeleg.mjs";

const ERSTES_ARGUMENT = 2;
const [basis, ordner] = argv.slice(ERSTES_ARGUMENT);
const urteil = Number(readFileSync(join(ordner, "exit-code"), "utf8").trim());
const beleg = belegZeilen({ root: cwd(), basis, urteil });
writeFileSync(join(ordner, BELEG_DATEI), `${JSON.stringify(beleg)}\n`);
