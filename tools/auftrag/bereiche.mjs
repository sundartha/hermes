import { existsSync } from "node:fs";
import { join } from "node:path";

import { cruise } from "dependency-cruiser";

import { imBereich } from "./format.mjs";

const GEMEINSAME_ORDNER = ["src/store/", "src/telephony/ports.js", "src/utils/"];
const DIREKTE_IMPORTE = { doNotFollow: { path: "node_modules" }, maxDepth: 1, moduleSystems: ["es6", "cjs"] };
const ENDSCHRAEGSTRICH = /\/$/;

function schluessel(pfad) {
  return pfad.replace(ENDSCHRAEGSTRICH, "");
}

function gemeinsamerOrdner(pfad) {
  return GEMEINSAME_ORDNER.find((ordner) => imBereich(ordner, pfad));
}

async function importierteOrdner(root, bereiche) {
  const vorhanden = bereiche.filter((bereich) => existsSync(join(root, bereich)));
  if (vorhanden.length === 0) return [];
  const { output } = await cruise(vorhanden.map(schluessel), DIREKTE_IMPORTE);
  const eigene = output.modules.filter(({ source }) => vorhanden.some((bereich) => imBereich(bereich, source)));
  const ziele = eigene.flatMap(({ dependencies }) => dependencies.map(({ resolved }) => resolved));
  return ziele.map(gemeinsamerOrdner).filter(Boolean);
}

function ohneUmschlossene(liste) {
  const eindeutig = [...new Set(liste)];
  return eindeutig.filter((eintrag) => !eindeutig.some((aussen) => eintrag.startsWith(`${aussen}/`)));
}

export async function sperrSchluessel(root, phase) {
  const bereiche = [...new Set(phase.auftraege.map(({ bereich }) => bereich))];
  const gebaut = bereiche.map((bereich) => schluessel(gemeinsamerOrdner(bereich) ?? bereich));
  const gelesen = await importierteOrdner(root, bereiche);
  const leser = gelesen.map((ordner) => `${schluessel(ordner)}/${phase.phase}`);
  return ohneUmschlossene([...gebaut, ...leser]);
}
