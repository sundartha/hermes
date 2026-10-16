import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { basisJobName, branchJobName } from "../../tools/tests-ausmisten/festgehalten.mjs";
import { REPO_ROOT } from "./probe-repo.js";

const WORKFLOWS = ".github/workflows";
const AUFRUFER = "tests-ausmisten.yml";
const PAKET = 3;
const JOB_ANFANG = /^ {2}\S/;
const JOB_NAME = /^ {4}name: (.+)$/;
const AUFRUF = /^ {4}uses: \.\/\.github\/workflows\/(\S+)$/;
const MATRIX_PAKET = /\$\{\{ matrix\.paket \}\}/g;

function jobs(datei) {
  const zeilen = readFileSync(join(REPO_ROOT, WORKFLOWS, datei), "utf8").split("\n");
  const bloecke = [];
  for (const zeile of zeilen.slice(zeilen.indexOf("jobs:") + 1)) {
    if (JOB_ANFANG.test(zeile)) bloecke.push([]);
    bloecke.at(-1)?.push(zeile);
  }
  return bloecke.map((block) => ({
    name: block.map((zeile) => JOB_NAME.exec(zeile)?.[1]).find(Boolean),
    aufruf: block.map((zeile) => AUFRUF.exec(zeile)?.[1]).find(Boolean),
  }));
}

function namenBeiGitHub(paket) {
  return jobs(AUFRUFER)
    .filter((job) => job.aufruf !== undefined)
    .flatMap((job) =>
      jobs(job.aufruf).map((innen) => `${job.name.replace(MATRIX_PAKET, String(paket))} / ${innen.name}`),
    );
}

test("ausmisten-jobnamen: melden sucht Basis- und Branch-Job unter den Namen, die die Workflow-Dateien GitHub geben", () => {
  const namen = namenBeiGitHub(PAKET);
  assert.ok(namen.includes(basisJobName(PAKET)), `${basisJobName(PAKET)} fehlt in ${namen.join(", ")}`);
  assert.ok(namen.includes(branchJobName(PAKET)), `${branchJobName(PAKET)} fehlt in ${namen.join(", ")}`);
});
