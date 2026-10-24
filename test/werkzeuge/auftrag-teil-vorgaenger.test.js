import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ROTER_TEST, VERDOPPELT, funktion } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import { commitAll, mitUpstreamMaster, outputLines, runIn, writeFiles } from "./probe-repo.js";

const TEIL = "P-9-t2-zweit";
const ERSTER = "P-9-t1-erst";
const DRITTER = "P-9-t3-dritt";
const ORDNER = `plaene/${TEIL}`;
const DESIGN = "# Design\n\n## Ausgangslage und Annahmen\n| Aussage | Beleg |\n|---|---|\n| `verdopple` gibt die Zahl unverändert zurück | `src/rechnen.js` |\n";
const AUFTRAG = { ...funktion("2 !== 4"), prueft: ["S1"], szenarien: { S1: "Gegeben 2, dann 4." } };
const DREHBUCH = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
const BEIDE = `Teil von: P-9-gross; nach: ${ERSTER}, ${DRITTER}`;

function pitch(kopfzeile) {
  return ["# P-9: Teil t2 zweit", "", "Issue: 77", ...(kopfzeile === null ? [] : [kopfzeile]), "", "## Absicht", "Probe.", ""].join("\n");
}

function gebaut(repo, teil) {
  writeFiles(repo, { [`notizen/${teil}.txt`]: `${teil}\n` });
  commitAll(repo, `Baue ${teil}\n\nAuftrag: ${teil}/a1\nArt: funktion`);
  return runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
}

function zurueckgenommen(repo, { teil, sha }) {
  writeFiles(repo, { [`notizen/${teil}.txt`]: "zurück\n" });
  commitAll(repo, `Revert "Baue ${teil}"\n\nThis reverts commit ${sha}.`);
}

function teilLauf(context, { kopfzeile = BEIDE, vorbereiten = () => {}, mitUpstream = true, befehl = "lauf" } = {}) {
  const dateien = { [`${ORDNER}/pitch.md`]: pitch(kopfzeile), [`${ORDNER}/design.md`]: DESIGN };
  const ergebnis = starte(context, { auftrag: AUFTRAG, drehbuch: DREHBUCH, dateien, vorbereiten, mitUpstream, befehl, phase: { phase: TEIL } });
  return { ...ergebnis, agent: existsSync(join(ergebnis.werkzeug, "prompt-test.txt")) };
}

function pruefeHalt({ lauf, agent }, fehlend) {
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(agent, false);
  for (const name of fehlend) assert.match(lauf.stderr, new RegExp(`Vorgänger ${name} `), lauf.stderr);
}

function nurErsterFehlt(context, optionen) {
  const ergebnis = teilLauf(context, optionen);
  pruefeHalt(ergebnis, [ERSTER]);
  assert.doesNotMatch(ergebnis.lauf.stderr, new RegExp(DRITTER));
  return ergebnis;
}

test("Teil-Vorgänger: ohne gemergten Vorgänger hält lauf vor dem ersten Agenten und nennt jeden fehlenden Vorgänger", (context) => {
  pruefeHalt(teilLauf(context), [ERSTER, DRITTER]);
});

test("Teil-Vorgänger: tragen alle Vorgänger auf upstream/master einen Commit mit Auftrag-Trailer, startet lauf wie bisher", (context) => {
  const { lauf } = teilLauf(context, { vorbereiten: (repo) => [ERSTER, DRITTER].forEach((teil) => gebaut(repo, teil)) });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /Vorgänger/);
});

test("Teil-Vorgänger: ein Vorgänger, der nur auf dem eigenen Branch gebaut ist, zählt nicht", (context) => {
  const vorbereiten = (repo) => {
    gebaut(repo, DRITTER);
    mitUpstreamMaster(repo);
    gebaut(repo, ERSTER);
  };
  nurErsterFehlt(context, { vorbereiten, mitUpstream: false });
});

test("Teil-Vorgänger: ein Vorgänger, der auf upstream/master gemergt ist, aber dem eigenen Stand fehlt, zählt nicht", (context) => {
  const vorbereiten = (repo) => {
    gebaut(repo, DRITTER);
    gebaut(repo, ERSTER);
    mitUpstreamMaster(repo);
    runIn(repo, "git", ["reset", "-q", "--hard", "HEAD~1"]);
  };
  const { lauf } = nurErsterFehlt(context, { vorbereiten, mitUpstream: false });
  assert.match(lauf.stderr, /fehlt aber im eigenen Stand/);
});

test("Teil-Vorgänger: ein zurückgenommener Vorgänger-Commit zählt nicht", (context) => {
  const vorbereiten = (repo) => {
    gebaut(repo, DRITTER);
    zurueckgenommen(repo, { teil: ERSTER, sha: gebaut(repo, ERSTER) });
  };
  nurErsterFehlt(context, { vorbereiten });
});

test("Teil-Vorgänger: ein Plan-Commit des Vorgängers ohne Zeile „Art“ zählt nicht als gebaut", (context) => {
  const vorbereiten = (repo) => {
    gebaut(repo, DRITTER);
    writeFiles(repo, { [`plaene/${ERSTER}/pitch.md`]: "# Teil\n" });
    commitAll(repo, `Lege die Teil-Ordner an\n\nAuftrag: ${ERSTER}/plan`);
  };
  nurErsterFehlt(context, { vorbereiten });
});

test("Teil-Vorgänger: ein Teil mit „nach: –“ startet ohne Vorgänger wie bisher", (context) => {
  const { lauf } = teilLauf(context, { kopfzeile: "Teil von: P-9-gross; nach: –" });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
});

test("Teil-Vorgänger: ein Pitch ohne Zeile „Teil von“ läuft unverändert", (context) => {
  const { lauf } = teilLauf(context, { kopfzeile: null });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /Teil von|Vorgänger/);
});

test("Teil-Vorgänger: eine fehlerhafte Zeile „Teil von“ ist ein Startbefund", (context) => {
  const ergebnis = teilLauf(context, { kopfzeile: `Teil von: P-9-gross nach ${ERSTER}` });
  pruefeHalt(ergebnis, []);
  assert.match(ergebnis.lauf.stderr, /pitch\.md: die Zeile „Teil von: P-9-gross nach P-9-t1-erst“ braucht die Form/);
});

test("Teil-Vorgänger: auch phase hält ohne gemergten Vorgänger, bevor es eine Integration anlegt", (context) => {
  const { repo } = nurErsterFehlt(context, { befehl: "phase", vorbereiten: (repo) => gebaut(repo, DRITTER) });
  assert.equal(outputLines(runIn(repo, "git", ["worktree", "list"]).stdout).length, 1);
});
