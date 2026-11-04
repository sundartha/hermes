import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";

import { nachlaufplan } from "./nachlauf.mjs";

const ERSTES_ARGUMENT = 2;
const TEILDATEI = /^mutation-teil-\d+\.json$/;
const KEIN_TEIL = [0];

const [ordner, ziel] = argv.slice(ERSTES_ARGUMENT);
const namen = readdirSync(ordner).filter((name) => TEILDATEI.test(name));
const plan = nachlaufplan(namen.map((name) => JSON.parse(readFileSync(join(ordner, name), "utf8"))));
const messen = plan.nummern.length > 0;
writeFileSync(ziel, `${JSON.stringify({ ...plan, messen, teile: messen ? plan.nummern : KEIN_TEIL })}\n`);
console.log(`Mutationsnachlauf: ${plan.nummern.length} Teile`);
