import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { ghRepo } from "../mutationspruefung/gh.mjs";
import { holeLaufzeiten, laufzeitenDesLaufs } from "../mutationspruefung/laufzeiten.mjs";
import { entferneTempOrdner, neuerTempOrdner } from "../temp-ordner.mjs";
import { gerundeteTabelle, MESSDATEI, WERKZEUG_MESSDATEI } from "./teilung.mjs";

const EINRUECKUNG = 2;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;
const EXIT_AUFRUF = 2;
const LAUFNUMMER = /^[1-9]\d*$/;
const WERKZEUG_ARTEFAKTE = "werkzeugteil-*";
const WERKZEUG_BERICHT = /^werkzeugteil-\d+\.jsonl$/;
const AUFRUF = "Aufruf: node tools/testlaufzeit/laufzeiten-erzeugen.mjs [--tests <id eines CI-Laufs> | --werkzeuge <id eines Prüfleiter-Laufs mit allen Werkzeugtests>]";

function geholt() {
  const ordner = neuerTempOrdner("testdauern-");
  try {
    const ziel = join(ordner, "laufzeiten.json");
    holeLaufzeiten(ziel);
    return JSON.parse(readFileSync(ziel, "utf8"));
  } finally {
    entferneTempOrdner(ordner);
  }
}

function testDauern(lauf) {
  const { dauern, grund } = laufzeitenDesLaufs({ repo: ghRepo(), lauf: Number(lauf) });
  return dauern ? { lauf: Number(lauf), dauern } : { lauf: null, grund };
}

function werkzeugDauern(lauf) {
  const passt = (datei) => WERKZEUG_BERICHT.test(datei);
  const { dauern, grund } = laufzeitenDesLaufs({ repo: ghRepo(), lauf: Number(lauf), artefakte: WERKZEUG_ARTEFAKTE, passt });
  return dauern ? { lauf: Number(lauf), dauern } : { lauf: null, grund };
}

function schreibe(ziel, { lauf, dauern, grund }) {
  if (lauf === null) {
    console.error(`Keine Messwerte geholt (${grund}); ${ziel} bleibt unverändert.`);
    return EXIT_FEHLER;
  }
  const tabelle = gerundeteTabelle({ lauf, dauern });
  writeFileSync(ziel, JSON.stringify(tabelle, null, EINRUECKUNG) + "\n");
  console.log(`${ziel}: ${Object.keys(tabelle.dauern).length} Testdateien aus Lauf ${lauf}`);
  return EXIT_OK;
}

function main() {
  const { tests, werkzeuge } = parseArgs({ options: { tests: { type: "string" }, werkzeuge: { type: "string" } } }).values;
  const gewaehlt = [tests, werkzeuge].filter((lauf) => lauf !== undefined);
  if (gewaehlt.length > 1 || gewaehlt.some((lauf) => !LAUFNUMMER.test(lauf))) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  if (tests !== undefined) return schreibe(MESSDATEI, testDauern(tests));
  if (werkzeuge !== undefined) return schreibe(WERKZEUG_MESSDATEI, werkzeugDauern(werkzeuge));
  return schreibe(MESSDATEI, geholt());
}

process.exitCode = main();
