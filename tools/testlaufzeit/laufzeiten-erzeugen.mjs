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
const AUFRUF = "Aufruf: node tools/testlaufzeit/laufzeiten-erzeugen.mjs [--werkzeuge <id eines Prüfleiter-Laufs mit allen Werkzeugtests>]";

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
  const { werkzeuge } = parseArgs({ options: { werkzeuge: { type: "string" } } }).values;
  if (werkzeuge === undefined) return schreibe(MESSDATEI, geholt());
  if (!LAUFNUMMER.test(werkzeuge)) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  return schreibe(WERKZEUG_MESSDATEI, werkzeugDauern(werkzeuge));
}

process.exitCode = main();
