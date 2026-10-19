import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { totcodeJobName } from "../../tools/tests-ausmisten/totcode-melden.mjs";
import { REPO_ROOT } from "./probe-repo.js";

const ORDNER = ".github/workflows";
const HAUPT = "totcode-messung.yml";
const PAKET = "totcode-messung-paket.yml";
const SCHRITT = "totcode-messung-schritt.yml";
const DATEIEN = [HAUPT, PAKET, SCHRITT];
const BELIEBIGES_PAKET = 3;
const OBERSTE_EBENE = /^\S/;
const JOB_KOPF = /^ {2}([\w-]+):$/;
const SCHLUESSEL = /^ {4}([\w-]+):\s*(.*)$/;
const RECHT = /^ {6}([\w-]+): (read|write)$/;
const NUTZT = /\buses:\s*(\S+)/;
const GEPINNT = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/;
const LOKAL = /^\.\/\.github\/workflows\/totcode-messung-(?:paket|schritt)\.yml$/;
const HERKUNFT =
  "(github.event.workflow_run.path == '.github/workflows/ci.yml' || startsWith(github.event.workflow_run.path, '.github/workflows/ci.yml@')) && github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.head_repository.full_name == github.repository && startsWith(github.event.workflow_run.head_branch, 'phase/') && github.event.workflow_run.conclusion == 'success'";

function zeilen(datei) {
  return readFileSync(join(REPO_ROOT, ORDNER, datei), "utf8").split("\n");
}

function block(liste, name) {
  const start = liste.indexOf(`${name}:`);
  if (start === -1) return [];
  const ende = liste.findIndex((zeile, index) => index > start && OBERSTE_EBENE.test(zeile));
  return liste.slice(start + 1, ende === -1 ? liste.length : ende);
}

function jobs(datei) {
  const ergebnis = new Map();
  let aktuell;
  for (const zeile of block(zeilen(datei), "jobs")) {
    const kopf = JOB_KOPF.exec(zeile);
    if (kopf) ergebnis.set((aktuell = kopf[1]), []);
    else if (aktuell !== undefined) ergebnis.get(aktuell).push(zeile);
  }
  return ergebnis;
}

function wert(job, schluessel) {
  return job
    .map((zeile) => SCHLUESSEL.exec(zeile))
    .find((treffer) => treffer?.[1] === schluessel)?.[2];
}

function rechte(job) {
  const start = job.findIndex((zeile) => zeile === "    permissions:");
  if (start === -1) return undefined;
  const folgende = job.slice(start + 1);
  const ende = folgende.findIndex((zeile) => !RECHT.test(zeile));
  const eintraege = folgende.slice(0, ende === -1 ? folgende.length : ende);
  return Object.fromEntries(eintraege.map((zeile) => RECHT.exec(zeile).slice(1)));
}

test("ausmisten-totcode-workflow: Auslöser ist nur workflow_run auf CI completed, run-name nennt Kopf und PR", () => {
  const haupt = zeilen(HAUPT);
  assert.equal(
    haupt.find((zeile) => zeile.startsWith("run-name:")),
    "run-name: Totcode-Messung ${{ github.event.workflow_run.head_sha }} ${{ github.event.workflow_run.pull_requests[0].number }}",
  );
  assert.deepEqual(block(haupt, "on").filter(Boolean), [
    "  workflow_run:",
    '    workflows: ["CI"]',
    "    types: [completed]",
  ]);
  for (const datei of [PAKET, SCHRITT])
    assert.deepEqual(block(zeilen(datei), "on")[0], "  workflow_call:", datei);
});

test("ausmisten-totcode-workflow: Workflow-Rechte sind leer, der Schritt erbt nur die Job-Rechte seines Aufrufers, nur melden schreibt, im Environment wartung und ohne Fremdpakete", () => {
  for (const datei of [HAUPT, PAKET]) assert.ok(zeilen(datei).includes("permissions: {}"), datei);
  assert.ok(!zeilen(SCHRITT).some((zeile) => zeile.trimStart().startsWith("permissions:")));
  for (const datei of DATEIEN) {
    for (const [name, job] of jobs(datei)) {
      const recht = rechte(job) ?? {};
      if (datei === HAUPT && name === "melden") continue;
      assert.ok(!Object.values(recht).includes("write"), `${datei} ${name}`);
      assert.equal(wert(job, "environment"), undefined, `${datei} ${name}`);
      assert.ok(!job.some((zeile) => /\bsecrets\b/.test(zeile)), `${datei} ${name}`);
    }
  }
  const melden = jobs(HAUPT).get("melden");
  assert.deepEqual(rechte(melden), { contents: "read", statuses: "write", actions: "write" });
  assert.equal(wert(melden, "environment"), "wartung");
  assert.ok(!melden.some((zeile) => zeile.includes("npm ci")));
  assert.ok(
    melden.some((zeile) => zeile.endsWith("run: node tools/tests-ausmisten.mjs totcode-melden")),
  );
  const geheim = JSON.parse(
    readFileSync(join(REPO_ROOT, "tools/basis/geheimnis-workflows.json"), "utf8"),
  );
  assert.ok(geheim.includes(HAUPT));
  assert.ok(!geheim.includes(PAKET) && !geheim.includes(SCHRITT));
});

test("ausmisten-totcode-workflow: Planen und Messen laufen nur mit contents read, ohne Token, auf master mit dem PR-Kopf als Daten", () => {
  const haupt = jobs(HAUPT);
  for (const name of ["planen", "rotprobe", "kette"])
    assert.deepEqual(rechte(haupt.get(name)), { contents: "read" }, name);
  assert.deepEqual(rechte(haupt.get("ermitteln")), {
    contents: "read",
    actions: "read",
    "pull-requests": "read",
    issues: "read",
  });
  for (const [name, job] of jobs(PAKET)) assert.deepEqual(rechte(job), { contents: "read" }, name);
  const [schritt] = jobs(SCHRITT).values();
  assert.equal(rechte(schritt), undefined);
  const text = schritt.join("\n");
  assert.ok(!/\bref:|repository:/.test(text));
  assert.match(
    text,
    /GITHUB_TOKEN: \$\{\{ inputs\.schritt == 'ermitteln' && github\.token \|\| '' \}\}/,
  );
  assert.match(text, /BASIS: \$\{\{ github\.sha \}\}/);
  assert.match(
    text,
    /KOPF: \$\{\{ github\.event\.workflow_run\.head_sha \}\}\n\s+run: git fetch --no-tags origin "\$KOPF"/,
  );
  for (const datei of DATEIEN)
    for (const zeile of zeilen(datei)) {
      const ziel = NUTZT.exec(zeile)?.[1];
      if (ziel !== undefined)
        assert.ok(GEPINNT.test(ziel) || LOKAL.test(ziel), `${datei}: ${ziel}`);
    }
});

test("ausmisten-totcode-workflow: Bedingungen der Jobs folgen Herkunft, Notwendigkeit und master-Stand", () => {
  const haupt = jobs(HAUPT);
  assert.equal(wert(haupt.get("ermitteln"), "if"), HERKUNFT);
  assert.equal(
    wert(haupt.get("planen"), "if"),
    "needs.ermitteln.outputs.noetig == 'true' && needs.ermitteln.outputs.fehler == '' && needs.ermitteln.outputs.aufmaster == 'true'",
  );
  assert.equal(wert(haupt.get("rotprobe"), "needs"), "planen");
  assert.equal(wert(haupt.get("kette"), "if"), "needs.planen.outputs.pakete != '[]'");
  assert.equal(wert(haupt.get("melden"), "needs"), "[ermitteln, planen, rotprobe, kette]");
  assert.equal(
    wert(haupt.get("melden"), "if"),
    "${{ !cancelled() && needs.ermitteln.outputs.noetig == 'true' }}",
  );
});

test("ausmisten-totcode-workflow: melden sucht Basis- und Kopf-Job unter den Namen, die die Workflow-Dateien GitHub geben", () => {
  const kette = wert(jobs(HAUPT).get("kette"), "name");
  const [schritt] = jobs(SCHRITT).values();
  const paket = jobs(PAKET);
  for (const [art, name] of [
    ["basis", "basis"],
    ["kopf", "kopf"],
  ]) {
    const voll = [
      kette.replace("${{ matrix.paket }}", String(BELIEBIGES_PAKET)),
      wert(paket.get(name), "name"),
      wert(schritt, "name"),
    ].join(" / ");
    assert.equal(voll, totcodeJobName(art, BELIEBIGES_PAKET));
  }
});

test("ausmisten-totcode-workflow: das Urteil fällt der Job „Ergebnis melden“, er braucht jede Messung und läuft ohne continue-on-error", () => {
  const melden = jobs(HAUPT).get("melden");
  assert.equal(wert(melden, "name"), "Ergebnis melden");
  for (const datei of DATEIEN)
    assert.ok(!zeilen(datei).some((zeile) => zeile.includes("continue-on-error")), datei);
});

test("ausmisten-totcode-workflow: Kopf und Rotprobe laufen nur über den Wrapper für den eigenen Benutzer, Planen und Basis messen auf master-Code direkt", () => {
  const [schritt] = jobs(SCHRITT).values();
  const aufrufe = schritt.filter((zeile) => zeile.includes("node tools/"));
  const direkt = aufrufe.filter((zeile) => zeile.includes("tools/tests-ausmisten/totcode.mjs "));
  assert.deepEqual(
    direkt.map((zeile) => zeile.trim().split(" ").slice(0, 4)),
    [
      ["node", "tools/tests-ausmisten/totcode.mjs", "planen", "--basis"],
      ["NODE_ENV=test", "node", "tools/tests-ausmisten/totcode.mjs", "basis"],
    ],
  );
  const untraut = aufrufe.filter((zeile) => zeile.includes("totcode-untraut.mjs"));
  assert.equal(untraut.length, 1, aufrufe.join("\n"));
  const fall = schritt[schritt.indexOf(untraut[0]) - 1].trim();
  assert.equal(fall, "kopf | rotprobe)");
  for (const datei of DATEIEN)
    assert.ok(!zeilen(datei).some((zeile) => /\bsudo\b/.test(zeile)), datei);
});
