import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { kenntZweck, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { REPO_ROOT } from "./probe-repo.js";

const QUELLORDNER = ["tools", "scripts"];
const QUELLENDUNGEN = [".mjs", ".js"];
const WORKFLOWORDNER = ".github";
const WORKFLOWENDUNG = ".yml";
const ZUORDNUNG = "tools/zweck/zuordnung/workflow-schritte.json";

export function quelltext(pfad) {
  return readFileSync(join(REPO_ROOT, pfad), "utf8");
}

export function eintraegeDerZuordnung() {
  return JSON.parse(quelltext(ZUORDNUNG));
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
