import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { messmenge } from "../../tools/auftrag/testumbau.mjs";
import { REPO_ROOT, isolatedEnvironment, probeRepository, writeFiles } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");

function nutzer(name, ...faelle) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import { ${name} } from "./hilfe.js";`,
    ...faelle.map((fall) => `test("${fall}", () => assert.equal(${name}(), ${name === "eins" ? 1 : 2}));`),
    "",
  ].join("\n");
}

const ZWEI_AUSGELAGERT = "export function zwei() {\n  return 2;\n}\n";
const HILFE_AUSGELAGERT = 'export function eins() {\n  return 1;\n}\nexport { zwei } from "./zwei-hilfe.js";\n';
const HILFE_ZUSAMMEN = `export function eins() {\n  return 1;\n}\n${ZWEI_AUSGELAGERT}`;
const EINS_TEST = nutzer("eins", "eins gibt eins", "eins bleibt eins");
const ZWEI_TEST = nutzer("zwei", "zwei gibt zwei", "zwei bleibt zwei");

function umbauRepo(context) {
  const repo = realpathSync(probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    "src/leer.js": "export {};\n",
    "test/hilfe.js": HILFE_AUSGELAGERT,
    "test/zwei-hilfe.js": ZWEI_AUSGELAGERT,
    "test/eins.test.js": EINS_TEST,
    "test/zwei.test.js": ZWEI_TEST,
  }));
  writeFiles(repo, { "test/hilfe.js": HILFE_ZUSAMMEN });
  rmSync(join(repo, "test/zwei-hilfe.js"));
  return repo;
}

function faelle(repo, umgebung = {}) {
  const lauf = spawnSync(process.execPath, [EINSTIEG, "testumbau", "--basis", "HEAD"], { cwd: repo, encoding: "utf8", env: { ...isolatedEnvironment(), ...umgebung } });
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

function entfernte(ausgabe) {
  return ausgabe.split("\n").filter((zeile) => zeile.startsWith("Entfernt: "));
}

const ALLE_FAELLE_BESTEHEN = /grün: 2 Testdateien geändert, 2 betroffene Testdateien vor und nach dem Umbau gelaufen, 0 Fälle entfernt, 0 Befunde\./;

test("Messmenge: beide Stände messen die Vereinigung ihrer Testdateien, jede Datei einmal und sortiert", () => {
  const tabelle = [
    { alt: ["test/b.test.js"], neu: ["test/a.test.js"], erwartet: ["test/a.test.js", "test/b.test.js"] },
    { alt: ["test/a.test.js"], neu: ["test/a.test.js"], erwartet: ["test/a.test.js"] },
    { alt: [], neu: ["test/a.test.js"], erwartet: ["test/a.test.js"] },
    { alt: ["test/a.test.js"], neu: [], erwartet: ["test/a.test.js"] },
  ];
  for (const { alt, neu, erwartet } of tabelle) assert.deepEqual(messmenge(alt, neu), erwartet);
});

test("Testumbau-Fälle: ein Umbau, der nur Hilfen verschiebt, lässt jeden Fall bestehen und meldet keinen als entfernt", (context) => {
  const lauf = faelle(umbauRepo(context));
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.deepEqual(entfernte(lauf.ausgabe), [], lauf.ausgabe);
  assert.match(lauf.ausgabe, ALLE_FAELLE_BESTEHEN);
});

test("Testumbau-Fälle: ein wirklich gelöschter Fall wird gemeldet, die Fälle einer anderen Datei nicht", (context) => {
  const repo = umbauRepo(context);
  writeFiles(repo, { "test/eins.test.js": nutzer("eins", "eins gibt eins") });
  const lauf = faelle(repo);
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.deepEqual(entfernte(lauf.ausgabe), ["Entfernt: test/eins.test.js: eins bleibt eins"], lauf.ausgabe);
});

test("Testumbau-Fälle: eine gelöschte Testdatei meldet alle ihre Fälle", (context) => {
  const repo = umbauRepo(context);
  rmSync(join(repo, "test/eins.test.js"));
  const lauf = faelle(repo);
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.deepEqual(entfernte(lauf.ausgabe), ["Entfernt: test/eins.test.js: eins gibt eins", "Entfernt: test/eins.test.js: eins bleibt eins"], lauf.ausgabe);
});

test("Testumbau-Fälle: liegt der Temp-Ordner hinter einem Symlink, urteilt der Lauf wie ohne Symlink", (context) => {
  const echt = realpathSync(mkdtempSync(join(tmpdir(), "tmp-echt-")));
  const verweis = join(tmpdir(), `tmp-verweis-${process.pid}`);
  symlinkSync(echt, verweis);
  context.after(() => {
    rmSync(verweis, { force: true });
    rmSync(echt, { recursive: true, force: true });
  });
  const lauf = faelle(umbauRepo(context), { TMPDIR: verweis });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.match(lauf.ausgabe, ALLE_FAELLE_BESTEHEN);
});

const MITTEL_VORHER = 'import * as hilfe from "./hilfe.js";\nexport function m() {\n  return hilfe.eins();\n}\nexport function n() {\n  return 5;\n}\n';
const MITTEL_NACHHER = 'import { eins } from "./hilfe.js";\nexport function m() {\n  return eins();\n}\nexport function n() {\n  return 5;\n}\n';
const HILFE_ZWEI = (rumpf) => `export function eins() {\n  return 1;\n}\nexport function zwei() {\n  return ${rumpf};\n}\n`;
const NUR_ALTER_STAND_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { n } from "./mittel.js";',
  'test("n gibt fünf", () => assert.equal(n(), 5));',
  'test("n bleibt fünf", () => assert.equal(n(), 5));',
  "",
].join("\n");

test("Testumbau-Fälle: eine Testdatei, die nur der alte Stand erreicht und deren Fälle bestehen, wird nicht als entfernt gemeldet", (context) => {
  const repo = realpathSync(probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    "src/leer.js": "export {};\n",
    "test/hilfe.js": HILFE_ZWEI("2"),
    "test/mittel.js": MITTEL_VORHER,
    "test/t.test.js": NUR_ALTER_STAND_TEST,
  }));
  writeFiles(repo, { "test/hilfe.js": HILFE_ZWEI("1 + 1"), "test/mittel.js": MITTEL_NACHHER });
  const lauf = faelle(repo);
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.deepEqual(entfernte(lauf.ausgabe), [], lauf.ausgabe);
  assert.match(lauf.ausgabe, /grün: 2 Testdateien geändert, 1 betroffene Testdateien vor und nach dem Umbau gelaufen, 0 Fälle entfernt, 0 Befunde\./);
});
