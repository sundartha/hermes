import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MELDUNG, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { funktion, ROTER_TEST } from "./auftrag-lauf-hilfen.js";
import { BASIS, EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import { CI_LOKAL_ROT, ciLokalAufrufe, mitCiLokal } from "./ersatz-werkzeuge.js";
import { REPO_ROOT, commitAll, runIn, writeFiles } from "./probe-repo.js";

const DREHBUCH = {
  test: { "test/rechnen.test.js": ROTER_TEST },
  bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
};

function ciLokal(exitCode) {
  return mitCiLokal(BASIS["package.json"], exitCode);
}

function betreffeSeit(repo, basis) {
  return runIn(repo, "git", ["log", "--format=%s", `${basis}..HEAD`]).stdout.split("\n").filter(Boolean);
}

test("nach dem letzten Auftrag der Phase fährt lauf ci-lokal einmal gegen die Basis des PRs ohne die teuren Schritte", (context) => {
  const { werkzeug, lauf, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, dateien: ciLokal(0) });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(ciLokalAufrufe(werkzeug), [["--basis", basis]]);
  assert.match(lauf.stdout, /^ci-lokal: grün$/m);
});

test("ist ci-lokal am Ende der Phase rot, endet lauf rot mit den roten Schritten und dem Zweck, der Auftrag bleibt committet", (context) => {
  const { repo, werkzeug, lauf, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, dateien: ciLokal(1) });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(ciLokalAufrufe(werkzeug).length, 1);
  assert.ok(lauf.stdout.includes(CI_LOKAL_ROT), lauf.stdout);
  assert.ok(lauf.stderr.includes(`ci-lokal gegen die Basis ${basis} endete mit Exit 1`), lauf.stderr);
  assert.ok(lauf.stderr.includes(zweckBlock(MELDUNG.CI_LOKAL).join("\n")), lauf.stderr);
  assert.deepEqual(betreffeSeit(repo, basis), ["Verdopple Zahlen"]);
});

test("baut lauf nichts, weil jeder Auftrag schon gebaut ist, fährt es ci-lokal nicht noch einmal und sagt das mit dem Befehl samt Basis", (context) => {
  const vorbereiten = (repo) => {
    writeFiles(repo, { "src/rechnen.js": DREHBUCH.bau["src/rechnen.js"] });
    commitAll(repo, "Verdopple Zahlen\n\nWarum: gebaut.\n\nAuftrag: probe/A1\nArt: funktion");
  };
  const { werkzeug, lauf, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, dateien: ciLokal(1), vorbereiten });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Auftrag A1: schon gebaut, übersprungen\./);
  assert.deepEqual(ciLokalAufrufe(werkzeug), []);
  assert.ok(lauf.stdout.includes("ci-lokal nicht gelaufen"), lauf.stdout);
  assert.ok(lauf.stdout.includes(`node tools/ci-lokal.mjs --basis ${basis}`), lauf.stdout);
});

test("lehnt commitlint die Nachricht des Auftrags ab, committet lauf nicht und fährt ci-lokal nicht", (context) => {
  const auftrag = { ...funktion("2 !== 4"), ziel: "fixup! Verdopple Zahlen" };
  const { repo, werkzeug, lauf, beleg, basis } = starte(context, { auftrag, drehbuch: DREHBUCH, dateien: ciLokal(0) });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  const commitlint = beleg.pruefungen.find(({ name }) => name === "commitlint");
  assert.notEqual(commitlint?.exitCode, 0, JSON.stringify(beleg.pruefungen.map(({ name, exitCode }) => [name, exitCode])));
  assert.equal(beleg.pruefungen.some(({ name }) => name === "commit"), false);
  assert.deepEqual(betreffeSeit(repo, basis), ["Zwischenstand: Abnahmetest für A1"]);
  assert.deepEqual(ciLokalAufrufe(werkzeug), []);
});

test("fehlt upstream/master, hält lauf am Ende der Phase rot an, nennt die fehlende Basis mit Zweck und fährt ci-lokal nicht", (context) => {
  const { werkzeug, lauf } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, dateien: ciLokal(0), mitUpstream: false });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.includes("upstream/master fehlt oder hat keinen gemeinsamen Commit mit HEAD"), lauf.stderr);
  assert.ok(lauf.stderr.includes(zweckBlock(MELDUNG.CI_LOKAL).join("\n")), lauf.stderr);
  assert.deepEqual(ciLokalAufrufe(werkzeug), []);
});

test("teillauf baut den Auftrag, fährt ci-lokal nicht und sagt das mit dem Befehl samt Basis", (context) => {
  const { werkzeug, lauf, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, dateien: ciLokal(1), befehl: "teillauf" });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(ciLokalAufrufe(werkzeug), []);
  assert.ok(lauf.stdout.includes("ci-lokal nicht gelaufen: teillauf fährt ci-lokal nie"), lauf.stdout);
  assert.ok(lauf.stdout.includes(`node tools/ci-lokal.mjs --basis ${basis}`), lauf.stdout);
});

test("am Phasenende führt lauf den günstigen Schritt der echten ci-lokal-Liste aus und den teuren nicht", (context) => {
  const paket = JSON.parse(BASIS["package.json"]);
  const scripts = { ...paket.scripts, "ci:lokal": `node ${JSON.stringify(join(REPO_ROOT, "tools/ci-lokal.mjs"))}` };
  const liste = { schritte: [{ name: "guenstig", befehl: "touch \"$HOME/guenstig.txt\"" }, { name: "teuer", teuer: true, befehl: "touch \"$HOME/teuer.txt\"" }], nurCi: {} };
  const dateien = { "package.json": JSON.stringify({ ...paket, scripts }), "tools/ci-lokal.json": JSON.stringify(liste) };
  const { werkzeug, lauf } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, dateien });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(existsSync(join(werkzeug, "guenstig.txt")), lauf.stdout);
  assert.equal(existsSync(join(werkzeug, "teuer.txt")), false, lauf.stdout);
  assert.match(lauf.stdout, /^teuer nicht gelaufen \(teuer, nur mit --mit-teuren\)$/m);
});
