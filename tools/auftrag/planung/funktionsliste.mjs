import { realpathSync } from "node:fs";

import { bereichDerDatei, leseBereiche } from "../../tests-ausmisten/pfade.mjs";
import { dependentsGraph, testsReaching } from "../../testgraph.mjs";
import { istKritisch } from "../agenten.mjs";
import { geschuetzteMuster, istGeschuetzt } from "../format.mjs";
import { aenderungsStellen } from "./erkundung.mjs";
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
