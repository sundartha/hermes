import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ABSATZ_MUTATION, MIT_MUTATION, ROTER_TEST, VERDOPPELT, pruefung } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, TESTUMBAU, starte } from "./auftrag-lauf-probe.js";
import { commitAll, mitUpstreamMaster, runIn, writeFiles } from "./probe-repo.js";

const MUTANT = "src/rechnen.js:2:10 ArithmeticOperator → zahl / 2";
const GRUND = "die Zahl ohne Faktor dasselbe Ergebnis lieferte";
const ERSATZ_MUTATION = `const mutant = ${JSON.stringify(MUTANT)};
const argumente = process.argv.slice(2);
if (argumente.includes("--testumbau")) {
  if (argumente.includes("--gleichwertig")) {
    console.error("Aufruf: Testumbau mit Gleichwertig-Meldung");
    process.exitCode = 2;
  } else console.log("grün: 1 vorher getötete Mutanten werden weiter getötet.");
} else if (argumente.includes(mutant)) console.log("grün: keiner überlebt");
else {
  process.exitCode = 1;
  console.log("Verstoß: Mutant überlebt: " + mutant);
}
`;
const DATEIEN = { ...MIT_MUTATION, "mutation.mjs": ERSATZ_MUTATION };

function testumbau(context, meldung, { abweichung = null, auftrag = TESTUMBAU } = {}) {
  const drehbuch = abweichung ?? {
    test: { "test/rechnen.test.js": ROTER_TEST },
    "test-nachrunde": {},
    "test-nachrunde-antwort": [ABSATZ_MUTATION, "", meldung].join("\n"),
  };
  const vorbereiten = (repo) => {
    mitUpstreamMaster(repo);
    writeFiles(repo, { "src/rechnen.js": VERDOPPELT });
    commitAll(repo, "Verdopple in der Phase");
  };
  return starte(context, { auftrag, drehbuch, dateien: DATEIEN, vorbereiten, mitUpstream: false });
}

const OHNE_FALL_GROSS = 'import { test } from "node:test";\ntest("anders", () => {});\n';

function nachricht(repo) {
  return runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout;
}

test("meldet der Test-Agent im Testumbau einen überlebenden Mutanten der Phase mit Begründung als gleichwertig, steht die Zeile im Auftrags-Commit", (context) => {
  const { repo, lauf, beleg } = testumbau(context, `Gleichwertig: ${MUTANT}, weil ${GRUND}`);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(nachricht(repo).includes(`Gleichwertig: ${MUTANT}, weil ${GRUND}`), nachricht(repo));
  assert.match(nachricht(repo), /^Auftrag: probe\/A1$/m);
  assert.equal(pruefung(beleg, "mutation testumbau"), 0);
  assert.equal(pruefung(beleg, "mutation nach Test"), 0);
  assert.deepEqual(beleg.nachfragen, []);
});

const NACHFRAGE = "## Meldung ohne genauen Schlüssel";
const OHNE_PFAD = `Gleichwertig: ${MUTANT.slice(MUTANT.indexOf(":") + 1)}, weil ${GRUND}`;
const MIT_PFAD = `Gleichwertig: ${MUTANT}, weil ${GRUND}`;

function mitNachfrage(context, zweite, weitere = {}) {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    "test-antwort": ABSATZ_MUTATION,
    "test-nachrunde": {},
    "test-nachrunde-antwort": [ABSATZ_MUTATION, "", OHNE_PFAD].join("\n"),
    nach: NACHFRAGE,
    "test-nach-antwort": zweite,
    ...weitere,
  };
  const ergebnis = testumbau(context, "", { abweichung: drehbuch });
  const { pruefungen } = ergebnis.beleg;
  return { ...ergebnis, mutationen: pruefungen.filter(({ name }) => name.startsWith("mutation")).map(({ name }) => name) };
}

test("meldet der Test-Agent einen Mutanten ohne Dateipfad als gleichwertig, fragt der Lauf in derselben Sitzung nach den genauen Schlüsseln und nimmt die Meldung mit Pfad an", (context) => {
  const { lauf, beleg, werkzeug } = mitNachfrage(context, MIT_PFAD);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const nachfrage = readFileSync(join(werkzeug, "prompt-test-nach.txt"), "utf8");
  assert.ok(nachfrage.includes(OHNE_PFAD) && nachfrage.includes(`- ${MUTANT}\n`), nachfrage);
  const nachrunde = beleg.agenten.filter(({ rolle }) => rolle === "test").at(-1);
  assert.deepEqual(beleg.nachfragen.map(({ sitzung }) => sitzung), [nachrunde.sitzung]);
  assert.equal(pruefung(beleg, "mutation nach Test"), 0);
});

test("steht die Meldung auch nach der Nachfrage ohne genauen Schlüssel, endet der Lauf mit der Zeile und startet keine weitere Mutationsprüfung", (context) => {
  const { lauf, beleg, mutationen } = mitNachfrage(context, OHNE_PFAD);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(beleg.grund.includes(OHNE_PFAD.slice("Gleichwertig: ".length)), beleg.grund);
  assert.deepEqual(mutationen, ["mutation testumbau", "mutation"]);
});

test("ändert der Test-Agent bei der Nachfrage zur Meldung eine Datei, endet der Lauf damit und startet keine weitere Mutationsprüfung", (context) => {
  const { lauf, beleg, mutationen } = mitNachfrage(context, MIT_PFAD, { "test-nach": { "test/rechnen.test.js": `${ROTER_TEST}// geändert\n` } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, "Die Nachfrage zur Meldung hat Dateien geändert.");
  assert.deepEqual(mutationen, ["mutation testumbau", "mutation"]);
});

function nichtAngenommen(context, meldung) {
  const { repo, lauf, beleg } = testumbau(context, meldung);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(nachricht(repo), /^Gleichwertig: /m);
  assert.ok(beleg.pruefungen.every(({ befehl }) => !befehl.includes("--gleichwertig")), JSON.stringify(beleg.pruefungen.map(({ befehl }) => befehl)));
  assert.equal(pruefung(beleg, "mutation nach Test"), EXIT_ROT);
}

test("meldet der Test-Agent im Testumbau die Zeile ohne Begründung, nimmt der Lauf sie nicht in den Commit und die Mutationsprüfung bekommt keine Gleichwertig-Meldung", (context) => {
  nichtAngenommen(context, `Gleichwertig: ${MUTANT}`);
});

test("meldet der Test-Agent im Testumbau einen Mutanten, der nicht überlebt, als gleichwertig, nimmt der Lauf die Zeile nicht an", (context) => {
  nichtAngenommen(context, `Gleichwertig: src/rechnen.js:9:9 ArithmeticOperator → zahl + 2, weil ${GRUND}`);
});

test("die Testrunde zu den Mutanten der Phase im Testumbau entfernt keinen bestehenden Fall ohne Entfernt-Begründung im Auftrags-Commit", (context) => {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    "test-nachrunde": { "test/text.test.js": OHNE_FALL_GROSS },
    "test-nachrunde-antwort": ABSATZ_MUTATION,
  };
  const auftrag = { ...TESTUMBAU, erwarteteDateien: ["test/rechnen.test.js", "test/text.test.js"] };
  const { repo, lauf } = testumbau(context, "", { abweichung: drehbuch, auftrag });
  const inhalt = runIn(repo, "git", ["show", "HEAD:test/text.test.js"]).stdout;
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(inhalt.includes('test("gross"'), inhalt);
  assert.match(lauf.stdout, /Der Testumbau entfernt Fälle, die die Antwort nicht mit .*: test\/text\.test\.js: gross/);
});

test("eine begründete Entfernt-Zeile steht im Auftrags-Commit genau einmal, auch wenn die Testrunde zu den Mutanten der Phase Dateien ändert", (context) => {
  const entfernt = "Entfernt: test/text.test.js: gross, weil der Fall ist doppelt";
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST, "test/text.test.js": OHNE_FALL_GROSS },
    "test-antwort": entfernt,
    "test-nachrunde": { "test/rechnen.test.js": `${ROTER_TEST}// ergänzt\n` },
    "test-nachrunde-antwort": ABSATZ_MUTATION,
  };
  const auftrag = { ...TESTUMBAU, erwarteteDateien: ["test/rechnen.test.js", "test/text.test.js"] };
  const { repo, lauf } = testumbau(context, "", { abweichung: drehbuch, auftrag });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(nachricht(repo).split(entfernt).length - 1, 1, nachricht(repo));
});
