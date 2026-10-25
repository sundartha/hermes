import { createHash } from "node:crypto";
import { join } from "node:path";

import { codeAuszug } from "./auszug.mjs";
import { istObjekt, istText, liste } from "./erkundung.mjs";
import { jsonAus } from "./fingerabdruck.mjs";

const WEG = "weg:";
const ERFUELLT = "erfüllt";

function wegSumme(planung, nummer, angaben) {
  const teile = [angaben, codeAuszug(planung.root, [{ nummern: { [nummer]: angaben } }]), planung.designTeile([nummer])];
  return createHash("sha256").update(JSON.stringify(teile)).digest("hex");
}

function heutigeSumme(planung, nummer) {
  const bericht = planung.berichte.find((eintrag) => istObjekt(eintrag?.nummern) && Object.hasOwn(eintrag.nummern, nummer));
  return bericht === undefined ? null : wegSumme(planung, nummer, bericht.nummern[nummer]);
}

function abgenommeneZeile(pruefliste, nummer) {
  const zeile = liste(pruefliste).find((eintrag) => istObjekt(eintrag) && eintrag.schluessel === `${WEG}${nummer}`);
  return zeile?.ergebnis === ERFUELLT && istText(zeile.fundstelle) ? zeile : undefined;
}

export function abgelegteListe(planung, datei) {
  return liste(jsonAus(join(planung.ablage, datei)));
}

export function verbuchteAbnahmen(planung, { nummern, bericht, offen }) {
  const bleibende = liste(planung.wegAbnahmen).filter(({ nummer }) => !nummern.includes(nummer));
  if (offen.length > 0 || !istObjekt(planung.stand)) return bleibende;
  const [erste] = nummern;
  const { pruefliste } = jsonAus(join(planung.ablage, `wegpruefung-${erste}-${planung.wegZaehler.get(erste)}.json`)) ?? {};
  const neue = nummern.flatMap((nummer) => {
    const zeile = abgenommeneZeile(pruefliste, nummer);
    if (zeile === undefined || !Object.hasOwn(bericht.nummern, nummer)) return [];
    return [{ nummer, summe: wegSumme(planung, nummer, bericht.nummern[nummer]), werkzeug: planung.stand.werkzeugBaum, zeile }];
  });
  return [...bleibende, ...neue];
}

function gilt(planung, abnahme) {
  if (!istObjekt(planung.stand) || !istObjekt(abnahme) || !istText(abnahme.summe) || !Object.hasOwn(abnahme, "werkzeug") || !istObjekt(abnahme.zeile)) return false;
  const werkzeug = planung.stand.werkzeugBaum;
  return (istText(werkzeug) || werkzeug === null) && abnahme.werkzeug === werkzeug && abnahme.summe === heutigeSumme(planung, abnahme.nummer);
}

export function uebernommeneWege(planung, schluessel) {
  const abnahmen = new Map(liste(planung.wegAbnahmen).filter((abnahme) => gilt(planung, abnahme)).map((abnahme) => [`${WEG}${abnahme.nummer}`, abnahme.zeile]));
  const zeilen = schluessel.filter((eintrag) => abnahmen.has(eintrag)).map((eintrag) => abnahmen.get(eintrag));
  return { rest: schluessel.filter((eintrag) => !abnahmen.has(eintrag)), zeilen };
}
