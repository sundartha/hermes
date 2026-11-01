import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { env, version } from "node:process";
import { isDeepStrictEqual } from "node:util";

import { entferneTempOrdner, neuerTempOrdner } from "../temp-ordner.mjs";
import { abrufLaufBefund, gh, ghRepo, mitUrteilAbgeschlossen } from "./gh.mjs";
import { bestaetigungAbgestuerzt } from "./bestaetigung.mjs";
import { pullRequestNummer, vorlaufImPullRequest } from "./vorlauf-pr.mjs";
import { werkzeugEingaben } from "./vorher-speicher.mjs";

const MAX_GIT_AUSGABE = 268_435_456;
const TESTORDNER = "test/";
const ARBEITSORDNER = ".mutationspruefung/";
const NUR_COMMIT = "^{commit}";
const NUR_BAUM = "^{tree}";
const KOPF_NICHT_NACHPRUEFBAR = "Kopf des Vorlaufs nicht nachprüfbar";
const ABRUF_ZWEIG = "lauf-mutation/";
const ABRUF_EREIGNIS = "workflow_dispatch";
const ABRUF_AUFTRAG = /^Auftrag: lauf\/in-ci$/m;
const VORLAUF_ZEILE = /^Vorlauf: ([1-9]\d*)$/m;
const COMMIT = /^[0-9a-f]{40}$/;
const ARTEFAKTE = "mutation-teil-*";
const TEILDATEI = /^mutation-teil-\d+\.json$/;
const BESTAETIGT = "getoetet";
const GETOETET = "Killed";
const MELDUNG_ZEICHEN = 160;
const LEERRAUM = /\s+/g;
const REGEL_HEUTE = "quellen";
const REGEL_GEPRUEFT = "geprueft";
const schattenUebernehmbar = [];

function git(argumente) {
  return execFileSync("git", argumente, { encoding: "utf8", maxBuffer: MAX_GIT_AUSGABE, stdio: ["ignore", "pipe", "pipe"] });
}

function einzeiler(text) {
  return String(text).replace(LEERRAUM, " ").trim().slice(0, MELDUNG_ZEICHEN);
}

function aufgeloest(ref) {
  return git(["rev-parse", "--verify", ref + NUR_COMMIT]).trim();
}

function baumVon(ref) {
  return git(["rev-parse", "--verify", ref + NUR_BAUM]).trim();
}

function dateienVon(commit) {
  const dateien = new Map();
  for (const zeile of git(["ls-tree", "-r", "-z", commit]).split("\0").filter(Boolean)) {
    const tab = zeile.indexOf("\t");
    dateien.set(zeile.slice(tab + 1), zeile.slice(0, tab).split(" ")[2]);
  }
  return dateien;
}

function werkzeugInTests() {
  return new Set(werkzeugEingaben(".").filter((pfad) => pfad.startsWith(TESTORDNER)));
}

function nachPfad([links], [rechts]) {
  return links < rechts ? -1 : 1;
}

function hashVon(eintraege) {
  return createHash("sha256").update(JSON.stringify(eintraege)).digest("hex");
}

function ausserhalbVonTests(dateien) {
  const werkzeug = werkzeugInTests();
  return [...dateien].filter(([pfad]) => werkzeug.has(pfad) || (!pfad.startsWith(TESTORDNER) && !pfad.startsWith(ARBEITSORDNER))).sort(nachPfad);
}

function baumHash(dateien) {
  return hashVon(ausserhalbVonTests(dateien));
}

function werkzeugHash(dateien) {
  const werkzeug = new Set(werkzeugEingaben("."));
  return hashVon([...dateien].filter(([pfad]) => werkzeug.has(pfad)).sort(nachPfad));
}

function testBlobs(dateien) {
  return Object.fromEntries([...dateien].filter(([pfad]) => pfad.startsWith(TESTORDNER)));
}

function hashJeCommit(commit, zwischenspeicher) {
  if (commit === null) return { hash: null, dateien: new Map() };
  if (!zwischenspeicher.has(commit)) {
    const dateien = dateienVon(commit);
    zwischenspeicher.set(commit, { hash: baumHash(dateien), dateien });
  }
  return zwischenspeicher.get(commit);
}

export function standVon({ seite, von, bis }, kopf) {
  const zwischenspeicher = new Map();
  const [vonCommit, bisCommit] = [aufgeloest(von), bis === undefined || bis === null ? null : aufgeloest(bis)];
  const prueft = seite === "alt" ? vonCommit : kopf;
  const quellen = { kopf: hashJeCommit(kopf, zwischenspeicher).hash, von: hashJeCommit(vonCommit, zwischenspeicher).hash, bis: hashJeCommit(bisCommit, zwischenspeicher).hash };
  return {
    seite,
    von: vonCommit,
    bis: bisCommit,
    quellen,
    geprueft: seite === "alt" ? { ...quellen, kopf: werkzeugHash(hashJeCommit(kopf, zwischenspeicher).dateien) } : quellen,
    tests: testBlobs(hashJeCommit(prueft, zwischenspeicher).dateien),
  };
}

export function lauffaehig(stand, zugesagt, regel = REGEL_HEUTE) {
  const gleich = (name) => isDeepStrictEqual(stand[name], zugesagt[name]);
  if (!gleich("seite")) return "andere Seite der Prüfung";
  if (!gleich(regel)) return "Dateien außerhalb von test/ geändert";
  return null;
}

function arbeitsbaumSauber() {
  return git(["status", "--porcelain"]).trim() === "";
}

function auffaellig(eintrag) {
  return bestaetigungAbgestuerzt(eintrag) || eintrag.hinweis !== undefined || eintrag.befund !== undefined;
}

function fuerUebernahme(bisher, eintrag) {
  if (bisher === undefined || auffaellig(bisher)) return bisher ?? eintrag;
  if (auffaellig(eintrag)) return eintrag;
  return bestaetigtGetoetet(eintrag) && !bestaetigtGetoetet(bisher) ? eintrag : bisher;
}

export function eintragsListe(berichte, index) {
  const nachSchluessel = new Map();
  for (const bericht of berichte) {
    for (const eintrag of bericht.messungen.filter(({ pruefung }) => pruefung === index).flatMap(({ ergebnisse }) => ergebnisse)) {
      if (eintrag.lage === undefined) continue;
      nachSchluessel.set(eintrag.schluessel, fuerUebernahme(nachSchluessel.get(eintrag.schluessel), eintrag));
    }
  }
  return [...nachSchluessel.values()];
}

export function bestaetigtGetoetet(eintrag) {
  const sauber = eintrag.hinweis === undefined && eintrag.befund === undefined;
  return sauber && eintrag.status === GETOETET && eintrag.bestaetigung === BESTAETIGT && Array.isArray(eintrag.toeter) && eintrag.toeter.length > 0;
}

function dateiVon(schluessel) {
  return schluessel.split(":")[0];
}

function jeDatei(eintraege) {
  const karte = {};
  for (const eintrag of eintraege) (karte[dateiVon(eintrag.schluessel)] ??= []).push(eintrag);
  return karte;
}

function schattenFeld(vorergebnis) {
  if (vorergebnis.lauf === null || vorergebnis.echt === REGEL_GEPRUEFT) return {};
  return { schatten: { uebernehmbar: schattenUebernehmbar } };
}

export function teilMetadaten(pruefungen, vorergebnis) {
  return {
    kopf: aufgeloest("HEAD"),
    baum: baumVon("HEAD"),
    umgebung: version,
    pruefungen: pruefungen.map(({ seite, von, bis }) => ({ seite, von: aufgeloest(von), bis: bis === undefined ? null : aufgeloest(bis) })),
    vorergebnis: vorergebnis.kennung ?? null,
    ...schattenFeld(vorergebnis),
  };
}

function ohneVorergebnis(grund) {
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
  if (inhalt.lauf === null || !Array.isArray(inhalt.pruefungen)) return ohneVorergebnis(typeof inhalt.grund === "string" && inhalt.grund !== "" ? inhalt.grund : "leer");
  return inhalt;
}

function stimmtUeberein(vorergebnis, pruefungen) {
  if (vorergebnis.lauf === null) return vorergebnis.grund;
  if (vorergebnis.umgebung !== version) return `andere Node-Version (${vorergebnis.umgebung})`;
  if (vorergebnis.pruefungen.length !== pruefungen.length) return "andere Zahl von Prüfungen";
  if (!arbeitsbaumSauber()) return "Arbeitsbaum nicht sauber";
  return null;
}

function kontextNach(regel, { vorergebnis, zugesagt, jetzt }) {
  const abweichung = lauffaehig(jetzt, zugesagt, regel);
  const kontext = abweichung === null ? { lauf: vorergebnis.lauf, eintraege: jeDatei(zugesagt.eintraege), vorher: zugesagt.tests, jetzt: jetzt.tests } : null;
  return { abweichung, kontext };
}

function schattenNoetig(echt, jetzt) {
  if (echt === REGEL_GEPRUEFT) return false;
  return echt === null || !isDeepStrictEqual(jetzt.geprueft, jetzt.quellen);
}

export function kontexteFuer(vorergebnis, pruefungen) {
  const grund = stimmtUeberein(vorergebnis, pruefungen);
  if (grund !== null) return { kontexte: pruefungen.map(() => null), zeile: keinVorergebnisZeile(grund) };
  const kopf = aufgeloest("HEAD");
  const echt = vorergebnis.echt === undefined ? REGEL_HEUTE : vorergebnis.echt;
  const gruende = [];
  const kontexte = pruefungen.map((pruefung, pruefungIndex) => {
    const zugesagt = vorergebnis.pruefungen[pruefungIndex];
    const lage = { vorergebnis, zugesagt, jetzt: standVon(pruefung, kopf) };
    const gilt = echt === null ? { abweichung: null, kontext: null } : kontextNach(echt, lage);
    if (gilt.abweichung !== null) gruende.push(gilt.abweichung);
    const schatten = schattenNoetig(echt, lage.jetzt) ? kontextNach(REGEL_GEPRUEFT, lage).kontext : null;
    return gilt.kontext === null && schatten === null ? null : { pruefung: pruefungIndex, echt: gilt.kontext, schatten };
  });
  const zeile = gruende.length > 0 ? `Mutationsprüfung: Vorergebnis passt nicht zum Stand (${[...new Set(gruende)].join("; ")}), voller Neulauf.` : null;
  return { kontexte, zeile };
}

function geaendert(vorher, jetzt) {
  const pfade = new Set([...Object.keys(vorher), ...Object.keys(jetzt)]);
  const abweichend = [...pfade].filter((pfad) => vorher[pfad] !== jetzt[pfad]);
  return { neu: abweichend.filter((pfad) => jetzt[pfad] !== undefined), geloescht: abweichend.filter((pfad) => jetzt[pfad] === undefined) };
}

function betroffeneTests(kontext, erreichende) {
  const { neu, geloescht } = geaendert(kontext.vorher, kontext.jetzt);
  if (geloescht.length > 0) return null;
  const betroffen = new Set();
  for (const pfad of neu) {
    const tests = erreichende(pfad);
    if (tests.length === 0) return null;
    for (const test of tests) betroffen.add(test);
  }
  return betroffen;
}

function imBereich(eintrag, bereiche) {
  const [von, bis] = eintrag.zeilen;
  return bereiche.some(([anfang, ende]) => von >= anfang && bis <= ende);
}

function bleibtGetoetet(eintrag, { betroffen, alle }) {
  return bestaetigtGetoetet(eintrag) && eintrag.toeter.every((test) => !betroffen.has(test) && alle.includes(test));
}

function teilungNach(kontext, datei, { alle, erreichende, zeilen }) {
  const bisher = kontext?.eintraege[datei];
  if (bisher === undefined || !bisher.every((eintrag) => imBereich(eintrag, zeilen))) return null;
  const betroffen = betroffeneTests(kontext, erreichende);
  if (betroffen === null) return null;
  const pruefung = { betroffen, alle };
  const behalten = bisher.filter((eintrag) => bleibtGetoetet(eintrag, pruefung));
  if (behalten.length === 0) return null;
  return { lauf: kontext.lauf, betroffen, uebernommen: behalten, offen: bisher.filter((eintrag) => !behalten.includes(eintrag)).map(({ lage }) => lage) };
}

function uebertragen(teilung) {
  if (teilung === null) return [];
  const offeneOrte = new Set(teilung.offen.map((lage) => JSON.stringify(lage)));
  return teilung.uebernommen.filter(({ lage }) => !offeneOrte.has(JSON.stringify(lage)));
}

function merkeSchatten({ pruefung, schatten, echt, datei }) {
  const schonUebernommen = new Set(uebertragen(echt).map(({ schluessel }) => schluessel));
  const neue = uebertragen(schatten).filter(({ schluessel }) => !schonUebernommen.has(schluessel));
  const unbekannt = neue.filter(({ schluessel }) => !schattenUebernehmbar.some((eintrag) => eintrag.pruefung === pruefung && eintrag.schluessel === schluessel));
  schattenUebernehmbar.push(...unbekannt.map(({ schluessel }) => ({ pruefung, schluessel })));
  if (unbekannt.length > 0) console.log(`${datei}: ${unbekannt.length} Mutanten aus Lauf ${schatten.lauf} wären übernommen worden (Schatten), alle frisch geprüft`);
}

export function uebernommen(kontext, datei, pruefung) {
  const echt = teilungNach(kontext?.echt, datei, pruefung);
  const schatten = teilungNach(kontext?.schatten, datei, pruefung);
  if (schatten !== null) merkeSchatten({ pruefung: kontext.pruefung, schatten, echt, datei });
  return echt;
}

export function zusammengefuehrt(teilung, datei, neu) {
  const frisch = new Set(neu.map(({ schluessel }) => schluessel));
  const behalten = teilung.uebernommen.filter(({ schluessel }) => !frisch.has(schluessel));
  if (behalten.length > 0) console.log(`${datei}: ${behalten.length} Mutanten aus Lauf ${teilung.lauf} übernommen, ${neu.length} neu geprüft`);
  return [...behalten, ...neu];
}

function laufPruefen(lauf, id, herkunft) {
  const befund = mitUrteilAbgeschlossen(lauf) ? abrufLaufBefund(lauf, ghRepo(), herkunft) : "ist nicht mit Urteil abgeschlossen";
  return befund === null ? null : `der Lauf ${id} ${befund}`;
}

function commitHolen(commit) {
  try {
    aufgeloest(commit);
  } catch {
    git(["fetch", "--quiet", "--no-tags", "origin", commit]);
    aufgeloest(commit);
  }
}

export function geladeneTeildateien(ordner) {
  const namen = readdirSync(ordner, { recursive: true }).map(String).filter((name) => TEILDATEI.test(basename(name)));
  return namen.map((name) => JSON.parse(readFileSync(join(ordner, name), "utf8")));
}

function pruefungenBrauchbar(pruefungen) {
  const commit = (wert) => wert === null || COMMIT.test(String(wert));
  return pruefungen.every(({ seite, von, bis }) => ["alt", "neu"].includes(seite) && COMMIT.test(String(von)) && commit(bis));
}

function altesFormat(bericht) {
  return !Number.isInteger(bericht.teile) || !Array.isArray(bericht.pruefungen) || typeof bericht.umgebung !== "string";
}

function nummernVollstaendig(berichte, teile) {
  const nummern = berichte.map(({ teil }) => teil).sort((links, rechts) => links - rechts);
  return nummern.length === teile && nummern.every((nummer, index) => nummer === index + 1);
}

function baumStimmt(berichte, lauf) {
  const baum = baumVon(lauf.head_sha);
  return berichte.every((bericht) => bericht.baum === baum);
}

function berichteVollstaendig(berichte, lauf, imPullRequest) {
  if (berichte.length === 0) return "enthält keine Teilergebnisse";
  const erster = berichte[0];
  if (altesFormat(erster)) return "hat Teilergebnisse in einem älteren Format";
  if (!pruefungenBrauchbar(erster.pruefungen)) return "nennt unbrauchbare Prüfungen";
  const gleich = (bericht) =>
    bericht.pruefsumme === erster.pruefsumme && (imPullRequest || bericht.kopf === lauf.head_sha) && bericht.teile === erster.teile && bericht.umgebung === erster.umgebung && isDeepStrictEqual(bericht.pruefungen, erster.pruefungen);
  if (!berichte.every(gleich)) return "hat Teilergebnisse, die nicht zu einem Plan und Commit gehören";
  return nummernVollstaendig(berichte, erster.teile) ? null : "hat nicht alle Teilergebnisse";
}

function zugesagtVonLauf(berichte, lauf) {
  const stand = (pruefung) => standVon(pruefung, lauf.head_sha);
  return berichte[0].pruefungen.map((pruefung, index) => {
    const festgestellt = stand(pruefung);
    return { seite: festgestellt.seite, quellen: festgestellt.quellen, geprueft: festgestellt.geprueft, tests: festgestellt.tests, eintraege: eintragsListe(berichte, index) };
  });
}

function abrufen({ id, herkunft, echt }) {
  const repo = ghRepo();
  const lauf = JSON.parse(gh(["api", `repos/${repo}/actions/runs/${id}`]));
  const unpassend = laufPruefen(lauf, id, herkunft);
  if (unpassend !== null) return ohneVorergebnis(unpassend);
  commitHolen(lauf.head_sha);
  const ordner = neuerTempOrdner("vorergebnis-");
  try {
    gh(["run", "download", String(id), "-R", repo, "-D", ordner, "-p", ARTEFAKTE]);
    const berichte = geladeneTeildateien(ordner);
    const imPullRequest = herkunft !== undefined;
    if (imPullRequest && !baumStimmt(berichte, lauf)) return ohneVorergebnis(KOPF_NICHT_NACHPRUEFBAR);
    const luecke = berichteVollstaendig(berichte, lauf, imPullRequest);
    if (luecke !== null) return ohneVorergebnis(`der Lauf ${id} ${luecke}`);
    for (const { von, bis } of berichte[0].pruefungen) [von, bis].filter(Boolean).forEach(commitHolen);
    const inhalt = { lauf: id, kopf: lauf.head_sha, umgebung: berichte[0].umgebung, echt, pruefungen: zugesagtVonLauf(berichte, lauf) };
    return { ...inhalt, kennung: hashVon(inhalt) };
  } finally {
    entferneTempOrdner(ordner);
  }
}

function laufNummer(umgebung) {
  const pullRequest = pullRequestNummer(umgebung);
  if (pullRequest !== null) return vorlaufImPullRequest(umgebung, pullRequest);
  const nachricht = git(["log", "-1", "--format=%B", "HEAD"]);
  if (umgebung.GITHUB_EVENT_NAME !== ABRUF_EREIGNIS || !String(umgebung.GITHUB_REF_NAME).startsWith(ABRUF_ZWEIG)) return { grund: "kein Abruf der Mutationsprüfung" };
  const treffer = VORLAUF_ZEILE.exec(nachricht);
  if (!ABRUF_AUFTRAG.test(nachricht) || treffer === null) return { grund: "der Commit nennt keinen Vorlauf" };
  if (Number(treffer[1]) >= Number(umgebung.GITHUB_RUN_ID)) return { grund: "der genannte Lauf ist nicht älter als dieser" };
  return { id: Number(treffer[1]), echt: REGEL_HEUTE };
}

function abgerufen(umgebung) {
  try {
    const gewaehlt = laufNummer(umgebung);
    return gewaehlt.id === undefined ? ohneVorergebnis(gewaehlt.grund) : abrufen({ ...gewaehlt, echt: gewaehlt.echt ?? (gewaehlt.uebernimmt ? REGEL_GEPRUEFT : null) });
  } catch (fehler) {
    return ohneVorergebnis(`Abruf fehlgeschlagen: ${einzeiler(fehler.message)}`);
  }
}

export function schreibeOhneVorergebnis(ziel, grund) {
  writeFileSync(ziel, `${JSON.stringify(ohneVorergebnis(grund))}\n`);
  return keinVorergebnisZeile(grund);
}

export function holeVorergebnis(ziel, umgebung = env) {
  const ergebnis = abgerufen(umgebung);
  writeFileSync(ziel, `${JSON.stringify(ergebnis)}\n`);
  if (ergebnis.lauf === null) return keinVorergebnisZeile(ergebnis.grund);
  const zahl = ergebnis.pruefungen.reduce((summe, { eintraege }) => summe + eintraege.filter(bestaetigtGetoetet).length, 0);
  const schatten = ergebnis.echt === null ? " Schattenmodus: nichts wird übernommen." : "";
  return `Mutationsprüfung: Vorergebnis aus Lauf ${ergebnis.lauf}, ${zahl} bestätigt getötete Mutanten.${schatten}`;
}
