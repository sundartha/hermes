import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { EXIT_ROT, werkzeug } from "./mutationspruefung-probe.js";
import { isolatedEnvironment, probeDirectory, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";

const MUTATION = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const EXIT_GRUEN = 0;
const EXIT_ABBRUCH = 2;
const POSTGRES = "HERMES_TEST_POSTGRES_URL";
const BEFUND = /^(?:Verstoß|rot|grün|Kein Verstoß): .+$/gm;
const QUELLE = "src/zahl.js";
const ZAHL = 'export function einordnen(zahl) {\n  const vermerk = "unbenutzt";\n  if (zahl < 0) return "negativ";\n  return "positiv";\n}\n';
const POSTGRES_HILFE = [
  "export async function echteDatenbank(t) {",
  `  if (!process.env.${POSTGRES}) {`,
  '    t.skip("kein Postgres");',
  "    return null;",
  "  }",
  "  return {};",
  "}",
  "",
].join("\n");
const PROBE = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  [QUELLE]: ZAHL,
  "test/zahl.test.js": zahlTest(),
};

function zahlTest(...faelle) {
  const standard = ['test("negativ", () => assert.equal(einordnen(-1), "negativ"));', 'test("null", () => assert.equal(einordnen(0), "positiv"));', 'test("positiv", () => assert.equal(einordnen(1), "positiv"));'];
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { einordnen } from "../src/zahl.js";',
    ...(faelle.length === 0 ? standard : faelle),
    "",
  ].join("\n");
}

const NUR_POSITIV = zahlTest('test("positiv", () => assert.equal(einordnen(1), "positiv"));');

function postgresTest(zusatz) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { echteDatenbank } from "./gemeinsam/echtes-postgres.js";',
    'import { einordnen } from "../src/zahl.js";',
    'test("negativ", async (t) => {',
    "  const datenbank = await echteDatenbank(t);",
    "  if (datenbank === null) return;",
    '  assert.equal(einordnen(-1), "negativ");',
    "});",
    zusatz,
    "",
  ].join("\n");
}

function befundzeilen(ausgabe) {
  return [...ausgabe.matchAll(BEFUND)].map(([zeile]) => zeile).sort();
}

function befunde({ stdout }) {
  return befundzeilen(stdout);
}

function inDerCiStrecke(context, repo, basis) {
  const ordner = probeDirectory(context, {});
  const planDatei = join(ordner, "plan.json");
  const plan = werkzeug(repo, basis, "--testumbau", "--plan", planDatei);
  assert.equal(plan.status, EXIT_GRUEN, plan.stdout + plan.stderr);
  const angaben = JSON.parse(readFileSync(planDatei, "utf8"));
  for (const teil of angaben.teile) {
    const lauf = werkzeug(repo, basis, "--testumbau", "--teil", String(teil), "--teile", String(angaben.anzahl), "--ergebnis", join(ordner, `mutation-teil-${teil}.json`));
    assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  }
  return { angaben, urteil: werkzeug(repo, basis, "--testumbau", "--urteil", ordner) };
}

function ohnePostgres(repo, ...argumente) {
  const umgebung = isolatedEnvironment();
  delete umgebung[POSTGRES];
  return spawnSync(process.execPath, [MUTATION, "--basis", "HEAD", "--testumbau", ...argumente], { cwd: repo, encoding: "utf8", env: umgebung });
}

test("Testumbau über Plan, Teile und Urteil ist grün wie der lokale Gesamtlauf, wenn der Umbau jeden Mutanten weiter tötet", (context) => {
  const repo = probeRepository(context, PROBE);
  writeFiles(repo, { "test/zahl.test.js": `${zahlTest()}// umgebaut\n` });
  const ganz = werkzeug(repo, "HEAD", "--testumbau");
  assert.equal(ganz.status, EXIT_GRUEN, ganz.stdout + ganz.stderr);
  const { urteil } = inDerCiStrecke(context, repo, "HEAD");
  assert.equal(urteil.status, EXIT_GRUEN, urteil.stdout + urteil.stderr);
  assert.deepEqual(befunde(urteil), befunde(ganz));
});

test("Testumbau über Plan, Teile und Urteil ist rot mit denselben Verstoß-Zeilen wie der lokale Gesamtlauf, wenn der Umbau einen Mutanten nicht mehr tötet", (context) => {
  const repo = probeRepository(context, PROBE);
  writeFiles(repo, { "test/zahl.test.js": NUR_POSITIV });
  const ganz = werkzeug(repo, "HEAD", "--testumbau");
  assert.equal(ganz.status, EXIT_ROT, ganz.stdout + ganz.stderr);
  const { urteil } = inDerCiStrecke(context, repo, "HEAD");
  assert.equal(urteil.status, EXIT_ROT, urteil.stdout + urteil.stderr);
  assert.match(urteil.stdout, /^Verstoß: Mutant nicht mehr getötet: src\/zahl\.js:3:7 /m);
  assert.deepEqual(befunde(urteil), befunde(ganz));
});

test("Testumbau über Plan, Teile und Urteil ohne Quelldatei unter den betroffenen Tests hat keinen Teil und ist grün", (context) => {
  const repo = probeRepository(context, { ...PROBE, "test/allein.test.js": 'import { test } from "node:test";\ntest("allein", () => {});\n' });
  writeFiles(repo, { "test/allein.test.js": 'import { test } from "node:test";\ntest("allein", () => {});\n// umgebaut\n' });
  const { angaben, urteil } = inDerCiStrecke(context, repo, "HEAD");
  assert.equal(angaben.anzahl, 0);
  assert.equal(urteil.status, EXIT_GRUEN, urteil.stdout + urteil.stderr);
  assert.match(urteil.stdout, /^grün: die betroffenen Tests \(1\) importieren keine Quelldatei unter src\/; es gibt keinen Mutanten zu vergleichen\.$/m);
});

test("Testumbau über Plan, Teil oder Urteil zusammen mit altem Stand oder Gleichwertig-Meldung bricht mit dem Aufruftext ab", (context) => {
  const repo = probeRepository(context, PROBE);
  const zusaetze = [["--alter-stand"], ["--gleichwertig", "src/zahl.js:3:7 EqualityOperator → zahl <= 0"]];
  for (const zusatz of zusaetze) {
    for (const messart of [["--plan", "x"], ["--urteil", "x"]]) {
      const lauf = werkzeug(repo, "HEAD", "--testumbau", ...messart, ...zusatz);
      assert.equal(lauf.status, EXIT_ABBRUCH, `${messart.join(" ")} ${zusatz.join(" ")}`);
      assert.match(lauf.stderr, /Aufruf: /);
    }
  }
});

test("Testumbau in der CI-Strecke bricht ohne Postgres ab und nennt die Testdatei, wenn die Tests am Basisstand Postgres brauchen und überspringen", (context) => {
  const repo = probeRepository(context, { ...PROBE, "test/gemeinsam/echtes-postgres.js": POSTGRES_HILFE, "test/zahl.test.js": postgresTest("") });
  writeFiles(repo, { "test/zahl.test.js": postgresTest("// umgebaut") });
  const plan = join(probeDirectory(context, {}), "plan.json");
  const lauf = ohnePostgres(repo, "--plan", plan);
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /^Abbruch: .*test\/zahl\.test\.js.*HERMES_TEST_POSTGRES_URL.*kein Urteil\.$/m);
  const mit = spawnSync(process.execPath, [MUTATION, "--basis", "HEAD", "--testumbau", "--plan", plan], { cwd: repo, encoding: "utf8", env: { ...isolatedEnvironment(), [POSTGRES]: "postgres://probe@localhost/probe" } });
  assert.equal(mit.status, EXIT_GRUEN, mit.stdout + mit.stderr);
});

test("Testumbau in der CI-Strecke bricht ohne Postgres ab, wenn erst die Tests am Kopf Postgres brauchen und überspringen", (context) => {
  const repo = probeRepository(context, { ...PROBE, "test/gemeinsam/echtes-postgres.js": POSTGRES_HILFE });
  writeFiles(repo, { "test/zahl.test.js": postgresTest("") });
  const lauf = ohnePostgres(repo, "--plan", join(probeDirectory(context, {}), "plan.json"));
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /^Abbruch: .*test\/zahl\.test\.js.*HERMES_TEST_POSTGRES_URL.*kein Urteil\.$/m);
});

test("Testumbau in der CI-Strecke ohne Postgres ist unbeanstandet, solange keine betroffene Testdatei Postgres braucht", (context) => {
  const repo = probeRepository(context, PROBE);
  writeFiles(repo, { "test/zahl.test.js": `${zahlTest()}// umgebaut\n` });
  const lauf = ohnePostgres(repo, "--plan", join(probeDirectory(context, {}), "plan.json"));
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
});
