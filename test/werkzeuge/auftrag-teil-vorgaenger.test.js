import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ROTER_TEST, VERDOPPELT, funktion } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import { gemergteVorgaenger } from "../../tools/auftrag/teil-vorgaenger.mjs";
import { commitAll, mitUpstreamMaster, outputLines, probeRepository, runIn, writeFiles } from "./probe-repo.js";

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

const UMBAU_TEIL = "P-9-t1-t1-umbau";
const REGEL_TEIL = "P-9-t1-t2-regel";

function geteiltAbgelegt(repo, vorgaenger = ERSTER, teile = [{ kuerzel: "t1", name: "umbau" }, { kuerzel: "t2", name: "regel" }]) {
  writeFiles(repo, { [`plaene/${vorgaenger}/planung/teile.json`]: `${JSON.stringify({ teile })}\n` });
  commitAll(repo, `Plane ${vorgaenger}: Teile`);
}

test("Teil-Vorgänger: ist ein Vorgänger laut teile.json auf upstream/master geteilt und sind alle Unter-Teile gemergt, startet lauf wie bisher", (context) => {
  const vorbereiten = (repo) => {
    geteiltAbgelegt(repo);
    [UMBAU_TEIL, REGEL_TEIL, DRITTER].forEach((teil) => gebaut(repo, teil));
  };
  const { lauf } = teilLauf(context, { vorbereiten });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /Vorgänger/);
});

test("Teil-Vorgänger: fehlt von einem geteilten Vorgänger ein Unter-Teil auf upstream/master, nennt der Befund den Unter-Teil und den geteilten Vorgänger", (context) => {
  const vorbereiten = (repo) => {
    geteiltAbgelegt(repo);
    [UMBAU_TEIL, DRITTER].forEach((teil) => gebaut(repo, teil));
  };
  const ergebnis = teilLauf(context, { vorbereiten });
  pruefeHalt(ergebnis, [REGEL_TEIL]);
  assert.ok(ergebnis.lauf.stderr.includes(`Vorgänger ${REGEL_TEIL} (Unter-Teil des geteilten Vorgängers ${ERSTER} laut planung/teile.json auf upstream/master) ist auf upstream/master`), ergebnis.lauf.stderr);
  assert.doesNotMatch(ergebnis.lauf.stderr, new RegExp(`Vorgänger (${UMBAU_TEIL}|${DRITTER}) `));
});

test("Teil-Vorgänger: ein ungeteilter, nicht gemergter Vorgänger neben einem geteilten, gemergten ergibt denselben Befund wie bisher", (context) => {
  const vorbereiten = (repo) => {
    geteiltAbgelegt(repo);
    [UMBAU_TEIL, REGEL_TEIL].forEach((teil) => gebaut(repo, teil));
  };
  const ergebnis = teilLauf(context, { vorbereiten });
  pruefeHalt(ergebnis, [DRITTER]);
  assert.match(ergebnis.lauf.stderr, new RegExp(`Teil ${TEIL}: Vorgänger ${DRITTER} ist auf upstream/master \\([0-9a-f]{7}\\) nicht gemergt; kein geltender Commit trägt „Auftrag: ${DRITTER}/…“ mit „Art: …“\\.`));
  assert.doesNotMatch(ergebnis.lauf.stderr, /Unter-Teil des geteilten/);
});

test("Teil-Vorgänger: eine teile.json, die nur auf dem eigenen Branch liegt, löst den Vorgänger nicht in Unter-Teile auf", (context) => {
  const vorbereiten = (repo) => {
    [UMBAU_TEIL, REGEL_TEIL, DRITTER].forEach((teil) => gebaut(repo, teil));
    mitUpstreamMaster(repo);
    geteiltAbgelegt(repo);
  };
  const { lauf } = nurErsterFehlt(context, { vorbereiten, mitUpstream: false });
  assert.doesNotMatch(lauf.stderr, /Unter-Teil des geteilten/);
});

test("Teil-Vorgänger: eine teile.json, die ihren eigenen Ordner als Unter-Teil nennt, endet im Befund für diesen Vorgänger statt in einer Schleife", (context) => {
  const kreis = "P-9-t1-erst-kreis";
  const vorbereiten = (repo) => geteiltAbgelegt(repo, kreis, [{ kuerzel: "erst", name: "kreis" }]);
  const ergebnis = teilLauf(context, { kopfzeile: `Teil von: P-9-gross; nach: ${kreis}`, vorbereiten });
  pruefeHalt(ergebnis, [kreis]);
});

test("Teil-Vorgänger: gemergteVorgaenger nennt einen geteilten Vorgänger erst, wenn alle Unter-Teile gemergt sind, mit dem Commit des letzten Unter-Teils, und einen ungeteilten wie bisher", (context) => {
  const faelle = [
    { gebaut: [UMBAU_TEIL, REGEL_TEIL, DRITTER], erwartet: [[ERSTER, REGEL_TEIL], [DRITTER, DRITTER]] },
    { gebaut: [UMBAU_TEIL, DRITTER], erwartet: [[DRITTER, DRITTER]] },
    { gebaut: [UMBAU_TEIL, REGEL_TEIL], erwartet: [[ERSTER, REGEL_TEIL]] },
  ];
  for (const { gebaut: teile, erwartet } of faelle) {
    const repo = probeRepository(context, { "README.md": "Probe\n" });
    geteiltAbgelegt(repo);
    const shas = new Map(teile.map((teil) => [teil, gebaut(repo, teil)]));
    mitUpstreamMaster(repo);
    const soll = erwartet.map(([vorgaenger, commit]) => ({ vorgaenger, sha: shas.get(commit).slice(0, 7) }));
    assert.deepEqual(gemergteVorgaenger(repo, [ERSTER, DRITTER]), soll, teile.join(", "));
  }
});
