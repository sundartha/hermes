import assert from "node:assert/strict";
import { chdir, cwd } from "node:process";
import { test } from "node:test";

import { imVorherStand } from "../../tools/mutationspruefung/testumbau.mjs";
import { probeRepository, writeFiles } from "./probe-repo.js";

const TESTDATEI = "test/eingang.test.js";
const TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { A } from "../src/eingang.js";',
  'test("eingang", () => assert.equal(A, 1));',
  "",
].join("\n");

async function quellenDerVorherSeite(context, quellen) {
  const testtext = quellen[TESTDATEI] ?? TEST;
  const repo = probeRepository(context, { "package.json": '{ "type": "module" }\n', ...quellen, [TESTDATEI]: testtext });
  writeFiles(repo, { [TESTDATEI]: `${testtext}// umgebaut\n` });
  const start = cwd();
  chdir(repo);
  try {
    return await imVorherStand({ basis: "HEAD", tests: [TESTDATEI] }, { alterStand: () => () => {} }, ({ quellen: gefunden }) => gefunden);
  } finally {
    chdir(start);
  }
}

test("Weiterleitung: die Testumbau-Mutation folgt von einer Quelldatei allen export … from bis zur letzten Datei, auch wenn die Datei daneben eigene Logik hat", async (context) => {
  const quellen = await quellenDerVorherSeite(context, {
    "src/eingang.js": 'export { A } from "./begriffe.js";\nexport * from "./mitte.js";\nexport const verdoppelt = (wert) => wert * 2;\n',
    "src/begriffe.js": "export const A = 1;\n",
    "src/mitte.js": 'export { B } from "./ende.js";\n',
    "src/ende.js": "export const B = 2;\n",
  });
  assert.deepEqual(quellen, ["src/begriffe.js", "src/eingang.js", "src/ende.js", "src/mitte.js"]);
});

test("Weiterleitung: ein gewöhnlicher Import mit Logik ist keine Weiterleitung; die importierte Datei kommt nicht dazu", async (context) => {
  const quellen = await quellenDerVorherSeite(context, {
    "src/eingang.js": 'import { EINS } from "./begriffe.js";\n\nexport const A = EINS;\n',
    "src/begriffe.js": "export const EINS = 1;\n",
  });
  assert.deepEqual(quellen, ["src/eingang.js"]);
});

test("Weiterleitung: lässt sich eine erreichte Quelldatei nicht lesen, folgt die Testumbau-Mutation allen ihren Abhängigkeiten unter src/, auch gewöhnlichen Importen", async (context) => {
  const quellen = await quellenDerVorherSeite(context, {
    "src/eingang.js": 'import { EINS } from "./begriffe.js";\n\nexport const A = EINS;\nexport const = ;\n',
    "src/begriffe.js": "export const EINS = 1;\n",
  });
  assert.deepEqual(quellen, ["src/begriffe.js", "src/eingang.js"]);
});

test("Weiterleitung: ist die Quelle eines export … from nicht eindeutig lesbar, folgt die Testumbau-Mutation allen Abhängigkeiten unter src/, auch gewöhnlichen Importen", async (context) => {
  const quellen = await quellenDerVorherSeite(context, {
    "src/eingang.js": 'import { ZWEI } from "./andere.js";\n\nexport * from "./\\x62egriffe.js";\nexport const B = ZWEI;\n',
    "src/begriffe.js": "export const A = 1;\n",
    "src/andere.js": "export const ZWEI = 2;\n",
  });
  assert.deepEqual(quellen, ["src/andere.js", "src/begriffe.js", "src/eingang.js"]);
});

test("Weiterleitung: reicht eine Quelldatei eine Datei außerhalb von src/ weiter, kommt diese nicht in die Quellen", async (context) => {
  const quellen = await quellenDerVorherSeite(context, {
    "src/eingang.js": 'export { A } from "./begriffe.js";\nexport { WERK } from "../lib/werk.js";\n',
    "src/begriffe.js": "export const A = 1;\n",
    "lib/werk.js": "export const WERK = 1;\n",
  });
  assert.deepEqual(quellen, ["src/begriffe.js", "src/eingang.js"]);
});

test("Weiterleitung: in einer .ts-Quelldatei folgt die Testumbau-Mutation nur den export … from, nicht dem gewöhnlichen Import", async (context) => {
  const quellen = await quellenDerVorherSeite(context, {
    "src/eingang.ts": 'import { ZWEI } from "./andere.js";\n\nexport { A } from "./begriffe.js";\nexport const B: number = ZWEI;\n',
    "src/begriffe.js": "export const A = 1;\n",
    "src/andere.js": "export const ZWEI = 2;\n",
    [TESTDATEI]: TEST.replace("../src/eingang.js", "../src/eingang.ts"),
  });
  assert.deepEqual(quellen, ["src/begriffe.js", "src/eingang.ts"]);
});
