import assert from "node:assert/strict";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { test } from "node:test";

import { testumbauPruefung } from "../../tools/mutationspruefung/testumbau.mjs";
import { EXIT_ROT } from "./mutationspruefung-probe.js";
import { probeRepository, REPO_ROOT, runIn, writeFiles } from "./probe-repo.js";

const MUTATION = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const QUELLE = "src/zahl.js";
const ZAHL = 'export function einordnen(zahl) {\n  const vermerk = "unbenutzt";\n  if (zahl < 0) return "negativ";\n  return "positiv";\n}\n';
const PROBE = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  [QUELLE]: ZAHL,
  "test/zahl.test.js": zahlTest(),
};

function zahlTest(zusatz = "") {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { einordnen } from "../src/zahl.js";',
    'test("negativ", () => assert.equal(einordnen(-1), "negativ"));',
    'test("null", () => assert.equal(einordnen(0), "positiv"));',
    'test("positiv", () => assert.equal(einordnen(1), "positiv"));',
    zusatz,
  ].join("\n");
}

function lage([zeile, spalte], [endzeile, endspalte]) {
  return { start: { line: zeile, column: spalte }, end: { line: endzeile, column: endspalte } };
}

const VORHER = [
  { schluessel: `${QUELLE}:1:32 BlockStatement → {}`, status: "Killed", zeilen: [1, 5], lage: lage([1, 32], [5, 2]) },
  { schluessel: `${QUELLE}:2:19 StringLiteral → ""`, status: "Survived", zeilen: [2, 2], lage: lage([2, 19], [2, 30]) },
  { schluessel: `${QUELLE}:3:7 EqualityOperator → zahl <= 0`, status: "Killed", zeilen: [3, 3], lage: lage([3, 7], [3, 15]) },
  { schluessel: `${QUELLE}:3:24 StringLiteral → ""`, status: "Killed", zeilen: [3, 3], lage: lage([3, 24], [3, 33]) },
];
const [BLOCK, , VERGLEICH, NEGATIV] = VORHER;

function ersatzWerkzeug(nachher) {
  const aufrufe = [];
  return {
    aufrufe,
    alterStand: () => () => {},
    durchgang: async (datei, bereiche) => {
      aufrufe.push(bereiche);
      return aufrufe.length === 1 ? VORHER : nachher;
    },
    ueberlebt: ({ status }) => status === "Survived",
  };
}

async function imProbeRepo(context, arbeit) {
  const repo = probeRepository(context, PROBE);
  writeFiles(repo, { "test/zahl.test.js": zahlTest("// umgebaut") });
  const ausgabe = context.mock.method(console, "log", () => {});
  const vorher = cwd();
  chdir(repo);
  try {
    return { ergebnis: await arbeit(), zeilen: ausgabe.mock.calls.map(({ arguments: [zeile] }) => zeile) };
  } finally {
    chdir(vorher);
  }
}

test("Testumbau-Nachher: die Nachher-Seite fragt Stryker nach der genauen Lage jedes vorher getöteten Mutanten; fehlt einer oder überlebt er, ist das Urteil rot", async (context) => {
  const werkzeug = ersatzWerkzeug([{ ...BLOCK }, { ...VERGLEICH, status: "Survived" }]);
  const { ergebnis, zeilen } = await imProbeRepo(context, () => testumbauPruefung("HEAD", werkzeug));
  assert.deepEqual(werkzeug.aufrufe.at(-1), [BLOCK.lage, VERGLEICH.lage, NEGATIV.lage]);
  assert.equal(ergebnis, EXIT_ROT, zeilen.join("\n"));
  const verstoesse = zeilen.filter((zeile) => zeile.startsWith("Verstoß: Mutant nicht mehr getötet: ")).map((zeile) => zeile.split(": ").slice(2).join(": "));
  assert.deepEqual(verstoesse, [VERGLEICH.schluessel, NEGATIV.schluessel]);
});

test("Testumbau-Nachher: ein Vorher-Ergebnis ohne Lage der Mutanten bricht ab, statt mit Zeilen weiterzurechnen", async (context) => {
  const ohneLage = VORHER.map(({ schluessel, status, zeilen }) => ({ schluessel, status, zeilen }));
  const werkzeug = { ...ersatzWerkzeug([]), durchgang: async (_datei, bereiche) => (bereiche.every(Array.isArray) ? ohneLage : []) };
  await assert.rejects(
    imProbeRepo(context, () => testumbauPruefung("HEAD", werkzeug)),
    /die Vorher-Seite nennt für 3 getötete Mutanten keine Lage .*die Vorher-Seite ist neu zu rechnen/,
  );
});

test("Testumbau-Nachher: mit Stryker rechnet die Nachher-Seite nur die vorher getöteten Mutanten, nicht den überlebenden im selben Rumpf", (context) => {
  const repo = probeRepository(context, PROBE);
  writeFiles(repo, { "test/zahl.test.js": zahlTest("// umgebaut") });
  const lauf = runIn(repo, process.execPath, [MUTATION, "--basis", "HEAD", "--testumbau"]);
  const ausgabe = `${lauf.stdout}${lauf.stderr}`;
  assert.equal(lauf.status, 0, ausgabe);
  const getoetet = Number(/^grün: (\d+) vorher getötete Mutanten in 1 Quelldateien/m.exec(ausgabe)?.[1]);
  const erstlaeufe = [...ausgabe.matchAll(/^src\/zahl\.js: (\d+) Mutanten gegen \d+ Testdateien in/gm)].map(([, anzahl]) => Number(anzahl));
  assert.equal(erstlaeufe.length, 2, ausgabe);
  const [vorher, nachher] = erstlaeufe;
  assert.ok(vorher > getoetet, ausgabe);
  assert.equal(nachher, getoetet, ausgabe);
});
