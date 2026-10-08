import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

import { Stryker } from "@stryker-mutator/core";

const OHNE_TESTS = /No tests were executed/;
const [, , optionenDatei, ergebnisDatei] = argv;

function knapp({ fileName, location, mutatorName, replacement, status }) {
  return { fileName, location, mutatorName, replacement, status };
}

async function lauf() {
  const optionen = JSON.parse(readFileSync(optionenDatei, "utf8"));
  try {
    return { ergebnisse: (await new Stryker(optionen).runMutationTest()).map(knapp) };
  } catch (fehler) {
    if (OHNE_TESTS.test(fehler.message)) return { ergebnisse: [] };
    return { fehler: fehler.message };
  }
}

writeFileSync(ergebnisDatei, JSON.stringify(await lauf()));
exit(0);
