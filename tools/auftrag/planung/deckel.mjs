import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BELEGE } from "../bericht.mjs";
import { kostenDerSitzung } from "../kosten.mjs";
import { istObjekt } from "./erkundung.mjs";

const PLANUNGSBERICHT = "planung.json";
const TOKEN = /^[1-9]\d*$/;

export function deckelAus(angabe) {
  if (angabe === undefined) return { deckel: null };
  return TOKEN.test(angabe) ? { deckel: Number(angabe) } : { fehler: `--deckel braucht eine ganze Zahl Token über 0, nicht ${angabe}` };
}

function vorigeKosten(root, phase) {
  try {
    const kosten = JSON.parse(readFileSync(join(root, BELEGE, phase, PLANUNGSBERICHT), "utf8")).kostenJeLauf;
    return istObjekt(kosten) ? kosten : {};
  } catch {
    return {};
  }
}

function mittel(eintrag) {
  return Number.isInteger(eintrag?.laeufe) && eintrag.laeufe > 0 && Number.isFinite(eintrag.token) ? eintrag.token / eintrag.laeufe : 0;
}

export function gemesseneKosten(root, beteiligte) {
  const sitzungen = new Set(beteiligte.map(({ sitzung }) => sitzung).filter((sitzung) => sitzung !== undefined));
  return [...sitzungen].reduce((summe, sitzung) => summe + kostenDerSitzung(root, { sitzung }).gesamt, 0);
}

export class Kostendeckel {
  constructor(root, phase, deckel) {
    this.deckel = deckel;
    this.vorige = vorigeKosten(root, phase);
    this.jeLauf = {};
    this.stand = {};
  }

  vorschau(rollen) {
    return Math.round(rollen.reduce((summe, rolle) => summe + mittel(this.jeLauf[rolle] ?? this.vorige[rolle]), 0));
  }

  ueber(gemessen, rollen) {
    const vorschau = this.vorschau(rollen);
    if (gemessen + vorschau <= this.deckel) return null;
    this.stand = { gemessen, vorschau };
    return `Deckel ${this.deckel} Token: gemessen ${gemessen}, mit der Vorschau ${vorschau} für ${rollen.length} Läufe (${[...new Set(rollen)].join(", ")}) wären es ${gemessen + vorschau}; plane hält vor dieser Welle an und wartet auf eine Entscheidung`;
  }

  verbuche(rollen, token) {
    for (const rolle of rollen) {
      const bisher = this.jeLauf[rolle] ?? { laeufe: 0, token: 0 };
      this.jeLauf[rolle] = { laeufe: bisher.laeufe + 1, token: bisher.token + token / rollen.length };
    }
  }

  bericht() {
    return { deckel: { deckel: this.deckel, ...this.stand }, kostenJeLauf: { ...this.vorige, ...this.jeLauf } };
  }
}
