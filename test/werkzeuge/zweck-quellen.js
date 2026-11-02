import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { kenntZweck, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { REPO_ROOT } from "./probe-repo.js";

const QUELLORDNER = ["tools", "scripts"];
const QUELLENDUNGEN = [".mjs", ".js"];
const WORKFLOWORDNER = ".github";
const WORKFLOWENDUNG = ".yml";
export const ZUORDNUNG = "tools/zweck/zuordnung/workflow-schritte";
const SCHRITT_TRENNER = " › ";
const ZUORDNUNGSENDUNG = ".json";
const UMLAUTE = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

export function quelltext(pfad) {
  return readFileSync(join(REPO_ROOT, pfad), "utf8");
}

function ohneUmlaute(text) {
  return text.toLowerCase().replace(/[äöüß]/g, (zeichen) => UMLAUTE[zeichen]);
}

function kurzname(text) {
  return ohneUmlaute(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function dateiFuerSchritt(schritt) {
  const [datei, ...teile] = schritt.split(SCHRITT_TRENNER);
  const quelle = datei.replace(/^\.github\//, "").replace(/\.yml$/, "").replace(/\/action$/, "");
  return [quelle, ...teile.slice(0, -1), `${kurzname(teile.at(-1))}${ZUORDNUNGSENDUNG}`].join("/");
}

export function zuordnungAus(dateien) {
  const eintraege = {};
  for (const { pfad, text } of dateien) {
    assert.ok(pfad.endsWith(ZUORDNUNGSENDUNG), `${ZUORDNUNG}/${pfad}: keine JSON-Datei`);
    const { schritt, ...eintrag } = JSON.parse(text);
    assert.ok(typeof schritt === "string" && schritt.includes(SCHRITT_TRENNER), `${ZUORDNUNG}/${pfad}: Feld schritt fehlt`);
    assert.equal(pfad, dateiFuerSchritt(schritt), `${ZUORDNUNG}/${pfad}: der Eintrag für „${schritt}“ gehört nach ${ZUORDNUNG}/${dateiFuerSchritt(schritt)}`);
    eintraege[schritt] = eintrag;
  }
  return eintraege;
}

function dateienUnter(ordner) {
  const dateien = readdirSync(ordner, { recursive: true, withFileTypes: true }).filter((eintrag) => eintrag.isFile());
  return dateien.map((eintrag) => relative(ordner, join(eintrag.parentPath, eintrag.name))).toSorted();
}

function zuordnungsdateien() {
  const pfade = dateienUnter(join(REPO_ROOT, ZUORDNUNG));
  return pfade.map((pfad) => ({ pfad, text: quelltext(join(ZUORDNUNG, pfad)) }));
}

export function eintraegeDerZuordnung() {
  return zuordnungAus(zuordnungsdateien());
}

export function urteilt(eintrag) {
  return eintrag.zweck !== undefined || eintrag.gruppen !== undefined;
}

export function dateienMitEndung(ordner, endungen) {
  return readdirSync(join(REPO_ROOT, ordner), { recursive: true, withFileTypes: true })
    .filter((eintrag) => eintrag.isFile() && endungen.some((endung) => eintrag.name.endsWith(endung)))
    .map((eintrag) => join(eintrag.parentPath, eintrag.name).slice(REPO_ROOT.length));
}

function zweckDatei(bereich) {
  return JSON.parse(quelltext(`tools/zweck/${bereich}.json`));
}

function literaleIn(pfad, bereich) {
  const literal = new RegExp(`["'\`](${bereich}/[a-z-]+)["'\`]`, "g");
  return [...quelltext(pfad).matchAll(literal)].map(([, id]) => id);
}

function zweckZeigenIn(pfad, bereich) {
  const aufruf = new RegExp(`node tools/zweck-zeigen\\.mjs ((?:${bereich}/[a-z-]+ ?)+)`, "g");
  return [...quelltext(pfad).matchAll(aufruf)].flatMap(([, ids]) => ids.trim().split(" "));
}

function genutzteIds(bereich) {
  const quellen = QUELLORDNER.flatMap((ordner) => dateienMitEndung(ordner, QUELLENDUNGEN));
  const workflows = dateienMitEndung(WORKFLOWORDNER, [WORKFLOWENDUNG]);
  return new Set([...quellen.flatMap((pfad) => literaleIn(pfad, bereich)), ...workflows.flatMap((pfad) => zweckZeigenIn(pfad, bereich))]);
}

export function nurGenutzteIds(bereich, weitere = []) {
  const genutzt = new Set([...genutzteIds(bereich), ...weitere]);
  for (const id of genutzt) assert.ok(kenntZweck(id), `kein Text für ${id}`);
  assert.deepEqual(Object.keys(zweckDatei(bereich)).toSorted(), [...genutzt].toSorted());
}

export function blockDanach(zeilen, id, nach) {
  const block = zweckBlock(id);
  const anfang = zeilen.indexOf(block[0]);
  const befund = zeilen.findIndex((zeile) => nach.test(zeile));
  return { block, anfang, befund, gefunden: anfang > befund && befund >= 0 ? zeilen.slice(anfang, anfang + block.length) : [] };
}

const JOBS = /^jobs:\s*$/;
const JOB = /^ {2}([\w-]+):\s*$/;
const JOBNAME = /^ {4}name:\s*(.+?)\s*$/;
const SCHRITTE = /^(\s*)steps:\s*$/;
const EIGENSCHAFT = /^([\w-]+):\s*(.*)$/;
const LISTENEINZUG = 2;

function eigenschaftAus(text) {
  const [, schluessel, wert] = EIGENSCHAFT.exec(text ?? "") ?? [];
  return schluessel === undefined ? {} : { [schluessel]: wert };
}

function kopfzeile(zustand, zeile) {
  const job = zustand.imJobs ? JOB.exec(zeile) : null;
  if (job) return { ...zustand, job: job[1], einzug: null };
  const name = zustand.job && zustand.einzug === null ? JOBNAME.exec(zeile) : null;
  if (name) zustand.jobnamen.set(zustand.job, name[1]);
  const liste = SCHRITTE.exec(zeile);
  if (liste) return { ...zustand, einzug: liste[1].length + LISTENEINZUG };
  return JOBS.test(zeile) ? { ...zustand, imJobs: true } : null;
}

function schrittzeile({ einzug, job }, zeile, schritte) {
  const eintrag = new RegExp(`^ {${einzug}}- (.*)$`).exec(zeile);
  if (eintrag) schritte.push({ job, werte: {}, roh: [] });
  const letzter = schritte.at(-1);
  if (letzter === undefined) return;
  letzter.roh.push(zeile);
  const text = eintrag?.[1] ?? new RegExp(`^ {${einzug + LISTENEINZUG}}(\\S.*)$`).exec(zeile)?.[1];
  Object.assign(letzter.werte, eigenschaftAus(text));
}

export function workflowSchritte(pfad) {
  let zustand = { job: null, einzug: null, imJobs: false, jobnamen: new Map() };
  const schritte = [];
  for (const zeile of quelltext(pfad).split("\n")) {
    const neu = kopfzeile(zustand, zeile);
    if (neu !== null) zustand = neu;
    else if (zustand.einzug !== null) schrittzeile(zustand, zeile, schritte);
  }
  return { schritte: schritte.map((schritt) => ({ datei: pfad, ...schritt })), jobnamen: zustand.jobnamen };
}

export function jobnamenVon(pfad) {
  return [...workflowSchritte(pfad).jobnamen.values()];
}
