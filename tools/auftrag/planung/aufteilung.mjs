import { liste } from "./erkundung.mjs";

const TRENNER = ":";
const NUMMER_AN = new Map([["weg", 0], ["b-nummer", 0], ["ausweg", 0], ["falsche-angabe", 1]]);
const JE_AUFTRAG = new Set(["nie-saetze", "bereichsgrund", "allein-gruen"]);
const KETTE = "allein-gruen";

class Gruppen {
  constructor(schnitt, gruppen) {
    this.gruppen = gruppen;
    this.auftraege = new Map(liste(schnitt?.auftraege).map((auftrag) => [auftrag?.id, auftrag]));
  }

  derNummer(nummer) {
    const stelle = this.gruppen.findIndex((gruppe) => liste(gruppe?.nummern).includes(nummer));
    return stelle === -1 ? null : stelle;
  }

  auftrag(id) {
    return this.auftraege.get(id) ?? {};
  }

  desAuftrags(id) {
    return new Set(liste(this.auftrag(id).prueft).map((nummer) => this.derNummer(nummer)));
  }

  vorgaenger(id) {
    const gesehen = new Set();
    const offen = [id];
    while (offen.length > 0) {
      const auftrag = this.auftrag(offen.pop());
      const naechste = liste(auftrag.abhaengigVon).map((eintrag) => eintrag?.id).filter((kennung) => !gesehen.has(kennung));
      for (const kennung of naechste) gesehen.add(kennung);
      offen.push(...naechste);
    }
    return gesehen;
  }

  einzige(id) {
    const gruppen = this.desAuftrags(id);
    return gruppen.size === 1 ? [...gruppen][0] : null;
  }

  ausKette(id, gruppe) {
    const fremd = [...this.vorgaenger(id)].some((kennung) => [...this.desAuftrags(kennung)].some((andere) => andere !== gruppe));
    return fremd ? null : gruppe;
  }

  desSchluessels(schluessel) {
    const [regel, ...teile] = schluessel.split(TRENNER);
    if (NUMMER_AN.has(regel)) return this.derNummer(teile[NUMMER_AN.get(regel)]);
    if (!JE_AUFTRAG.has(regel)) return null;
    const gruppe = this.einzige(teile[0]);
    return regel === KETTE && gruppe !== null ? this.ausKette(teile[0], gruppe) : gruppe;
  }
}

export function teilePruefliste(schluessel, schnitt, gruppen) {
  const zuordnung = new Gruppen(schnitt, gruppen);
  const teile = [...gruppen.map((_gruppe, stelle) => ({ gruppe: stelle, schluessel: [] })), { gruppe: null, schluessel: [] }];
  for (const eintrag of schluessel) teile.at(zuordnung.desSchluessels(eintrag) ?? -1).schluessel.push(eintrag);
  return teile.filter((teil) => teil.schluessel.length > 0);
}
