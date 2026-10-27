import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ABSATZ_MUTATION, exitCodes, funktion, MIT_MUTATION, ROTER_TEST, VERDOPPELT } from "./auftrag-lauf-hilfen.js";
import { BASIS, EXIT_ROT, starte, UMBAU } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const SATZ = "Eine Zahl wird nie falsch verdoppelt.";
const OHNE_WIRKUNG = 'test("[NIE1] drei bleibt kein Text", () => assert.notDeepEqual(verdopple(3), "6"));';
const MIT_WIRKUNG = 'test("[NIE1] drei wird sechs", () => assert.equal(verdopple(3), 6));';
const ALTER_CODE = 'test("[NIE1] Text bleibt groß", () => assert.equal(gross("a"), "A"));';
const GROSS_IMPORT = 'import { gross } from "../src/text.js";';
const NACHRUNDE = "## Schutztests ohne Wirkung";
const ABSATZ = "Zweck schutzwirkung: Drehbuchtext des Ersatz-Agenten.";
const ALTER_SCHUTZ = "[NIE1] src/text.js:2";
const FALSCHER_SCHUTZ = "[NIE1] src/text.js:1";
const NICHT_PRUEFBAR = "Hinweis: Wirkung der Schutztests nicht prüfbar, keine neue oder geänderte Zeile unter src/.";
const ERSATZ_MUTATION = `import { readFileSync } from "node:fs";
const argumente = process.argv.slice(2);
const testdatei = readFileSync("test/rechnen.test.js", "utf8");
const name = /test\\("(\\[NIE1\\][^"]*)"/.exec(testdatei)?.[1];
if (!argumente.includes("--schutzwirkung") && !testdatei.includes("verdopple(2), 4")) {
  console.log("Verstoß: Mutant überlebt: src/rechnen.js:2:10 ArithmeticOperator → zahl / 2");
  process.exitCode = 1;
} else if (!argumente.includes("--schutzwirkung")) console.log("grün: keiner überlebt");
else if (name.includes("ohne neue Zeile")) console.log(${JSON.stringify(NICHT_PRUEFBAR)});
else if (testdatei.includes("gross(")) console.log("Hinweis: Schutztest erreicht keine neue Zeile, Wirkung nicht prüfbar: " + name);
else if (!testdatei.includes("notDeepEqual")) console.log("Schutztest wirksam: " + name);
else if (argumente.includes(${JSON.stringify(ALTER_SCHUTZ)})) console.log("Hinweis: Schutz im alten Code belegt (src/text.js:2): " + name);
else if (argumente.includes(${JSON.stringify(FALSCHER_SCHUTZ)})) {
  console.log("Verstoß: Alter Schutz nicht belegt (src/text.js:1, der Fall tötet dort keinen Mutanten): " + name);
  process.exitCode = 1;
} else {
  console.log("Verstoß: Schutztest wirkungslos: " + name);
  process.exitCode = 1;
}
`;

function schutzfall(fall, ...importe) {
  return { "test/rechnen.test.js": [ROTER_TEST.trimEnd(), ...importe, fall, ""].join("\n") };
}

function laufMit(context, fall, zusatz = {}) {
  const drehbuch = { test: fall, bau: { "src/rechnen.js": VERDOPPELT }, nach: NACHRUNDE, ...zusatz };
  const dateien = { ...MIT_MUTATION, "mutation.mjs": ERSATZ_MUTATION };
  return starte(context, { auftrag: { ...funktion("2 !== 4"), wasDarfNiePassieren: [SATZ] }, drehbuch, dateien });
}

function nachricht(repo) {
  return runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout;
}

test("ein Schutztest ohne Wirkung geht mit Satz und Testname an den Test-Agenten; bleibt er wirkungslos, ist der Auftrag rot", (context) => {
  const { werkzeug, lauf, beleg } = laufMit(context, schutzfall(OHNE_WIRKUNG), { "test-antwort": ABSATZ, "test-nach-antwort": ABSATZ });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual([exitCodes(beleg, "schutzwirkung"), exitCodes(beleg, "schutzwirkung nach Test")], [[EXIT_ROT], [EXIT_ROT]]);
  assert.equal(beleg.grund, "Schutztest ohne Wirkung: Schutztest wirkungslos: [NIE1] drei bleibt kein Text");
  const prompt = readFileSync(join(werkzeug, "prompt-test-nach.txt"), "utf8");
  assert.ok(prompt.includes(`- Schutztest wirkungslos: [NIE1] drei bleibt kein Text – Satz [NIE1] „${SATZ}“`), prompt);
});

test("macht der Test-Agent den Schutztest ohne Wirkung wirksam, wird der Auftrag grün", (context) => {
  const nachrunde = { "test-nach": schutzfall(MIT_WIRKUNG), "test-nach-antwort": ABSATZ };
  const { lauf, beleg } = laufMit(context, schutzfall(OHNE_WIRKUNG), nachrunde);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual([exitCodes(beleg, "schutzwirkung"), exitCodes(beleg, "schutzwirkung nach Test")], [[EXIT_ROT], [0]]);
});

test("ein wirksamer Schutztest bleibt grün und braucht keine Nachrunde", (context) => {
  const { werkzeug, lauf, beleg } = laufMit(context, schutzfall(MIT_WIRKUNG));
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, "schutzwirkung"), [0]);
  assert.equal(existsSync(join(werkzeug, "prompt-test-nach.txt")), false);
});

test("ein Schutztest für Schutz im unveränderten Code erzeugt keinen Befund, nur einen Hinweis im Commit", (context) => {
  const { werkzeug, repo, lauf, beleg } = laufMit(context, schutzfall(ALTER_CODE, GROSS_IMPORT));
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, "schutzwirkung"), [0]);
  assert.equal(existsSync(join(werkzeug, "prompt-test-nach.txt")), false);
  assert.ok(nachricht(repo).includes("Hinweis: Schutztest erreicht keine neue Zeile, Wirkung nicht prüfbar: [NIE1] Text bleibt groß"), nachricht(repo));
});

test("meldet der Test-Agent alten Schutz, prüft der Lauf genau diese Zeile und hält Antwort und Beleg im Commit fest", (context) => {
  const antwort = `${ABSATZ}\nAlter Schutz: ${ALTER_SCHUTZ}, weil die Verdopplung dort schon geprüft wird`;
  const { repo, lauf, beleg } = laufMit(context, schutzfall(OHNE_WIRKUNG), { "test-nach-antwort": antwort });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const [zweite] = beleg.pruefungen.filter(({ name }) => name === "schutzwirkung nach Test");
  assert.ok(zweite.befehl.includes(`--alter-schutz ${ALTER_SCHUTZ}`), zweite.befehl);
  assert.equal(nachricht(repo).split(`Alter Schutz: ${ALTER_SCHUTZ}, weil die Verdopplung dort schon geprüft wird`).length, 2, nachricht(repo));
  assert.ok(nachricht(repo).includes("Hinweis: Schutz im alten Code belegt (src/text.js:2): [NIE1] drei bleibt kein Text"), nachricht(repo));
});

test("im Umbau prüft der Lauf die Wirkung der Schutztests nicht und sagt das im Commit", (context) => {
  const textTest = [BASIS["test/text.test.js"].trimEnd(), 'test("leer", () => assert.equal(gross(""), ""));', 'test("[NIE1] Text bleibt groß", () => assert.equal(gross("a"), "A"));', ""].join("\n");
  const antwort = "Zweck mutation alter Stand: Drehbuchtext des Ersatz-Agenten.\nZweck schutztests: Drehbuchtext des Ersatz-Agenten.";
  const drehbuch = { "test-nachrunde": { "test/text.test.js": textTest }, "test-nachrunde-antwort": antwort, bau: { "src/text.js": "export function gross(text) {\n  return String(text).toUpperCase();\n}\n" } };
  const { repo, lauf } = starte(context, { auftrag: { ...UMBAU, wasDarfNiePassieren: [SATZ] }, drehbuch, dateien: MIT_MUTATION });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(nachricht(repo).includes("Hinweis: Wirkung der Schutztests im Umbau nicht geprüft."), nachricht(repo));
});

test("sagt die Prüfung „nicht prüfbar“, steht der Grund im Commit", (context) => {
  const { repo, lauf, beleg } = laufMit(context, schutzfall('test("[NIE1] ohne neue Zeile drei wird sechs", () => assert.equal(verdopple(3), 6));'));
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, "schutzwirkung"), [0]);
  assert.ok(nachricht(repo).includes(NICHT_PRUEFBAR), nachricht(repo));
});

test("ist der gemeldete alte Schutz nicht belegt, ist der Auftrag mit genau diesem Grund rot", (context) => {
  const antwort = `${ABSATZ}\nAlter Schutz: ${FALSCHER_SCHUTZ}, weil die Verdopplung dort schon geprüft wird`;
  const { lauf, beleg } = laufMit(context, schutzfall(OHNE_WIRKUNG), { "test-antwort": ABSATZ, "test-nach-antwort": antwort });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, "Schutztest ohne Wirkung: Alter Schutz nicht belegt (src/text.js:1, der Fall tötet dort keinen Mutanten): [NIE1] drei bleibt kein Text");
});

test("eine Alter-Schutz-Antwort in falscher Form wird verworfen und der Schutztest bleibt ein Befund", (context) => {
  const antwort = `${ABSATZ}\nAlter Schutz: irgendwo im alten Code, weil die Verdopplung dort schon geprüft wird`;
  const { lauf, beleg } = laufMit(context, schutzfall(OHNE_WIRKUNG), { "test-antwort": ABSATZ, "test-nach-antwort": antwort });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  const [zweite] = beleg.pruefungen.filter(({ name }) => name === "schutzwirkung nach Test");
  assert.ok(!zweite.befehl.includes("--alter-schutz"), zweite.befehl);
  assert.equal(beleg.grund, "Schutztest ohne Wirkung: Schutztest wirkungslos: [NIE1] drei bleibt kein Text");
});

test("schwächt der Test-Agent in der Schutzrunde einen tötenden Fall, wird die Mutationsprüfung der neuen Zeilen rot", (context) => {
  const geschwaecht = { "test/rechnen.test.js": ROTER_TEST.replace("verdopple(2), 4", "verdopple(2) > 0, true").trimEnd() + `\n${MIT_WIRKUNG}\n` };
  const { lauf, beleg } = laufMit(context, schutzfall(OHNE_WIRKUNG), { "test-nach": geschwaecht, "test-antwort": `${ABSATZ}\n${ABSATZ_MUTATION}`, "test-nach-antwort": `${ABSATZ}\n${ABSATZ_MUTATION}` });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, "Mutant überlebt: src/rechnen.js:2:10 ArithmeticOperator → zahl / 2");
});

test("nennt der Test-Agent dieselbe Kennung zweimal als alten Schutz, prüft der Lauf nur die erste Angabe", (context) => {
  const antwort = [ABSATZ, `Alter Schutz: ${ALTER_SCHUTZ}, weil die Verdopplung dort schon geprüft wird`, `Alter Schutz: ${FALSCHER_SCHUTZ}, weil auch dort`].join("\n");
  const { lauf, beleg } = laufMit(context, schutzfall(OHNE_WIRKUNG), { "test-nach-antwort": antwort });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const [zweite] = beleg.pruefungen.filter(({ name }) => name === "schutzwirkung nach Test");
  assert.ok(zweite.befehl.includes(`--alter-schutz ${ALTER_SCHUTZ}`) && !zweite.befehl.includes(FALSCHER_SCHUTZ), zweite.befehl);
});
