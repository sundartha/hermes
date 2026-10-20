import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { bereichDerDatei, leseBereiche } from "../../tests-ausmisten/pfade.mjs";
import { dependentsGraph, testsReaching } from "../../testgraph.mjs";
import { istQuelltext } from "../../ziele/funktionen.mjs";
import { istKritisch } from "../agenten.mjs";
import { geschuetzteMuster, istGeschuetzt, istTestdatei } from "../format.mjs";
import { aenderungsStellen, istText, liste } from "./erkundung.mjs";
import { vonEslintGeprueft } from "./eslint-prueft.mjs";
import { funktionsKarten } from "./karte.mjs";

function mitZeilen(stelle) {
  return stelle.neu === undefined && Number.isInteger(stelle.von) && Number.isInteger(stelle.bis);
}

function nummernDerStellen(stellen) {
  return [...new Set(stellen.map(({ nummer }) => nummer))].toSorted();
}

export function funktionsListe(root, berichte) {
  const stellen = aenderungsStellen(berichte).filter(mitZeilen);
  const alle = [...new Set(stellen.map(({ datei }) => datei))].toSorted();
  if (alle.length === 0) return [];
  const dateien = vonEslintGeprueft(root, alle);
  if (dateien.length === 0) return [];
  return funktionsKarten(root, dateien).flatMap(({ datei, funktionen }) => {
    const eigene = stellen.filter((stelle) => stelle.datei === datei);
    return funktionen.flatMap((funktion) => {
      const nummern = nummernDerStellen(eigene.filter(({ von, bis }) => funktion.von <= bis && von <= funktion.bis));
      return nummern.length > 0 ? [{ datei, ...funktion, nummern }] : [];
    });
  });
}

export async function dateiKarte(root, berichte) {
  const stellen = aenderungsStellen(berichte);
  const dateien = [...new Set(stellen.map(({ datei }) => datei))].toSorted();
  const bereiche = leseBereiche();
  const muster = geschuetzteMuster(root);
  const graph = await dependentsGraph(realpathSync(root));
  return dateien.map((datei) => ({
    datei,
    nummern: nummernDerStellen(stellen.filter((stelle) => stelle.datei === datei)),
    bereich: bereichDerDatei(datei, bereiche) ?? null,
    codeowners: istGeschuetzt(muster, datei),
    kritisch: istKritisch(datei),
    tests: testsReaching(datei, graph).toSorted(),
  }));
}

function produktDateien(root, auftraege) {
  const dateien = auftraege.flatMap((auftrag) => liste(auftrag.erwarteteDateien));
  return [...new Set(dateien)].filter((datei) => istText(datei) && !istTestdatei(datei) && existsSync(join(root, datei)));
}

function ersatzbericht(root, dateien, nummer) {
  const aenderungen = dateien.map((datei) => ({ datei, von: 1, bis: readFileSync(join(root, datei), "utf8").split("\n").length }));
  return { gruppe: [], nummern: { [nummer]: { aenderungen } } };
}

export function umbauBericht(root, auftraege, nummer) {
  return ersatzbericht(root, produktDateien(root, auftraege), nummer);
}

export async function umbauKarten(root, auftraege, nummer) {
  const dateien = produktDateien(root, auftraege);
  const funktionsliste = funktionsListe(root, [ersatzbericht(root, dateien.filter(istQuelltext), nummer)]);
  return { funktionsliste, dateikarte: await dateiKarte(root, [ersatzbericht(root, dateien, nummer)]) };
}
