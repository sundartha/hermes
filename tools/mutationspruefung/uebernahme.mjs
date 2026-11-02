import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { env, version } from "node:process";
import { isDeepStrictEqual } from "node:util";

import { entferneTempOrdner, neuerTempOrdner } from "../temp-ordner.mjs";
import { abrufLaufBefund, gh, ghRepo } from "./gh.mjs";
import { bestaetigungAbgestuerzt } from "./bestaetigung.mjs";
import { ortsschluessel } from "./teile.mjs";
import { beendet, pullRequestNummer, vorlaeufeImPullRequest } from "./vorlauf-pr.mjs";

const MAX_GIT_AUSGABE = 268_435_456;
const NUR_COMMIT = "^{commit}";
const NUR_BAUM = "^{tree}";
const ABRUF_ZWEIG = "lauf-mutation/";
const ABRUF_EREIGNIS = "workflow_dispatch";
const ABRUF_AUFTRAG = /^Auftrag: lauf\/in-ci$/m;
const VORLAUF_ZEILE = /^Vorlauf: ([1-9]\d*)$/m;
const ARTEFAKTE = "mutation-teil-*";
const TEILDATEI = /^mutation-teil-\d+\.json$/;
const BESTAETIGT = "getoetet";
const GETOETET = "Killed";
const SEITEN = new Set(["alt", "neu"]);
const COMMIT = /^[0-9a-f]{40}$/;
const MELDUNG_ZEICHEN = 160;
const LEERRAUM = /\s+/g;
const OHNE_BELEG = "kein bestätigt getöteter Mutant mit Stand der betroffenen Dateien";
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

function hashVon(wert) {
  return createHash("sha256").update(JSON.stringify(wert)).digest("hex");
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

function mitBeleg(eintrag) {
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

function stimmtUeberein(vorergebnis) {
  if (vorergebnis.lauf === null) return vorergebnis.grund;
  if (vorergebnis.umgebung !== version) return `andere Node-Version (${vorergebnis.umgebung})`;
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
  if (belege === undefined || !Array.isArray(mutanten) || stand === null) return null;
  const treffer = mutanten.map((mutant) => belegFuer(belege.get(mutant.schluessel) ?? [], { datei, alle, stand }));
  const offeneOrte = new Set(mutanten.filter((_mutant, nummer) => treffer[nummer] === null).map(({ lage }) => ortsschluessel(lage)));
  const uebernommen = treffer.filter((beleg) => beleg !== null && !offeneOrte.has(ortsschluessel(beleg.eintrag.lage)));
  if (uebernommen.length === 0) return null;
  const offen = new Map(mutanten.filter(({ lage }) => offeneOrte.has(ortsschluessel(lage))).map(({ lage }) => [ortsschluessel(lage), lage]));
  const laeufe = [...new Set(uebernommen.map(({ lauf }) => lauf))].sort((links, rechts) => rechts - links);
  return { lauf: laeufe.join(", "), laeufe, uebernommen: uebernommen.map(({ eintrag }) => eintrag), offen: [...offen.values()] };
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

export function seitVorlaufGeaendert(kontext, teilung) {
  const { vorher, jetzt } = kontext.tests;
  return (test) => teilung.laeufe.some((lauf) => vorher[lauf]?.[test] !== jetzt[test]);
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

function altesFormat(bericht) {
  return !Array.isArray(bericht.messungen) || !Number.isInteger(bericht.teile) || !Array.isArray(bericht.pruefungen) || typeof bericht.umgebung !== "string";
}

function pruefungenBrauchbar(pruefungen) {
  const commit = (wert) => wert === null || COMMIT.test(String(wert));
  return pruefungen.every(({ seite, von, bis }) => SEITEN.has(seite) && COMMIT.test(String(von)) && commit(bis));
}

function einPlan(berichte) {
  const [erster] = berichte;
  const gleich = (bericht) =>
    bericht.pruefsumme === erster.pruefsumme && bericht.kopf === erster.kopf && bericht.teile === erster.teile && bericht.umgebung === erster.umgebung && isDeepStrictEqual(bericht.pruefungen, erster.pruefungen);
  return berichte.every(gleich);
}

function luecke(berichte) {
  if (berichte.length === 0) return "enthält keine Teilergebnisse";
  if (berichte.some(altesFormat)) return "hat Teilergebnisse in einem älteren Format";
  if (!berichte.every(({ pruefungen }) => pruefungenBrauchbar(pruefungen))) return "nennt unbrauchbare Prüfungen";
  if (!einPlan(berichte)) return "hat Teilergebnisse, die nicht zu einem Plan und Commit gehören";
  const nummern = berichte.map(({ teil }) => teil);
  return new Set(nummern).size === nummern.length ? null : "hat doppelte Teilergebnisse";
}

function vollstaendigGemessen(eintraege) {
  const von = eintraege[0].messanteil?.[1];
  const anteile = new Set(eintraege.map(({ messanteil }) => (messanteil?.[1] === von ? messanteil[0] : null)));
  return Number.isInteger(von) && Array.from({ length: von }, (_leer, index) => index + 1).every((anteil) => anteile.has(anteil));
}

function messungenJePruefung(berichte) {
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

function beobachtungenDesLaufs(berichte, lauf) {
  const seiten = berichte[0].pruefungen.map(({ seite }) => seite);
  const beobachtet = new Map();
  for (const [schluessel, eintraege] of messungenJePruefung(berichte)) {
    const [pruefung, mutant] = JSON.parse(schluessel);
    if (seiten[pruefung] === undefined || !vollstaendigGemessen(eintraege)) continue;
    const eintrag = eintraege.reduce((bisher, naechster) => fuerUebernahme(bisher, naechster), undefined);
    const ort = `${seiten[pruefung]}\0${mutant}`;
    const bisher = beobachtet.has(ort) ? beobachtet.get(ort) : [];
    beobachtet.set(ort, bisher === null || !mitBeleg(eintrag) ? null : [...bisher, { seite: seiten[pruefung], lauf, eintrag }]);
  }
  return beobachtet;
}

function berichteDesLaufs(id, repo) {
  const ordner = neuerTempOrdner("vorergebnis-");
  try {
    gh(["run", "download", String(id), "-R", repo, "-D", ordner, "-p", ARTEFAKTE]);
    return geladeneTeildateien(ordner);
  } finally {
    entferneTempOrdner(ordner);
  }
}

function laufPruefen(lauf, id, herkunft) {
  const befund = beendet(lauf) ? abrufLaufBefund(lauf, ghRepo(), herkunft) : "ist nicht beendet";
  return befund === null ? null : `der Lauf ${id} ${befund}`;
}

function belegeAusLauf(id, herkunft) {
  try {
    const repo = ghRepo();
    const unpassend = laufPruefen(JSON.parse(gh(["api", `repos/${repo}/actions/runs/${id}`])), id, herkunft);
    if (unpassend !== null) return { beobachtet: new Map(), gruende: [unpassend] };
    const berichte = berichteDesLaufs(id, repo);
    const fehlt = luecke(berichte);
    if (fehlt !== null) return { beobachtet: new Map(), gruende: [`der Lauf ${id} ${fehlt}`] };
    if (berichte[0].umgebung !== version) return { beobachtet: new Map(), gruende: [`andere Node-Version (${berichte[0].umgebung})`] };
    const testdateien = typeof berichte[0].testdateien === "object" && berichte[0].testdateien !== null ? berichte[0].testdateien : {};
    return { beobachtet: beobachtungenDesLaufs(berichte, id), gruende: [], testdateien };
  } catch (fehler) {
    return { beobachtet: new Map(), gruende: [`der Lauf ${id}: Abruf fehlgeschlagen: ${einzeiler(fehler.message)}`] };
  }
}

function juengsteBelege(gesammelt) {
  const entschieden = new Map();
  for (const { beobachtet } of gesammelt) {
    for (const [ort, belege] of beobachtet) if (!entschieden.has(ort)) entschieden.set(ort, belege);
  }
  const einmalig = new Map([...entschieden.values()].flatMap((belege) => belege ?? []).map((beleg) => [JSON.stringify([beleg.seite, beleg.eintrag.schluessel, beleg.eintrag.stand]), beleg]));
  return [...einmalig.values()];
}

function abrufen({ ids, herkunft, echt }) {
  const gesammelt = ids.map((id) => belegeAusLauf(id, herkunft));
  const belege = juengsteBelege(gesammelt);
  if (belege.length === 0) return ohneVorergebnis([...new Set(gesammelt.flatMap(({ gruende }) => gruende))].join("; ") || OHNE_BELEG);
  const laeufe = [...new Set(belege.map(({ lauf }) => lauf))].sort((links, rechts) => rechts - links);
  const testdateien = Object.fromEntries(laeufe.map((lauf) => [lauf, gesammelt[ids.indexOf(lauf)].testdateien]));
  const inhalt = { lauf: laeufe[0], laeufe, umgebung: version, echt, belege, testdateien };
  return { ...inhalt, kennung: hashVon(inhalt) };
}

function laufNummern(umgebung) {
  const pullRequest = pullRequestNummer(umgebung);
  if (pullRequest !== null) return vorlaeufeImPullRequest(umgebung, pullRequest);
  const nachricht = git(["log", "-1", "--format=%B", "HEAD"]);
  if (umgebung.GITHUB_EVENT_NAME !== ABRUF_EREIGNIS || !String(umgebung.GITHUB_REF_NAME).startsWith(ABRUF_ZWEIG)) return { grund: "kein Abruf der Mutationsprüfung" };
  const treffer = VORLAUF_ZEILE.exec(nachricht);
  if (!ABRUF_AUFTRAG.test(nachricht) || treffer === null) return { grund: "der Commit nennt keinen Vorlauf" };
  if (Number(treffer[1]) >= Number(umgebung.GITHUB_RUN_ID)) return { grund: "der genannte Lauf ist nicht älter als dieser" };
  return { ids: [Number(treffer[1])], uebernimmt: true };
}

function abgerufen(umgebung) {
  try {
    const gewaehlt = laufNummern(umgebung);
    return gewaehlt.ids === undefined ? ohneVorergebnis(gewaehlt.grund) : abrufen({ ids: gewaehlt.ids, herkunft: gewaehlt.herkunft, echt: gewaehlt.uebernimmt === true });
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
  const schatten = ergebnis.echt ? "" : " Schattenmodus: nichts wird übernommen.";
  return `Mutationsprüfung: Vorergebnis aus Lauf ${ergebnis.laeufe.join(", ")}, ${ergebnis.belege.length} bestätigt getötete Mutanten.${schatten}`;
}
