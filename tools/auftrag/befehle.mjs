import { env } from "node:process";

import { geschuetzteMuster, ladePhase, phasenBefunde } from "./format.mjs";
import { aenderungenSeit } from "./git.mjs";
import { fuehreAus, gekuerzteTestausgabe, grenzBefunde, rotUrteil } from "./pruefungen.mjs";

export const EXIT_GRUEN = 0;
export const EXIT_ROT = 1;
export const ROLLEN = ["test", "bau"];

export function abnahmeBefehl(auftrag) {
  return ["npm", "--silent", "test", "--", auftrag.abnahme];
}

export function gueltigePhase(phasendatei, root) {
  let phase;
  try {
    phase = ladePhase(phasendatei);
  } catch (fehler) {
    return { befunde: [`Die Phasendatei ${phasendatei} ist nicht lesbar: ${fehler.message}`] };
  }
  return { phase, befunde: phasenBefunde(phase, root) };
}

function gueltigerAuftrag(phasendatei, kennung, root) {
  const { phase, befunde } = gueltigePhase(phasendatei, root);
  if (befunde.length > 0) return { befunde };
  const auftrag = phase.auftraege.find(({ id }) => id === kennung);
  return auftrag ? { phase, auftrag, befunde } : { befunde: [`Die Phase hat keinen Auftrag ${kennung}.`] };
}

function meldeBefunde(befunde) {
  for (const befund of befunde) console.error(befund);
  return EXIT_ROT;
}

export function pruefe(phasendatei, root) {
  const { phase, befunde } = gueltigePhase(phasendatei, root);
  if (befunde.length > 0) {
    meldeBefunde(befunde);
    console.log(`rot: ${befunde.length} Befunde in ${phasendatei}.`);
    return EXIT_ROT;
  }
  console.log(`grün: ${phase.auftraege.length} Aufträge in ${phasendatei} sind vollständig.`);
  return EXIT_GRUEN;
}

export function rot(phasendatei, kennung, root) {
  const { auftrag, befunde } = gueltigerAuftrag(phasendatei, kennung, root);
  if (befunde.length > 0) return meldeBefunde(befunde);
  if (typeof auftrag.erwarteterFehler !== "string") {
    return meldeBefunde([`Auftrag ${kennung} ist ein Umbau und hat keinen roten Test.`]);
  }
  const lauf = fuehreAus("abnahme", abnahmeBefehl(auftrag), { cwd: root, env });
  console.log(gekuerzteTestausgabe(lauf.ausgabe));
  const urteil = rotUrteil(lauf, auftrag.erwarteterFehler);
  console.log(urteil.zeile);
  return urteil.rot ? EXIT_GRUEN : EXIT_ROT;
}

export function grenzen(phasendatei, kennung, { rolle, basis, root }) {
  const { auftrag, befunde } = gueltigerAuftrag(phasendatei, kennung, root);
  if (befunde.length > 0) return meldeBefunde(befunde);
  const aenderungen = aenderungenSeit(basis, root);
  const kontext = { auftrag, rolle, muster: geschuetzteMuster(root) };
  const { verstoesse, hinweise, produktzeilen } = grenzBefunde(kontext, aenderungen);
  for (const zeile of [...verstoesse, ...hinweise]) console.log(zeile);
  const urteil = verstoesse.length === 0 ? "grün" : "rot";
  console.log(
    `${urteil}: ${aenderungen.length} Dateien geändert, ${produktzeilen} Zeilen Produktcode, Rolle ${rolle}.`,
  );
  return verstoesse.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}
