import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ausgang } from "../../tools/auftrag/ausgang.mjs";
import { pflichtDer, roteRunde } from "../../tools/auftrag/rote-pruefungen.mjs";
import { absatzZuordnung } from "../../tools/auftrag/zweck.mjs";
import { BASIS, EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const ERSTE_LAEUFE_ROT = (meldung) =>
  [
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const zaehler = join(process.env.HOME, "laeufe-" + process.argv[2]);',
    'const lauf = existsSync(zaehler) ? Number(readFileSync(zaehler, "utf8")) + 1 : 1;',
    "writeFileSync(zaehler, String(lauf));",
    `if (lauf <= Number(process.argv[3] ?? 1)) { console.log(${JSON.stringify(meldung)}); process.exitCode = 1; }`,
    "",
  ].join("\n");
const LINT_EINMAL_ROT = {
  "lint-rot.mjs": ERSTE_LAEUFE_ROT("src/text.js\n  2:14  error  Name zu kurz  id-length"),
  "package.json": BASIS["package.json"].replace('"lint":"node -e 0"', '"lint":"node lint-rot.mjs lint"'),
};
const MUTANT = "src/text.js:2:10 MethodExpression → wort";
function mutationRotBis(laeufe) {
  return {
    "erste-laeufe-rot.mjs": ERSTE_LAEUFE_ROT(`Verstoß: Mutant überlebt: ${MUTANT}`),
    "mutation.mjs": 'if (!process.argv.includes("--alter-stand")) await import("./erste-laeufe-rot.mjs");\n',
    "package.json": BASIS["package.json"].replace('"lint"', `"test:mutation":"node mutation.mjs mutation ${laeufe}","lint"`),
  };
}
const MUTATION_EINMAL_ROT = mutationRotBis(1);
const GEAENDERT = { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" };
const ANDERS_GEAENDERT = { "src/text.js": "export function gross(eingabe) {\n  return eingabe.toUpperCase();\n}\n" };
const VORIGE_RUNDE = "Fehlerausgabe der vorigen Runde";
const NACHFRAGE = "## Zweck-Absatz fehlt";
const ABSATZ_LINT = "Zweck lint: Drehbuchtext des Ersatz-Agenten zu lint.";
const BEGRUENDUNG_BAU = "\nZweck der Prüfungen, Begründung des Bau-Agenten:\n";
const ROTE_LINT_RUNDE = "\nRote Prüfungen laut Skript:\n| Runde 1: lint, Exit 1, Zweck-ID lint\n";
const NUR_ARBEITSSITZUNG = 1;
const ARBEITSSITZUNG_UND_NACHRUNDE = 2;
const LINT_ROT_IN_JEDER_RUNDE = 9;
const LINT_ROT_NUR_IN_RUNDE_1 = 1;
const SAETZE_UEBER_DER_KUERZUNGSGRENZE = 40;

function nachricht({ repo }) {
  return runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout;
}

function lintRunde(context, antwort) {
  return starte(context, { auftrag: UMBAU, drehbuch: { bau: GEAENDERT, "bau-antwort": antwort }, dateien: LINT_EINMAL_ROT });
}

function bauSitzungen({ beleg }) {
  return beleg.agenten.filter(({ rolle }) => rolle === "bau");
}

test("begründet der Bau-Agent nach roter Lint-Runde, stehen rote Prüfung und Absatz in der Commit-Nachricht", (context) => {
  const lauf = lintRunde(context, { [VORIGE_RUNDE]: `Erledigt.\n\n${ABSATZ_LINT}\n\nSonst nichts geändert.`, "": "Erledigt." });
  assert.equal(lauf.lauf.status, 0, lauf.lauf.stdout + lauf.lauf.stderr);
  const text = nachricht(lauf);
  assert.ok(text.includes(ROTE_LINT_RUNDE) && text.includes("\n|     2:14  error  Name zu kurz  id-length\n"), text);
  assert.ok(text.includes(`\nZweck der Prüfungen, Begründung des Bau-Agenten:\n> ${ABSATZ_LINT}\n\n`), text);
  assert.ok(readFileSync(join(lauf.werkzeug, "prompt-bau.txt"), "utf8").includes("Zugeordnet sind dem Bau-Agenten: lint."));
  assert.equal(bauSitzungen(lauf).length, NUR_ARBEITSSITZUNG);
});

test("fehlt der Absatz, fragt das Skript in derselben Sitzung einmal nach, und mit der Antwort wird der Auftrag grün", (context) => {
  const lauf = lintRunde(context, { [NACHFRAGE]: ABSATZ_LINT, "": "Erledigt." });
  assert.equal(lauf.lauf.status, 0, lauf.lauf.stdout + lauf.lauf.stderr);
  const [bau, ...weitere] = bauSitzungen(lauf);
  assert.deepEqual([weitere.length, lauf.beleg.nachfragen.map(({ sitzung }) => sitzung)], [0, [bau.sitzung]]);
  assert.ok(readFileSync(join(lauf.werkzeug, "prompt-bau.txt"), "utf8").startsWith(`${NACHFRAGE}\n\nDeine letzte Antwort enthält keinen Absatz mit der eigenen Zeile „Zweck <ID>:“ für: lint.`));
  const text = nachricht(lauf);
  assert.ok(text.includes(`${BEGRUENDUNG_BAU}> ${ABSATZ_LINT}\n`) && text.includes("\nHinweise des Bau-Agenten:\n> Erledigt.\n"), text);
});

test("stoppt der Auftrag nach einer Nachfrage, nennt die Entscheidungsnotiz die Antwort der Arbeitssitzung als Hinweis", (context) => {
  const immerRot = { ...LINT_EINMAL_ROT, "package.json": BASIS["package.json"].replace('"lint":"node -e 0"', `"lint":"node lint-rot.mjs lint ${LINT_ROT_IN_JEDER_RUNDE}"`) };
  const langerSchluss = "Weitere Erklärung der Arbeitssitzung. ".repeat(SAETZE_UEBER_DER_KUERZUNGSGRENZE);
  const antwort = { [NACHFRAGE]: ABSATZ_LINT, [VORIGE_RUNDE]: `Arbeitshinweis der zweiten Runde.\n${langerSchluss}`, "": "Arbeitshinweis der ersten Runde." };
  const lauf = starte(context, { auftrag: UMBAU, drehbuch: { bau: GEAENDERT, "bau-antwort": antwort }, dateien: immerRot });
  assert.equal(lauf.lauf.status, EXIT_ROT, lauf.lauf.stdout + lauf.lauf.stderr);
  const notiz = lauf.beleg.entscheidung.text;
  assert.ok(notiz.includes("Hinweise des Bau-Agenten:\n> Arbeitshinweis der zweiten Runde."), notiz);
  assert.equal(lauf.beleg.nachfragen.length, 1);
});

test("fehlt der Absatz auch nach der Nachfrage, ist die Runde rot an zweck-absatz und nichts wird committet", (context) => {
  const lauf = lintRunde(context, "Erledigt.");
  assert.equal(lauf.lauf.status, EXIT_ROT, lauf.lauf.stdout + lauf.lauf.stderr);
  assert.deepEqual([lauf.beleg.grund, lauf.beleg.roteIds], ["Begründung fehlt: Zweck lint", ["zweck-absatz"]]);
  assert.equal(lauf.kopf, lauf.basis);
});

test("ein Absatz aus einem Zeichen genügt dem Skript, denn es prüft nur, ob er da ist", (context) => {
  const lauf = lintRunde(context, { [VORIGE_RUNDE]: "Zweck lint: x", "": "Erledigt." });
  assert.equal(lauf.lauf.status, 0, lauf.lauf.stdout + lauf.lauf.stderr);
  assert.ok(nachricht(lauf).includes("\nZweck der Prüfungen, Begründung des Bau-Agenten:\n> Zweck lint: x\n"), nachricht(lauf));
});

test("ein grüner Auftrag ohne Befund hat keinen der beiden Abschnitte und keine Nachfrage", (context) => {
  const lauf = starte(context, { auftrag: UMBAU, drehbuch: { bau: GEAENDERT, "bau-antwort": "Erledigt." } });
  assert.equal(lauf.lauf.status, 0, lauf.lauf.stdout + lauf.lauf.stderr);
  assert.doesNotMatch(nachricht(lauf), /Rote Prüfungen laut Skript|Zweck der Prüfungen/);
  assert.equal(bauSitzungen(lauf).length, NUR_ARBEITSSITZUNG);
});

test("in der Mutationsnachrunde braucht nur eine Dateiänderung einen Absatz; Nötig ohne Änderung braucht keinen", (context) => {
  const faelle = [
    { nachrunde: {}, antwort: `Nötig: ${MUTANT}, weil leere Wörter sonst anders behandelt würden`, absatz: false },
    { nachrunde: ANDERS_GEAENDERT, antwort: "Zweck mutation: Drehbuchtext des Ersatz-Agenten zur Nachrunde.", absatz: true },
  ];
  for (const { nachrunde, antwort, absatz } of faelle) {
    const drehbuch = { bau: GEAENDERT, "bau-nachrunde": nachrunde, "bau-nachrunde-antwort": antwort };
    const lauf = starte(context, { auftrag: UMBAU, drehbuch, dateien: MUTATION_EINMAL_ROT });
    assert.equal(lauf.lauf.status, 0, lauf.lauf.stdout + lauf.lauf.stderr);
    assert.equal(bauSitzungen(lauf).length, ARBEITSSITZUNG_UND_NACHRUNDE, antwort);
    const text = nachricht(lauf);
    assert.ok(text.includes("\n| Runde 1: mutation, Exit 1, Zweck-ID mutation\n"), text);
    assert.equal(text.includes(`\nZweck der Prüfungen, Begründung des Bau-Agenten:\n> ${antwort}\n`), absatz, text);
  }
});

test("in der Nachrunde des Test-Agenten verlangt das Skript den Absatz vom Test-Agenten, nicht vom Bau-Agenten", (context) => {
  const absatz = "Zweck mutation: Drehbuchtext des Ersatz-Agenten zur Mutation.";
  const drehbuch = {
    bau: GEAENDERT,
    "bau-nachrunde-antwort": `Nötig: ${MUTANT}, weil sonst jedes Wort klein bliebe`,
    "test-nachrunde": { "test/text.test.js": `${BASIS["test/text.test.js"]}test("wort", () => assert.equal(gross("b"), "B"));\n` },
    "test-nachrunde-antwort": absatz,
  };
  const lauf = starte(context, { auftrag: UMBAU, drehbuch, dateien: MUTATION_EINMAL_ROT });
  assert.equal(lauf.lauf.status, 0, lauf.lauf.stdout + lauf.lauf.stderr);
  assert.deepEqual(lauf.beleg.agenten.map(({ rolle }) => rolle), ["bau", "bau", "test"]);
  const text = nachricht(lauf);
  assert.ok(text.includes(`\nZweck der Prüfungen, Begründung des Test-Agenten:\n> ${absatz}\n`), text);
  assert.doesNotMatch(text, /Begründung des Bau-Agenten/);
});

const ALTER_STAND_EINMAL_ROT = {
  ...MUTATION_EINMAL_ROT,
  "mutation.mjs": 'if (process.argv.includes("--alter-stand")) await import("./erste-laeufe-rot.mjs");\n',
  "package.json": BASIS["package.json"].replace('"lint"', '"test:mutation":"node mutation.mjs alter-stand 1","lint"'),
};

test("im Umbau steht die Begründung des Test-Agenten im Commit seiner Tests, nicht im Umbau-Commit", (context) => {
  const absatz = "Zweck mutation alter Stand: Drehbuchtext des Ersatz-Agenten zum alten Stand.";
  const drehbuch = {
    bau: GEAENDERT,
    "test-nachrunde": { "test/text.test.js": `${BASIS["test/text.test.js"]}test("wort", () => assert.equal(gross("b"), "B"));\n` },
    "test-nachrunde-antwort": absatz,
  };
  const lauf = starte(context, { auftrag: UMBAU, drehbuch, dateien: ALTER_STAND_EINMAL_ROT });
  assert.equal(lauf.lauf.status, 0, lauf.lauf.stdout + lauf.lauf.stderr);
  const testCommit = runIn(lauf.repo, "git", ["log", "-1", "--format=%B", "HEAD^"]).stdout;
  assert.ok(testCommit.includes("\n| Runde 1: mutation alter Stand, Exit 1, Zweck-ID mutation alter Stand\n"), testCommit);
  assert.ok(testCommit.includes(`\nZweck der Prüfungen, Begründung des Test-Agenten:\n> ${absatz}\n`), testCommit);
  assert.doesNotMatch(nachricht(lauf), /Begründung des Test-Agenten|mutation alter Stand, Exit 1/);
});

test("nach einer roten Runde steht im Umbau die rote Runde des Bau-Agenten mit seinem Absatz im Umbau-Commit, nicht im Test-Commit", (context) => {
  const dateien = { ...ALTER_STAND_EINMAL_ROT, ...LINT_EINMAL_ROT, "package.json": ALTER_STAND_EINMAL_ROT["package.json"].replace('"lint":"node -e 0"', `"lint":"node lint-rot.mjs lint ${LINT_ROT_NUR_IN_RUNDE_1}"`) };
  const absatz = "Zweck mutation alter Stand: Drehbuchtext des Ersatz-Agenten zum alten Stand.";
  const drehbuch = {
    bau: GEAENDERT,
    "bau-antwort": { [VORIGE_RUNDE]: ABSATZ_LINT, "": "Erledigt." },
    "test-nachrunde": { "test/text.test.js": `${BASIS["test/text.test.js"]}test("wort", () => assert.equal(gross("b"), "B"));\n` },
    "test-nachrunde-antwort": absatz,
  };
  const lauf = starte(context, { auftrag: UMBAU, drehbuch, dateien });
  assert.equal(lauf.lauf.status, 0, lauf.lauf.stdout + lauf.lauf.stderr);
  const testCommit = runIn(lauf.repo, "git", ["log", "-1", "--format=%B", "HEAD^"]).stdout;
  const umbauCommit = nachricht(lauf);
  assert.ok(!testCommit.includes("Runde 1: lint") && !testCommit.includes("Zweck lint:"), testCommit);
  assert.ok(umbauCommit.includes(ROTE_LINT_RUNDE) && umbauCommit.includes(`${BEGRUENDUNG_BAU}> ${ABSATZ_LINT}\n`), umbauCommit);
});

test("ändert die Nachfrage zum Zweck eine Datei, ist die Runde rot an zweck-absatz", (context) => {
  const drehbuch = { bau: GEAENDERT, "bau-nachrunde": ANDERS_GEAENDERT, "bau-nachrunde-antwort": "Gestrichen." };
  const lauf = starte(context, { auftrag: UMBAU, drehbuch, dateien: MUTATION_EINMAL_ROT });
  assert.equal(lauf.lauf.status, EXIT_ROT, lauf.lauf.stdout + lauf.lauf.stderr);
  const [ersteRunde] = lauf.beleg.runden;
  assert.match(ersteRunde, /^Runde 1: Die Nachfrage zum Zweck hat Dateien geändert\./);
  assert.ok(ersteRunde.includes("Wozu: Wer nach einer Meldung Dateien ändert"), ersteRunde);
});

function absaetze(antwort) {
  return ausgang(antwort, "bau").zweck;
}

test("ein Absatz zählt nur als eigene Zeile außerhalb von Zitat und Code-Block und endet an der Leerzeile", () => {
  const nichtGezaehlt = ["> Zweck lint: zitiert", "  Zweck lint: eingerückt", ["```", "Zweck lint: im Block", "```"].join("\n"), "Zweck lint:"];
  for (const antwort of nichtGezaehlt) assert.equal(absaetze(antwort).lint ?? "", "", antwort);
  const antwort = ["Zweck grenzen/bereich:", "erste Zeile", "zweite Zeile", "", "Zusammenfassung", "Zweck keine änderung: kurz", "Auftrag passt nicht: anderer Grund"].join("\n");
  assert.deepEqual(absaetze(antwort), { "grenzen/bereich": "erste Zeile\nzweite Zeile", "keine änderung": "kurz" });
});

test("ein Absatz endet an jeder Meldezeile des Agenten, nicht erst an der Leerzeile", () => {
  const meldungen = [
    "Auftrag passt nicht: Grund",
    "Voraussetzung fehlt: Erst src/a.js aufräumen.",
    "Alter Test hält altes Verhalten fest: test/a.test.js:alt – neu",
    "Gleichwertig: src/a.js:1:1 Mutant, weil nichts passiert",
    "Nötig: src/a.js:1:1 Mutant, weil etwas passiert",
  ];
  for (const meldung of meldungen) assert.deepEqual(absaetze(["Zweck lint: erste Zeile", meldung, "weiter"].join("\n")), { lint: "erste Zeile" }, meldung);
});

test("zugeordnet wird nach dem roten Schritt: Test-Schritte dem Test-Agenten, Gründe eines Agenten dem, der zuletzt lief, Skript-Schritte keinem", () => {
  const runde = roteRunde({
    runde: 1,
    grund: "Der Agent test hat .fortschritt/ verändert.",
    pruefungen: [
      { name: "grenzen test", exitCode: 1, zeilen: ["Verstoß: Der Test-Agent hat Produktcode geändert: src/a.js"], zweck: ["grenzen/produkt-im-test"] },
      { name: "geänderte fälle", exitCode: 1, zeilen: [] },
      { name: "lint", exitCode: 1, zeilen: [] },
      { name: "abnahme vorher", exitCode: 1, zeilen: [] },
      { name: "bisect", exitCode: 1, zeilen: [] },
    ],
    roteIds: ["belege"],
    agenten: [{ rolle: "bau" }, { rolle: "test" }],
  });
  const pflicht = pflichtDer([runde]);
  assert.deepEqual(pflicht, [
    { id: "grenzen/produkt-im-test", rolle: "test" },
    { id: "geänderte fälle", rolle: "test" },
    { id: "lint", rolle: "bau" },
    { id: "belege", rolle: "test" },
  ]);
  const [zeile] = absatzZuordnung(pflicht);
  assert.ok(zeile.endsWith("Zugeordnet sind dem Bau-Agenten: lint; dem Test-Agenten: grenzen/produkt-im-test, geänderte fälle, belege."), zeile);
});
