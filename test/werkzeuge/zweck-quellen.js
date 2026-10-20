import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { kenntZweck, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { REPO_ROOT } from "./probe-repo.js";

const QUELLORDNER = ["tools", "scripts"];
const QUELLENDUNGEN = [".mjs", ".js"];
const WORKFLOWORDNER = ".github";
const WORKFLOWENDUNG = ".yml";

export function quelltext(pfad) {
  return readFileSync(join(REPO_ROOT, pfad), "utf8");
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
