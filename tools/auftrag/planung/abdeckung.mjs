import { basename, resolve } from "node:path";

import { istUmbau } from "../format.mjs";
import { liste } from "./erkundung.mjs";
import { PITCH, SICHERHEIT, gleicherText, nummernImOrdner } from "./nummern.mjs";

function auftraegeMitNummern(phase) {
  return liste(phase.auftraege).filter((auftrag) => Array.isArray(auftrag?.prueft));
}

export function nurUmbauBefunde(auftraege, nurUmbau) {
  if (!nurUmbau) return [];
  return auftraege.filter((auftrag) => !istUmbau(auftrag ?? {})).map((auftrag) => `Pitch ohne Szenarien erlaubt nur Umbauten: ${auftrag?.id}`);
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

export function befundeImOrdner(ordner, phase) {
  const dokumente = nummernImOrdner(ordner);
  const auftraege = auftraegeMitNummern(phase);
  const name = basename(resolve(ordner));
  const kennung = phase.phase === name ? [] : [`phase muss ${name} heißen wie der Ordner, nicht ${JSON.stringify(phase.phase)}`];
  return { anzahl: dokumente.soll.size, befunde: [...kennung, ...dokumente.unklar, ...nurUmbauBefunde(liste(phase.auftraege), dokumente.nurUmbau), ...abdeckungBefunde(dokumente.soll, zuordnung(auftraege)), ...auftragBefunde(auftraege, dokumente)] };
}
