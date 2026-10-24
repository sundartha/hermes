import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BELEGE } from "../bericht.mjs";
import { gemeinsamerOrdner } from "../git.mjs";
import { kostenDesAuftrags } from "../kosten.mjs";
import { istObjekt, schreibeJsonAtomar } from "./erkundung.mjs";
import { ganzeZahl, zahlZeile } from "./kopfzeile.mjs";
import { werkzeugeDerRolle } from "./team.mjs";

const PLANUNGSBERICHT = "planung.json";
const FREIGABE_ZEILE = "Planung freigegeben: <Zahl> Token";
export const TEIL_DECKEL = 3_000_000;

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

const TOPF_BUCH = "hermes-topf";
const LAUF_ENDUNG = ".json";
const ENTWURF = ".entwurf";
const EIGENER_LAUF = { datei: null };

export function topfBuch(root, eltern) {
  return gemeinsamerOrdner(root, TOPF_BUCH, eltern);
}

function liesLauf(datei) {
  try {
    return JSON.parse(readFileSync(datei, "utf8"));
  } catch (fehler) {
    return fehler.code === "ENOENT" ? null : {};
  }
}

function laeufe(buch) {
  if (!existsSync(buch)) return [];
  const namen = readdirSync(buch).filter((name) => name.endsWith(LAUF_ENDUNG) && !name.startsWith("."));
  return namen.map((name) => ({ name, lauf: liesLauf(join(buch, name)) })).filter(({ lauf }) => lauf !== null).map(({ name, lauf }) => ({ name, ...lauf }));
}

function laufKosten({ token, deckel }) {
  if (Number.isFinite(token)) return token;
  return Number.isFinite(deckel) ? deckel : null;
}

export function restTopf(buch, { freigabe, vorschnitt, ohne }) {
  const andere = laeufe(buch).filter(({ name }) => name !== ohne);
  const offen = andere.filter((lauf) => laufKosten(lauf) === null).map(({ name }) => join(buch, name));
  if (offen.length > 0) return { fehler: `Rest-Topf nicht messbar: ${offen.join(", ")} nennt weder Verbrauch noch Deckel; plane hält an, statt zu schätzen` };
  const verbraucht = andere.reduce((summe, lauf) => summe + laufKosten(lauf), 0);
  const rest = freigabe - vorschnitt - verbraucht;
  const topf = { freigabe, vorschnitt, teile: verbraucht, rest, teilDeckel: Math.max(0, Math.min(TEIL_DECKEL, rest)) };
  return { topf, rechnung: `Freigabe ${freigabe} − Vorschnitt ${vorschnitt} − Teile ${verbraucht} = ${rest}` };
}

export function reserviere(buch, { teil, deckel, worktree }) {
  mkdirSync(buch, { recursive: true });
  const name = `${teil}-${Date.now()}-${process.pid}${LAUF_ENDUNG}`;
  const entwurf = join(buch, `.${name}${ENTWURF}`);
  writeFileSync(entwurf, JSON.stringify({ teil, beginn: new Date().toISOString(), deckel, worktree }));
  linkSync(entwurf, join(buch, name));
  unlinkSync(entwurf);
  EIGENER_LAUF.datei = join(buch, name);
  return name;
}

export function setzeReservierung(deckel) {
  schreibeJsonAtomar(EIGENER_LAUF.datei, { ...liesLauf(EIGENER_LAUF.datei), deckel });
}

export function gibReservierungFrei() {
  unlinkSync(EIGENER_LAUF.datei);
  EIGENER_LAUF.datei = null;
}

export function verbucheLauf(root, beteiligte) {
  if (EIGENER_LAUF.datei === null) return;
  schreibeJsonAtomar(EIGENER_LAUF.datei, { ...liesLauf(EIGENER_LAUF.datei), token: gemesseneKosten(root, beteiligte) });
}

export class Kostendeckel {
  constructor(root, phase, deckel) {
    this.root = root;
    this.deckel = deckel;
    this.werkzeuge = {};
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
    if (bekannt.length > 0) return Math.max(...bekannt.map(mittel));
    const gemesseneRollen = Object.keys(this.jeLauf);
    const gleicheWerkzeuge = gemesseneRollen.filter((andere) => this.ausstattung(andere) === this.ausstattung(rolle));
    return this.hoechstesMittel(gleicheWerkzeuge.length > 0 ? gleicheWerkzeuge : gemesseneRollen);
  }

  hoechstesMittel(rollen) {
    return Math.max(0, ...rollen.map((rolle) => mittel(this.jeLauf[rolle])));
  }

  ausstattung(rolle) {
    this.werkzeuge[rolle] ??= werkzeugeDerRolle(this.root, rolle).toSorted().join(",");
    return this.werkzeuge[rolle];
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
