import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ABSATZ_ALTER_STAND } from "./auftrag-lauf-hilfen.js";
import { BASIS, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const WEGWERF = ".claude/worktrees/absicherung-probe";
const AUFRUFE = ".fortschritt/aufrufe.txt";
const LAUFENDER = { ...UMBAU, id: "A0", ziel: "Räume rechnen auf", erwarteteDateien: ["src/rechnen.js"], vorbild: "src/text.js", abnahme: "test/rechnen.test.js", betrifft: { "src/rechnen.js": ["verdopple"] } };
const WARTENDER = { ...UMBAU, id: "B1", betrifft: { "src/text.js": ["gross"] } };
const VORAB_TEST = `${BASIS["test/text.test.js"]}test("leer", () => assert.equal(gross(""), ""));\n`;
const HOECHSTE_PLAETZE = "12";
const GRUND = "der Aufruf dasselbe Ergebnis liefert";
const MUTANT = "src/text.js:2:10 MethodExpression → text";
const ERSATZ_PAKET = {
  ".gitignore": `${BASIS[".gitignore"]}.claude/worktrees/\n`,
  "package-lock.json": JSON.stringify({ name: "probe", lockfileVersion: 3, requires: true, packages: { "": { name: "probe" } } }),
  "test/rechnen.test.js": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { verdopple } from "../src/rechnen.js";\ntest("verdoppelt", () => assert.equal(verdopple(2), 2));\n',
};

function ersatzMutation({ ueberlebtOhne = null, lauf = 777 }) {
  return `import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
mkdirSync(".fortschritt", { recursive: true });
const standOhneDeklaration = !readFileSync("src/text.js", "utf8").includes("function gross");
appendFileSync(${JSON.stringify(AUFRUFE)}, JSON.stringify({ argumente: process.argv.slice(2), standOhneDeklaration, plaetze: process.env.HERMES_MUTATION_PLAETZE }) + "\\n");
console.log("Mutationsprüfung in der CI: Lauf https://github.com/eigner/repo/actions/runs/${lauf}, Stand abc");
const offen = !process.argv.includes("${MUTANT}") && ${JSON.stringify(ueberlebtOhne)} !== null && !readFileSync("test/text.test.js", "utf8").includes(${JSON.stringify(ueberlebtOhne)});
if (offen) process.exitCode = 1;
console.log(offen ? "Verstoß: Mutant überlebt: ${MUTANT}" : "grün: keiner überlebt");
`;
}

function mitVermerkB1(repo) {
  runIn(repo, "git", ["switch", "-q", "-c", "absicherung/probe"]);
  runIn(repo, "git", ["commit", "-q", "--allow-empty", "-m", `Sichere vorab ab\n\nAbsicherung: Lauf 555 Auftrag B1\nPaket: PAS`]);
  runIn(repo, "git", ["switch", "-q", "-"]);
}

function absichern(context, { drehbuch = {}, mutation = {}, auftraege = [LAUFENDER, WARTENDER], dateien = {}, davor = () => {}, umgebung = {} } = {}) {
  const gesamt = {
    ...ERSATZ_PAKET,
    "package.json": BASIS["package.json"].replace('"lint"', '"test:mutation":"node mutation.mjs","lint"'),
    "mutation.mjs": ersatzMutation(mutation),
    ...dateien,
  };
  const vorbereiten = (repo) => {
    runIn(repo, "git", ["config", "user.name", "Probe"]);
    runIn(repo, "git", ["config", "user.email", "probe@example.invalid"]);
    davor(repo);
  };
  const probe = starte(context, { auftrag: LAUFENDER, drehbuch, dateien: gesamt, vorbereiten, phase: { auftraege, paket: "PAS" }, befehl: "absichern", umgebung });
  const verlauf = runIn(probe.repo, "git", ["log", "--format=%s%n%b%x00", "upstream/master..absicherung/probe"]);
  const eintraege = verlauf.stdout.split("\0").map((eintrag) => eintrag.trim());
  const branch = eintraege.filter(Boolean);
  const aufrufeDatei = join(probe.repo, WEGWERF, AUFRUFE);
  const zeilen = existsSync(aufrufeDatei) ? readFileSync(aufrufeDatei, "utf8").split("\n").filter(Boolean) : [];
  const aufrufe = zeilen.map((zeile) => JSON.parse(zeile));
  return { ...probe, branch, aufrufe };
}

test("ein wartender Umbau ohne Verbindung zum laufenden wird über die CI-Mutation am Wegwerf-Stand abgesichert und mit dem Lauf im Branch vermerkt", (context) => {
  const { lauf, branch, aufrufe } = absichern(context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(aufrufe.length, 1, lauf.stdout + lauf.stderr);
  assert.ok(aufrufe[0].argumente.includes("--in-ci") && aufrufe[0].argumente.includes("--alter-stand"), JSON.stringify(aufrufe));
  assert.equal(aufrufe[0].standOhneDeklaration, true);
  assert.equal(aufrufe[0].plaetze, HOECHSTE_PLAETZE);
  assert.equal(branch.length, 1, lauf.stdout + lauf.stderr);
  assert.ok(branch[0].includes("Absicherung: Lauf 777 Auftrag B1"), branch[0]);
  assert.ok(lauf.stdout.includes("Absicherung B1: abgesichert, Lauf 777."), lauf.stdout);
});

test("überlebt ein Mutant am alten Stand, ergänzt der Test-Agent nur Tests, und der Vermerk folgt erst nach dem grünen Lauf", (context) => {
  const drehbuch = { "test-nachrunde": { "test/text.test.js": VORAB_TEST }, "test-nachrunde-antwort": ABSATZ_ALTER_STAND };
  const { repo, lauf, branch, aufrufe } = absichern(context, { drehbuch, mutation: { ueberlebtOhne: "leer" } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(aufrufe.length, 2, lauf.stdout + lauf.stderr);
  assert.equal(branch.length, 2, branch.join("\n"));
  assert.ok(branch[1].startsWith("Halte Verhalten vor Umbau B1 vorab fest"), branch[1]);
  assert.ok(branch[1].includes("Paket: PAS") && !branch[1].includes("Auftrag: "), branch[1]);
  assert.ok(branch[0].includes("Absicherung: Lauf 777 Auftrag B1"), branch[0]);
  const dateien = runIn(repo, "git", ["diff", "--name-only", "upstream/master", "absicherung/probe"]).stdout.trim();
  assert.equal(dateien, "test/text.test.js");
});

test("meldet der Test-Agent einen Mutanten als gleichwertig, schreibt der Absicherungslauf keinen Vermerk", (context) => {
  const drehbuch = { "test-nachrunde": {}, "test-nachrunde-antwort": [ABSATZ_ALTER_STAND, "", `Gleichwertig: ${MUTANT}, weil ${GRUND}`].join("\n") };
  const { lauf, branch } = absichern(context, { drehbuch, mutation: { ueberlebtOhne: "gibt es nie" } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(branch, []);
  assert.ok(lauf.stdout.includes("Absicherung B1: nicht abgesichert"), lauf.stdout);
});

test("ein wartender Auftrag, dessen Zeilen sich mit dem laufenden überschneiden, wird nicht abgesichert", (context) => {
  const verbunden = { ...WARTENDER, erwarteteDateien: ["src/rechnen.js"], betrifft: { "src/rechnen.js": ["verdopple"] } };
  const { lauf, branch, aufrufe } = absichern(context, { auftraege: [LAUFENDER, verbunden] });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual([branch, aufrufe], [[], []]);
  assert.ok(lauf.stdout.includes("Absicherung: 0 Aufträge"), lauf.stdout);
});

test("ein wartender Auftrag, dessen betrifft-Namen in der Datei fehlen, wird nicht abgesichert und der Lauf bleibt ohne Vermerk", (context) => {
  const unvermessbar = { ...WARTENDER, betrifft: { "src/text.js": ["gibtEsNicht"] } };
  const { lauf, branch, aufrufe } = absichern(context, { auftraege: [LAUFENDER, unvermessbar] });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual([branch, aufrufe], [[], []]);
  assert.ok(lauf.stdout.includes("nicht abgesichert, die Zeilen aus betrifft sind nicht vermessbar"), lauf.stdout);
});

test("ein wartender Auftrag mit demselben Abnahmetest wie der laufende wird nicht abgesichert, weil beide dieselbe Testdatei ändern würden", (context) => {
  const gleicherTest = { ...WARTENDER, abnahme: LAUFENDER.abnahme };
  const { lauf, branch, aufrufe } = absichern(context, { auftraege: [LAUFENDER, gleicherTest] });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual([branch, aufrufe], [[], []]);
});

test("ein Auftrag, den der Branch schon vermerkt, wird beim zweiten Aufruf nicht noch einmal geprüft", (context) => {
  const { lauf, aufrufe } = absichern(context, { davor: mitVermerkB1 });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(aufrufe, []);
  assert.ok(lauf.stdout.includes("Absicherung B1: schon abgesichert, Lauf 555."), lauf.stdout);
});

test("der Absicherungslauf setzt die Plätze bei vorbelegter Umgebung immer auf höchstens 12: leer, ungültig oder größer ergibt 12, ein kleinerer Wert bleibt", (context) => {
  const vorbelegt = ["", "999", "13", "abc", "0", "-3", "5.5"];
  const plaetze = [...vorbelegt, "5"].map((wert) => absichern(context, { umgebung: { HERMES_MUTATION_PLAETZE: wert } }).aufrufe[0]?.plaetze);
  assert.deepEqual(plaetze, [...vorbelegt.map(() => HOECHSTE_PLAETZE), "5"]);
});

test("zwei wartende Aufträge, deren betrifft denselben Block nennen, teilen einen Lauf und einen Beleg, den der Branch für beide vermerkt", (context) => {
  const zweiter = { ...WARTENDER, id: "B2" };
  const { lauf, branch, aufrufe } = absichern(context, { auftraege: [LAUFENDER, WARTENDER, zweiter] });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(aufrufe.length, 1, lauf.stdout + lauf.stderr);
  assert.equal(branch.length, 1, branch.join("\n"));
  assert.ok(branch[0].includes("Absicherung: Lauf 777 Auftrag B1") && branch[0].includes("Absicherung: Lauf 777 Auftrag B2"), branch[0]);
  assert.ok(lauf.stdout.includes("Absicherung B1: abgesichert, Lauf 777.") && lauf.stdout.includes("Absicherung B2: abgesichert, Lauf 777."), lauf.stdout);
});

test("zwei wartende Aufträge mit verschiedenen Blöcken derselben Datei bekommen je einen eigenen Lauf und Beleg", (context) => {
  const zweiter = { ...WARTENDER, id: "B2", betrifft: { "src/text.js": ["klein"] } };
  const dateien = { "src/text.js": `${BASIS["src/text.js"]}\nexport function klein(text) {\n  return text.toLowerCase();\n}\n` };
  const { lauf, branch, aufrufe } = absichern(context, { auftraege: [LAUFENDER, WARTENDER, zweiter], dateien });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(aufrufe.length, 2, lauf.stdout + lauf.stderr);
  assert.equal(branch.length, 2, branch.join("\n"));
  assert.ok(branch.some((eintrag) => eintrag.includes("Auftrag B1") && !eintrag.includes("Auftrag B2")), branch.join("\n"));
  assert.ok(branch.some((eintrag) => eintrag.includes("Auftrag B2") && !eintrag.includes("Auftrag B1")), branch.join("\n"));
});

test("ist von zwei Aufträgen mit demselben Block einer schon vermerkt, prüft der Lauf nur den anderen", (context) => {
  const { lauf, aufrufe } = absichern(context, { auftraege: [LAUFENDER, WARTENDER, { ...WARTENDER, id: "B2" }], davor: mitVermerkB1 });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(aufrufe.length, 1, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stdout.includes("Absicherung B1: schon abgesichert, Lauf 555.") && lauf.stdout.includes("Absicherung B2: abgesichert, Lauf 777."), lauf.stdout);
});
