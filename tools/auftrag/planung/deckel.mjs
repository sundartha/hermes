import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BELEGE } from "../bericht.mjs";
import { kostenDesAuftrags } from "../kosten.mjs";
import { istObjekt } from "./erkundung.mjs";
import { ganzeZahl, zahlZeile } from "./kopfzeile.mjs";

const PLANUNGSBERICHT = "planung.json";
const FREIGABE_ZEILE = "Planung freigegeben: <Zahl> Token";

function freigabeAusPitch(pitch) {
  const gefunden = zahlZeile(pitch, { name: "Planung freigegeben", einheit: "Token" });
  if (gefunden === undefined) return { fehler: `pitch.md hat keine Zeile „${FREIGABE_ZEILE}“ und --deckel fehlt; ohne freigegebene Token-Menge plant plane nicht` };
  return gefunden.zahl === undefined ? { fehler: `pitch.md: die Zeile „${gefunden.zeile.trim()}“ braucht die Form „${FREIGABE_ZEILE}“ mit einer ganzen Zahl über 0` } : { deckel: gefunden.zahl };
}

export function deckelAus(angabe, pitch) {
  if (angabe === undefined) return freigabeAusPitch(pitch);
  const deckel = ganzeZahl(angabe);
  return deckel === undefined ? { fehler: `--deckel braucht eine ganze Zahl Token über 0, nicht ${angabe}` } : { deckel };
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
    this.offen = new Map();
    this.halt = null;
    this.schritt = null;
  }

  mittelJeLauf(rolle, gemessen) {
    if (this.jeLauf[rolle] !== undefined) return mittel(this.jeLauf[rolle]);
    const bekannt = [this.vorige[rolle], gemessen].filter(istLauf);
    return bekannt.length > 0 ? Math.max(...bekannt.map(mittel)) : Math.max(0, ...Object.values(this.jeLauf).map(mittel));
  }

  vorschau(rollen, gemessenJeRolle = {}) {
    return Math.round(rollen.reduce((summe, rolle) => summe + this.mittelJeLauf(rolle, gemessenJeRolle[rolle]), 0));
  }

  haelt({ gemessen, vorschau }, schritt) {
    if (gemessen + vorschau <= this.deckel) return false;
    this.stand = { gemessen, vorschau };
    this.schritt = schritt;
    return true;
  }

  ueber({ gemessen, jeRolle }, rollen, schritt) {
    const vorschau = this.vorschau(rollen, jeRolle);
    if (!this.haelt({ gemessen, vorschau }, schritt)) {
      this.offen = new Map(rollen.map((rolle, stelle) => [stelle, this.mittelJeLauf(rolle, jeRolle[rolle])]));
      return null;
    }
    return `Deckel ${this.deckel} Token: gemessen ${gemessen}, mit der Vorschau ${vorschau} für ${rollen.length} Läufe (${[...new Set(rollen)].join(", ")}) wären es ${gemessen + vorschau}; plane hält vor dem Schritt „${schritt}“ an und wartet auf eine Entscheidung`;
  }

  imLauf(stelle, { gemessen, jeRolle }, { rolle, schritt }) {
    if (this.halt !== null) return this.halt;
    const eigener = this.mittelJeLauf(rolle, jeRolle[rolle]);
    const andere = [...this.offen].reduce((summe, [lauf, betrag]) => (lauf === stelle ? summe : summe + betrag), 0);
    const vorschau = Math.round(andere + eigener);
    if (!this.haelt({ gemessen, vorschau }, schritt)) {
      this.offen.set(stelle, eigener);
      return null;
    }
    this.halt = `Deckel ${this.deckel} Token: gemessen ${gemessen}, mit der Vorschau ${vorschau} für die offenen Schritte dieser Welle wären es ${gemessen + vorschau}; plane startet den Schritt „${schritt}“ nicht, lässt die laufenden Antworten zu Ende laufen und wartet auf eine Entscheidung`;
    return this.halt;
  }

  endeLauf(stelle) {
    this.offen.delete(stelle);
  }

  verbuche(rollen, token) {
    for (const rolle of rollen) {
      const bisher = this.jeLauf[rolle] ?? { laeufe: 0, token: 0 };
      this.jeLauf[rolle] = { laeufe: bisher.laeufe + 1, token: bisher.token + token / rollen.length };
    }
  }

  bericht() {
    const schritt = this.schritt === null ? {} : { deckelSchritt: this.schritt };
    return { deckel: { deckel: this.deckel, ...this.stand }, ...schritt, kostenJeLauf: { ...this.vorige, ...this.jeLauf } };
  }
}
