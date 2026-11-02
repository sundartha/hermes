import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { readList } from "../../tools/werkzeugtests/liste.mjs";
import { passingTest, PRUEFLEITER_TOOL, probeRepository, runIn } from "./probe-repo.js";

const LISTE = "tools/basis/werkzeugtests-mit-produkt.json";
const GELISTET = "test/werkzeuge/gelistet.test.js";
const FREI = "test/werkzeuge/frei.test.js";
const WEB_DATEI = "apps/web/seite.js";
const WERKZEUG = "tools/werkzeug.mjs";
const BERICHT = ".pruefung/werkzeugteil-1.jsonl";
const DATENSCHUTZ_TEST = "test/werkzeuge/anbieter-datenschutz-pruefen.test.js";
const RUECKKEHR_TEST = "test/werkzeuge/rueckkehr-parameter-pruefen.test.js";

const FREI_SIEHT_KEIN_WEB = [
  'import assert from "node:assert/strict";',
  'import { existsSync } from "node:fs";',
  'import { test } from "node:test";',
  'test("frei sieht kein apps/web", () => {',
  '  assert.equal(existsSync("apps"), false);',
  "});",
  "",
].join("\n");

function probe(context) {
  return probeRepository(context, {
    "package.json": JSON.stringify({ name: "apps-web-probe", private: true, type: "module" }),
    [LISTE]: JSON.stringify({ [GELISTET]: "liest die Webseite" }),
    "test/testbaenke-run.mjs": "export const harness = 1;\n",
    [WEB_DATEI]: "export const seite = 1;\n",
    [WERKZEUG]: "export const werkzeug = 1;\n",
    [GELISTET]: passingTest("gelisteter Werkzeugtest"),
    [FREI]: FREI_SIEHT_KEIN_WEB,
  });
}

function laufMitAenderung(context, ...pfade) {
  const ordner = probe(context);
  for (const pfad of pfade) appendFileSync(join(ordner, pfad), "export const geaendert = 1;\n");
  const lauf = runIn(ordner, process.execPath, [
    PRUEFLEITER_TOOL, "--basis", "HEAD", "--werkzeugteil", "1/1", "--werkzeugtests-aus-liste",
  ]);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const gelaufen = readFileSync(join(ordner, BERICHT), "utf8")
    .split("\n")
    .filter((zeile) => zeile !== "")
    .map((zeile) => JSON.parse(zeile).datei);
  return gelaufen.toSorted();
}

test("eine reine Änderung unter apps/web fährt nur die gelisteten Werkzeugtests", (context) => {
  assert.deepEqual(laufMitAenderung(context, WEB_DATEI), [GELISTET]);
});

test("eine Änderung unter tools fährt alle Werkzeugtests, auch mit einer Änderung unter apps/web", (context) => {
  assert.deepEqual(laufMitAenderung(context, WERKZEUG), [FREI, GELISTET]);
  assert.deepEqual(laufMitAenderung(context, WERKZEUG, WEB_DATEI), [FREI, GELISTET]);
});

test("die Prüfungen, die das echte apps/web lesen, stehen auf der Liste", () => {
  const { dateien, fehler } = readList();
  assert.equal(fehler, null);
  assert.ok(dateien.includes(DATENSCHUTZ_TEST));
  assert.ok(dateien.includes(RUECKKEHR_TEST));
});
