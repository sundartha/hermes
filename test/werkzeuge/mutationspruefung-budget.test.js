import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BASIS, EXIT_ABBRUCH, NEGATIV, quelle, testdatei } from "./mutationspruefung-hilfen.js";
import { commitAll, outputLines, probeDirectory, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";
import { halter, starte, umgebung, WARTET, wartet, zeile } from "./schwerlauf-lauf.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const LOGORDNER = ".mutationspruefung/log";
const VIELE_ZEILEN = 600;
const URTEIL = /^(?:grün|rot): /m;
const ABBRUCH_BUDGET = /^Abbruch: Budget/m;
const EIN_PLATZ = 1;
const BUDGET_UMGEBUNG = [
  "BUDGET",
  "BUDGET_MS",
  "MUTATION_BUDGET",
  "MUTATIONSPRUEFUNG_BUDGET",
  "MUTATIONSPRUEFUNG_BUDGET_MS",
  "MUTATIONSPRUEFUNG_BUDGET_MINUTEN",
  "RECHENZEIT_BUDGET",
  "ZEITBUDGET",
];
const SEHR_VIEL = "999999999";
const UNLESBAR = "  const grenze = (;";
const UNTERGRENZE = /^Vorschau Seite neu: 1 Quelldateien, 1 Testdateien, 1 Testgruppen, 0 Mutanten, Mutanten in 1 Quelldateien nicht zählbar, Schätzung mindestens/m;

function vieleMutanten() {
  return Array.from({ length: VIELE_ZEILEN }, (_leer, stelle) => `  if (zahl > ${stelle} && zahl < ${stelle + 2}) return "${stelle}";`);
}

function markierenderTest(marke) {
  return ['import { appendFileSync } from "node:fs";', `appendFileSync(${JSON.stringify(marke)}, "lief\\n");`, testdatei([-1, "negativ"], [1, "positiv"])].join("\n");
}

function logeintraege(repo) {
  const ordner = join(repo, LOGORDNER);
  const dateien = existsSync(ordner) ? readdirSync(ordner).filter((name) => name.endsWith(".jsonl")) : [];
  assert.equal(dateien.length, 1, JSON.stringify(dateien));
  return outputLines(readFileSync(join(ordner, dateien[0]), "utf8")).map((zeile) => JSON.parse(zeile));
}

function arten(eintraege, art) {
  return eintraege.filter((eintrag) => eintrag.art === art);
}

function grosseQuelleGeaendert(context, marke) {
  const repo = probeRepository(context, { ...BASIS, "test/zahl.test.js": markierenderTest(marke) });
  writeFiles(repo, { "src/zahl.js": quelle(...vieleMutanten()) });
  return repo;
}

function grosseQuelleTestUmgebaut(context, marke) {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": quelle(...vieleMutanten()), "test/zahl.test.js": markierenderTest(marke) });
  writeFiles(repo, { "test/zahl.test.js": `${markierenderTest(marke)}// umgebaut\n` });
  commitAll(repo, "Testumbau");
  return repo;
}

async function ohneWarten(context, { repo, env }, argumente) {
  const lauf = starte([WERKZEUG, ...argumente], { env, cwd: repo });
  context.after(() => lauf.kind.kill("SIGKILL"));
  const gewartet = zeile(lauf.kind.stderr, WARTET).then(() => assert.fail(`Lauf wartet auf die Sperre: ${lauf.stderr}`));
  const [code] = await Promise.race([lauf.ende, gewartet]);
  return { ...lauf, status: code };
}

function ohneStart(lauf, { repo, marke }) {
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, ABBRUCH_BUDGET, lauf.stderr);
  assert.doesNotMatch(lauf.stdout, URTEIL, lauf.stdout);
  assert.equal(existsSync(marke), false, "ein Testprozess lief trotz Schätzung über dem Budget");
  const eintraege = logeintraege(repo);
  assert.deepEqual([arten(eintraege, "sperre"), arten(eintraege, "stryker")], [[], []], JSON.stringify(eintraege));
  const [vorschau] = arten(eintraege, "vorschau");
  assert.ok(vorschau.schaetzung_ms > vorschau.budget_ms, JSON.stringify(vorschau));
  assert.equal(eintraege.at(-1).exit, EXIT_ABBRUCH, JSON.stringify(eintraege.at(-1)));
  return vorschau;
}

test("liegt die Schätzung der normalen Mutation über dem Budget, startet sie nicht und endet mit Exit 2, ohne auf die Sperre zu warten", async (context) => {
  const env = umgebung(context, EIN_PLATZ);
  await halter(context, env);
  const marke = join(probeDirectory(context, {}), "testlauf");
  const repo = grosseQuelleGeaendert(context, marke);
  const vorschau = ohneStart(await ohneWarten(context, { repo, env }, ["--basis", "HEAD"]), { repo, marke });
  assert.deepEqual([vorschau.quelldateien, vorschau.testdateien, vorschau.testgruppen], [1, 1, 1], JSON.stringify(vorschau));
});

test("liegt die Schätzung der Testumbau-Mutation über dem Budget, startet sie nicht und endet mit Exit 2, ohne auf die Sperre zu warten", async (context) => {
  const env = umgebung(context, EIN_PLATZ);
  await halter(context, env);
  const marke = join(probeDirectory(context, {}), "testlauf");
  const repo = grosseQuelleTestUmgebaut(context, marke);
  const vorschau = ohneStart(await ohneWarten(context, { repo, env }, ["--basis", "HEAD~1", "--testumbau"]), { repo, marke });
  assert.deepEqual([vorschau.quelldateien, vorschau.testdateien], [1, 1], JSON.stringify(vorschau));
});

test("Umgebungsvariablen heben das Budget nicht an: die Schätzung über dem Budget startet auch mit ihnen nicht", async (context) => {
  const marke = join(probeDirectory(context, {}), "testlauf");
  const ohne = umgebung(context, EIN_PLATZ);
  const mit = { ...ohne, ...Object.fromEntries(BUDGET_UMGEBUNG.map((name) => [name, SEHR_VIEL])) };
  const budgets = [];
  for (const env of [ohne, mit]) {
    const repo = grosseQuelleGeaendert(context, marke);
    budgets.push(ohneStart(await ohneWarten(context, { repo, env }, ["--basis", "HEAD"]), { repo, marke }).budget_ms);
  }
  assert.equal(budgets[1], budgets[0]);
});

test("eine nicht zählbare Quelldatei rechnet die Vorschau nicht als 0 Mutanten, sondern weist die Schätzung als Untergrenze aus", async (context) => {
  const env = umgebung(context, EIN_PLATZ);
  await halter(context, env);
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, UNLESBAR) });
  const lauf = starte([WERKZEUG, "--basis", "HEAD"], { env, cwd: repo });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await wartet(lauf);
  assert.match(lauf.stdout, UNTERGRENZE, lauf.stdout);
  const [vorschau] = arten(logeintraege(repo), "vorschau");
  assert.deepEqual([vorschau.mutanten, vorschau.unzaehlbar], [0, 1], JSON.stringify(vorschau));
});
