import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { TESTDATEIEN_JE_ANTEIL } from "../../tools/mutationspruefung/teile.mjs";
import { AKTIVER_MUTANT, pruefe } from "./mutationspruefung-hilfen.js";
import {
  REPO_ROOT,
  isolatedEnvironment,
  probeDirectory,
  probeRepository,
  writeFiles,
} from "./probe-repo.js";

const MUTANT = "17";
const FREMD = "PLW_FREMDE_VARIABLE";
const UNGESETZT = "-";
const GESEHEN = /kindmutant=(\S+) fremd=(\S+)/;
const LESEN = `process.env[${JSON.stringify(AKTIVER_MUTANT)}] ?? "${UNGESETZT}"`;
const KIND_SERVER = [
  `const gesehen = "kindmutant=" + (${LESEN}) + " fremd=" + (process.env.${FREMD} ?? "${UNGESETZT}");`,
  'process.stdout.write(gesehen + "\\nlaeuft auf http://localhost:1\\n");',
  "setTimeout(() => process.exit(0), 50);",
  "",
].join("\n");
const KIND_KONFIGURATION = [
  'import { config as echt } from "./config-echt.js";',
  'export * from "./config-echt.js";',
  `export const config = new Proxy(echt, { get: (ziel, feld) => (feld === "kindmutant" ? (${LESEN}) : Reflect.get(ziel, feld)) });`,
  "",
].join("\n");
const TREIBER = [
  'import { startServer, startServerExpectExit } from "./test/helpers.js";',
  'import { gebauteKonfiguration } from "./test/gemeinsam/gebaute-konfiguration.js";',
  "const beendet = await startServerExpectExit();",
  "const laufend = await startServer();",
  "const ausgabe = laufend.stdout;",
  "await laufend.stop();",
  'const { kindmutant } = gebauteKonfiguration({}, ["kindmutant"]);',
  'process.stdout.write("\\n" + JSON.stringify({ beendet: beendet.output, laufend: ausgabe, konfiguration: kindmutant }));',
  "process.exit(0);",
  "",
].join("\n");

function kopiereHermes(context) {
  const ordner = probeDirectory(context, {});
  for (const teil of ["src", "test", "tools", "package.json"])
    cpSync(join(REPO_ROOT, teil), join(ordner, teil), { recursive: true });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(ordner, "node_modules"));
  renameSync(join(ordner, "src/config.js"), join(ordner, "src/config-echt.js"));
  writeFiles(ordner, {
    "src/server.js": KIND_SERVER,
    "src/config.js": KIND_KONFIGURATION,
    "treiber.mjs": TREIBER,
  });
  return ordner;
}

test("ein Kind, das die gemeinsamen Testhilfen starten, sieht die Variable des aktiven Mutanten und keine andere des Elternprozesses", (context) => {
  const ordner = kopiereHermes(context);
  const lauf = spawnSync(process.execPath, ["treiber.mjs"], {
    cwd: ordner,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), [AKTIVER_MUTANT]: MUTANT, [FREMD]: "1" },
  });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const zeilen = lauf.stdout.trim().split("\n");
  const { beendet, laufend, konfiguration } = JSON.parse(zeilen.at(-1));
  assert.deepEqual(
    [beendet, laufend].map((ausgabe) => GESEHEN.exec(ausgabe)?.slice(1)),
    [
      [MUTANT, UNGESETZT],
      [MUTANT, UNGESETZT],
    ],
  );
  assert.equal(konfiguration, MUTANT);
});

const STARTWEGE = {
  starte: "src/server.js",
  starteMitWaechter: "test/helpers/waechter.mjs",
};

function startHilfe() {
  return [
    'import { spawnSync } from "node:child_process";',
    ...Object.entries(STARTWEGE).map(
      ([name, einstieg]) =>
        `export const ${name} = () => spawnSync(process.execPath, ["${einstieg}"], { encoding: "utf8" }).stdout;`,
    ),
    "",
  ].join("\n");
}

function kindtest(start) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import { ${start} } from "./hilfe.js";`,
    `test("kind", () => assert.equal(${start}(), "1"));`,
    "",
  ].join("\n");
}

function kindtests() {
  return Object.fromEntries(
    Object.keys(STARTWEGE).flatMap((start) =>
      Array.from({ length: TESTDATEIEN_JE_ANTEIL }, (_leer, index) => [
        `test/${start}-${index}.test.js`,
        kindtest(start),
      ]),
    ),
  );
}

const ANTEILE = /^Teil \d+ von \d+: .*$/gm;
const KIND_ANTEIL = /src\/kind\.js \(Testdateien (\d+) von (\d+)\)/g;

test("eine Quelldatei, die nur ein als Kind gestarteter Einstieg lädt, zählt jeden Test, der dieses Kind startet, direkt oder über ein importierendes Startskript", (context) => {
  const repo = probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    "src/kind.js": "export const wert = () => 1;\n",
    "src/server.js": 'import { wert } from "./kind.js";\nprocess.stdout.write(String(wert()));\n',
    "test/helpers/waechter.mjs": 'await import("../../src/server.js");\n',
    "test/hilfe.js": startHilfe(),
    ...kindtests(),
  });
  writeFiles(repo, { "src/kind.js": 'export const wert = () => Number("1");\n' });
  const ziel = join(probeDirectory(context, {}), "plan.json");
  const lauf = pruefe(repo, "--basis", "HEAD", "--plan", ziel);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const anteile = [...lauf.stdout.matchAll(ANTEILE)].join("\n");
  assert.deepEqual(
    [...anteile.matchAll(KIND_ANTEIL)].map(([, anteil, von]) => `${anteil} von ${von}`),
    ["1 von 2", "2 von 2"],
    lauf.stdout,
  );
});
