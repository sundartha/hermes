import { readFileSync } from "node:fs";

import { MATRIX_HOECHSTENS, nachOrt } from "./teile.mjs";

const MUTANTEN_JE_TEIL = 15;
const WEITERES_STUECK = 2;

const offen = [];
const verschoben = [];
const zustand = { verschiebt: false, nurDiese: null };

export function verschiebeZeitgrenzenMutanten() {
  zustand.verschiebt = true;
}

export function misstNurDiese(einheiten) {
  zustand.nurDiese = new Set(einheiten.flatMap(({ mutanten }) => mutanten.map(({ schluessel }) => schluessel)));
}

export function nachlaufMutanten() {
  return zustand.nurDiese;
}

export function verschiebt(zeitueber) {
  if (!zustand.verschiebt) return false;
  offen.push(...zeitueber);
  return true;
}

export function offenVerschoben() {
  return offen;
}

export function schliesseEinheitAb({ pruefung, datei, anteil, von }) {
  const mutanten = offen.splice(0).map(({ schluessel, lage }) => ({ schluessel, lage }));
  if (mutanten.length > 0) verschoben.push({ pruefung, datei, anteil, von, mutanten });
}

export function verschobeneEinheiten() {
  return verschoben;
}

function einheitenAus(berichte) {
  const einheiten = new Map();
  const reihenfolge = [...berichte].sort((links, rechts) => links.teil - rechts.teil);
  for (const { pruefung, datei, anteil, von, mutanten } of reihenfolge.flatMap((bericht) => bericht.verschoben ?? [])) {
    const schluessel = JSON.stringify([pruefung, datei, anteil, von]);
    const einheit = einheiten.get(schluessel) ?? { pruefung, datei, anteil, von, stueck: WEITERES_STUECK, stuecke: WEITERES_STUECK, mutanten: new Map() };
    for (const mutant of mutanten) einheit.mutanten.set(mutant.schluessel, mutant);
    einheiten.set(schluessel, einheit);
  }
  return [...einheiten.values()].map((einheit) => ({ ...einheit, mutanten: [...einheit.mutanten.values()] }));
}

function gepackt(orte, grenze) {
  const teile = [];
  for (const ort of orte) {
    const letzter = teile.at(-1);
    if (letzter !== undefined && letzter.summe + ort.mutanten.length <= grenze) {
      letzter.summe += ort.mutanten.length;
      letzter.orte.push(ort);
    } else {
      teile.push({ summe: ort.mutanten.length, orte: [ort] });
    }
  }
  return teile;
}

function einheitenDes({ orte }) {
  const einheiten = new Map();
  for (const { einheit, mutanten } of orte) einheiten.set(einheit, [...(einheiten.get(einheit) ?? []), ...mutanten]);
  return [...einheiten].map(([einheit, mutanten]) => ({ ...einheit, mutanten }));
}

export function nachlaufplan(berichte) {
  const orte = einheitenAus(berichte).flatMap((einheit) => nachOrt(einheit.mutanten).map((mutanten) => ({ einheit, mutanten })));
  const gesamt = orte.reduce((summe, { mutanten }) => summe + mutanten.length, 0);
  const teile = gepackt(orte, Math.max(MUTANTEN_JE_TEIL, Math.ceil(gesamt / MATRIX_HOECHSTENS)));
  const vorne = berichte[0]?.teile ?? 0;
  return { nummern: teile.map((_teil, index) => vorne + index + 1), einheiten: teile.map(einheitenDes) };
}

function messstelle({ pruefung, schluessel, anteil, von }) {
  return JSON.stringify([pruefung, schluessel, anteil, von]);
}

function gemesseneStellen(berichte) {
  const stellen = new Set();
  for (const { pruefung, ergebnisse } of berichte.flatMap(({ messungen }) => messungen)) {
    for (const { schluessel, messanteil: [anteil, von] = [] } of ergebnisse) stellen.add(messstelle({ pruefung, schluessel, anteil, von }));
  }
  return stellen;
}

export function ohneErgebnis(berichte) {
  const einheiten = einheitenAus(berichte);
  if (einheiten.length === 0) return [];
  const gemessen = gemesseneStellen(berichte);
  return einheiten.flatMap(({ pruefung, anteil, von, mutanten }) =>
    mutanten.map(({ schluessel }) => schluessel).filter((schluessel) => !gemessen.has(messstelle({ pruefung, schluessel, anteil, von }))),
  );
}

export function nachlaufTeil({ teil, teile }, anzahl, pfad) {
  const { nummern, einheiten } = JSON.parse(readFileSync(pfad, "utf8"));
  if (Number(teile) !== anzahl) throw new Error(`der Plan hat ${anzahl} Teile, aufgerufen mit --teile ${teile}`);
  const stelle = nummern.indexOf(Number(teil));
  if (stelle === -1) throw new Error(`Teil ${teil} gibt es im Nachlauf nicht`);
  return { nummer: Number(teil), eigene: einheiten[stelle] };
}
