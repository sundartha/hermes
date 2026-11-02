import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ROTER_TEST, VERDOPPELT, funktion } from "./auftrag-lauf-hilfen.js";
import { starte, starteNochmal } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const EXIT_HALT = 75;
const HALT_ORDNER = ".fortschritt/probe";
const HALT_DATEI = `${HALT_ORDNER}/HALT`;
const GRUND = "Sitzung wird geparkt";

const VERDREIFACHT = "export function verdreifache(zahl) {\n  return zahl * 3;\n}\n";
const DREIFACH_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { verdreifache } from "../src/dreifach.js";',
  'test("verdreifacht", () => assert.equal(verdreifache(2), 6));',
  "",
].join("\n");
const ZWEITER_AUFTRAG = {
  ...funktion("Cannot find module"),
  id: "A2",
  ziel: "Verdreifache Zahlen",
  bereich: "src/dreifach.js",
  erwarteteDateien: ["src/dreifach.js", "test/dreifach.test.js"],
  abnahme: "test/dreifach.test.js",
};
const PHASE = {
  entwurf: { "src/rechnen.js": "Entwurf.", "src/dreifach.js": "Entwurf." },
  auftraege: [funktion("2 !== 4"), ZWEITER_AUFTRAG],
};
const BEIDE_AUFTRAEGE = {
  "test#0": { "test/rechnen.test.js": ROTER_TEST },
  "test#1": { "test/dreifach.test.js": DREIFACH_TEST },
  "bau#1": { "src/dreifach.js": VERDREIFACHT },
};
const HALT_WAEHREND_A1 = { ...BEIDE_AUFTRAEGE, "bau#0": { "src/rechnen.js": VERDOPPELT, [HALT_DATEI]: GRUND } };
const OHNE_HALT = { ...BEIDE_AUFTRAEGE, "bau#0": { "src/rechnen.js": VERDOPPELT } };

function betreffe(repo, basis) {
  return runIn(repo, "git", ["log", "--reverse", "--format=%s", `${basis}..HEAD`]).stdout.split("\n").filter(Boolean);
}

function startMit(context, drehbuch, vorbereiten) {
  return starte(context, { auftrag: PHASE.auftraege[0], phase: PHASE, drehbuch, vorbereiten });
}

function haltVorgelegt(repo) {
  mkdirSync(join(repo, HALT_ORDNER), { recursive: true });
  writeFileSync(join(repo, HALT_DATEI), GRUND);
}

test("wird während Auftrag A1 ein Halt angefordert, schließt lauf A1 mit Commit ab, beginnt A2 nicht und endet mit Exit 75 und dem Grund", (context) => {
  const { lauf, repo, basis } = startMit(context, HALT_WAEHREND_A1);
  assert.equal(lauf.status, EXIT_HALT, lauf.stdout + lauf.stderr);
  assert.deepEqual(betreffe(repo, basis), ["Verdopple Zahlen"]);
  assert.ok(!existsSync(join(repo, "src/dreifach.js")));
  assert.ok(!existsSync(join(repo, "test/dreifach.test.js")));
  assert.ok(lauf.stderr.includes(GRUND), lauf.stderr);
  assert.ok(lauf.stderr.includes("Auftrag A2"), lauf.stderr);
});

test("ein erneuter Start nach dem Halt baut A2 weiter und endet grün, ohne A1 noch einmal zu bauen", (context) => {
  const erster = startMit(context, HALT_WAEHREND_A1);
  assert.equal(erster.lauf.status, EXIT_HALT, erster.lauf.stdout + erster.lauf.stderr);
  const { lauf, repo } = starteNochmal(erster, OHNE_HALT);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(betreffe(repo, erster.basis), ["Verdopple Zahlen", "Verdreifache Zahlen"]);
  assert.ok(existsSync(join(repo, "src/dreifach.js")));
});

test("liegt der Halt schon beim Start vor, baut lauf keinen Auftrag und endet mit Exit 75; der nächste Start baut beide", (context) => {
  const erster = startMit(context, OHNE_HALT, haltVorgelegt);
  assert.equal(erster.lauf.status, EXIT_HALT, erster.lauf.stdout + erster.lauf.stderr);
  assert.deepEqual(betreffe(erster.repo, erster.basis), []);
  const { lauf, repo } = starteNochmal(erster, OHNE_HALT);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(betreffe(repo, erster.basis), ["Verdopple Zahlen", "Verdreifache Zahlen"]);
});

test("legt ein Agent eine Datei HALT an anderer Stelle unter .fortschritt an, bleibt das eine Veränderung der Belege und der Auftrag wird rot", (context) => {
  const drehbuch = { ...OHNE_HALT, "bau#0": { "src/rechnen.js": VERDOPPELT, ".fortschritt/probe/zusatz/HALT": GRUND } };
  const { lauf, repo, basis } = startMit(context, drehbuch);
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
  assert.ok((lauf.stdout + lauf.stderr).includes(".fortschritt/ verändert"), lauf.stdout + lauf.stderr);
  assert.deepEqual(betreffe(repo, basis), []);
});

test("ohne Halt-Datei baut lauf beide Aufträge und endet grün", (context) => {
  const { lauf, repo, basis } = startMit(context, OHNE_HALT);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(betreffe(repo, basis), ["Verdopple Zahlen", "Verdreifache Zahlen"]);
});
