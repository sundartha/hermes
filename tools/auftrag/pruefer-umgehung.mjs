import { inhaltNachCommit } from "./pruefer-arbeitsordner.mjs";
import { gitAusgabe } from "./pruefer-auswahl.mjs";
import { ANORDNUNG, BLOCKER, NACHBAU } from "./pruefer-schema.mjs";

const STELLE = /^(.+):(\d+)(?:-(\d+))?$/;
const LEERRAUM = /\s+/g;
const ZEILENUMBRUCH = "\n";
const NUL = "\0";
const BASIS_PRAEFIX = "basis/";
const DATEIEN_PRAEFIX = "dateien/";

function stelleAus(wert, praefix) {
  const treffer = STELLE.exec(wert.trim());
  if (!treffer) return null;
  const [, roh, von, bis = von] = treffer;
  const datei = roh.startsWith(praefix) ? roh.slice(praefix.length) : roh;
  const [anfang, ende] = [Number(von), Number(bis)];
  return anfang >= 1 && ende >= anfang ? { datei, anfang, ende } : null;
}

function zeilenAm(rev, datei, root) {
  return inhaltNachCommit(rev, datei, root)?.toString("utf8").split(ZEILENUMBRUCH) ?? null;
}

function block(rev, { datei, anfang, ende }, root) {
  const zeilen = zeilenAm(rev, datei, root);
  if (!zeilen || ende > zeilen.length) return null;
  const teil = zeilen.slice(anfang - 1, ende);
  return teil.some((zeile) => zeile.trim() !== "") ? teil : null;
}

function stehtIn(zeilen, teil) {
  if (!zeilen) return false;
  const gesucht = teil.join(ZEILENUMBRUCH);
  return [...zeilen.keys()].some(
    (index) => zeilen.slice(index, index + teil.length).join(ZEILENUMBRUCH) === gesucht,
  );
}

function dateienMit(rev, zeile, root) {
  try {
    const treffer = gitAusgabe(["grep", "-l", "-z", "-F", "-e", zeile, rev, "--"], root);
    return treffer.split(NUL).filter(Boolean).map((name) => name.slice(rev.length + 1));
  } catch {
    return [];
  }
}

function standAufBasis(basis, teil, root) {
  const anker = teil.find((zeile) => zeile.trim() !== "");
  return dateienMit(basis, anker, root).some((datei) => stehtIn(zeilenAm(basis, datei, root), teil));
}

function nachbauGrund(befund, sha, { root, basis, head }) {
  const vorhanden = stelleAus(befund.vorhanden, BASIS_PRAEFIX);
  const neu = stelleAus(befund.neu, DATEIEN_PRAEFIX);
  if (!vorhanden || !neu) return "Stelle nicht in der Form <Datei>:<von>-<bis>";
  const alt = block(basis, vorhanden, root);
  if (!alt) return "vorhandene Stelle fehlt auf der Basis";
  if (!stehtIn(zeilenAm(head, vorhanden.datei, root), alt)) return "vorhandene Stelle im PR geändert";
  const hinzu = block(sha, neu, root);
  if (!hinzu) return "neue Stelle fehlt im Commit";
  if (standAufBasis(basis, hinzu, root)) return "neue Stelle stand schon auf der Basis";
  return stehtIn(zeilenAm(head, neu.datei, root), hinzu) ? "" : "neue Stelle fehlt am Endstand";
}

function normalisiert(text) {
  return text.replace(LEERRAUM, " ").trim();
}

function anordnungGrund(befund, { auftragstext, nachrichten }) {
  const zitat = normalisiert(befund.zitat);
  if (zitat === "") return "Zitat leer";
  const quellen = [auftragstext, ...nachrichten].map(normalisiert);
  return quellen.some((quelle) => quelle.includes(zitat)) ? "" : "Zitat fehlt in Issue und Commit-Nachrichten";
}

const PRUEFUNGEN = new Map([
  [NACHBAU, nachbauGrund],
  [ANORDNUNG, (befund, _sha, lage) => anordnungGrund(befund, lage)],
]);

function zuBelegen(befund) {
  return befund.schwere === BLOCKER && !befund.sicherheit && PRUEFUNGEN.has(befund.umgehung);
}

function belegt(befund, sha, lage) {
  if (!zuBelegen(befund)) return befund;
  const grund = PRUEFUNGEN.get(befund.umgehung)(befund, sha, lage);
  return { ...befund, belegt: grund === "", belegGrund: grund };
}

export function belegeUmgehungen(commits, lage) {
  return commits.map((commit) => ({
    ...commit,
    befunde: commit.befunde.map((befund) => belegt(befund, commit.sha, lage)),
  }));
}
