import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { AUFTRAG, ANFANGSDATEIEN, EXIT_BEFUND, EXIT_OK, PHASE, PHASENDATEI, PLAN, ZWEITER_AUFTRAG, aendereA, imRepo, json, nachricht, pruefe, sha } from "./src-nur-lauf-hilfen.js";
import { commitAll, outputLines, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const ERSTE_ZEILEN = 2;

test("ein src-Commit mit Zeile, Block und Datei aus dem Plan auf master ist grün", (context) => {
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, nachricht()));
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(`${lauf.stdout}${lauf.stderr}`, "");
});

test("ein Commit ohne Änderung unter src braucht keine Auftrag-Zeile", (context) => {
  const { lauf } = imRepo(context, (verzeichnis) => {
    writeFiles(verzeichnis, { "docs/x.md": "x\n", "test/a.test.js": "x\n" });
    commitAll(verzeichnis, "Notiere etwas");
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("ein src-Commit ohne Zeile Auftrag ist rot und nennt Commit und Datei", (context) => {
  const { lauf, kopf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, "Ändere a.js von Hand\n"));
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.equal(outputLines(lauf.stderr).length, 1);
  assert.ok(outputLines(lauf.stderr)[0].startsWith(`${kopf}: keine einzelne Zeile „Auftrag: <Phase>/<Auftrag>“`), lauf.stderr);
  assert.ok(outputLines(lauf.stderr)[0].endsWith("geändert: src/a.js"), lauf.stderr);
  assert.equal(lauf.stdout, `${zweckBlock("github/src-nur-lauf").join("\n")}\n`);
});

test("ein src-Commit mit Zeile Auftrag von Hand, aber ohne Block ist rot", (context) => {
  const text = `Ändere a.js von Hand\n\nAuftrag: ${PHASE}/a1\nArt: funktion\n`;
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, text));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /der Auftrags-JSON-Block in der Nachricht weicht von dem Auftrag a1 ab/);
});

test("ein src-Commit, der seine Phase im selben Commit anlegt, ist rot", (context) => {
  const neu = { ...PLAN, phase: "P-neu" };
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, nachricht(neu), { "plaene/P-neu/phase.json": json(neu) }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /die Phase P-neu steht nicht in plaene\/P-neu\/phase\.json im Verlauf vor dem Commit/);
});

test("ein src-Commit, dessen Phase erst danach im selben PR angelegt wird, ist rot", (context) => {
  const neu = { ...PLAN, phase: "P-neu" };
  const { lauf } = imRepo(context, (verzeichnis) => {
    aendereA(verzeichnis, nachricht(neu));
    writeFiles(verzeichnis, { "plaene/P-neu/phase.json": json(neu) });
    commitAll(verzeichnis, "Plane P-neu");
  });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /die Phase P-neu steht nicht in plaene\/P-neu\/phase\.json im Verlauf vor dem Commit/);
});

test("ein src-Commit nach der im selben PR zuvor angelegten Phase ist grün", (context) => {
  const neu = { ...PLAN, phase: "P-neu" };
  const { lauf } = imRepo(context, (verzeichnis) => {
    writeFiles(verzeichnis, { "plaene/P-neu/phase.json": json(neu) });
    commitAll(verzeichnis, "Plane P-neu");
    aendereA(verzeichnis, nachricht(neu));
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("ein src-Commit, der den Auftrag der Phase im selben Commit erweitert, ist rot", (context) => {
  const erweitert = { ...AUFTRAG, erwarteteDateien: [...AUFTRAG.erwarteteDateien, "src/b.js"] };
  const plan = { ...PLAN, auftraege: [erweitert] };
  const zusatz = { [PHASENDATEI]: json(plan), "src/b.js": "export const b = 1;\n" };
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, nachricht(plan, erweitert), zusatz));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /der Auftrags-JSON-Block in der Nachricht weicht von dem Auftrag a1 ab/);
});

test("ein src-Commit mit einer Datei außerhalb von erwarteteDateien ist rot und nennt die Datei", (context) => {
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, nachricht(), { "src/fremd.js": "export const f = 1;\n" }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /die src\/-Datei\(en\) src\/fremd\.js stehen nicht in erwarteteDateien von P-probe\/a1/);
});

test("ein src-Commit, dessen Auftrags-JSON vom Auftrag der Phase abweicht, ist rot", (context) => {
  const verfaelscht = nachricht().replace('"src/a.js",', '"src/a.js", "src/fremd.js",');
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, verfaelscht, { "src/fremd.js": "export const f = 1;\n" }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /der Auftrags-JSON-Block in der Nachricht weicht von dem Auftrag a1 ab, der in plaene\/P-probe\/phase\.json/);
});

test("ein src-Commit mit dem Auftrags-JSON, aber ohne den vom Skript eingefügten Satz davor, ist rot", (context) => {
  const ohneSatz = nachricht().replace("Auftrag laut Phase, vom Skript eingefügt:", "Auftrag:");
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, ohneSatz));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /der Auftrags-JSON-Block in der Nachricht weicht von dem Auftrag a1 ab/);
});

test("ein src-Commit, dessen Absicht und Entwurf im Block anders lauten, ist grün", (context) => {
  const anders = nachricht().replace("a.js soll eins liefern.", "Anderer Text.").replace("a.js liefert eins.", "Anderer Entwurf.");
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, anders));
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("ein src-Commit im älteren Blockformat ohne Überschriften ist grün", (context) => {
  const alt = nachricht().replace(/## Absicht\n\n/, "").replace(/## Auftrag\n\n/, "").replace(/## Entwurf für src\/\n\n/, "");
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, alt));
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("ein src-Commit mit der Art eines anderen Auftrags ist rot", (context) => {
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, nachricht().replace("Art: funktion", "Art: umbau")));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /die Zeile „Art: funktion“ fehlt oder weicht ab/);
});

test("ein src-Commit für einen Auftrag, der auf master schon gebaut ist, ist rot", (context) => {
  const verzeichnis = probeRepository(context, ANFANGSDATEIEN);
  aendereA(verzeichnis, nachricht());
  const basis = sha(verzeichnis);
  aendereA(verzeichnis, `${nachricht()}\nNoch einmal`);
  const lauf = pruefe(verzeichnis, basis);
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /der Auftrag P-probe\/a1 ist am Basis-Stand oder in einem früheren Commit des PR schon gebaut/);
});

test("ein zweiter src-Commit für denselben Auftrag im selben PR ist rot und der erste nicht", (context) => {
  const { lauf, verzeichnis } = imRepo(context, (ordner) => {
    aendereA(ordner, nachricht());
    aendereA(ordner, `${nachricht()}\nKopie der ersten Nachricht`);
  });
  assert.equal(lauf.status, EXIT_BEFUND);
  const zweiter = sha(verzeichnis);
  assert.deepEqual(outputLines(lauf.stderr).map((zeile) => zeile.split(":")[0]), [zweiter]);
  assert.match(lauf.stderr, /schon gebaut/);
});

test("zwei src-Commits für zwei verschiedene Aufträge im selben PR sind grün", (context) => {
  const { lauf } = imRepo(context, (ordner) => {
    aendereA(ordner, nachricht());
    aendereA(ordner, nachricht(PLAN, ZWEITER_AUFTRAG));
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("ein src-Commit nach einer im Verlauf gelöschten und neu angelegten Phasendatei wird geprüft statt abzubrechen", (context) => {
  const verzeichnis = probeRepository(context, ANFANGSDATEIEN);
  rmSync(join(verzeichnis, PHASENDATEI));
  commitAll(verzeichnis, "Lösche die Phase");
  writeFiles(verzeichnis, { [PHASENDATEI]: json(PLAN) });
  commitAll(verzeichnis, "Lege die Phase neu an");
  const basis = sha(verzeichnis);
  aendereA(verzeichnis, nachricht());
  const lauf = pruefe(verzeichnis, basis);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /TypeError/);
});

test("ein src-Commit nach einer im Verlauf gelöschten Phasendatei und mit Block der alten Fassung ist grün, ohne dass das Werkzeug abbricht", (context) => {
  const verzeichnis = probeRepository(context, ANFANGSDATEIEN);
  const basis = sha(verzeichnis);
  rmSync(join(verzeichnis, PHASENDATEI));
  commitAll(verzeichnis, "Lösche die Phase");
  aendereA(verzeichnis, nachricht());
  const lauf = pruefe(verzeichnis, basis);
  assert.doesNotMatch(lauf.stderr, /TypeError|Error:/);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("ein src-Commit für einen Auftrag, den die Phase nicht kennt, ist rot", (context) => {
  const text = nachricht().replace(`Auftrag: ${PHASE}/a1`, `Auftrag: ${PHASE}/a9`);
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, text));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /der Auftrag a9 steht in keinem Stand von plaene\/P-probe\/phase\.json/);
});

test("ein src-Commit mit dem Auftrag eines früheren Stands der Phase auf master ist grün", (context) => {
  const verzeichnis = probeRepository(context, ANFANGSDATEIEN);
  const spaeter = { ...PLAN, auftraege: [{ ...AUFTRAG, prueft: "a.js liefert später eins" }] };
  writeFiles(verzeichnis, { [PHASENDATEI]: json(spaeter) });
  commitAll(verzeichnis, "Schärfe den Auftrag");
  const basis = sha(verzeichnis);
  aendereA(verzeichnis, nachricht());
  const lauf = pruefe(verzeichnis, basis);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("ein src-Commit einer vertraulichen Phase meldet, dass der Nachweis nicht prüfbar ist", (context) => {
  const text = `Ändere a.js\n\nUrsache: Auftrag a1 der Phase F-V1-wartung.\n\nAuftrag: F-V1-wartung/a1\nArt: fehlerbehebung\n`;
  const { lauf } = imRepo(context, (verzeichnis) => aendereA(verzeichnis, text));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /vertrauliche Phase F-V1-wartung, Nachweis nicht prüfbar/);
});

test("jeder von zwei src-Commits ohne Zeile wird einzeln genannt", (context) => {
  const { lauf, verzeichnis } = imRepo(context, (ordner) => {
    aendereA(ordner, "Erste Änderung\n");
    aendereA(ordner, "Zweite Änderung, etwas länger\n");
  });
  assert.equal(lauf.status, EXIT_BEFUND);
  const commits = outputLines(runIn(verzeichnis, "git", ["log", `-${ERSTE_ZEILEN}`, "--format=%H"]).stdout);
  const genannt = outputLines(lauf.stderr).map((zeile) => zeile.split(":")[0]);
  assert.deepEqual(genannt.toSorted(), commits.toSorted());
});
