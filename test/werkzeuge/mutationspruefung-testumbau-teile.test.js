import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { test } from "node:test";

import { nachherSeite, urteilsMengen } from "../../tools/mutationspruefung/testumbau.mjs";
import { aufgeteilt, befundzeilen } from "./mutationspruefung-hilfen.js";
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

function befunde(lauf) {
  return befundzeilen(lauf, BEFUND);
}

function inDerCiStrecke(context, repo, basis) {
  const { plan, urteil } = aufgeteilt(context, repo, { basis, zusatz: ["--testumbau"] });
  return { angaben: plan, urteil };
}

function ohnePostgres(repo, ...argumente) {
  const umgebung = isolatedEnvironment();
  delete umgebung[POSTGRES];
  return spawnSync(process.execPath, [MUTATION, "--basis", "HEAD", "--testumbau", ...argumente], { cwd: repo, encoding: "utf8", env: umgebung });
}

function brichtOhnePostgresAb(repo, plan) {
  const lauf = ohnePostgres(repo, "--plan", plan);
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /^Abbruch: .*test\/zahl\.test\.js.*HERMES_TEST_POSTGRES_URL.*kein Urteil\.$/m);
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
  assert.match(urteil.stdout, /^Verstoß: Mutant nicht mehr getötet: src\/zahl\.js:3:7-3:15 EqualityOperator → zahl <= 0$/m);
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
  brichtOhnePostgresAb(repo, plan);
  const mit = spawnSync(process.execPath, [MUTATION, "--basis", "HEAD", "--testumbau", "--plan", plan], { cwd: repo, encoding: "utf8", env: { ...isolatedEnvironment(), [POSTGRES]: "postgres://probe@localhost/probe" } });
  assert.equal(mit.status, EXIT_GRUEN, mit.stdout + mit.stderr);
});

test("Testumbau in der CI-Strecke bricht ohne Postgres ab, wenn erst die Tests am Kopf Postgres brauchen und überspringen", (context) => {
  const repo = probeRepository(context, { ...PROBE, "test/gemeinsam/echtes-postgres.js": POSTGRES_HILFE });
  writeFiles(repo, { "test/zahl.test.js": postgresTest("") });
  brichtOhnePostgresAb(repo, join(probeDirectory(context, {}), "plan.json"));
});

test("Testumbau in der CI-Strecke bricht ohne Postgres ab, wenn nur die Tests am Basisstand Postgres brauchen und der Kopf sie ohne Postgres umschreibt", (context) => {
  const repo = probeRepository(context, { ...PROBE, "test/gemeinsam/echtes-postgres.js": POSTGRES_HILFE, "test/zahl.test.js": postgresTest("") });
  writeFiles(repo, { "test/zahl.test.js": zahlTest() });
  brichtOhnePostgresAb(repo, join(probeDirectory(context, {}), "plan.json"));
});

test("Testumbau in der CI-Strecke ohne Postgres ist unbeanstandet, solange keine betroffene Testdatei Postgres braucht", (context) => {
  const repo = probeRepository(context, PROBE);
  writeFiles(repo, { "test/zahl.test.js": `${zahlTest()}// umgebaut\n` });
  const lauf = ohnePostgres(repo, "--plan", join(probeDirectory(context, {}), "plan.json"));
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
});

test("Testumbau-Plan holt mit --laufzeiten-holen die Laufzeittabelle für die Teil- und Urteil-Jobs und schreibt sie wie der Plan der normalen Mutation", (context) => {
  const repo = probeRepository(context, PROBE);
  writeFiles(repo, { "test/zahl.test.js": `${zahlTest()}// umgebaut\n` });
  const ordner = probeDirectory(context, {});
  const tabelle = join(ordner, "mutation-laufzeiten.json");
  mkdirSync(join(ordner, "bin"));
  writeFileSync(join(ordner, "bin", "gh"), "#!/bin/sh\necho 'HTTP 502' >&2\nexit 1\n");
  chmodSync(join(ordner, "bin", "gh"), 0o755);
  const lauf = spawnSync(process.execPath, [MUTATION, "--basis", "HEAD", "--testumbau", "--plan", join(ordner, "plan.json"), "--laufzeiten-holen", tabelle], {
    cwd: repo,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), PATH: `${join(ordner, "bin")}:${process.env.PATH}` },
  });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Mutationsplan: keine Laufzeiten geholt/m);
  assert.deepEqual(JSON.parse(readFileSync(tabelle, "utf8")).dauern, {});
});

const NEGATIV_HILFE = 'import { echteDatenbank } from "../gemeinsam/echtes-postgres.js";\nimport { einordnen } from "../../src/zahl.js";\nexport function negativ() {\n  return einordnen(-1);\n}\nexport function datenbank(t) {\n  return echteDatenbank(t);\n}\n';

function mitHilfe(pfad) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import { negativ } from "${pfad}";`,
    'test("negativ", () => assert.equal(negativ(), "negativ"));',
    "",
  ].join("\n");
}

test("Testumbau über Plan, Teile und Urteil meldet eine reine Verschiebung mit derselben Zeile und demselben Exit wie der lokale Gesamtlauf, auch wenn die verschobene Hilfe Postgres braucht und es fehlt", (context) => {
  const repo = probeRepository(context, { ...PROBE, "test/gemeinsam/echtes-postgres.js": POSTGRES_HILFE, "test/hilfe/negativ.js": NEGATIV_HILFE, "test/zahl.test.js": mitHilfe("./hilfe/negativ.js") });
  rmSync(join(repo, "test/hilfe/negativ.js"));
  writeFiles(repo, { "test/neu/negativ.js": NEGATIV_HILFE, "test/zahl.test.js": mitHilfe("./neu/negativ.js") });
  const ganz = werkzeug(repo, "HEAD", "--testumbau");
  assert.equal(ganz.status, EXIT_GRUEN, ganz.stdout + ganz.stderr);
  assert.match(ganz.stdout, /^reine Verschiebung: keine Testumbau-Mutation/m);
  const ohnePostgresPlan = ohnePostgres(repo, "--plan", join(probeDirectory(context, {}), "plan.json"));
  assert.equal(ohnePostgresPlan.status, EXIT_GRUEN, ohnePostgresPlan.stdout + ohnePostgresPlan.stderr);
  const { urteil } = inDerCiStrecke(context, repo, "HEAD");
  assert.equal(urteil.status, EXIT_GRUEN, urteil.stdout + urteil.stderr);
  assert.equal(urteil.stdout, ganz.stdout);
});

const LAGE = { start: { line: 4, column: 10 }, end: { line: 4, column: 19 } };

function getoetet(zeile, bestaetigung) {
  return { schluessel: `${QUELLE}:${zeile}:10 StringLiteral → ""`, datei: QUELLE, lage: LAGE, bestaetigung };
}

const HAENGER = getoetet(4, "haenger");
const ECHT = getoetet(5, "getoetet");

async function mitNeuberechnung(context, getoeteteMutanten) {
  const repo = probeRepository(context, PROBE);
  let aufrufe = 0;
  const werkzeug = {
    alterStand: () => () => {},
    durchgang: async () => (++aufrufe === 1 ? [] : [{ ...HAENGER, status: "Survived" }]),
    ueberlebt: ({ status }) => status === "Survived",
  };
  const davor = cwd();
  chdir(repo);
  try {
    return await nachherSeite(getoeteteMutanten, { basis: "HEAD", tests: ["test/zahl.test.js"] }, werkzeug);
  } finally {
    chdir(davor);
  }
}

test("Testumbau-Teil meldet verlorene Hänger getrennt von echten Verlusten und rechnet die Hänger im Basisstand nur neu, solange der Teil keinen echten Verlust hat", async (context) => {
  const nurHaenger = await mitNeuberechnung(context, [HAENGER]);
  assert.deepEqual([nurHaenger.verloren, nurHaenger.echteVerluste, nurHaenger.entfallenMoeglich], [[HAENGER.schluessel], 0, [HAENGER.schluessel]]);
  const gemischt = await mitNeuberechnung(context, [ECHT, HAENGER]);
  assert.deepEqual([gemischt.verloren, gemischt.echteVerluste, gemischt.entfallenMoeglich], [[ECHT.schluessel, HAENGER.schluessel], 1, []]);
});

test("Testumbau-Urteil über mehrere Teile lässt verlorene Hänger nur entfallen, wenn kein Teil einen echten Verlust meldet, wie der lokale Gesamtlauf", () => {
  const haengerTeil = { verloren: [HAENGER.schluessel], echteVerluste: 0, entfallenMoeglich: [HAENGER.schluessel] };
  const leererTeil = { verloren: [], echteVerluste: 0, entfallenMoeglich: [] };
  const echterTeil = { verloren: [ECHT.schluessel], echteVerluste: 1, entfallenMoeglich: [] };
  assert.deepEqual(urteilsMengen([haengerTeil, leererTeil]), { entfallen: [HAENGER.schluessel], verloren: [] });
  assert.deepEqual(urteilsMengen([haengerTeil, echterTeil]), { entfallen: [], verloren: [HAENGER.schluessel, ECHT.schluessel] });
});

const GROSSE_LISTE = `export const liste = [${Array.from({ length: 60_000 }, (_leer, stelle) => stelle).join(",")}];\n`;

test("Testumbau-Plan nennt ein nicht teilbares Stück mit Schätzung über der halben Jobgrenze von 360 Minuten in einer Warnzeile und plant trotzdem", (context) => {
  const repo = probeRepository(context, { ...PROBE, [QUELLE]: `${GROSSE_LISTE}${ZAHL}` });
  writeFiles(repo, { "test/zahl.test.js": `${zahlTest()}// umgebaut\n` });
  const plan = join(probeDirectory(context, {}), "plan.txt");
  const lauf = werkzeug(repo, "HEAD", "--testumbau", "--plan", plan);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Warnung: Stück \d+ \(src\/zahl\.js:\d+-\d+\) lässt sich nicht kleiner schneiden, Schätzung \d+ min, die Jobgrenze von GitHub liegt bei 360 min$/m);
});
