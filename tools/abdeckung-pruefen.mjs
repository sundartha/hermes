import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { PITCH, SICHERHEIT, gleicherText, nummernImOrdner } from "./auftrag/planung/nummern.mjs";

const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_AUFRUF = 2;
const ERSTES_EIGENES_ARGUMENT = 2;
const AUFRUF_HINWEIS = "Aufruf: node tools/abdeckung-pruefen.mjs plaene/P-<Nummer>-<kurzname>/";
const PHASE = "phase.json";

function auftraegeMitNummern(phase) {
  const auftraege = Array.isArray(phase.auftraege) ? phase.auftraege : [];
  return auftraege.filter((auftrag) => Array.isArray(auftrag?.prueft));
}

function zuordnung(auftraege) {
  const besitzer = new Map();
  for (const auftrag of auftraege) {
    for (const nummer of new Set(auftrag.prueft)) besitzer.set(nummer, [...(besitzer.get(nummer) ?? []), auftrag.id]);
  }
  return besitzer;
}

function abdeckungBefunde(soll, besitzer) {
  const befunde = [];
  for (const nummer of soll.keys()) {
    const kennungen = besitzer.get(nummer) ?? [];
    if (kennungen.length === 0) befunde.push(`${nummer} gehört keinem Auftrag`);
    if (kennungen.length > 1) befunde.push(`${nummer} gehört mehreren Aufträgen: ${kennungen.join(", ")}`);
  }
  return befunde;
}

function nummerBefund(auftrag, nummer, { soll, andererAusgang }) {
  const erwartet = soll.get(nummer);
  if (andererAusgang.has(nummer)) return `${auftrag.id}: ${nummer} hat in ${SICHERHEIT} nicht den Ausgang „verhindern“ und gehört keinem Auftrag`;
  if (erwartet === undefined) return `${auftrag.id}: ${nummer} steht weder in ${PITCH} noch unter „2. Angriffswege“ in ${SICHERHEIT}`;
  if (gleicherText(auftrag.szenarien?.[nummer]) === gleicherText(erwartet.text)) return null;
  return `${auftrag.id}: szenarien["${nummer}"] ist nicht wörtlich der Text aus ${erwartet.quelle}: ${gleicherText(erwartet.text)}`;
}

function auftragBefunde(auftraege, dokumente) {
  return auftraege.flatMap((auftrag) => auftrag.prueft.map((nummer) => nummerBefund(auftrag, nummer, dokumente))).filter((befund) => befund !== null);
}

function befundeImOrdner(ordner, phase) {
  const dokumente = nummernImOrdner(ordner);
  const auftraege = auftraegeMitNummern(phase);
  const name = basename(resolve(ordner));
  const kennung = phase.phase === name ? [] : [`phase muss ${name} heißen wie der Ordner, nicht ${JSON.stringify(phase.phase)}`];
  return { anzahl: dokumente.soll.size, befunde: [...kennung, ...dokumente.unklar, ...abdeckungBefunde(dokumente.soll, zuordnung(auftraege)), ...auftragBefunde(auftraege, dokumente)] };
}

function ladePhase(ordner) {
  try {
    return { phase: JSON.parse(readFileSync(join(ordner, PHASE), "utf8")) };
  } catch (fehler) {
    return { befunde: [`${PHASE} ist nicht lesbar: ${fehler.message}`] };
  }
}

function pruefe(argumente) {
  if (argumente.length !== 1) {
    console.error(AUFRUF_HINWEIS);
    return EXIT_AUFRUF;
  }
  const [ordner] = argumente;
  const fehlend = [PITCH, SICHERHEIT, PHASE].filter((datei) => !existsSync(join(ordner, datei)));
  if (fehlend.length > 0) {
    console.error(`Im Ordner ${ordner} fehlt: ${fehlend.join(", ")}\n${AUFRUF_HINWEIS}`);
    return EXIT_AUFRUF;
  }
  const geladen = ladePhase(ordner);
  const { anzahl, befunde } = geladen.phase ? befundeImOrdner(ordner, geladen.phase) : { anzahl: 0, befunde: geladen.befunde };
  for (const befund of befunde) console.error(befund);
  if (befunde.length > 0) {
    console.log(`rot: ${befunde.length} Befunde in ${ordner}.`);
    return EXIT_ROT;
  }
  console.log(`grün: ${anzahl} Nummern in ${ordner} gehören je genau einem Auftrag.`);
  return EXIT_GRUEN;
}

process.exitCode = pruefe(process.argv.slice(ERSTES_EIGENES_ARGUMENT));
