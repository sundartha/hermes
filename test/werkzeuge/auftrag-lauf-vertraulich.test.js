import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { phasenBefunde } from "../../tools/auftrag/format.mjs";
import { ROTER_TEST, VERDOPPELT, funktion } from "./auftrag-lauf-hilfen.js";
import { BASIS, EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import { REPO_ROOT } from "./probe-repo.js";
import { ghErsatz } from "./warteschlange/hilfen.mjs";

const PHASE = "F-999-probe";
const VERTRAULICH = { phase: PHASE, vertraulich: true, issue: undefined };
const ALTER_TEST = "test/text.test.js";
const PASST_NICHT = "Auftrag passt nicht: Die Stelle gibt es so nicht.";

function vertraulicherLauf(context, { drehbuch = {}, dateien = {}, phase = VERTRAULICH, befehl = "lauf" }) {
  const gh = ghErsatz(context);
  const ergebnis = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien, phase, umgebung: gh.umgebung, befehl });
  const belegDatei = join(ergebnis.repo, ".fortschritt", PHASE, "A1.json");
  const beleg = existsSync(belegDatei) ? JSON.parse(readFileSync(belegDatei, "utf8")) : null;
  const prompts = readdirSync(ergebnis.werkzeug).filter((name) => name.startsWith("prompt-"));
  return { ...ergebnis, beleg, prompts, gh: gh.aufrufe() };
}

function befehlMitPhase(context, befehl, felder) {
  return vertraulicherLauf(context, { phase: { phase: PHASE, issue: undefined, ...felder }, befehl });
}

test("lauf startet eine vertrauliche Phase ohne Issue und ruft GitHub nicht auf", (context) => {
  const gruen = vertraulicherLauf(context, { drehbuch: { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } } });
  assert.equal(gruen.lauf.status, 0, gruen.lauf.stdout + gruen.lauf.stderr);
  assert.ok(gruen.prompts.includes("prompt-test.txt"));
  assert.equal(gruen.beleg.ergebnis, "grün");
  assert.deepEqual(gruen.gh, []);

  const ausgestiegen = vertraulicherLauf(context, { drehbuch: { "test-antwort": PASST_NICHT } });
  assert.equal(ausgestiegen.lauf.status, EXIT_ROT, ausgestiegen.lauf.stdout + ausgestiegen.lauf.stderr);
  assert.ok(ausgestiegen.prompts.includes("prompt-test.txt"));
  assert.match(ausgestiegen.beleg.entscheidung.text, /Die Stelle gibt es so nicht/);
  assert.match(ausgestiegen.beleg.entscheidung.hinweis, /vertraulich; die Notiz steht nur im Beleg/);
  assert.deepEqual(ausgestiegen.gh, []);
});

test("lauf hält eine gewöhnliche Phase ohne Issue weiter vor dem ersten Agenten an", (context) => {
  for (const phase of [{ phase: PHASE, issue: undefined }, { phase: PHASE, issue: undefined, vertraulich: false }, { phase: "E-999-probe", issue: undefined, vertraulich: true }]) {
    const { lauf, prompts, gh } = vertraulicherLauf(context, { drehbuch: { test: { "test/rechnen.test.js": ROTER_TEST } }, phase });
    assert.equal(lauf.status, EXIT_ROT, `${JSON.stringify(phase)}: ${lauf.stdout}${lauf.stderr}`);
    assert.deepEqual([prompts, gh], [[], []], JSON.stringify(phase));
  }
});

test("im vertraulichen Modus gibt lauf keinen alten Test frei", (context) => {
  const halt = { phase: PHASE, auftrag: "A1", runde: 1, entscheidung: { text: `Alter Test ${ALTER_TEST}` }, alterTest: { datei: ALTER_TEST } };
  const geaendert = `${BASIS[ALTER_TEST]}test("gross leer", () => assert.equal(gross(""), ""));\n`;
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST, [ALTER_TEST]: geaendert }, bau: { "src/rechnen.js": VERDOPPELT } };
  const zweiter = vertraulicherLauf(context, { drehbuch, dateien: { [`.fortschritt/${PHASE}/A1.json`]: JSON.stringify(halt) } });
  assert.equal(zweiter.lauf.status, EXIT_ROT, zweiter.lauf.stdout + zweiter.lauf.stderr);
  assert.match(zweiter.lauf.stdout, /keine Freigabe für test\/text\.test\.js: die Phase ist vertraulich/);
  assert.doesNotMatch(zweiter.lauf.stdout, /gibt test\/text\.test\.js frei/);
  assert.match(JSON.stringify(zweiter.beleg), /Der Test-Agent hat einen fremden Test geändert: test\/text\.test\.js/);
  assert.deepEqual(zweiter.gh, []);

  const meldung = `Alter Test hält altes Verhalten fest: ${ALTER_TEST}:gross – erwartet die alte Schreibweise`;
  const gemeldet = vertraulicherLauf(context, { drehbuch: { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT }, "bau-antwort": meldung } });
  assert.equal(gemeldet.lauf.status, EXIT_ROT, gemeldet.lauf.stdout + gemeldet.lauf.stderr);
  const { text } = gemeldet.beleg.entscheidung;
  assert.match(text, /Ein alter Test hält das Verhalten fest/);
  assert.doesNotMatch(text, /Label verhalten-geaendert|Issue #/);
  assert.match(text, /vertraulich[\s\S]*kein[\s\S]*frei[\s\S]*Advisory/);
  assert.deepEqual(gemeldet.gh, []);
});

test("phase lehnt eine vertrauliche Phasendatei ab", (context) => {
  const { lauf, repo, gh } = befehlMitPhase(context, "phase", { vertraulich: true });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /vertraulich[\s\S]*node tools\/auftrag\.mjs lauf/);
  assert.equal(existsSync(join(repo, ".claude/worktrees")), false);
  assert.deepEqual(gh, []);
});

test("pruefe lehnt eine Phasendatei mit issue und vertraulich zugleich ab", (context) => {
  const { lauf } = befehlMitPhase(context, "pruefe", { issue: 54, vertraulich: true });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /issue und vertraulich/);
  const ohneIssue = befehlMitPhase(context, "pruefe", { vertraulich: true });
  assert.equal(ohneIssue.lauf.status, 0, ohneIssue.lauf.stdout + ohneIssue.lauf.stderr);
});

test("pruefe nimmt vertraulich nur als true in der Phase eines Fehlers an", () => {
  const auftraege = [funktion("2 !== 4")];
  const fall = (felder) => phasenBefunde({ phase: PHASE, entwurf: { "src/rechnen.js": "Entwurf." }, auftraege, ...felder }, REPO_ROOT).filter((befund) => befund.includes("vertraulich"));
  const tabelle = [
    [{ vertraulich: true }, 0],
    [{ issue: 54 }, 0],
    [{ vertraulich: true, issue: 54 }, 1],
    [{ vertraulich: true, issue: null }, 1],
    [{ vertraulich: false }, 1],
    [{ vertraulich: "true" }, 1],
    [{ phase: "E-999-probe", vertraulich: true }, 1],
    [{ phase: "P-999-probe", vertraulich: true }, 1],
  ];
  for (const [felder, anzahl] of tabelle) assert.equal(fall(felder).length, anzahl, JSON.stringify(felder));
});
