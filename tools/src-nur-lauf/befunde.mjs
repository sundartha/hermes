import { isDeepStrictEqual } from "node:util";

import { AUFTRAG_LAUT_PHASE, gezeigterAuftrag } from "../auftrag/agenten.mjs";
import { NUL, auftragsCommits, auftragsTrailer, dateiAm, gebautIn, git } from "../auftrag/git.mjs";
import { VERTRAULICH_LABEL, vertraulichProblem } from "./vertraulich.mjs";

const PRODUKTCODE = "src/";
const AUFTRAG_ZEILE = /^Auftrag: ([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*)$/gm;
const ART_ZEILE = /^Art: (\S+)$/gm;
const AUFTRAG_BLOCK = /^```json\n([\s\S]*?)\n```$/m;
const VERTRAULICH = /^F-V\d/;
const ANFUEHRUNG = '"';
const KOMBINIERT = "diff --cc ";
const MERGE_GRUND = "Merge-Commit ändert src/ selbst, nicht zulässig";
const ZEILE_FEHLT = "keine einzelne Zeile „Auftrag: <Phase>/<Auftrag>“ in der Nachricht";

function phasenPfad(phase) {
  return `plaene/${phase}/phase.json`;
}

function einzeln(nachricht, muster) {
  const treffer = [...nachricht.matchAll(muster)];
  return treffer.length === 1 ? treffer[0] : null;
}

function istObjekt(wert) {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function lies(sha, pfad, root) {
  try {
    const stand = JSON.parse(dateiAm(sha, pfad, root));
    return istObjekt(stand) ? [stand] : [];
  } catch {
    return [];
  }
}

function staende(vor, phase, root) {
  const pfad = phasenPfad(phase);
  const shas = git(["log", "--full-history", "--format=%H", vor, "--", pfad], { cwd: root }).split("\n").filter(Boolean);
  return shas.flatMap((sha) => lies(sha, pfad, root));
}

function auftragIn(stand, id) {
  return Array.isArray(stand.auftraege) ? stand.auftraege.find((auftrag) => auftrag.id === id) : undefined;
}

function zettelBlock(nachricht) {
  const [, nach, ...weitere] = nachricht.split(AUFTRAG_LAUT_PHASE);
  return nach !== undefined && weitere.length === 0 ? AUFTRAG_BLOCK.exec(nach) : null;
}

function blockPasst(nachricht, auftrag) {
  const block = zettelBlock(nachricht);
  if (block === null) return false;
  try {
    return isDeepStrictEqual(JSON.parse(block[1]), gezeigterAuftrag(auftrag));
  } catch {
    return false;
  }
}

function fremdeDateien(dateien, auftrag) {
  const erwartet = new Set(auftrag.erwarteteDateien ?? []);
  return dateien.filter((datei) => !erwartet.has(datei));
}

function stimmtMitPhase({ nachricht, dateien, phase, auftrag, trailer }) {
  const art = einzeln(nachricht, ART_ZEILE);
  const fremd = fremdeDateien(dateien, auftrag);
  return [
    ...(art !== null && art[1] === auftrag.art ? [] : [`die Zeile „Art: ${auftrag.art}“ fehlt oder weicht ab`]),
    ...(gebautIn(trailer, phase, auftrag) ? [`der Auftrag ${phase}/${auftrag.id} ist am Basis-Stand oder in einem früheren Commit des PR schon gebaut`] : []),
    ...(fremd.length > 0 ? [`die src/-Datei(en) ${fremd.join(", ")} stehen nicht in erwarteteDateien von ${phase}/${auftrag.id}`] : []),
  ];
}

function ohnePhase(phase) {
  if (VERTRAULICH.test(phase)) return { vertraulich: phase };
  return [`die Phase ${phase} steht nicht in ${phasenPfad(phase)} im Verlauf vor dem Commit; die Phasendatei fehlt oder wird erst im Bau-Commit oder danach angelegt`];
}

function gruendeFuer({ sha, nachricht, dateien, root, trailer }) {
  const zeile = einzeln(nachricht, AUFTRAG_ZEILE);
  if (zeile === null) return [ZEILE_FEHLT];
  const [, phase, id] = zeile;
  const alle = staende(`${sha}^`, phase, root);
  if (alle.length === 0) return ohnePhase(phase);
  const mitAuftrag = alle.filter((kandidat) => auftragIn(kandidat, id) !== undefined);
  if (mitAuftrag.length === 0) return [`der Auftrag ${id} steht in keinem Stand von ${phasenPfad(phase)} im Verlauf vor dem Commit`];
  const passend = mitAuftrag.find((kandidat) => blockPasst(nachricht, auftragIn(kandidat, id)));
  if (passend === undefined) return [`der Auftrags-JSON-Block in der Nachricht weicht von dem Auftrag ${id} ab, der in ${phasenPfad(phase)} im Verlauf vor dem Commit steht`];
  return stimmtMitPhase({ nachricht, dateien, phase, auftrag: auftragIn(passend, id), trailer });
}

function istProdukt(datei) {
  return datei.toLowerCase().startsWith(PRODUKTCODE) || datei.startsWith(ANFUEHRUNG);
}

function geaenderteProduktdateien(sha, root) {
  const ausgabe = git(["diff-tree", "-r", "--no-commit-id", "--no-renames", "--name-only", "-z", sha], { cwd: root });
  return ausgabe.split(NUL).filter(istProdukt);
}

function eigeneProduktdateienDerZusammenfuehrung(sha, root) {
  const ausgabe = git(["-c", "core.quotepath=off", "diff-tree", "--cc", "-p", "-U0", "--no-color", "--no-commit-id", sha], { cwd: root });
  const pfade = ausgabe.split("\n").filter((zeile) => zeile.startsWith(KOMBINIERT)).map((zeile) => zeile.slice(KOMBINIERT.length));
  return pfade.filter(istProdukt);
}

function zusammenfuehrungsGruende(sha, root) {
  const dateien = eigeneProduktdateienDerZusammenfuehrung(sha, root);
  return { dateien, gruende: dateien.length > 0 ? [MERGE_GRUND] : [] };
}

function eltern(zeile) {
  const [sha, ...vorgaenger] = zeile.split(" ");
  return { sha, zusammenfuehrung: vorgaenger.length > 1 };
}

function pruefeGate(nummer) {
  return nummer === undefined ? Promise.resolve("die PR-Nummer fehlt (--pr), die Timeline ist nicht lesbar") : vertraulichProblem(nummer);
}

async function vertraulichGrund(phase, gate) {
  const problem = await gate();
  return problem === undefined ? [] : [`vertrauliche Phase ${phase}, Nachweis nicht prüfbar: ${problem}; erlaubt nur mit Label ${VERTRAULICH_LABEL} vom Bot und Approve am Kopf`];
}

async function commitBefunde({ sha, zusammenfuehrung }, { root, trailer, gate }) {
  const merge = zusammenfuehrung ? zusammenfuehrungsGruende(sha, root) : undefined;
  const dateien = merge?.dateien ?? geaenderteProduktdateien(sha, root);
  if (dateien.length === 0) return [];
  const nachricht = git(["log", "-1", "--format=%B", sha], { cwd: root });
  const gruende = merge?.gruende ?? gruendeFuer({ sha, nachricht, dateien, root, trailer });
  const aufgeloest = Array.isArray(gruende) ? gruende : await vertraulichGrund(gruende.vertraulich, gate);
  return aufgeloest.map((grund) => `${sha}: ${grund}; geändert: ${dateien.join(", ")}`);
}

export async function befunde({ basis: basisRef, kopf, pr: nummer }, root) {
  const basis = git(["rev-parse", basisRef], { cwd: root }).trim();
  const zeilen = git(["rev-list", "--parents", "--reverse", `${basis}..${kopf}`], { cwd: root }).split("\n").filter(Boolean);
  const trailerBasis = auftragsTrailer(root, basis);
  const trailerJeCommit = new Map(auftragsCommits(root, kopf).map(({ sha, trailer }) => [sha, trailer]));
  let urteil;
  const gate = () => (urteil ??= pruefeGate(nummer));
  const fruehere = [];
  const ergebnisse = [];
  for (const zeile of zeilen) {
    const commit = eltern(zeile);
    ergebnisse.push(await commitBefunde(commit, { root, trailer: [...trailerBasis, ...fruehere], gate }));
    if (trailerJeCommit.has(commit.sha)) fruehere.push(trailerJeCommit.get(commit.sha));
  }
  return ergebnisse.flat();
}
