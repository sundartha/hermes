import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { entpacke } from "../auftrag/pruefer-gedaechtnis.mjs";
import { githubZugang } from "../auftrag/pruefer-github.mjs";
import { CI, PRUEFLEITER } from "./erzeuger.mjs";

const ERSTES_ARGUMENT = 2;
const EXIT_GLEICH = 0;
const EXIT_ABWEICHUNG = 1;
const EXIT_AUFRUF = 2;
const SCHATTEN_NAME = /^uebernahme-schatten-/;
const SCHATTEN_DATEI = "uebernahme-schatten.json";
const WORKFLOWS = { ci: CI, pruefleiter: PRUEFLEITER };
const AUFRUF = "Aufruf: node tools/uebernahme/schatten-vergleich.mjs --lauf <id>";

async function artefaktInhalt(github, artefakt, datei) {
  const dateien = entpacke(await github.roh(`/actions/artifacts/${artefakt.id}/zip`));
  const inhalt = dateien.get(datei);
  if (inhalt === undefined) throw new Error(`Artefakt ${artefakt.name} enthält ${datei} nicht`);
  return inhalt.toString("utf8");
}

function frischeZeilen(text) {
  const zeilen = text.split("\n").filter((zeile) => zeile.trim() !== "");
  return new Map(zeilen.map((zeile) => [JSON.parse(zeile).datei, JSON.parse(zeile)]));
}

async function vergleicheTeil(github, artefakte, plan) {
  const workflow = WORKFLOWS[plan.art];
  const frisch = artefakte.find(({ name }) => name === workflow.artefakt(plan.teil));
  if (frisch === undefined) {
    return { uebernehmbar: 0, gleich: 0, abweichend: [`${workflow.artefakt(plan.teil)}: Artefakt fehlt`] };
  }
  const zeilen = frischeZeilen(await artefaktInhalt(github, frisch, workflow.bericht(plan.teil)));
  const vorhergesagt = plan.dateien.filter(({ uebernehmbar }) => uebernehmbar);
  const abweichend = vorhergesagt
    .filter(({ datei, erwartet }) => zeilen.get(datei)?.bestanden !== erwartet.bestanden)
    .map(({ datei }) => datei);
  return {
    uebernehmbar: vorhergesagt.length,
    gleich: vorhergesagt.length - abweichend.length,
    abweichend,
  };
}

export async function vergleicheLauf(github, laufId) {
  const artefakte = await github.alle(`/actions/runs/${laufId}/artifacts`, (antwort) => antwort.artifacts);
  const schatten = artefakte.filter(({ name }) => SCHATTEN_NAME.test(name));
  const summe = { vorhersagen: schatten.length, uebernehmbar: 0, gleich: 0, abweichend: [] };
  for (const artefakt of schatten) {
    const plan = JSON.parse(await artefaktInhalt(github, artefakt, SCHATTEN_DATEI));
    const teil = await vergleicheTeil(github, artefakte, plan);
    summe.uebernehmbar += teil.uebernehmbar;
    summe.gleich += teil.gleich;
    summe.abweichend.push(...teil.abweichend);
  }
  return summe;
}

export async function main(argumente, github = githubZugang()) {
  const { lauf } = parseArgs({ args: argumente, options: { lauf: { type: "string" } } }).values;
  if (!/^[1-9]\d*$/.test(lauf ?? "")) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  const summe = await vergleicheLauf(github, lauf);
  console.log(
    `Lauf ${lauf}: ${summe.vorhersagen} Vorhersagen, übernehmbar ${summe.uebernehmbar}, gleich ${summe.gleich}, abweichend ${summe.abweichend.length} [${summe.abweichend.join(", ")}]`,
  );
  return summe.vorhersagen > 0 && summe.abweichend.length === 0 ? EXIT_GLEICH : EXIT_ABWEICHUNG;
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) {
  process.exitCode = await main(process.argv.slice(ERSTES_ARGUMENT));
}
