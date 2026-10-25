import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BELEGE } from "../bericht.mjs";
import { gemeinsamerOrdner } from "../git.mjs";
import { kostenDesAuftrags } from "../kosten.mjs";
import { istObjekt, schreibeJsonAtomar } from "./erkundung.mjs";
import { gitLauf } from "./git.mjs";
import { ganzeZahl, zahlZeile } from "./kopfzeile.mjs";
import { werkzeugeDerRolle } from "./team.mjs";

const PLANUNGSBERICHT = "planung.json";
const PLANUNGSBERICHTE = /^planung(?:-[^/]+)?\.json$/u;
const JE_ROLLE = "je Rolle";
const ERKUNDER = "erkunder";
export const WEGPRUEFER = "wegpruefer";
const AGENT_DER_ROLLE = { [WEGPRUEFER]: "pruefer-planung" };
const WORKTREE = "worktree ";
const FREIGABE_ZEILE = "Planung freigegeben: <Zahl> Token";
export const TEIL_DECKEL = 3_000_000;
const FREIGABE = { name: "Planung freigegeben", einheit: "Token" };
const PROZENT = 100;

export function freigabeZeileFehlt(pitch) {
  return zahlZeile(pitch, FREIGABE) === undefined;
}

function freigabeAusPitch(pitch) {
  const gefunden = zahlZeile(pitch, FREIGABE);
  if (gefunden === undefined) return { fehler: `pitch.md hat keine Zeile „${FREIGABE_ZEILE}“ und --deckel fehlt; ohne freigegebene Token-Menge plant plane nicht` };
  return gefunden.zahl === undefined ? { fehler: `pitch.md: die Zeile „${gefunden.zeile.trim()}“ braucht die Form „${FREIGABE_ZEILE}“ mit einer ganzen Zahl über 0` } : { deckel: gefunden.zahl };
}

export function deckelAus(angabe, pitch) {
  if (angabe === undefined) return freigabeAusPitch(pitch);
  const deckel = ganzeZahl(angabe);
  return deckel === undefined ? { fehler: `--deckel braucht eine ganze Zahl Token über 0, nicht ${angabe}` } : { deckel };
}

function liesKosten(datei) {
  try {
    const bericht = JSON.parse(readFileSync(datei, "utf8"));
    return { kosten: istObjekt(bericht?.kostenJeLauf) ? bericht.kostenJeLauf : {}, jeRolle: bericht?.kostenGebucht === JE_ROLLE };
  } catch {
    return { kosten: {}, jeRolle: false };
  }
}

function vorigeKosten(root, phase) {
  return liesKosten(join(root, BELEGE, phase, PLANUNGSBERICHT));
}

function istLauf(eintrag) {
  return Number.isInteger(eintrag?.laeufe) && eintrag.laeufe > 0 && Number.isFinite(eintrag.token);
}

function mittel(eintrag) {
  return istLauf(eintrag) ? eintrag.token / eintrag.laeufe : 0;
}

function worktrees(root) {
  const zeilen = gitLauf(root, ["worktree", "list", "--porcelain"]).stdout.split("\n");
  return zeilen.filter((zeile) => zeile.startsWith(WORKTREE)).map((zeile) => zeile.slice(WORKTREE.length));
}

function berichteAndererPhasen(baum, phase) {
  const belege = join(baum, BELEGE);
  if (!existsSync(belege)) return [];
  const ordner = readdirSync(belege, { withFileTypes: true }).filter((eintrag) => eintrag.isDirectory() && eintrag.name !== phase);
  return ordner.flatMap(({ name }) => readdirSync(join(belege, name)).filter((datei) => PLANUNGSBERICHTE.test(datei)).map((datei) => join(belege, name, datei)));
}

function andereMittel(root, phase) {
  const hoechste = {};
  for (const datei of worktrees(root).flatMap((baum) => berichteAndererPhasen(baum, phase))) {
    const { kosten, jeRolle } = liesKosten(datei);
    const zaehlen = Object.entries(kosten).filter(([rolle, eintrag]) => istLauf(eintrag) && (jeRolle || rolle !== ERKUNDER));
    for (const [rolle, eintrag] of zaehlen) hoechste[rolle] = Math.max(hoechste[rolle] ?? 0, mittel(eintrag));
  }
  return hoechste;
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

function laufKosten({ token, deckel, weitergegeben }) {
  if (Number.isFinite(token)) return Math.max(token, Number.isFinite(weitergegeben) ? weitergegeben : 0);
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
  if (EIGENER_LAUF.datei === null) return;
  unlinkSync(EIGENER_LAUF.datei);
  EIGENER_LAUF.datei = null;
}

export function verbucheLauf(root, beteiligte, { weitergegeben = false } = {}) {
  if (EIGENER_LAUF.datei === null) return;
  const lauf = liesLauf(EIGENER_LAUF.datei);
  schreibeJsonAtomar(EIGENER_LAUF.datei, { ...lauf, token: gemesseneKosten(root, beteiligte), ...(weitergegeben && { weitergegeben: lauf.deckel }) });
}

function prozent(teil, ganzes) {
  return `${((teil * PROZENT) / ganzes).toFixed(1).replace(".", ",")} %`;
}

function vorBekanntem(links, rechts) {
  return rechts.mittel - links.mittel || Number(links.ganz) - Number(rechts.ganz);
}

function fertigeRollen(geplant, stelle) {
  return stelle?.abgebrochen.size > 0 ? geplant.filter((rolle) => stelle.fertig.has(rolle) && !stelle.abgebrochen.has(rolle)) : geplant;
}

export class Kostendeckel {
  constructor(root, phase, deckel) {
    this.root = root;
    this.deckel = deckel;
    this.werkzeuge = {};
    const vorige = vorigeKosten(root, phase);
    this.vorige = vorige.kosten;
    this.vorigeJeRolle = vorige.jeRolle;
    this.andere = andereMittel(root, phase);
    this.jeLauf = {};
    this.stand = {};
    this.offen = new Map();
    this.halt = null;
    this.schritt = null;
    this.zaehlung = null;
    this.stellen = new Map();
    this.liveAbbruch = null;
    this.wellen = [];
  }

  wert(rolle, gemessen) {
    if (this.jeLauf[rolle] !== undefined) return { mittel: mittel(this.jeLauf[rolle]), ganz: false };
    const vorige = istLauf(this.vorige[rolle]) ? [{ mittel: mittel(this.vorige[rolle]), ganz: rolle === ERKUNDER && !this.vorigeJeRolle }] : [];
    const dieserLauf = istLauf(gemessen) ? [{ mittel: mittel(gemessen), ganz: false }] : [];
    const andere = this.andere[rolle] === undefined ? [] : [{ mittel: this.andere[rolle], ganz: false }];
    return [...vorige, ...dieserLauf, ...andere].toSorted(vorBekanntem)[0];
  }

  mittelJeLauf(rolle, gemessen) {
    return this.wert(rolle, gemessen)?.mittel ?? this.ersatz(rolle);
  }

  ersatz(rolle) {
    if (rolle === WEGPRUEFER) {
      const erkunder = this.wert(ERKUNDER);
      return Math.max(this.mittelJeLauf(AGENT_DER_ROLLE[rolle]), erkunder === undefined || erkunder.ganz ? 0 : erkunder.mittel);
    }
    const gemesseneRollen = Object.keys(this.jeLauf);
    const gleicheWerkzeuge = gemesseneRollen.filter((andere) => this.ausstattung(andere) === this.ausstattung(rolle));
    return this.hoechstesMittel(gleicheWerkzeuge.length > 0 ? gleicheWerkzeuge : gemesseneRollen);
  }

  hoechstesMittel(rollen) {
    return Math.max(0, ...rollen.map((rolle) => mittel(this.jeLauf[rolle])));
  }

  ausstattung(rolle) {
    this.werkzeuge[rolle] ??= werkzeugeDerRolle(this.root, AGENT_DER_ROLLE[rolle] ?? rolle).toSorted().join(",");
    return this.werkzeuge[rolle];
  }

  imErkunderEnthalten(rollen, jeRolle) {
    if (!rollen.includes(ERKUNDER) || this.wert(WEGPRUEFER, jeRolle[WEGPRUEFER]) !== undefined) return false;
    return this.wert(ERKUNDER, jeRolle[ERKUNDER])?.ganz ?? true;
  }

  schrittVorschau(rollen, jeRolle) {
    const ohne = this.imErkunderEnthalten(rollen, jeRolle) ? WEGPRUEFER : null;
    return rollen.filter((rolle) => rolle !== ohne).reduce((summe, rolle) => summe + this.mittelJeLauf(rolle, jeRolle[rolle]), 0);
  }

  vorschau(schritte, jeRolle = {}) {
    return Math.round(schritte.reduce((summe, rollen) => summe + this.schrittVorschau(rollen, jeRolle), 0));
  }

  haelt({ gemessen, vorschau }, schritt) {
    if (gemessen + vorschau <= this.deckel) return false;
    this.stand = { gemessen, vorschau };
    this.schritt = schritt;
    return true;
  }

  ueber({ gemessen, jeRolle }, schritte, schritt) {
    const vorschau = this.vorschau(schritte, jeRolle);
    if (!this.haelt({ gemessen, vorschau }, schritt)) {
      this.offen = new Map(schritte.map((rollen, stelle) => [stelle, this.schrittVorschau(rollen, jeRolle)]));
      return null;
    }
    return `Deckel ${this.deckel} Token: gemessen ${gemessen}, mit der Vorschau ${vorschau} für ${schritte.length} Läufe (${[...new Set(schritte.flat())].join(", ")}) wären es ${gemessen + vorschau}; plane hält vor dem Schritt „${schritt}“ an und wartet auf eine Entscheidung`;
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

  halteUeberschreitungFest(gemessen, schritt) {
    if (gemessen <= this.deckel) return false;
    if (this.schritt === null) {
      this.stand = { gemessen };
      this.schritt = schritt;
    }
    this.stand = { ...this.stand, ueberschritten: gemessen - this.deckel };
    return true;
  }

  ueberschritten(gemessen, schritt) {
    if (!this.halteUeberschreitungFest(gemessen, schritt)) return null;
    const { ueberschritten } = this.stand;
    return `Deckel ${this.deckel} Token überschritten: gemessen ${gemessen}, ${ueberschritten} Token (${prozent(ueberschritten, this.deckel)}) über dem Deckel beim Schritt „${this.schritt}“; plane startet keinen Agenten mehr und wartet auf eine Entscheidung`;
  }

  endeLauf(stelle) {
    this.offen.delete(stelle);
  }

  wache({ stelle, rolle }) {
    return { an: (beende, wer) => this.an(stelle(), beende, rolle(wer)), melde: (lauf, groesse, zuvor) => this.melde(lauf, groesse, zuvor), ab: (lauf, abgebrochen) => this.ab(lauf, abgebrochen), gesperrt: () => this.gesperrt(), kostendeckel: this };
  }

  async gezaehlt({ gemessen, schritt }, arbeit) {
    this.beginneZaehlung(gemessen(), schritt);
    try {
      return await arbeit();
    } finally {
      this.beendeZaehlung(gemessen());
    }
  }

  beginneZaehlung(gemessen, schritt) {
    this.zaehlung = { grund: gemessen, schritt, live: 0, groesste: 0, laufend: new Map(), stellen: new Map(), abbruch: null };
  }

  an(stelle, beende, rolle) {
    if (this.zaehlung === null) return null;
    const lauf = { stelle, rolle, beende };
    this.zaehlung.laufend.set(lauf, null);
    return lauf;
  }

  ab(lauf, abgebrochen) {
    if (this.zaehlung === null || lauf === null) return;
    this.zaehlung.laufend.delete(lauf);
    const { stellen } = this.zaehlung;
    const stelle = stellen.get(lauf.stelle) ?? { fertig: new Set(), abgebrochen: new Set() };
    (abgebrochen ? stelle.abgebrochen : stelle.fertig).add(lauf.rolle);
    stellen.set(lauf.stelle, stelle);
  }

  gesperrt() {
    return this.zaehlung?.abbruch ?? null;
  }

  melde(lauf, groesse, zuvor) {
    const { zaehlung } = this;
    if (zaehlung === null) return;
    zaehlung.live += groesse - zuvor;
    zaehlung.groesste = Math.max(zaehlung.groesste, groesse);
    if (zaehlung.laufend.has(lauf)) zaehlung.laufend.set(lauf, groesse);
    if (zaehlung.abbruch === null) this.pruefeLive();
  }

  pruefeLive() {
    const { zaehlung } = this;
    const { grund, live, schritt, laufend, groesste } = zaehlung;
    const vorhalt = [...laufend.values()].reduce((summe, letzte) => summe + (letzte ?? groesste), 0);
    if (grund + live + vorhalt <= this.deckel) return;
    zaehlung.abbruch = `Deckel ${this.deckel} Token: gemessen ${grund}, live ${live}, Vorhalt ${vorhalt}, zusammen ${grund + live + vorhalt}; plane bricht die laufenden Agenten beim Schritt „${schritt}“ ab und wartet auf eine Entscheidung`;
    this.halt = this.halt === null ? zaehlung.abbruch : `${this.halt}; ${zaehlung.abbruch}`;
    this.liveAbbruch ??= zaehlung.abbruch;
    if (this.schritt === null) {
      this.stand = { gemessen: grund, live, vorhalt };
      this.schritt = schritt;
    }
    for (const { beende } of laufend.keys()) beende(zaehlung.abbruch);
  }

  beendeZaehlung(gemessen) {
    const { grund, live, schritt, stellen } = this.zaehlung;
    this.wellen.push({ schritt, live, gemessen: gemessen - grund });
    this.stellen = stellen;
    this.zaehlung = null;
  }

  verbuche(schritte, kosten) {
    const rollen = schritte.flatMap((geplant, stelle) => fertigeRollen(geplant, this.stellen.get(stelle)));
    const vorkommen = Map.groupBy(rollen, (rolle) => rolle);
    const eigene = [...vorkommen.keys()].reduce((summe, rolle) => summe + (kosten[rolle] ?? 0), 0);
    const rest = Object.values(kosten).reduce((summe, token) => summe + token, 0) - eigene;
    for (const [rolle, { length: laeufe }] of vorkommen) {
      const bisher = this.jeLauf[rolle] ?? { laeufe: 0, token: 0 };
      this.jeLauf[rolle] = { laeufe: bisher.laeufe + laeufe, token: bisher.token + (kosten[rolle] ?? 0) + (rest * laeufe) / rollen.length };
    }
  }

  bericht() {
    const schritt = this.schritt === null ? {} : { deckelSchritt: this.schritt };
    const ohneKennzeichnung = !this.vorigeJeRolle && this.vorige[ERKUNDER] !== undefined && this.jeLauf[ERKUNDER] === undefined;
    return { deckel: { deckel: this.deckel, ...this.stand }, ...schritt, wellen: this.wellen, kostenJeLauf: { ...this.vorige, ...this.jeLauf }, ...(!ohneKennzeichnung && { kostenGebucht: JE_ROLLE }) };
  }
}
