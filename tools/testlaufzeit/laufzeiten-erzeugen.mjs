import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { gh, ghRepo } from "../mutationspruefung/gh.mjs";
import { dauernAus, holeLaufzeiten } from "../mutationspruefung/laufzeiten.mjs";
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

function inTempOrdner(praefix, arbeit) {
  const ordner = neuerTempOrdner(praefix);
  try {
    return arbeit(ordner);
  } finally {
    entferneTempOrdner(ordner);
  }
}

function geholt() {
  return inTempOrdner("testdauern-", (ordner) => {
    const ziel = join(ordner, "laufzeiten.json");
    holeLaufzeiten(ziel);
    return JSON.parse(readFileSync(ziel, "utf8"));
  });
}

function werkzeugDauern(lauf) {
  return inTempOrdner("werkzeugdauern-", (ordner) => {
    gh(["run", "download", lauf, "-R", ghRepo(), "-D", ordner, "-p", WERKZEUG_ARTEFAKTE]);
    const dauern = dauernAus(ordner, (datei) => WERKZEUG_BERICHT.test(datei));
    const leer = Object.keys(dauern).length === 0;
    return leer ? { lauf: null, grund: `keine Werkzeug-Laufzeiten im Lauf ${lauf}` } : { lauf: Number(lauf), dauern };
  });
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
