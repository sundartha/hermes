import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { version } from "node:process";

import { git } from "../auftrag/git.mjs";
import { bestaetigungAbgestuerzt } from "./bestaetigung.mjs";
import { nachOrt, ortsschluessel } from "./teile.mjs";

const NUR_COMMIT = "^{commit}";
const NUR_BAUM = "^{tree}";
const TEILDATEI = /^mutation-teil-\d+\.json$/;
const BESTAETIGT = "getoetet";
const GETOETET = "Killed";
const schattenUebernehmbar = [];

export function aufgeloest(ref) {
  return git(["rev-parse", "--verify", ref + NUR_COMMIT]).trim();
}

function baumVon(ref) {
  return git(["rev-parse", "--verify", ref + NUR_BAUM]).trim();
}

function auffaellig(eintrag) {
  return bestaetigungAbgestuerzt(eintrag) || eintrag.hinweis !== undefined || eintrag.befund !== undefined;
}

function fuerUebernahme(bisher, eintrag) {
  if (bisher === undefined || auffaellig(bisher)) return bisher ?? eintrag;
  if (auffaellig(eintrag)) return eintrag;
  return bestaetigtGetoetet(eintrag) && !bestaetigtGetoetet(bisher) ? eintrag : bisher;
}

export function eintraegeJeMutant(berichte) {
  const nachMutant = new Map();
  for (const { messungen } of berichte) {
    for (const { pruefung, ergebnisse } of messungen.filter((messung) => Array.isArray(messung.ergebnisse))) {
      for (const eintrag of ergebnisse.filter((kandidat) => kandidat.lage !== undefined)) {
        const schluessel = JSON.stringify([pruefung, eintrag.schluessel]);
        nachMutant.set(schluessel, [...(nachMutant.get(schluessel) ?? []), eintrag]);
      }
    }
  }
  return nachMutant;
}

export function zusammengefasst(eintraege) {
  return eintraege.reduce((bisher, naechster) => fuerUebernahme(bisher, naechster), undefined);
}

export function eintragsListe(berichte, index) {
  return [...eintraegeJeMutant(berichte)].filter(([schluessel]) => JSON.parse(schluessel)[0] === index).map(([, eintraege]) => zusammengefasst(eintraege));
}

export function bestaetigtGetoetet(eintrag) {
  const sauber = eintrag.hinweis === undefined && eintrag.befund === undefined;
  return sauber && eintrag.status === GETOETET && eintrag.bestaetigung === BESTAETIGT && Array.isArray(eintrag.toeter) && eintrag.toeter.length > 0;
}

export function mitBeleg(eintrag) {
  return bestaetigtGetoetet(eintrag) && typeof eintrag.stand === "string" && eintrag.lage !== undefined;
}

function dateiVon(schluessel) {
  return schluessel.split(":")[0];
}

function testBlobs() {
  const zeilen = git(["ls-files", "-s", "-z", "--", "test/"]).split("\0").filter(Boolean);
  return Object.fromEntries(zeilen.map((zeile) => [zeile.slice(zeile.indexOf("\t") + 1), zeile.split(" ")[1]]));
}

function schattenFeld(vorergebnis) {
  if (vorergebnis.lauf === null || vorergebnis.echt) return {};
  return { schatten: { uebernehmbar: schattenUebernehmbar } };
}

export function teilMetadaten(pruefungen, vorergebnis) {
  return {
    kopf: aufgeloest("HEAD"),
    baum: baumVon("HEAD"),
    umgebung: version,
    pruefungen: pruefungen.map(({ seite, von, bis }) => ({ seite, von: aufgeloest(von), bis: bis === undefined ? null : aufgeloest(bis) })),
    vorergebnis: vorergebnis.kennung ?? null,
    testdateien: testBlobs(),
    ...schattenFeld(vorergebnis),
  };
}

export function ohneVorergebnis(grund) {
  return { lauf: null, grund };
}

export function keinVorergebnisZeile(grund) {
  return `Mutationsprüfung: kein Vorergebnis (${grund}), voller Neulauf.`;
}

function dateiLesen(pfad) {
  try {
    return JSON.parse(readFileSync(pfad, "utf8"));
  } catch {
    return null;
  }
}

export function leseVorergebnis(pfad) {
  if (pfad === undefined) return ohneVorergebnis("kein Vorergebnis angegeben");
  if (!existsSync(pfad)) throw new Error(`Vorergebnisdatei fehlt: ${pfad}`);
  const inhalt = dateiLesen(pfad);
  if (typeof inhalt !== "object" || inhalt === null) return ohneVorergebnis("Vorergebnisdatei unlesbar");
  if (inhalt.lauf === null || !Array.isArray(inhalt.belege)) return ohneVorergebnis(typeof inhalt.grund === "string" && inhalt.grund !== "" ? inhalt.grund : "leer");
  return inhalt;
}

function belegIndex(belege) {
  const index = new Map();
  for (const beleg of belege) {
    const jeSeite = index.get(beleg.seite) ?? new Map();
    const jeDatei = jeSeite.get(dateiVon(beleg.eintrag.schluessel)) ?? new Map();
    jeDatei.set(beleg.eintrag.schluessel, [...(jeDatei.get(beleg.eintrag.schluessel) ?? []), beleg]);
    jeSeite.set(dateiVon(beleg.eintrag.schluessel), jeDatei);
    index.set(beleg.seite, jeSeite);
  }
  return index;
}

function arbeitsbaumSauber() {
  return git(["status", "--porcelain"]).trim() === "";
}

function stimmtUeberein(vorergebnis) {
  if (vorergebnis.lauf === null) return vorergebnis.grund;
  if (vorergebnis.umgebung !== version) return `andere Node-Version (${vorergebnis.umgebung})`;
  if (!arbeitsbaumSauber()) return "Arbeitsbaum nicht sauber";
  return null;
}

export function kontexteFuer(vorergebnis, pruefungen) {
  const grund = stimmtUeberein(vorergebnis);
  if (grund !== null) return { kontexte: pruefungen.map(() => null), zeile: keinVorergebnisZeile(grund) };
  const index = belegIndex(vorergebnis.belege);
  const tests = { vorher: vorergebnis.testdateien ?? {}, jetzt: testBlobs() };
  return { kontexte: pruefungen.map((_pruefung, pruefung) => ({ pruefung, echt: vorergebnis.echt === true, index, tests })), zeile: null };
}

function belegFuer(belege, { datei, alle, stand }) {
  return belege.find(({ eintrag }) => eintrag.toeter.every((test) => alle.includes(test)) && eintrag.stand === stand(datei, eintrag.toeter)) ?? null;
}

function teilungNach(kontext, datei, { seite, mutanten, alle, stand }) {
  const belege = kontext?.index.get(seite)?.get(datei);
  if (belege === undefined || !Array.isArray(mutanten)) return null;
  const treffer = mutanten.map((mutant) => belegFuer(belege.get(mutant.schluessel) ?? [], { datei, alle, stand }));
  const offeneOrte = new Set(mutanten.filter((_mutant, nummer) => treffer[nummer] === null).map(({ lage }) => ortsschluessel(lage)));
  const uebernommen = treffer.filter((beleg) => beleg !== null && !offeneOrte.has(ortsschluessel(beleg.eintrag.lage)));
  if (uebernommen.length === 0) return null;
  const offen = nachOrt(mutanten.filter(({ lage }) => offeneOrte.has(ortsschluessel(lage)))).map(([erster]) => erster.lage);
  const laeufe = [...new Set(uebernommen.map(({ lauf }) => lauf))].sort((links, rechts) => rechts - links);
  return { lauf: laeufe.join(", "), laeufe, uebernommen: uebernommen.map(({ eintrag }) => eintrag), offen };
}

function merkeSchatten({ pruefung, teilung, datei }) {
  const unbekannt = teilung.uebernommen.filter(({ schluessel }) => !schattenUebernehmbar.some((eintrag) => eintrag.pruefung === pruefung && eintrag.schluessel === schluessel));
  schattenUebernehmbar.push(...unbekannt.map(({ schluessel }) => ({ pruefung, schluessel })));
  if (unbekannt.length > 0) console.log(`${datei}: ${unbekannt.length} Mutanten aus Lauf ${teilung.lauf} wären übernommen worden (Schatten), alle frisch geprüft`);
}

export function uebernommen(kontext, datei, lage) {
  const teilung = teilungNach(kontext, datei, lage);
  if (teilung === null || kontext.echt) return teilung;
  merkeSchatten({ pruefung: kontext.pruefung, teilung, datei });
  return null;
}

function seitVorlaufGeaendert(kontext, teilung) {
  const { vorher, jetzt } = kontext.tests;
  return (test) => teilung.laeufe.some((lauf) => vorher[lauf]?.[test] !== jetzt[test]);
}

export function geaenderterTest({ seite, imGraph }, kontext, teilung) {
  return seite === "alt" ? (test) => imGraph.has(test) : seitVorlaufGeaendert(kontext, teilung);
}

export function zusammengefuehrt(teilung, datei, neu) {
  const frisch = new Set(neu.map(({ schluessel }) => schluessel));
  const behalten = teilung.uebernommen.filter(({ schluessel }) => !frisch.has(schluessel));
  if (behalten.length > 0) console.log(`${datei}: ${behalten.length} Mutanten aus Lauf ${teilung.lauf} übernommen, ${neu.length} neu geprüft`);
  return [...behalten, ...neu];
}

export function geladeneTeildateien(ordner) {
  const namen = readdirSync(ordner, { recursive: true }).map(String).filter((name) => TEILDATEI.test(basename(name)));
  return namen.map((name) => JSON.parse(readFileSync(join(ordner, name), "utf8")));
}

export function schreibeOhneVorergebnis(ziel, grund) {
  writeFileSync(ziel, `${JSON.stringify(ohneVorergebnis(grund))}\n`);
  return keinVorergebnisZeile(grund);
}
