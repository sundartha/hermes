import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";

import { ausgang, nenntAltenTest } from "../../tools/auftrag/ausgang.mjs";
import { ROT } from "../../tools/auftrag/bericht.mjs";
import { fuehreRundenAus } from "../../tools/auftrag/runden.mjs";
import { BASIS, EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { teamRepository } from "./neuschnitt-probe.js";
import { probeDirectory, runIn } from "./probe-repo.js";

const GRUND = "Der Abnahmetest verlangt ein Verhalten, das der Entwurf ausschließt.";
const AUSSTIEG = `Auftrag passt nicht: ${GRUND}`;
const BISHER_GELESENE_ZEICHEN = 1000;
const SCHLUSSSATZ = "Hier folgt eine lange Erklärung, warum ich aufgehört habe. ";
const LANGER_SCHLUSS = SCHLUSSSATZ.repeat(Math.ceil(BISHER_GELESENE_ZEICHEN / SCHLUSSSATZ.length) + 1);
const MUTANT = "src/text.js:2:10 MethodExpression → text";
const GEAENDERT = { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" };
const MUTATION_OHNE_MELDUNG = [
  'const gemeldet = process.argv.includes("--gleichwertig") || process.argv.includes("--alter-stand");',
  "if (!gemeldet) process.exitCode = 1;",
  `console.log(gemeldet ? "grün: keiner überlebt" : ${JSON.stringify(`Verstoß: Mutant überlebt: ${MUTANT}`)});`,
  "",
].join("\n");
const MIT_MUTATION = {
  "mutation.mjs": MUTATION_OHNE_MELDUNG,
  "package.json": BASIS["package.json"].replace('"lint"', '"test:mutation":"node mutation.mjs","lint"'),
};

test("eine Ausstiegszeile weit vor dem Ende einer langen Antwort beendet den Auftrag ohne rote Runde", (context) => {
  const drehbuch = { "bau-antwort": `Ich höre auf.\n${AUSSTIEG}\n${LANGER_SCHLUSS}`, "notiz-antwort": "1. Entwurf klären" };
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual([beleg.ausstieg, beleg.runden], [GRUND, []]);
  assert.ok(beleg.entscheidung.text.includes(`\n${AUSSTIEG}\n`), beleg.entscheidung.text);
});

test("eine Ausweg-Zeile zählt nur in Spalte 0 außerhalb von Code-Blöcken und nicht mit einem Platzhalter als Grund", () => {
  const nichtGezaehlt = [
    ["```", AUSSTIEG, "```"].join("\n"),
    ["Zum Schluss ein Beispiel:", "```", AUSSTIEG].join("\n"),
    `> ${AUSSTIEG}`,
    `  ${AUSSTIEG}`,
    "Auftrag passt nicht: <Grund in einem Satz>",
    "Alter Test hält altes Verhalten fest: <Testdatei>:<Testname> – <Grund>",
    "Gleichwertig: <Mutant>, weil <ein Satz>",
    "Gleichwertig: src/rechnen.js:3 BooleanLiteral, weil <ein Satz>",
  ];
  for (const antwort of nichtGezaehlt) {
    const weg = ausgang(antwort, "bau");
    assert.deepEqual([weg.ausstieg, weg.alterTest, weg.gleichwertig], [null, null, []], antwort);
  }
  assert.equal(ausgang(["```", "Code", "```", AUSSTIEG].join("\n"), "bau").ausstieg, GRUND);
});

test("stehen mehrere Ausweg-Zeilen in der Antwort, gilt die letzte, die die Rolle benutzen darf", () => {
  const antwort = ["Voraussetzung fehlt: Erst src/a.js aufräumen.", AUSSTIEG, "Voraussetzung fehlt: Der Bereich braucht eine neue Tabelle."].join("\n");
  assert.deepEqual(
    [ausgang(antwort, "bau"), ausgang(antwort, "test")].map(({ ausstieg, voraussetzung }) => [ausstieg, voraussetzung]),
    [
      [null, "Der Bereich braucht eine neue Tabelle."],
      [GRUND, null],
    ],
  );
  assert.deepEqual(ausgang(AUSSTIEG, "notiz").ausstieg, null);
});

test("eine Gleichwertig-Zeile vor mehr als 1000 Zeichen Text wird in der Mutationsnachrunde angenommen", (context) => {
  const meldung = `Gleichwertig: ${MUTANT}, weil Groß- und Kleinschreibung hier nie vorkommen`;
  const drehbuch = { bau: GEAENDERT, "bau-nachrunde-antwort": `${meldung}\n${LANGER_SCHLUSS}` };
  const { lauf, repo } = starte(context, { auftrag: UMBAU, drehbuch, dateien: MIT_MUTATION });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const nachricht = runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout;
  assert.ok(nachricht.includes(`\n${meldung}\n`), nachricht);
});

function alterTestMit(...titel) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { verdopple } from "../src/rechnen.js";',
    ...titel.map((name) => `test(${JSON.stringify(name)}, () => assert.equal(verdopple(2), 2));`),
    "",
  ].join("\n");
}
const ALTER_TEST = alterTestMit("verdopple lässt die Zahl");
const VERDOPPELT = { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" };
const ALTER_TEST_ZEILE = "Alter Test hält altes Verhalten fest: test/rechnen.test.js:verdopple lässt die Zahl – Das Ziel verlangt das Verdoppeln.";

test("hält ein alter Test das alte Verhalten fest, verwirft das Skript den Bau und legt Zeile, Testergebnis und Diff Antonio vor", (context) => {
  const drehbuch = { bau: VERDOPPELT, "bau-antwort": `${ALTER_TEST_ZEILE}\n${LANGER_SCHLUSS}`, "notiz-antwort": "1. Verhalten freigeben" };
  const { lauf, beleg, basis, kopf, repo } = starte(context, { auftrag: UMBAU, drehbuch, dateien: { "test/rechnen.test.js": ALTER_TEST } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual([kopf, beleg.runden, beleg.ausstieg, runIn(repo, "git", ["status", "--porcelain"]).stdout], [basis, [], null, ""]);
  assert.deepEqual([beleg.alterTest.datei, beleg.alterTest.test, beleg.alterTest.rot], ["test/rechnen.test.js", "verdopple lässt die Zahl", true]);
  assert.match(beleg.alterTest.diff, /^\+ {2}return zahl \* 2;$/m);
  for (const teil of [`\n${ALTER_TEST_ZEILE}\n`, "rot: ja", "verhalten-geaendert", "test/rechnen.test.js:verdopple lässt die Zahl"]) {
    assert.ok(beleg.entscheidung.text.includes(teil), teil);
  }
});

test("ändert der Bau-Agent einen Test und meldet ihn als alten Test, führt das Skript den geänderten Test nicht aus", (context) => {
  const spur = join(probeDirectory(context, {}), "ausgefuehrt");
  const geaendert = `${ALTER_TEST}import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(spur)}, "");\n`;
  const drehbuch = { bau: { ...VERDOPPELT, "test/rechnen.test.js": geaendert }, "bau-antwort": ALTER_TEST_ZEILE, "notiz-antwort": "1. Klären" };
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch, dateien: { "test/rechnen.test.js": ALTER_TEST } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual([existsSync(spur), beleg.alterTest], [false, null]);
  assert.ok(JSON.stringify(beleg).includes("Der Bau-Agent hat einen Test geändert: test/rechnen.test.js"));
});

test("nennt die Zeile zum alten Test eine Datei, die es vorher nicht gab, gilt sie als „Auftrag passt nicht“", (context) => {
  const zeile = "Alter Test hält altes Verhalten fest: test/gibt-es-nicht.test.js:alt – Der Auftrag ändert das Verhalten.";
  const drehbuch = { bau: VERDOPPELT, "bau-antwort": zeile, "notiz-antwort": "1. Klären" };
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual([beleg.ausstieg, beleg.alterTest, beleg.runden], [zeile, null, []]);
  assert.ok(beleg.entscheidung.text.includes(`\nAuftrag passt nicht: ${zeile}\n`), beleg.entscheidung.text);
});

test("nennt die Zeile zum alten Test den eigenen Abnahmetest oder einen Testnamen, den die Datei nicht enthält, gilt sie als „Auftrag passt nicht“", (context) => {
  const zeilen = [
    "Alter Test hält altes Verhalten fest: test/text.test.js:gross – Der Abnahmetest hält das alte Verhalten fest.",
    "Alter Test hält altes Verhalten fest: test/rechnen.test.js:gibt es nicht – Der Auftrag ändert das Verhalten.",
    "Alter Test hält altes Verhalten fest: test/rechnen.test.js:verdopple – Der Auftrag ändert das Verhalten.",
    "Alter Test hält altes Verhalten fest: test/rechnen.test.js:assert – Der Auftrag ändert das Verhalten.",
  ];
  for (const zeile of zeilen) {
    const drehbuch = { bau: VERDOPPELT, "bau-antwort": zeile, "notiz-antwort": "1. Klären" };
    const { beleg } = starte(context, { auftrag: UMBAU, drehbuch, dateien: { "test/rechnen.test.js": ALTER_TEST } });
    assert.deepEqual([beleg.ausstieg, beleg.alterTest], [zeile, null], zeile);
  }
});

test("nennt die Zeile zum alten Test eine Gruppe oder einen auskommentierten Test, gilt sie als „Auftrag passt nicht“", (context) => {
  const mitGruppe = alterTestMit("verdopple lässt die Zahl")
    .replace("test(", 'describe("rechnen", () => {\n  test(')
    .replace(/\n$/, '\n});\n// test("alter Fall", () => assert.equal(verdopple(1), 1));\n/* test("ganz alter Fall", () => {}); */\n');
  for (const name of ["rechnen", "alter Fall", "ganz alter Fall"]) {
    const zeile = `Alter Test hält altes Verhalten fest: test/rechnen.test.js:${name} – Der Auftrag ändert das Verhalten.`;
    const drehbuch = { bau: VERDOPPELT, "bau-antwort": zeile, "notiz-antwort": "1. Klären" };
    const { beleg } = starte(context, { auftrag: UMBAU, drehbuch, dateien: { "test/rechnen.test.js": mitGruppe } });
    assert.deepEqual([beleg.ausstieg, beleg.alterTest], [zeile, null], name);
  }
  const zeile = ALTER_TEST_ZEILE;
  const { beleg } = starte(context, { auftrag: UMBAU, drehbuch: { bau: VERDOPPELT, "bau-antwort": zeile, "notiz-antwort": "1. Freigeben" }, dateien: { "test/rechnen.test.js": mitGruppe } });
  assert.equal(beleg.alterTest?.test, "verdopple lässt die Zahl");
});

test("Testnamen liest das Skript nur aus echten Aufrufen von test und it, nicht aus Texten, die wie Kommentare oder Aufrufe aussehen", (context) => {
  const kopf = alterTestMit().trimEnd();
  const faelle = [
    ["verdopple lässt die Zahl", `${kopf}\nconst muster = "src/*.js";\ntest("verdopple lässt die Zahl", () => assert.equal(verdopple(2), 2));\n/* Ende */\n`, true],
    ["verdopple // halbiere", `${kopf}\ntest(\`verdopple // halbiere\`, () => assert.equal(verdopple(2), 2));\nconst ende = "x";\n`, true],
    ["nur ein Text", `${kopf}\nconst aufruf = "test('nur ein Text')";\ntest("verdopple lässt die Zahl", () => assert.equal(verdopple(2), 2));\n`, false],
  ];
  for (const [name, quelle, erkannt] of faelle) {
    const zeile = `Alter Test hält altes Verhalten fest: test/rechnen.test.js:${name} – Der Auftrag ändert das Verhalten.`;
    const drehbuch = { bau: VERDOPPELT, "bau-antwort": zeile, "notiz-antwort": "1. Klären" };
    const { beleg } = starte(context, { auftrag: UMBAU, drehbuch, dateien: { "test/rechnen.test.js": quelle } });
    assert.deepEqual([beleg.ausstieg, beleg.alterTest?.test ?? null], erkannt ? [null, name] : [zeile, null], name);
  }
});

test("ein Testname mit Bindestrich wird ganz erkannt, passt die Zeile auf zwei Tests, gilt sie als „Auftrag passt nicht“", (context) => {
  const name = "verdopple - bei zwei";
  const zeile = `Alter Test hält altes Verhalten fest: test/rechnen.test.js:${name} – Das Ziel verlangt das Verdoppeln.`;
  const drehbuch = { bau: VERDOPPELT, "bau-antwort": zeile, "notiz-antwort": "1. Klären" };
  const eindeutig = starte(context, { auftrag: UMBAU, drehbuch, dateien: { "test/rechnen.test.js": alterTestMit(name) } }).beleg;
  assert.deepEqual([eindeutig.ausstieg, eindeutig.alterTest?.test, eindeutig.alterTest?.rot], [null, name, true]);
  assert.ok(eindeutig.entscheidung.text.includes(`test/rechnen.test.js:${name}`), eindeutig.entscheidung.text);
  const mehrdeutig = starte(context, { auftrag: UMBAU, drehbuch, dateien: { "test/rechnen.test.js": alterTestMit("verdopple", name) } }).beleg;
  assert.deepEqual([mehrdeutig.ausstieg, mehrdeutig.alterTest], [zeile, null]);
});

const NOTIZ_ERSATZ = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
readFileSync(0, "utf8");
appendFileSync(process.env.ERSATZ_STARTS, process.env.HERMES_ROLLE + "\\n");
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "1. Entscheiden" }) + "\\n");
`;
const PLAN = "plaene/P-001-probe";

function setzeUmgebung(context, werte) {
  const vorher = new Map(Object.keys(werte).map((name) => [name, env[name]]));
  Object.assign(env, werte);
  context.after(() => {
    vorher.forEach((alt, name) => {
      if (alt === undefined) delete env[name];
      else env[name] = alt;
    });
  });
}

function ausPlanung(context, ausweg, roteRunden = []) {
  const auftrag = { id: "a1", art: "funktion", ziel: "Verdopple Zahlen", bereich: "src/rechnen.js", erwarteteDateien: ["src/rechnen.js"], abnahme: "test/rechnen.test.js" };
  const phase = { phase: "P-001-probe", entwurf: { "src/rechnen.js": "Entwurf." }, auftraege: [auftrag] };
  const root = teamRepository(context, { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl;\n}\n", "test/rechnen.test.js": "", [`${PLAN}/pitch.md`]: "# P-001\n", [`${PLAN}/sicherheit.md`]: "# Sicherheit\n", [`${PLAN}/phase.json`]: `${JSON.stringify(phase)}\n` });
  const werkzeug = probeDirectory(context, { "claude.mjs": NOTIZ_ERSATZ });
  chmodSync(join(werkzeug, "claude.mjs"), 0o755);
  setzeUmgebung(context, { HERMES_CLAUDE: join(werkzeug, "claude.mjs"), ERSATZ_STARTS: join(werkzeug, "starts.txt") });
  const kontext = { phase, auftrag, root, phasendatei: `${PLAN}/phase.json`, plan: { fertig: new Set() } };
  const offen = [...roteRunden];
  const runde = () => ({ ergebnis: ROT, runde: 1, phase: "P-001-probe", auftrag: "a1", basis: "HEAD", agenten: [], pruefungen: [], ...(offen.shift() ?? ausweg) });
  const ergebnis = fuehreRundenAus(kontext, runde);
  const starts = existsSync(join(werkzeug, "starts.txt")) ? readFileSync(join(werkzeug, "starts.txt"), "utf8") : "";
  const beleg = JSON.parse(readFileSync(join(root, ".fortschritt/P-001-probe/a1.json"), "utf8"));
  return { ergebnis, starts, beleg };
}

test("ein unklarer Zweck geht auch bei einer Phase aus einem Pitch direkt an Antonio, ein alter Test erst an den Plan-Agenten für einen Testumbau, ein anderer Ausstieg zum Planer", (context) => {
  const alterTest = { zeile: ALTER_TEST_ZEILE, datei: "test/rechnen.test.js", test: "verdopple lässt die Zahl", grund: "Das Ziel verlangt das Verdoppeln.", rot: true };
  const faelle = [
    [{ alterTest }, "plan\nnotiz\n"],
    [{ ausstieg: "Zweck der Prüfung lint unklar: Die Regel verbietet hier den einzigen Namen der Fachsprache." }, "notiz\n"],
    [{ ausstieg: GRUND }, "planer\n"],
  ];
  for (const [ausweg, erster] of faelle) {
    const { ergebnis, starts } = ausPlanung(context, ausweg);
    assert.equal(ergebnis, ROT);
    assert.ok(starts.startsWith(erster), JSON.stringify({ ausweg, starts }));
  }
});

test("die Entscheidungsnotiz nennt die Prüfung, an der ausgestiegen wurde: die rote der Runde davor, die aus der Zeile oder keine", (context) => {
  const lintRot = { grund: "lint endete mit Exit 1.", pruefungen: [{ name: "lint", exitCode: 1, zeilen: ["src/a.js: Name zu kurz"] }] };
  const alterTest = { zeile: ALTER_TEST_ZEILE, datei: "test/rechnen.test.js", test: "verdopple lässt die Zahl", grund: "Das Ziel verlangt das Verdoppeln.", rot: false };
  const faelle = [
    [{ ausstieg: GRUND }, [lintRot], "lint"],
    [{ ausstieg: GRUND }, [], "keine"],
    [{ ausstieg: "Zweck der Prüfung typprüfung unklar: Das Projekt hat keine Typen." }, [lintRot], "typprüfung"],
    [{ alterTest }, [], "betroffene tests"],
  ];
  for (const [ausweg, roteRunden, pruefung] of faelle) {
    const { beleg } = ausPlanung(context, ausweg, roteRunden);
    assert.ok(beleg.entscheidung.text.includes(`\nAusweg bei Prüfung: ${pruefung}\n`), beleg.entscheidung.text);
  }
});

test("eine Gleichwertig-Zeile mit Platzhalter als Grund zählt nicht, eine Zeile zum alten Test vom Test-Agenten gilt als „Auftrag passt nicht“", () => {
  assert.deepEqual(ausgang(`Gleichwertig: ${MUTANT}, weil <ein Satz>`, "bau").gleichwertig, []);
  const mitBindestrich = "Alter Test hält altes Verhalten fest: test/rechnen.test.js:verdopple lässt die Zahl - Das Ziel verlangt das Verdoppeln.";
  assert.deepEqual([ausgang(mitBindestrich, "bau").ausstieg, ausgang(mitBindestrich, "bau").alterTest?.datei], [null, "test/rechnen.test.js"]);
  assert.deepEqual([ausgang(ALTER_TEST_ZEILE, "test").ausstieg, ausgang(ALTER_TEST_ZEILE, "test").alterTest], [ALTER_TEST_ZEILE, null]);
});

test("eine Zeile zum alten Test ohne Testnamen gilt als „Auftrag passt nicht“, mit Platzhalter als Begründung zählt sie nicht, und die gewählte Zeile kommt wörtlich zurück", () => {
  const ohneTestnamen = "Alter Test hält altes Verhalten fest: test/rechnen.test.js:  – Der Auftrag ändert das Verhalten.";
  assert.deepEqual([ausgang(ohneTestnamen, "bau").ausstieg, ausgang(ohneTestnamen, "bau").alterTest], [ohneTestnamen, null]);
  const mitPlatzhalter = [AUSSTIEG, "Alter Test hält altes Verhalten fest: test/rechnen.test.js:verdopple lässt die Zahl – <Grund>"].join("\n");
  assert.deepEqual([ausgang(mitPlatzhalter, "bau").ausstieg, ausgang(mitPlatzhalter, "bau").alterTest], [GRUND, null]);
  const mitLeerraum = `Auftrag passt nicht:   ${GRUND}`;
  const faelle = [
    [mitLeerraum, "bau", mitLeerraum],
    [mitPlatzhalter, "bau", AUSSTIEG],
    [ALTER_TEST_ZEILE, "test", ALTER_TEST_ZEILE],
    ["Voraussetzung fehlt: Erst src/a.js aufräumen.", "bau", "Voraussetzung fehlt: Erst src/a.js aufräumen."],
    ["Nur eine Erklärung.", "bau", null],
  ];
  assert.deepEqual(faelle.map(([antwort, rolle]) => ausgang(antwort, rolle).zeile), faelle.map(([, , zeile]) => zeile));
});

test("eine Zeile zum alten Test mit Platzhalter als Begründung zählt nicht, auch wenn Datei oder Testname nicht der Form folgen", () => {
  const ohneTestnamen = "Alter Test hält altes Verhalten fest: test/rechnen.test.js – <Grund>";
  const fremderPfad = "Alter Test hält altes Verhalten fest: src/rechnen.js:verdopple – <Grund>";
  for (const platzhalterZeile of [ohneTestnamen, fremderPfad]) {
    const weg = ausgang([AUSSTIEG, platzhalterZeile].join("\n"), "bau");
    assert.deepEqual([weg.ausstieg, weg.alterTest, weg.zeile], [GRUND, null, AUSSTIEG], platzhalterZeile);
  }
});

test("hat die Lesart, deren Testname in der Datei steht, nur einen Platzhalter als Begründung, nennt die Zeile keinen alten Test", () => {
  const zeile = "Alter Test hält altes Verhalten fest: test/rechnen.test.js:verdopple - Fall – <Grund>";
  const { alterTest } = ausgang(zeile, "bau");
  assert.deepEqual([alterTest?.datei, nenntAltenTest(alterTest, ["verdopple - Fall"])], ["test/rechnen.test.js", null]);
});

test("meldet der Bau-Agent in der Mutationsnachrunde einen alten Test, endet der Auftrag ohne Commit als Entscheidung", (context) => {
  const drehbuch = { bau: GEAENDERT, "bau-nachrunde-antwort": ALTER_TEST_ZEILE, "notiz-antwort": "1. Freigeben" };
  const { lauf, beleg, basis, kopf } = starte(context, { auftrag: UMBAU, drehbuch, dateien: { ...MIT_MUTATION, "test/rechnen.test.js": ALTER_TEST } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual([kopf, beleg.alterTest?.rot, beleg.runden], [basis, false, []]);
  assert.ok(beleg.entscheidung.text.includes(`\n${ALTER_TEST_ZEILE}\nAusweg bei Prüfung: betroffene tests\n`), beleg.entscheidung.text);
});
