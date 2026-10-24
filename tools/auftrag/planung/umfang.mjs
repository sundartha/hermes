import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { istTestdatei } from "../format.mjs";
import { genannteFunktionen, genannteStellen, pruefbareDateien } from "./altfunktionen-vorab.mjs";
import { dateiKarte } from "./funktionsliste.mjs";
import { loeschEinstiege, loeschmenge } from "./loeschmenge.mjs";
import { PITCH, SICHERHEIT, nummernImOrdner } from "./nummern.mjs";
import { DOKUMENTE, istAltfunktion } from "./schnitt.mjs";

const EXIT_GRUEN = 0;
const EXIT_AUFRUF = 2;
const BYTE_JE_KB = 1024;
const ZEHNTEL = 10;
const JSON_EINRUECKUNG = 2;
const QUELLE = "umfang";

export function dokumenteIm(ordner) {
  return Object.fromEntries(DOKUMENTE.filter((name) => existsSync(join(ordner, name))).map((name) => [name, readFileSync(join(ordner, name), "utf8")]));
}

async function testsAn(root, dateien) {
  if (dateien.length === 0) return [];
  const bericht = { nummern: { [QUELLE]: { aenderungen: dateien.map((datei) => ({ datei })) } } };
  const karte = await dateiKarte(root, [bericht]);
  return [...new Set(karte.flatMap(({ tests }) => tests))].toSorted();
}

function kilobyte(dokumente) {
  const bytes = Object.values(dokumente).reduce((summe, text) => summe + Buffer.byteLength(text), 0);
  return Math.round((bytes / BYTE_JE_KB) * ZEHNTEL) / ZEHNTEL;
}

export async function umfang(root, ordner) {
  const dokumente = dokumenteIm(ordner);
  const stellen = genannteStellen(dokumente);
  const belegt = pruefbareDateien(root, stellen.map(({ datei }) => datei));
  const codeDateien = belegt.filter((datei) => !istTestdatei(datei));
  const funktionen = genannteFunktionen(root, stellen);
  const einstiege = loeschEinstiege(dokumente[PITCH] ?? "");
  return {
    nummern: nummernImOrdner(ordner).soll.size,
    codeDateien,
    testDateien: belegt.filter(istTestdatei),
    funktionen: funktionen.length,
    altfunktionen: funktionen.filter(istAltfunktion).length,
    testsAnDateien: await testsAn(root, codeDateien),
    dokumentKB: kilobyte(dokumente),
    ...(einstiege && { loeschmenge: await loeschmenge(root, einstiege) }),
  };
}

export async function umfangBefehl(ordnerAngabe, root) {
  const ordner = resolve(root, ordnerAngabe);
  const fehlend = [PITCH, SICHERHEIT].filter((name) => !existsSync(join(ordner, name)));
  if (fehlend.length > 0) {
    console.error(`${ordner} enthält kein ${fehlend.join(" und kein ")}`);
    return EXIT_AUFRUF;
  }
  console.log(JSON.stringify(await umfang(root, ordner), null, JSON_EINRUECKUNG));
  return EXIT_GRUEN;
}
