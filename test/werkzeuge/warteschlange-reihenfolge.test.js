import assert from "node:assert/strict";
import { test } from "node:test";

import { passingTest } from "./probe-repo.js";
import { testlaeufer, warteschlangenAttrappe, wegwerfRepo } from "./warteschlange/hilfen.mjs";

const ZAHL_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { ZAHL } from "../zahl.js";',
  'test("ZAHL ist 2", () => assert.equal(ZAHL, 2));',
  "",
].join("\n");
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

function zweiAenderungen(context) {
  const repo = wegwerfRepo(context, {
    "zahl.js": "export const ZAHL = 2;\n",
    "test/basis.test.js": passingTest("Basis läuft"),
  });
  repo.git(["checkout", "-q", "-b", "a", "master"]);
  const aenderungA = repo.committe({ "test/a.test.js": ZAHL_TEST }, "A prüft ZAHL");
  const aAllein = testlaeufer(repo.ordner);
  repo.git(["checkout", "-q", "-b", "b", "master"]);
  const aenderungB = repo.committe({ "zahl.js": "export const ZAHL = 3;\n" }, "B setzt ZAHL auf 3");
  const bAllein = testlaeufer(repo.ordner);
  return { repo, aenderungA, aenderungB, aAllein, bAllein };
}

test("zwei einzeln grüne Änderungen, die zusammen rot sind, werden nicht beide übernommen", (context) => {
  const { repo, aenderungA, aenderungB, aAllein, bAllein } = zweiAenderungen(context);
  assert.equal(aAllein.status, EXIT_GRUEN, aAllein.ausgabe);
  assert.equal(bAllein.status, EXIT_GRUEN, bAllein.ausgabe);
  const [ersterEintrag, zweiterEintrag] = warteschlangenAttrappe(repo, [
    { name: "pr-1-aaaaaaa", commits: [aenderungA] },
    { name: "pr-2-bbbbbbb", commits: [aenderungB] },
  ]);
  assert.equal(ersterEintrag.uebernommen, true, ersterEintrag.ausgabe);
  assert.equal(zweiterEintrag.uebernommen, false);
  assert.equal(zweiterEintrag.status, EXIT_ROT, zweiterEintrag.ausgabe);
  assert.deepEqual(zweiterEintrag.wackelig.wackelig, []);
  assert.deepEqual(zweiterEintrag.wackelig.rot, [
    { datei: "test/a.test.js", test: "ZAHL ist 2", grund: "zweimal rot" },
  ]);
  assert.equal(repo.imOrigin(["show", "master:zahl.js"]), "export const ZAHL = 2;");
  assert.equal(repo.imOrigin(["log", "-1", "--format=%s", "master"]), "A prüft ZAHL");
});

test("in umgekehrter Reihenfolge wird B übernommen und A nicht", (context) => {
  const { repo, aenderungA, aenderungB } = zweiAenderungen(context);
  const [ersterEintrag, zweiterEintrag] = warteschlangenAttrappe(repo, [
    { name: "pr-2-bbbbbbb", commits: [aenderungB] },
    { name: "pr-1-aaaaaaa", commits: [aenderungA] },
  ]);
  assert.equal(ersterEintrag.uebernommen, true, ersterEintrag.ausgabe);
  assert.equal(zweiterEintrag.uebernommen, false);
  assert.equal(repo.imOrigin(["show", "master:zahl.js"]), "export const ZAHL = 3;");
  assert.notEqual(repo.imOrigin(["ls-tree", "--name-only", "master", "test/"]).includes("a.test.js"), true);
});
