import assert from "node:assert/strict";
import { linkSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { starteAgent } from "../../tools/auftrag/agenten.mjs";
import { BLOCKING_EXIT_CODE, commitPaths, ersatzClaude, probeDirectory, probeRepository, runHook, runIn } from "./probe-repo.js";

const DATEI = "test/bestehend.test.js";
const NEUE_DATEI = "test/neu.test.js";
const UMLAUT_DATEI = "test/über.test.js";
const ALT = 'test("alt", () => {});\n';
const EIGEN = 'test("eigen", () => {});\n';
const SCHAERFER = 'test("eigen, schärfer", () => {});\n';
const PHASE = "P-1";
const LAENGE_COMMIT_KENNUNG = 40;

function kopf(repo) {
  return runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
}

function festhalten(repo, trailer, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) writeFileSync(join(repo, pfad), inhalt);
  commitPaths(repo, Object.keys(dateien), `Halte Verhalten fest\n\nAuftrag: ${trailer}`);
}

function runde1(context) {
  const repo = probeRepository(context, { [DATEI]: ALT });
  const basis = kopf(repo);
  festhalten(repo, `${PHASE}/u1`, { [DATEI]: `${ALT}${EIGEN}` });
  return { repo, basis };
}

function ersetzen(repo, pfad, { alt, neu }) {
  return { tool_name: "Edit", tool_input: { file_path: join(repo, pfad), old_string: alt, new_string: neu }, cwd: repo };
}

function schreiben(repo, pfad, inhalt) {
  return { tool_name: "Write", tool_input: { file_path: join(repo, pfad), content: inhalt }, cwd: repo };
}

function hook(repo, eingabe, { rolle = "test", basis } = {}) {
  const environment = { HERMES_ROLLE: rolle, ...(basis === undefined ? {} : { HERMES_AUFTRAGSBASIS: basis }) };
  return runHook("tests-schuetzen.mjs", { cwd: repo, input: eingabe, environment });
}

test("eigener Testblock: der Test-Agent ändert Zeilen, die sein Auftrag nach der Auftragsbasis angehängt hat", (context) => {
  const { repo, basis } = runde1(context);
  const faelle = [ersetzen(repo, DATEI, { alt: EIGEN, neu: SCHAERFER }), schreiben(repo, DATEI, `${ALT}${SCHAERFER}`), schreiben(repo, DATEI, ALT)];
  for (const eingabe of faelle) {
    const ergebnis = hook(repo, eingabe, { basis });
    assert.equal(ergebnis.status, 0, `${eingabe.tool_name}: ${ergebnis.stderr}`);
  }
  writeFileSync(join(repo, DATEI), `${ALT}${EIGEN}${EIGEN}`);
  assert.equal(hook(repo, ersetzen(repo, DATEI, { alt: `${EIGEN}${EIGEN}`, neu: SCHAERFER }), { basis }).status, 0, "nicht committeter Block");
});

test("eigener Testblock: eine Zeile, die an der Auftragsbasis schon stand, bleibt gesperrt", (context) => {
  const { repo, basis } = runde1(context);
  const faelle = [
    ersetzen(repo, DATEI, { alt: ALT, neu: 'test("alt", () => { return; });\n' }),
    ersetzen(repo, DATEI, { alt: ALT, neu: "" }),
    schreiben(repo, DATEI, EIGEN),
    schreiben(repo, DATEI, `${ALT.trimEnd()}${EIGEN}`),
  ];
  for (const eingabe of faelle) {
    const ergebnis = hook(repo, eingabe, { basis });
    assert.equal(ergebnis.status, BLOCKING_EXIT_CODE, JSON.stringify(eingabe.tool_input));
    assert.match(ergebnis.stderr, /nur angehängt/);
  }
});

test("eigener Testblock: an einen Pfad, der sich von einem Pfad der Auftragsbasis nur in Groß- und Kleinschreibung oder Unicode-Normalform unterscheidet, und an einen harten Verweis wird nur angehängt", (context) => {
  const repo = probeRepository(context, { [DATEI]: ALT, [UMLAUT_DATEI]: ALT });
  const basis = kopf(repo);
  const grossgeschrieben = DATEI.replace("bestehend", "BESTEHEND");
  const zerlegt = UMLAUT_DATEI.normalize("NFD");
  writeFileSync(join(repo, grossgeschrieben), `${ALT}${EIGEN}`);
  writeFileSync(join(repo, zerlegt), `${ALT}${EIGEN}`);
  linkSync(join(repo, DATEI), join(repo, "test/verweis.test.js"));
  for (const pfad of [grossgeschrieben, zerlegt, "test/verweis.test.js"]) {
    const ergebnis = hook(repo, ersetzen(repo, pfad, { alt: ALT, neu: "" }), { basis });
    assert.equal(ergebnis.status, BLOCKING_EXIT_CODE, pfad);
    assert.match(ergebnis.stderr, /nur angehängt/);
  }
});

test("eigener Testblock: eine Testdatei, die es an der Auftragsbasis nicht gab, ändert der Test-Agent frei", (context) => {
  const { repo, basis } = runde1(context);
  festhalten(repo, `${PHASE}/u1`, { [NEUE_DATEI]: `${EIGEN}${ALT}` });
  for (const eingabe of [ersetzen(repo, NEUE_DATEI, { alt: EIGEN, neu: SCHAERFER }), schreiben(repo, NEUE_DATEI, ALT)]) {
    const ergebnis = hook(repo, eingabe, { basis });
    assert.equal(ergebnis.status, 0, `${eingabe.tool_name}: ${ergebnis.stderr}`);
  }
});

test("eigener Testblock: ohne bestimmbare Auftragsbasis wird an den Arbeitsstand nur angehängt", (context) => {
  const { repo } = runde1(context);
  for (const basis of [undefined, "", "0".repeat(LAENGE_COMMIT_KENNUNG), "f".repeat(LAENGE_COMMIT_KENNUNG), "HEAD~1", "kein commit"]) {
    const geaendert = hook(repo, ersetzen(repo, DATEI, { alt: EIGEN, neu: SCHAERFER }), { basis });
    assert.equal(geaendert.status, BLOCKING_EXIT_CODE, `Basis ${basis}`);
    assert.match(geaendert.stderr, /nur angehängt/);
    const angehaengt = hook(repo, schreiben(repo, DATEI, `${ALT}${EIGEN}${SCHAERFER}`), { basis });
    assert.equal(angehaengt.status, 0, `Basis ${basis}: ${angehaengt.stderr}`);
  }
});

test("eigener Testblock: der Bau-Agent ändert auch mit Auftragsbasis keine Tests", (context) => {
  const { repo, basis } = runde1(context);
  for (const eingabe of [ersetzen(repo, DATEI, { alt: EIGEN, neu: SCHAERFER }), schreiben(repo, NEUE_DATEI, ALT)]) {
    const ergebnis = hook(repo, eingabe, { rolle: "bau", basis });
    assert.equal(ergebnis.status, BLOCKING_EXIT_CODE, eingabe.tool_input.file_path);
    assert.match(ergebnis.stderr, /keine Tests/);
  }
});

const ERSATZ_CLAUDE = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.ERSATZ_ZIEL, process.env.HERMES_AUFTRAGSBASIS ?? "fehlt");
console.log(JSON.stringify({ type: "result", result: "fertig" }));
`;

test("eigener Testblock: der Start des Test-Agenten gibt den Commit vor den Commits seines Auftrags als HERMES_AUFTRAGSBASIS mit", (context) => {
  const ziel = ersatzClaude(context, ERSATZ_CLAUDE, { HERMES_AUFTRAGSBASIS: "geerbt" });
  const repo = probeRepository(context, { [DATEI]: ALT });
  festhalten(repo, `${PHASE}/u0`, { [DATEI]: `${ALT}${EIGEN}` });
  festhalten(repo, "P-2/u1", { [DATEI]: `${ALT}${EIGEN}${EIGEN}` });
  const vorDemAuftrag = kopf(repo);
  festhalten(repo, `${PHASE}/u1`, { [DATEI]: `${ALT}${EIGEN}${EIGEN}${SCHAERFER}` });
  festhalten(repo, `${PHASE}/u1`, { [NEUE_DATEI]: ALT });
  const nurEigene = probeDirectory(context, { [DATEI]: ALT });
  runIn(nurEigene, "git", ["init", "-q"]);
  festhalten(nurEigene, `${PHASE}/u1`, { [DATEI]: `${ALT}${EIGEN}` });
  const faelle = [
    { id: "u1", rolle: "test", root: repo, erwartet: vorDemAuftrag },
    { id: "u2", rolle: "test", root: repo, erwartet: kopf(repo) },
    { id: "u1", rolle: "bau", root: repo, erwartet: "fehlt" },
    { id: "u1", rolle: "test", root: nurEigene, erwartet: "fehlt" },
    { id: "u1", rolle: "test", root: probeDirectory(context, {}), erwartet: "fehlt" },
  ];
  for (const { id, rolle, root, erwartet } of faelle) {
    const auftrag = { id, bereich: "src/x.js", abnahme: "test/x.test.js", erwarteteDateien: [] };
    const lauf = starteAgent({ rolle, phase: { phase: PHASE }, auftrag, root }, "Auftrag");
    assert.equal(lauf.exitCode, 0, lauf.fehlerausgabe);
    assert.equal(readFileSync(ziel, "utf8"), erwartet, `${rolle} ${id} ${root}`);
  }
});
