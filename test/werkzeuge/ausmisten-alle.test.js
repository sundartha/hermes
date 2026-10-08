import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { probeDirectory } from "./probe-repo.js";
import { ausmistenRepo, starte } from "./ausmisten/hilfen.mjs";
import { EXIT_ROT, WIRKSAME_TESTS } from "./ausmisten/messung.mjs";
import {
  scheinGitleaks,
  verlinkeLintWerkzeuge,
  vorpruefDateien,
} from "./ausmisten/vorpruefen.mjs";

const WERKZEUG = "tools/tests-ausmisten.mjs";
const FUNKTIONEN_JE_QUELLE = 800;
const GROSS_TEST = "test/post/gross.test.js";
const QUELLEN = ["src/post/gross-0.js", "src/post/gross-1.js"];

function grosseQuelle(nummer) {
  const zeilen = Array.from(
    { length: FUNKTIONEN_JE_QUELLE },
    (_leer, zeile) => `export function f${nummer}_${zeile}() {\n  return ${zeile} + 1;\n}`,
  );
  return `${zeilen.join("\n")}\n`;
}

const GROSS_TEST_INHALT = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { f0_0 } from "../../src/post/gross-0.js";',
  'import { f1_0 } from "../../src/post/gross-1.js";',
  "",
  'test("zählt in beiden großen Quellen", () => {',
  "  assert.equal(f0_0(), 1);",
  "  assert.equal(f1_0(), 1);",
  "});",
  "",
].join("\n");

function zweiPaketeRepo(context) {
  const protokoll = join(probeDirectory(context, {}), "aufrufe.txt");
  const quellen = Object.fromEntries(QUELLEN.map((pfad, nummer) => [pfad, grosseQuelle(nummer)]));
  const repo = ausmistenRepo(context, {
    ...WIRKSAME_TESTS,
    ...vorpruefDateien(protokoll),
    ...quellen,
    [GROSS_TEST]: GROSS_TEST_INHALT,
  });
  verlinkeLintWerkzeuge(repo.ordner);
  const kopf = repo.committe({}, [GROSS_TEST]);
  repo.git(["checkout", "-q", repo.master]);
  return { ...repo, kopf, gitleaks: scheinGitleaks(context, { protokoll }) };
}

async function lokal(context, repo, { speicher, zusatz = [] }) {
  const aus = probeDirectory(context, {});
  const args = [
    "lokal",
    "--bereich",
    "posteingang",
    "--master",
    repo.master,
    "--kopf",
    repo.kopf,
    "--aus",
    aus,
    "--gitleaks",
    repo.gitleaks,
    "--speicher",
    speicher,
    ...zusatz,
  ];
  const ergebnis = await starte(WERKZEUG, { args, cwd: repo.ordner, umgebung: {} });
  return { ...ergebnis, aus };
}

function verlustIn(quelle) {
  return new RegExp(`Verstoß: Mutant auf dem Branch nicht mehr getötet: ${quelle.replaceAll(".", "\\.")}:`);
}

test("ausmisten-alle: mit --alle misst lokal jedes Paket und nennt die Verluste beider Pakete, ohne bricht es beim ersten ab", async (context) => {
  const repo = zweiPaketeRepo(context);
  const speicher = probeDirectory(context, {});
  const alle = await lokal(context, repo, { speicher, zusatz: ["--alle"] });
  assert.equal(alle.status, EXIT_ROT, alle.ausgabe);
  assert.match(alle.ausgabe, /Lokal: rot in Paket 0; weiter wegen --alle\./);
  assert.match(alle.ausgabe, /Lokal: rot in Paket 1; weiter wegen --alle\./);
  for (const quelle of QUELLEN) assert.match(alle.ausgabe, verlustIn(quelle));
  assert.match(alle.ausgabe, /Lokal: rot$/m);
  const frueh = await lokal(context, repo, { speicher });
  assert.equal(frueh.status, EXIT_ROT, frueh.ausgabe);
  assert.match(
    frueh.ausgabe,
    /Lokal: rot in Paket 0; die übrigen Pakete werden nicht gemessen\./,
  );
  assert.match(frueh.ausgabe, verlustIn(QUELLEN[0]));
  assert.doesNotMatch(frueh.ausgabe, verlustIn(QUELLEN[1]));
  assert.equal(existsSync(join(frueh.aus, "branch-1")), false);
});
