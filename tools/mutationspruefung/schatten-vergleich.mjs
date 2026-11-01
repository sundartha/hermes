import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { argv, exit } from "node:process";
import { pathToFileURL } from "node:url";

import { bestaetigtGetoetet, eintragsListe } from "./uebernahme.mjs";

const ERSTES_ARGUMENT = 2;
const EXIT_GRUEN = 0;
const EXIT_ABWEICHUNG = 1;
const EXIT_AUFRUF = 2;
const TEILDATEI = /^mutation-teil-\d+\.json$/;

function uebernehmbare(berichte) {
  const nachSchluessel = new Map();
  for (const eintrag of berichte.flatMap(({ schatten }) => schatten?.uebernehmbar ?? [])) nachSchluessel.set(`${eintrag.pruefung}\0${eintrag.schluessel}`, eintrag);
  return [...nachSchluessel.values()];
}

export function schattenVergleich(berichte) {
  const frisch = new Map();
  const frischJe = (pruefung) => {
    if (!frisch.has(pruefung)) frisch.set(pruefung, new Map(eintragsListe(berichte, pruefung).map((eintrag) => [eintrag.schluessel, eintrag])));
    return frisch.get(pruefung);
  };
  const uebernehmbar = uebernehmbare(berichte);
  const abweichungen = uebernehmbar.filter(({ pruefung, schluessel }) => {
    const eintrag = frischJe(pruefung).get(schluessel);
    return eintrag === undefined || !bestaetigtGetoetet(eintrag);
  });
  return { uebernehmbar: uebernehmbar.length, abweichungen };
}

function teilberichte(ordner) {
  const namen = readdirSync(ordner, { recursive: true }).map(String).filter((name) => TEILDATEI.test(basename(name)));
  return namen.map((name) => JSON.parse(readFileSync(join(ordner, name), "utf8")));
}

function hauptlauf(ordner) {
  if (ordner === undefined) {
    console.error("Aufruf: node tools/mutationspruefung/schatten-vergleich.mjs <ordner mit mutation-teil-*.json>");
    return EXIT_AUFRUF;
  }
  const { uebernehmbar, abweichungen } = schattenVergleich(teilberichte(ordner));
  for (const { pruefung, schluessel } of abweichungen) console.log(`Abweichung: als übernehmbar gemeldet, im frischen Lauf nicht bestätigt getötet: Prüfung ${pruefung}, ${schluessel}`);
  console.log(`Schattenvergleich: ${uebernehmbar} übernehmbare Mutanten, ${abweichungen.length} im frischen Lauf nicht bestätigt getötet.`);
  return abweichungen.length === 0 ? EXIT_GRUEN : EXIT_ABWEICHUNG;
}

if (import.meta.url === pathToFileURL(argv[1]).href) exit(hauptlauf(argv[ERSTES_ARGUMENT]));
