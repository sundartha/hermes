import { existsSync, readFileSync } from "node:fs";
import { cwd } from "node:process";

import { geaenderteFaelle } from "../auftrag/faelle.mjs";
import { muster } from "../tests-ausmisten/ausnehmen.mjs";
import {
  ALTER_SCHUTZ,
  ALTER_SCHUTZ_NICHT_BELEGT,
  ALTER_SCHUTZ_UNGEPRUEFT,
  alterSchutzBeleg,
  freigabeImIssue,
  freigegebenZeile,
  nichtPruefbarZeile,
  nurSchutzRot,
  satzNummer,
  SCHUTZFAELLE_MUSTER,
  SCHUTZ_NICHT_PRUEFBAR,
  SCHUTZ_UNERREICHT,
  SCHUTZ_WIRKSAM,
  SCHUTZ_WIRKUNGSLOS,
  schutzZusammenfassung,
  wartetZeile,
} from "../auftrag/schutzkennung.mjs";

const GETOETET = new Set(["Killed", "Timeout"]);
const GELAUFEN_UEBERLEBT = "Survived";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const VERSTOSS = "Verstoß: ";
const WIRKUNGSLOS = `${VERSTOSS}${SCHUTZ_WIRKUNGSLOS}`;
const NICHT_BELEGT = `${VERSTOSS}${ALTER_SCHUTZ_NICHT_BELEGT}`;
const UNGEPRUEFT = `Hinweis: ${ALTER_SCHUTZ_UNGEPRUEFT}, kein wirkungsloser Schutztest mit dieser Kennung`;

const KENNUNG_IM_TEXT = "[NIE";
const OHNE_MUTANTEN = "nicht prüfbar";

export function schutzfaelle(basis, testdateien) {
  return testdateien
    .filter((pfad) => existsSync(pfad) && readFileSync(pfad, "utf8").includes(KENNUNG_IM_TEXT))
    .flatMap((pfad) => geaenderteFaelle(basis, cwd(), pfad).map((fall) => ({ ...fall, pfad })))
    .filter((fall) => fall.neu && !fall.still && satzNummer(fall.name, Infinity) !== null);
}

function genannt(grund, name) {
  return `${grund ?? ""}, `.includes(`: ${name}, `);
}

async function gemeinsamGetoetet(einheiten, faelle, werkzeug) {
  const wirksam = new Set();
  for (const pfad of new Set(faelle.map((fall) => fall.pfad))) {
    for (const { datei, bereiche } of einheiten) {
      const ergebnisse = await werkzeug.stryker({ datei, zeilen: bereiche, tests: [pfad], namensmuster: SCHUTZFAELLE_MUSTER });
      for (const fall of faelle.filter((eintrag) => eintrag.pfad === pfad)) {
        if (ergebnisse.some(({ status, grund }) => GETOETET.has(status) && genannt(grund, fall.name))) wirksam.add(fall);
      }
    }
  }
  return wirksam;
}

export async function messeFall(fall, ziel, werkzeug) {
  const ergebnisse = await werkzeug.stryker({ datei: ziel.datei, zeilen: ziel.bereiche, tests: [fall.pfad], namensmuster: muster(fall.name) });
  const { getoetet, erreicht } = zaehlung(ergebnisse);
  return { getoetet, erreicht, mutanten: ergebnisse.map(({ status, zeilen }) => ({ status, zeilen })) };
}

function urteilAus(messungen) {
  if (messungen.some(({ getoetet }) => getoetet)) return SCHUTZ_WIRKSAM;
  return messungen.some(({ erreicht }) => erreicht) ? WIRKUNGSLOS : SCHUTZ_UNERREICHT;
}

async function einzeln(fall, ziele, werkzeug) {
  const gemessen = [];
  for (const ziel of ziele) {
    gemessen.push(await messeFall(fall, ziel, werkzeug));
    if (gemessen.at(-1).getoetet) break;
  }
  return urteilAus(gemessen);
}

function alteSchutzstellen(angaben) {
  const stellen = new Map();
  for (const angabe of angaben) {
    const [, kennung, datei, zeile] = ALTER_SCHUTZ.exec(angabe) ?? [];
    if (kennung === undefined) throw new Error("--alter-schutz hat nicht die Form [NIE1] src/DATEI:ZEILE");
    if (stellen.has(kennung)) throw new Error("--alter-schutz nennt dieselbe Kennung mehr als einmal");
    stellen.set(kennung, { datei, zeile: Number(zeile) });
  }
  return stellen;
}

function ungepruefteStellen(stellen, geprueft) {
  return [...stellen].filter(([kennung]) => !geprueft.has(kennung)).map(([kennung, { datei, zeile }]) => `${UNGEPRUEFT}: ${kennung} ${datei}:${zeile}`);
}

function kennungVon(fall) {
  return fall.name.slice(0, fall.name.indexOf(" "));
}

function geaendert(einheiten, { datei, zeile }) {
  return einheiten.some((einheit) => einheit.datei === datei && einheit.bereiche.some(([von, bis]) => von <= zeile && zeile <= bis));
}

async function alterSchutz(fall, { einheiten, stellen }, werkzeug) {
  const stelle = stellen.get(kennungVon(fall));
  if (stelle === undefined) return [`${WIRKUNGSLOS}: ${fall.name}`];
  const ort = `${stelle.datei}:${stelle.zeile}`;
  if (!existsSync(stelle.datei)) return [`${NICHT_BELEGT} (${ort} gibt es nicht): ${fall.name}`];
  if (geaendert(einheiten, stelle)) return [`${NICHT_BELEGT} (${ort} ist seit der Basis geändert): ${fall.name}`];
  const urteil = await einzeln(fall, [{ datei: stelle.datei, bereiche: [[stelle.zeile, stelle.zeile]] }], werkzeug);
  if (urteil === SCHUTZ_WIRKSAM) return [alterSchutzBeleg(stelle.datei, stelle.zeile, fall.name)];
  return [`${NICHT_BELEGT} (${ort}, der Fall tötet dort keinen Mutanten): ${fall.name}`];
}

export function aufgezeichnet(messungen) {
  return (fall, ziele) => {
    const eigene = messungen.filter((messung) => messung.pfad === fall.pfad && messung.fall === fall.name);
    for (const { datei } of ziele) {
      if (!eigene.some((messung) => messung.datei === datei)) throw new Error(`Schutzmessung fehlt: ${fall.name} in ${datei}`);
    }
    return urteilAus(eigene);
  };
}

function ueberdeckt(mutant, bereiche) {
  if (!Array.isArray(mutant.zeilen)) return true;
  const [von, bis] = mutant.zeilen;
  return bereiche.some(([anfang, ende]) => anfang <= bis && von <= ende);
}

function zaehlung(mutanten) {
  return { getoetet: mutanten.some(({ status }) => GETOETET.has(status)), erreicht: mutanten.some(({ status }) => status === GELAUFEN_UEBERLEBT), anzahl: mutanten.length };
}

export function aufgezeichnetEigen(messungen) {
  return (fall, eigene) => {
    const gemessen = eigene.map(({ datei, bereiche }) => ({ bereiche, messung: messungen.find((eintrag) => eintrag.pfad === fall.pfad && eintrag.fall === fall.name && eintrag.datei === datei) }));
    if (gemessen.some(({ messung }) => !Array.isArray(messung?.mutanten))) return null;
    return gemessen.map(({ bereiche, messung }) => zaehlung(messung.mutanten.filter((mutant) => ueberdeckt(mutant, bereiche))));
  };
}

async function eigeneMessung(fall, eigene, werkzeug) {
  if (werkzeug.eigene !== undefined) return werkzeug.eigene(fall, eigene);
  const gemessen = [];
  for (const ziel of eigene) gemessen.push(zaehlung((await messeFall(fall, ziel, werkzeug)).mutanten));
  return gemessen;
}

function eigenesUrteil(gemessen) {
  if (gemessen === null) return null;
  if (gemessen.some(({ getoetet }) => getoetet)) return SCHUTZ_WIRKSAM;
  if (gemessen.some(({ erreicht }) => erreicht)) return WIRKUNGSLOS;
  return gemessen.every(({ anzahl }) => anzahl === 0) ? OHNE_MUTANTEN : null;
}

async function fallurteil(fall, kontext, werkzeug) {
  const zugeordnet = kontext.zuordnung.get(fall);
  const eigenes = zugeordnet === undefined ? null : eigenesUrteil(await eigeneMessung(fall, zugeordnet.einheiten, werkzeug));
  if (eigenes !== null) return eigenes;
  return werkzeug.fall === undefined ? einzeln(fall, kontext.einheiten, werkzeug) : werkzeug.fall(fall, kontext.einheiten);
}

async function gemeinsamWirksam(faelle, kontext, werkzeug) {
  if (werkzeug.fall !== undefined) return new Set();
  return gemeinsamGetoetet(kontext.einheiten, faelle.filter((fall) => !kontext.zuordnung.has(fall)), werkzeug);
}

function nichtPruefbarEintrag(fall, { auftrag, commit, einheiten }, issue) {
  const zeilen = einheiten.flatMap(({ datei, bereiche }) => bereiche.map(([von, bis]) => ({ datei, von, bis })));
  return { fall: fall.name, testdatei: fall.pfad, auftrag, commit, zeilen, freigegeben: issue !== undefined };
}

async function ohneMutanten(faelle, kontext, werkzeug) {
  if (faelle.length === 0) return { zeilen: new Map(), eintraege: [], hinweise: [] };
  const { freigaben, hinweise } = werkzeug.freigaben === undefined ? { freigaben: new Map(), hinweise: [] } : await werkzeug.freigaben();
  const zeilen = new Map();
  const eintraege = [];
  for (const fall of faelle) {
    const zugeordnet = kontext.zuordnung.get(fall);
    const issue = freigaben.get(freigabeImIssue(zugeordnet.auftrag, fall.name));
    zeilen.set(fall, issue === undefined ? nichtPruefbarZeile(zugeordnet.auftrag, fall.name) : freigegebenZeile(zugeordnet.auftrag, issue, fall.name));
    eintraege.push(nichtPruefbarEintrag(fall, zugeordnet, issue));
  }
  return { zeilen, eintraege, hinweise };
}

async function urteileJeFall(faelle, kontext, werkzeug) {
  const wirksam = await gemeinsamWirksam(faelle, kontext, werkzeug);
  const urteilJeFall = new Map();
  for (const fall of faelle) urteilJeFall.set(fall, wirksam.has(fall) ? SCHUTZ_WIRKSAM : await fallurteil(fall, kontext, werkzeug));
  return urteilJeFall;
}

async function ausgabezeilen(urteilJeFall, offen, { kontext, werkzeug }) {
  const zeilen = [...offen.hinweise];
  const geprueft = new Set();
  for (const [fall, urteil] of urteilJeFall) {
    if (urteil === WIRKUNGSLOS) geprueft.add(kennungVon(fall));
    if (urteil === OHNE_MUTANTEN) zeilen.push(offen.zeilen.get(fall));
    else zeilen.push(...(urteil === WIRKUNGSLOS ? await alterSchutz(fall, kontext, werkzeug) : [`${urteil}: ${fall.name}`]));
  }
  return [...zeilen, ...ungepruefteStellen(kontext.stellen, geprueft)];
}

async function urteile(faelle, kontext, werkzeug) {
  const urteilJeFall = await urteileJeFall(faelle, kontext, werkzeug);
  const offen = await ohneMutanten(faelle.filter((fall) => urteilJeFall.get(fall) === OHNE_MUTANTEN), kontext, werkzeug);
  return { zeilen: await ausgabezeilen(urteilJeFall, offen, { kontext, werkzeug }), nichtPruefbar: offen.eintraege };
}

export async function schutzUrteil(angaben, werkzeug) {
  const stellen = alteSchutzstellen(angaben);
  const faelle = werkzeug.faelle();
  const einheiten = (await werkzeug.einheiten()).filter(({ bereiche }) => bereiche !== undefined);
  if (faelle.length === 0 || einheiten.length === 0) {
    const grund = faelle.length === 0 ? "kein neuer Fall mit [NIE<n>]-Kennung" : "keine neue oder geänderte Zeile unter src/";
    return { geprueft: false, anzahl: faelle.length, verstoesse: 0, wartend: 0, nichtPruefbar: [], zeilen: [`${SCHUTZ_NICHT_PRUEFBAR}, ${grund}.`, ...ungepruefteStellen(stellen, new Set())] };
  }
  await werkzeug.freigabe();
  const zuordnung = werkzeug.zuordnung === undefined ? new Map() : werkzeug.zuordnung(faelle, einheiten);
  const { zeilen, nichtPruefbar } = await urteile(faelle, { einheiten, stellen, zuordnung }, werkzeug);
  const wartend = nichtPruefbar.filter(({ freigegeben }) => !freigegeben).length;
  return { geprueft: true, anzahl: faelle.length, verstoesse: zeilen.filter((zeile) => zeile.startsWith(VERSTOSS)).length, wartend, nichtPruefbar, zeilen };
}

function zusammenfassung({ anzahl, verstoesse, wartend }) {
  const wartet = wartend > 0 ? [wartetZeile(wartend, anzahl)] : [];
  return verstoesse === 0 && wartend > 0 ? wartet : [schutzZusammenfassung(anzahl, verstoesse), ...wartet];
}

export function meldeSchutz(urteil) {
  for (const zeile of urteil.zeilen) console.log(zeile);
  if (urteil.geprueft) for (const zeile of zusammenfassung(urteil)) console.log(zeile);
  return urteil.verstoesse === 0 && !(urteil.wartend > 0) ? EXIT_GRUEN : EXIT_ROT;
}

export async function schutzwirkungPruefung(angaben, werkzeug) {
  const urteil = await schutzUrteil(angaben, werkzeug);
  if (!urteil.geprueft) urteil.zeilen.push("grün: keine Wirkung zu prüfen.");
  return meldeSchutz(urteil);
}

export function ohneReinenSchutzbefund(exitCode, ausgabe) {
  return exitCode === EXIT_ROT && nurSchutzRot(ausgabe) ? EXIT_GRUEN : exitCode;
}
