import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { TESTDATEIEN_JE_ANTEIL } from "../../tools/mutationspruefung/teile.mjs";
import { quelltexttest } from "./mutationspruefung-hilfen.js";
import { EXIT_ROT, werkzeug } from "./mutationspruefung-probe.js";
import { commitAll, probeDirectory, probeRepository, writeFiles } from "./probe-repo.js";

const BEFUND = /^(?:Verstoß|rot|grün|Bestätigung): .+$/gm;
const AKTIVER_MUTANT = ["__STRY", "KER_ACTIVE_MUT", "ANT__"].join("");

function quelle(...zeilen) {
  return ["export const protokoll = [];", "export function einordnen(zahl) {", ...zeilen, '  return "positiv";', "}", ""].join("\n");
}

function testdatei(...pruefungen) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { einordnen } from "../src/zahl.js";',
    'test("probe", () => {',
    ...pruefungen.map((pruefung) => `  ${pruefung}`),
    "});",
    "",
  ].join("\n");
}

const NEGATIV = '  if (zahl < 0) return "negativ";';
const NULL = '  if (zahl === 0) return "null";';
const PROTOKOLL = "  protokoll.push(zahl);";
const ABSCHALTEN = "  // Stryker disable next-line all";
const BASIS = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "src/zahl.js": quelle(NEGATIV),
  "test/zahl.test.js": testdatei('assert.equal(einordnen(-1), "negativ");', 'assert.equal(einordnen(1), "positiv");'),
};

function befunde(lauf) {
  const zeilen = [...lauf.stdout.matchAll(BEFUND)].map(([zeile]) => zeile);
  return zeilen.sort();
}

function aufgeteilt(context, repo, { basis, zwischen = () => {} }) {
  const ordner = probeDirectory(context, {});
  const planDatei = join(ordner, "plan.txt");
  const planLauf = werkzeug(repo, basis, "--plan", planDatei);
  assert.equal(planLauf.status, 0, planLauf.stdout + planLauf.stderr);
  const plan = JSON.parse(readFileSync(planDatei, "utf8"));
  const laeufe = [];
  for (const teil of plan.teile) {
    const ergebnis = join(ordner, `mutation-teil-${teil}.json`);
    const lauf = werkzeug(repo, basis, "--teil", String(teil), "--teile", String(plan.anzahl), "--ergebnis", ergebnis);
    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    laeufe.push(lauf);
  }
  zwischen();
  return { plan, laeufe, urteil: werkzeug(repo, basis, "--urteil", ordner) };
}

function gleichesUrteil(context, repo, basis = "HEAD") {
  const ganz = werkzeug(repo, basis);
  const { plan, urteil } = aufgeteilt(context, repo, { basis });
  assert.equal(urteil.status, ganz.status, `ganz:\n${ganz.stdout}\naufgeteilt:\n${urteil.stdout}${urteil.stderr}`);
  assert.deepEqual(befunde(urteil), befunde(ganz));
  return { ganz, plan };
}

function fuellung() {
  return Object.fromEntries(
    Array.from({ length: TESTDATEIEN_JE_ANTEIL }, (_leer, index) => [
      `test/fuellung-${String(index).padStart(3, "0")}.test.js`,
      testdatei('assert.equal(typeof einordnen, "function");'),
    ]),
  );
}

test("in mehreren Anteilen bleiben gelöschte Zeile, Kommentar Stryker disable und ein Mutant, den kein Anteil tötet, rot wie im ganzen Lauf", (context) => {
  const repo = probeRepository(context, { ...BASIS, ...fuellung() });
  writeFiles(repo, { "src/zahl.js": quelle(PROTOKOLL, NEGATIV, ABSCHALTEN, NULL) });
  const { ganz, plan } = gleichesUrteil(context, repo);
  assert.equal(plan.anzahl, 2);
  assert.equal(ganz.status, EXIT_ROT, ganz.stdout + ganz.stderr);
  const verstoesse = befunde(ganz).filter((zeile) => zeile.startsWith("Verstoß: Mutant überlebt: "));
  assert.ok(verstoesse.includes("Verstoß: Mutant überlebt: src/zahl.js:3 Zeile gelöscht"), ganz.stdout);
  assert.ok(verstoesse.includes("Verstoß: Mutant überlebt: src/zahl.js:5 Kommentar „Stryker disable“"), ganz.stdout);
  assert.ok(verstoesse.some((zeile) => zeile.startsWith("Verstoß: Mutant überlebt: src/zahl.js:6:")), ganz.stdout);
});

const HILFE = { "test/hilfe.js": 'export { einordnen, protokoll } from "../src/zahl.js";\n' };
const VERLANGT_NULL = ['assert.equal(einordnen(0), "null");', "assert.deepEqual(protokoll, [0]);"];

function indirekterTest(marke, pruefungen = VERLANGT_NULL) {
  return [
    'import assert from "node:assert/strict";',
    'import { appendFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'import { einordnen, protokoll } from "./hilfe.js";',
    `appendFileSync(${JSON.stringify(marke)}, "lauf\\n");`,
    'test("probe", () => {',
    ...pruefungen.map((pruefung) => `  ${pruefung}`),
    "});",
    "",
  ].join("\n");
}

test("was nur eine indirekt erreichende Testdatei tötet, misst bei Anteilen der Teil mit dieser Testdatei, und das Urteil gleicht dem ganzen Lauf", (context) => {
  const marke = join(probeDirectory(context, {}), "mutationspruefung-indirekt.txt");
  const repo = probeRepository(context, {
    ...BASIS,
    ...fuellung(),
    ...HILFE,
    "test/indirekt.test.js": indirekterTest(marke),
  });
  writeFiles(repo, { "src/zahl.js": quelle(PROTOKOLL, NEGATIV, NULL) });
  const markenzeilen = () => (existsSync(marke) ? readFileSync(marke, "utf8") : "");
  let vorDemUrteil;
  const { plan, laeufe, urteil } = aufgeteilt(context, repo, {
    basis: "HEAD",
    zwischen: () => {
      vorDemUrteil = markenzeilen();
    },
  });
  assert.notEqual(vorDemUrteil, "", "kein Teil hat die indirekte Testdatei gestartet");
  assert.equal(markenzeilen(), vorDemUrteil, "das Urteil hat die indirekte Testdatei gestartet");
  assert.equal(plan.anzahl, 2);
  assert.ok(laeufe.some((lauf) => / [1-9]\d* in diesen Testdateien nicht getötet/.test(lauf.stdout)), laeufe.map((lauf) => lauf.stdout).join("\n"));
  assert.equal(urteil.status, 0, urteil.stdout + urteil.stderr);
  const ganz = werkzeug(repo, "HEAD");
  assert.equal(ganz.status, 0, ganz.stdout + ganz.stderr);
  assert.deepEqual(befunde(urteil), befunde(ganz));
});

test("ein Umbau-Commit, der ungetestetes Verhalten entfernt, ist auch aufgeteilt rot", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": quelle(NEGATIV, NULL) });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV) });
  commitAll(repo, "Räume auf\n\nWarum: kürzer.\n\nArt: umbau\nPaket: 27");
  const { ganz } = gleichesUrteil(context, repo, "HEAD~1");
  assert.equal(ganz.status, EXIT_ROT, ganz.stdout + ganz.stderr);
  assert.match(ganz.stdout, /^rot: Umbau verworfen/m);
});

test("eine neue Zeile, die Strykers Zustand abfragt, ist aufgeteilt rot, mit und ohne geänderte Zeile unter src/", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "test/zustand.test.js": testdatei(`assert.equal(process.env.${AKTIVER_MUTANT}, undefined);`) });
  const ohne = gleichesUrteil(context, repo);
  assert.equal(ohne.ganz.status, EXIT_ROT, ohne.ganz.stdout + ohne.ganz.stderr);
  assert.deepEqual(ohne.plan.teile, [0]);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL), "test/zahl.test.js": testdatei('assert.equal(einordnen(0), "null");', 'assert.equal(einordnen(1), "positiv");', 'assert.equal(einordnen(-1), "negativ");') });
  const mit = gleichesUrteil(context, repo);
  assert.equal(mit.ganz.status, EXIT_ROT, mit.ganz.stdout + mit.ganz.stderr);
  assert.match(mit.ganz.stdout, /^Verstoß: Zeile fragt Strykers Zustand ab/m);
});

test("eine neue Datei, die keine Testdatei erreicht, ist aufgeteilt rot", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/neu.js": "export const eins = () => 1;\n" });
  commitAll(repo, "Lege eine neue Datei an");
  const { ganz } = gleichesUrteil(context, repo, "HEAD~1");
  assert.equal(ganz.status, EXIT_ROT, ganz.stdout + ganz.stderr);
  assert.match(ganz.stdout, /keine Testdatei erreicht die Datei/);
});

const OHNE_QUELLTEXT = /^Zweite Stufe ohne test\/quelltext\.test\.js › ist leer: im Erstlauf rot$/m;

test("eine Testdatei der zweiten Stufe, die schon im Erstlauf rot ist, lässt der Teil mit dieser Testdatei aus und nennt sie, mit denselben Befunden wie im ganzen Lauf", (context) => {
  const repo = probeRepository(context, { ...BASIS, ...fuellung(), "test/quelltext.test.js": quelltexttest("ist leer") });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const ganz = werkzeug(repo, "HEAD");
  const { plan, laeufe, urteil } = aufgeteilt(context, repo, { basis: "HEAD" });
  assert.equal(plan.anzahl, 2);
  assert.equal(ganz.status, EXIT_ROT, ganz.stdout + ganz.stderr);
  assert.equal(urteil.status, EXIT_ROT, urteil.stdout + urteil.stderr);
  assert.deepEqual(befunde(urteil), befunde(ganz));
  assert.equal(laeufe.filter((lauf) => OHNE_QUELLTEXT.test(lauf.stdout)).length, 1, laeufe.map((lauf) => lauf.stdout).join("\n"));
  assert.doesNotMatch(urteil.stdout, OHNE_QUELLTEXT);
});

const ZEHN = '  if (zahl === 10) return "zehn";';
const SCHWACH = ['assert.equal(typeof einordnen, "function");'];

function indirekteFuellung(marke) {
  return Object.fromEntries(
    Array.from({ length: TESTDATEIEN_JE_ANTEIL }, (_leer, index) => [
      `test/indirekt-${String(index).padStart(3, "0")}.test.js`,
      indirekterTest(marke, SCHWACH),
    ]),
  );
}

test("eine Datei mit einer direkten und vielen indirekt erreichenden Testdateien wird nach allen geteilt, und die Teile urteilen wie der ganze Lauf", (context) => {
  const marke = join(probeDirectory(context, {}), "mutationspruefung-fuellung.txt");
  const repo = probeRepository(context, { ...BASIS, ...HILFE, ...indirekteFuellung(marke), "test/indirekt.test.js": indirekterTest(marke) });
  writeFiles(repo, { "src/zahl.js": quelle(PROTOKOLL, NEGATIV, NULL, ZEHN) });
  const { ganz, plan } = gleichesUrteil(context, repo);
  assert.ok(plan.anzahl > 1, JSON.stringify(plan));
  assert.equal(ganz.status, EXIT_ROT, ganz.stdout + ganz.stderr);
  const verstoesse = befunde(ganz).filter((zeile) => zeile.startsWith("Verstoß: Mutant überlebt: "));
  assert.ok(verstoesse.length > 0, ganz.stdout);
  assert.ok(verstoesse.every((zeile) => zeile.startsWith("Verstoß: Mutant überlebt: src/zahl.js:6:")), ganz.stdout);
});
