import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT } from "./probe-repo.js";

const WORKFLOW = ".github/workflows/pruefleiter.yml";
const PFLICHT_JOBS = ["vorpruefung", "werkzeugtests", "pruefleiter"];
const JOB_KOPF = /^ {2}([^\s#]\S*):$/;

function jobBloecke(text) {
  const zeilen = text.split("\n");
  const bloecke = new Map();
  let aktuell;
  for (const zeile of zeilen.slice(zeilen.indexOf("jobs:") + 1)) {
    const id = JOB_KOPF.exec(zeile)?.[1];
    if (id !== undefined) {
      aktuell = [];
      bloecke.set(id, aktuell);
    }
    aktuell?.push(zeile);
  }
  return bloecke;
}

test("pruefleiter-zeitgrenze: die drei Jobs in pruefleiter.yml gibt es noch", () => {
  const text = readFileSync(join(REPO_ROOT, WORKFLOW), "utf8");
  for (const id of PFLICHT_JOBS) assert.ok(jobBloecke(text).has(id), `${id} fehlt in ${WORKFLOW}`);
});
