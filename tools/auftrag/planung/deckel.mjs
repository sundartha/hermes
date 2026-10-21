import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BELEGE } from "../bericht.mjs";
import { kostenDesAuftrags } from "../kosten.mjs";
import { istObjekt } from "./erkundung.mjs";

const PLANUNGSBERICHT = "planung.json";
const TOKEN = /^[1-9]\d*$/;
const FREIGABE_ZEILE = "Planung freigegeben: <Zahl> Token";
const FREIGABE = /^Planung freigegeben:(.*)$/m;
const FREIGABE_WERT = /^ ([1-9]\d*) Token\s*$/;

function freigabeAusPitch(pitch) {
  const zeile = FREIGABE.exec(pitch);
  if (zeile === null) return { fehler: `pitch.md hat keine Zeile „${FREIGABE_ZEILE}“ und --deckel fehlt; ohne freigegebene Token-Menge plant plane nicht` };
  const wert = FREIGABE_WERT.exec(zeile[1]);
  return wert === null ? { fehler: `pitch.md: die Zeile „${zeile[0].trim()}“ braucht die Form „${FREIGABE_ZEILE}“ mit einer ganzen Zahl über 0` } : { deckel: Number(wert[1]) };
}

export function deckelAus(angabe, pitch) {
  if (angabe === undefined) return freigabeAusPitch(pitch);
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

function istLauf(eintrag) {
  return Number.isInteger(eintrag?.laeufe) && eintrag.laeufe > 0 && Number.isFinite(eintrag.token);
}

function mittel(eintrag) {
  return istLauf(eintrag) ? eintrag.token / eintrag.laeufe : 0;
}

export function gemesseneKosten(root, beteiligte) {
  return kostenDesAuftrags(root, beteiligte.filter(({ sitzung }) => sitzung !== undefined)).summe.gesamt;
}

export function gemesseneLaeufe(root, sitzungen) {
  const { sitzungen: gemessen, summe } = kostenDesAuftrags(root, sitzungen);
  return { laeufe: gemessen.length, token: summe.gesamt };
}

export class Kostendeckel {
  constructor(root, phase, deckel) {
    this.deckel = deckel;
    this.vorige = vorigeKosten(root, phase);
    this.jeLauf = {};
    this.stand = {};
  }

  mittelJeLauf(rolle, gemessen) {
    if (this.jeLauf[rolle] !== undefined) return mittel(this.jeLauf[rolle]);
    const bekannt = [this.vorige[rolle], gemessen].filter(istLauf);
    return bekannt.length > 0 ? Math.max(...bekannt.map(mittel)) : Math.max(0, ...Object.values(this.jeLauf).map(mittel));
  }

  vorschau(rollen, gemessenJeRolle = {}) {
    return Math.round(rollen.reduce((summe, rolle) => summe + this.mittelJeLauf(rolle, gemessenJeRolle[rolle]), 0));
  }

  ueber(gemessen, rollen, gemessenJeRolle) {
    const vorschau = this.vorschau(rollen, gemessenJeRolle);
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
