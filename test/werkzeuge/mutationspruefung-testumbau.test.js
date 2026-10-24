import assert from "node:assert/strict";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { test } from "node:test";

import { testumbauPruefung } from "../../tools/mutationspruefung/testumbau.mjs";
import { EXIT_ROT } from "./mutationspruefung-probe.js";
import { probeRepository, REPO_ROOT, runIn, writeFiles } from "./probe-repo.js";

const MUTATION = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const EXIT_GRUEN = 0;
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
const HAENGER = {
  schluessel: `${QUELLE}:4:10 StringLiteral → ""`,
  status: "Timeout",
  bestaetigung: "haenger",
  zeilen: [4, 4],
  lage: lage([4, 10], [4, 19]),
};
const MIT_HAENGER = [...VORHER, HAENGER];
const HAENGER_UEBERLEBT = { ...HAENGER, status: "Survived", bestaetigung: undefined };
const OHNE_NEUBERECHNUNG = 2;
const MIT_NEUBERECHNUNG = 3;
const ENTFAELLT = `Kein Verstoß (vorher nur Hänger, Neuberechnung: überlebt): ${HAENGER.schluessel}`;

function ersatzWerkzeug(nachher, { vorher = VORHER, neu = [] } = {}) {
  const aufrufe = [];
  const staende = [];
  return {
    aufrufe,
    staende,
    alterStand: (basis) => {
      staende.push(basis);
      return () => {};
    },
    durchgang: async (datei, bereiche) => {
      aufrufe.push(bereiche);
      return [vorher, nachher, neu][aufrufe.length - 1];
    },
    ueberlebt: ({ status }) => status === "Survived",
  };
}

function verstoesse(zeilen) {
  return zeilen.filter((zeile) => zeile.startsWith("Verstoß: Mutant nicht mehr getötet: ")).map((zeile) => zeile.split(": ").slice(2).join(": "));
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
  assert.deepEqual(verstoesse(zeilen), [VERGLEICH.schluessel, NEGATIV.schluessel]);
});

async function pruefeMit(context, werkzeug) {
  return { werkzeug, ...(await imProbeRepo(context, () => testumbauPruefung("HEAD", werkzeug))) };
}

function mitHaengerVorher(context, nachher, neu = []) {
  return pruefeMit(context, ersatzWerkzeug(nachher, { vorher: MIT_HAENGER, neu }));
}

function mitAbbruchVorher(context, abbruch) {
  return pruefeMit(context, ersatzWerkzeug([BLOCK, VERGLEICH, NEGATIV], { vorher: [...VORHER, abbruch], neu: [HAENGER_UEBERLEBT] }));
}

function bleibtRot({ werkzeug, ergebnis, zeilen }, { aufrufe, verstoss }) {
  assert.equal(ergebnis, EXIT_ROT, zeilen.join("\n"));
  assert.equal(werkzeug.aufrufe.length, aufrufe);
  assert.deepEqual(verstoesse(zeilen), verstoss);
  assert.ok(!zeilen.includes(ENTFAELLT), zeilen.join("\n"));
}

test("Testumbau-Hänger: ein Verlust, der vorher nur Hänger war, entfällt, wenn die Neuberechnung der Vorher-Seite ihn überleben lässt, und wird mit Schlüssel und Grund genannt", async (context) => {
  const { werkzeug, ergebnis, zeilen } = await mitHaengerVorher(context, [BLOCK, VERGLEICH, NEGATIV], [HAENGER_UEBERLEBT]);
  assert.equal(ergebnis, EXIT_GRUEN, zeilen.join("\n"));
  assert.deepEqual(werkzeug.aufrufe.at(-1), [HAENGER.lage]);
  assert.deepEqual(werkzeug.staende, ["HEAD", "HEAD"]);
  assert.ok(zeilen.includes(ENTFAELLT), zeilen.join("\n"));
  assert.deepEqual(verstoesse(zeilen), []);
  assert.ok(zeilen.some((zeile) => zeile.startsWith("grün: 3 von 4 vorher getötete Mutanten") && zeile.endsWith("1 waren vorher nur Hänger und überleben in der Neuberechnung.")), zeilen.join("\n"));
});

test("Testumbau-Hänger: ein Verlust, der vorher nur Hänger war, bleibt Verstoß, wenn die Neuberechnung für seinen Schlüssel kein Ergebnis liefert", async (context) => {
  const fremd = { ...HAENGER_UEBERLEBT, schluessel: `${QUELLE}:4:10 StringLiteral → "Stryker was here!"` };
  bleibtRot(await mitHaengerVorher(context, [BLOCK, VERGLEICH, NEGATIV], [fremd]), { aufrufe: MIT_NEUBERECHNUNG, verstoss: [HAENGER.schluessel] });
});

test("Testumbau-Hänger: ein Verlust, der vorher nur Hänger war, bleibt Verstoß, wenn die Neuberechnung ihn wieder tötet", async (context) => {
  const lauf = await mitHaengerVorher(context, [BLOCK, VERGLEICH, NEGATIV], [{ ...HAENGER, status: "Killed", bestaetigung: "getoetet" }]);
  bleibtRot(lauf, { aufrufe: MIT_NEUBERECHNUNG, verstoss: [HAENGER.schluessel] });
});

test("Testumbau-Hänger: ein Verlust, der vorher nur Hänger war, bleibt Verstoß, wenn die Neuberechnung wieder nur einen Hänger zeigt", async (context) => {
  bleibtRot(await mitHaengerVorher(context, [BLOCK, VERGLEICH, NEGATIV], [{ ...HAENGER }]), { aufrufe: MIT_NEUBERECHNUNG, verstoss: [HAENGER.schluessel] });
});

test("Testumbau-Hänger: ein Verlust aus einem echten Kill bleibt Verstoß und löst keine Neuberechnung aus", async (context) => {
  bleibtRot(await mitHaengerVorher(context, [BLOCK, NEGATIV, HAENGER]), { aufrufe: OHNE_NEUBERECHNUNG, verstoss: [VERGLEICH.schluessel] });
});

test("Testumbau-Hänger: steht neben dem Hänger-Verlust ein Verlust aus einem echten Kill, wird nichts neu gerechnet und beide bleiben Verstoß", async (context) => {
  const lauf = await mitHaengerVorher(context, [BLOCK, NEGATIV], [HAENGER_UEBERLEBT]);
  bleibtRot(lauf, { aufrufe: OHNE_NEUBERECHNUNG, verstoss: [VERGLEICH.schluessel, HAENGER.schluessel] });
});

test("Testumbau-Hänger: ein verlorener Vorher-Eintrag mit Status Timeout, aber bestätigt getötet, bleibt Verstoß und löst keine Neuberechnung aus", async (context) => {
  const lauf = await mitAbbruchVorher(context, { ...HAENGER, status: "Timeout", bestaetigung: "getoetet" });
  bleibtRot(lauf, { aufrufe: OHNE_NEUBERECHNUNG, verstoss: [HAENGER.schluessel] });
});

test("Testumbau-Hänger: ein verlorener Vorher-Eintrag mit Status RuntimeError ohne Bestätigung bleibt Verstoß und löst keine Neuberechnung aus", async (context) => {
  const lauf = await mitAbbruchVorher(context, { ...HAENGER, status: "RuntimeError", bestaetigung: undefined });
  bleibtRot(lauf, { aufrufe: OHNE_NEUBERECHNUNG, verstoss: [HAENGER.schluessel] });
});

test("Testumbau-Hänger: ohne Verlust bleibt das Urteil grün und nichts wird neu gerechnet", async (context) => {
  const { werkzeug, ergebnis, zeilen } = await mitHaengerVorher(context, [BLOCK, VERGLEICH, NEGATIV, HAENGER], [HAENGER_UEBERLEBT]);
  assert.equal(ergebnis, EXIT_GRUEN, zeilen.join("\n"));
  assert.equal(werkzeug.aufrufe.length, OHNE_NEUBERECHNUNG);
  assert.deepEqual(werkzeug.staende, ["HEAD"]);
  assert.ok(!zeilen.includes(ENTFAELLT), zeilen.join("\n"));
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
