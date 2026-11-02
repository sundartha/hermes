import { writeFileSync } from "node:fs";
import { env, version } from "node:process";
import { isDeepStrictEqual } from "node:util";

import { git } from "../auftrag/git.mjs";
import { entferneTempOrdner, neuerTempOrdner } from "../temp-ordner.mjs";
import { ABRUF_EREIGNIS, ABRUF_ZWEIG, abrufLaufBefund, gh, ghRepo } from "./gh.mjs";
import { grundlageImBaum, hashVon } from "./mutantenstand.mjs";
import { aufgeloest, eintraegeJeMutant, geladeneTeildateien, keinVorergebnisZeile, mitBeleg, ohneVorergebnis, zusammengefasst } from "./uebernahme.mjs";
import { beendet, pullRequestNummer, vorlaeufeImPullRequest } from "./vorlauf-pr.mjs";

const ABRUF_AUFTRAG = /^Auftrag: lauf\/in-ci$/m;
const VORLAUF_ZEILE = /^Vorlauf: ([1-9]\d*)$/m;
const ARTEFAKTE = "mutation-teil-*";
const SEITEN = new Set(["alt", "neu"]);
const COMMIT = /^[0-9a-f]{40}$/;
const MELDUNG_ZEICHEN = 160;
const LEERRAUM = /\s+/g;
const OHNE_BELEG = "kein bestätigt getöteter Mutant mit Stand der betroffenen Dateien";
const KOPF_NICHT_NACHPRUEFBAR = "Kopf des Vorlaufs nicht nachprüfbar";
const ANDERE_GRUNDLAGE = "hat mit anderem Werkzeug, Workflow oder anderen Daten gemessen als dieser Lauf";

function einzeiler(text) {
  return String(text).replace(LEERRAUM, " ").trim().slice(0, MELDUNG_ZEICHEN);
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

function beobachtungenDesLaufs(berichte, lauf) {
  const seiten = berichte[0].pruefungen.map(({ seite }) => seite);
  const beobachtet = new Map();
  for (const [schluessel, eintraege] of eintraegeJeMutant(berichte)) {
    const [pruefung, mutant] = JSON.parse(schluessel);
    if (seiten[pruefung] === undefined || !vollstaendigGemessen(eintraege)) continue;
    const eintrag = zusammengefasst(eintraege);
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

function commitHolen(commit) {
  try {
    aufgeloest(commit);
  } catch {
    git(["fetch", "--quiet", "--no-tags", "origin", commit]);
    aufgeloest(commit);
  }
}

function elternVon(commit) {
  return git(["rev-list", "--parents", "-n", "1", commit]).trim().split(LEERRAUM).slice(1);
}

function nachpruefbarerKopf({ kopf }, lauf) {
  if (!COMMIT.test(String(kopf))) return null;
  try {
    commitHolen(kopf);
  } catch {
    return null;
  }
  return kopf === lauf.head_sha || elternVon(kopf)[1] === lauf.head_sha ? kopf : null;
}

function laufPruefen(lauf, id, herkunft) {
  const befund = beendet(lauf) ? abrufLaufBefund(lauf, ghRepo(), herkunft) : "ist nicht beendet";
  return befund === null ? null : `der Lauf ${id} ${befund}`;
}

function berichteGeprueft(id, lauf, repo) {
  const berichte = berichteDesLaufs(id, repo);
  const fehlt = luecke(berichte);
  if (fehlt !== null) return { grund: `der Lauf ${id} ${fehlt}` };
  if (berichte[0].umgebung !== version) return { grund: `andere Node-Version (${berichte[0].umgebung})` };
  const kopf = nachpruefbarerKopf(berichte[0], lauf);
  return kopf === null ? { grund: `der Lauf ${id}: ${KOPF_NICHT_NACHPRUEFBAR}` } : { berichte, kopf };
}

function belegeAusLauf(id, { herkunft, jetzt }) {
  try {
    const repo = ghRepo();
    const lauf = JSON.parse(gh(["api", `repos/${repo}/actions/runs/${id}`]));
    const unpassend = laufPruefen(lauf, id, herkunft);
    if (unpassend !== null) return { beobachtet: new Map(), gruende: [unpassend] };
    const { berichte, kopf, grund } = berichteGeprueft(id, lauf, repo);
    if (grund !== undefined) return { beobachtet: new Map(), gruende: [grund] };
    const testdateien = typeof berichte[0].testdateien === "object" && berichte[0].testdateien !== null ? berichte[0].testdateien : {};
    if (!isDeepStrictEqual(grundlageImBaum(kopf), jetzt)) return { beobachtet: new Map(), gruende: [], verworfen: `der Lauf ${id} ${ANDERE_GRUNDLAGE}`, testdateien };
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

function meldeVerworfene(gesammelt) {
  for (const { verworfen } of gesammelt.filter((ergebnis) => ergebnis.verworfen !== undefined)) console.log(`Mutationsprüfung: keine Belege, ${verworfen}.`);
}

function vorergebnisAus(ids, gesammelt, echt) {
  const belege = juengsteBelege(gesammelt);
  const gueltig = ids.filter((_id, nummer) => gesammelt[nummer].gruende.length === 0);
  if (belege.length === 0 && gueltig.length === 0) return ohneVorergebnis([...new Set(gesammelt.flatMap(({ gruende }) => gruende))].join("; ") || OHNE_BELEG);
  const laeufe = [...new Set(belege.length === 0 ? gueltig : belege.map(({ lauf }) => lauf))].sort((links, rechts) => rechts - links);
  const testdateien = Object.fromEntries(laeufe.map((lauf) => [lauf, gesammelt[ids.indexOf(lauf)].testdateien]));
  const inhalt = { lauf: laeufe[0], laeufe, umgebung: version, echt, belege, testdateien };
  return { ...inhalt, kennung: hashVon(inhalt) };
}

function abrufen({ ids, herkunft, echt }) {
  const jetzt = grundlageImBaum("HEAD");
  const gesammelt = ids.map((id) => belegeAusLauf(id, { herkunft, jetzt }));
  meldeVerworfene(gesammelt);
  return vorergebnisAus(ids, gesammelt, echt);
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

export function holeVorergebnis(ziel, umgebung = env) {
  const ergebnis = abgerufen(umgebung);
  writeFileSync(ziel, `${JSON.stringify(ergebnis)}\n`);
  if (ergebnis.lauf === null) return keinVorergebnisZeile(ergebnis.grund);
  const schatten = ergebnis.echt ? "" : " Schattenmodus: nichts wird übernommen.";
  return `Mutationsprüfung: Vorergebnis aus Lauf ${ergebnis.laeufe.join(", ")}, ${ergebnis.belege.length} bestätigt getötete Mutanten.${schatten}`;
}
