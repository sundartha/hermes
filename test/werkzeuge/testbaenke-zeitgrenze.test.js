import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { RUNNER, passingTest } from "./probe-repo.js";
import { ZWEITER_LAUF, saubereUmgebung, wegwerfRepo } from "./warteschlange/hilfen.mjs";

const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const KLEINE_GRENZE = { TESTS_DATEIGRENZE_S: "2" };
const LAUF_FRIST_MS = 45_000;
const HAENGER_DATEI = "test/haengt.test.js";
const GRUENE_DATEI = "test/gruen.test.js";

const HAENGT_NACH_DEM_LETZTEN_TEST = [
  'import { test } from "node:test";',
  'test("letzter Fall", () => {});',
  "setInterval(() => {}, 1000);",
  "",
].join("\n");

const HAENGT_MITTEN_IM_TEST = [
  'import { test } from "node:test";',
  "setInterval(() => {}, 1000);",
  'test("wartet nie", () => new Promise(() => {}));',
  "",
].join("\n");

const HAENGT_NUR_EINMAL = [
  'import { existsSync, writeFileSync } from "node:fs";',
  'import { test } from "node:test";',
  'const merker = new URL("../merker.txt", import.meta.url);',
  "const warSchonDa = existsSync(merker);",
  'writeFileSync(merker, "gelaufen");',
  'test("haengt nur beim ersten Lauf", () => {});',
  "if (!warSchonDa) setInterval(() => {}, 1000);",
  "",
].join("\n");

const HAENGT_NUR_EINMAL_MITTEN_IM_TEST = [
  'import { existsSync, writeFileSync } from "node:fs";',
  'import { test } from "node:test";',
  'const merker = new URL("../merker.txt", import.meta.url);',
  "const warSchonDa = existsSync(merker);",
  'writeFileSync(merker, "gelaufen");',
  "if (!warSchonDa) setInterval(() => {}, 1000);",
  'test("haengt nur beim ersten Lauf mitten im Test", () => (warSchonDa ? undefined : new Promise(() => {})));',
  "",
].join("\n");

function lauf(ordner, umgebung = {}, argumente = ["regression"]) {
  const ergebnis = spawnSync(process.execPath, [RUNNER, ...argumente], {
    cwd: ordner,
    encoding: "utf8",
    env: saubereUmgebung({ NODE_ENV: "test", ...umgebung }),
    timeout: LAUF_FRIST_MS,
  });
  return { status: ergebnis.status, ausgabe: `${ergebnis.stdout}${ergebnis.stderr}` };
}

function pruefeHaenger(context, quelltext) {
  const repo = wegwerfRepo(context, {
    [HAENGER_DATEI]: quelltext,
    [GRUENE_DATEI]: passingTest("gruener Fall"),
  });

  const ergebnis = lauf(repo.ordner, KLEINE_GRENZE);

  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, new RegExp(`✗ .*${HAENGER_DATEI}`), ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /Zeitgrenze überschritten/, ergebnis.ausgabe);
  assert.doesNotMatch(ergebnis.ausgabe, new RegExp(GRUENE_DATEI), ergebnis.ausgabe);
}

test("eine Testdatei, die nach dem letzten Test nie endet, beendet den Lauf rot in Sekunden und nennt die Datei", (context) => {
  pruefeHaenger(context, HAENGT_NACH_DEM_LETZTEN_TEST);
});

test("eine Testdatei, die mitten in einem Test nie endet, beendet den Lauf rot in Sekunden und nennt die Datei", (context) => {
  pruefeHaenger(context, HAENGT_MITTEN_IM_TEST);
});

const GROSSE_GRENZE = "--test-timeout=86400000";

function pruefeAngehobeneGrenze(context, argumente) {
  const repo = wegwerfRepo(context, { [HAENGER_DATEI]: HAENGT_NACH_DEM_LETZTEN_TEST });

  const ergebnis = lauf(repo.ordner, KLEINE_GRENZE, argumente);

  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /Zeitgrenze überschritten/, ergebnis.ausgabe);
}

test("ein hinter dem Trenner übergebenes --test-timeout hebt die Zeitgrenze nicht an", (context) => {
  pruefeAngehobeneGrenze(context, ["regression", "--", GROSSE_GRENZE]);
});

test("ein an der Dateistelle übergebenes --test-timeout hebt die Zeitgrenze nicht an", (context) => {
  pruefeAngehobeneGrenze(context, ["regression", GROSSE_GRENZE, HAENGER_DATEI]);
});

test("eine Testdatei, die rechtzeitig endet, bleibt unter der kleinen Grenze grün", (context) => {
  const repo = wegwerfRepo(context, { [GRUENE_DATEI]: passingTest("gruener Fall") });

  const ergebnis = lauf(repo.ordner, KLEINE_GRENZE);

  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /^1 bestanden, 0 rot/m, ergebnis.ausgabe);
});

test("eine Testdatei, die nur im ersten Lauf hängt, wird vom zweiten Lauf nicht verziehen", (context) => {
  const repo = wegwerfRepo(context, { "test/haengt-einmal.test.js": HAENGT_NUR_EINMAL });

  const ergebnis = lauf(repo.ordner, { ...ZWEITER_LAUF, ...KLEINE_GRENZE });

  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.doesNotMatch(ergebnis.ausgabe, /Wackelig/, ergebnis.ausgabe);
});

test("ein Test, der nur im ersten Lauf mitten im Test hängt, wird vom zweiten Lauf nicht verziehen", (context) => {
  const repo = wegwerfRepo(context, { "test/haengt-einmal.test.js": HAENGT_NUR_EINMAL_MITTEN_IM_TEST });

  const ergebnis = lauf(repo.ordner, { ...ZWEITER_LAUF, ...KLEINE_GRENZE });

  assert.match(ergebnis.ausgabe, /Zeitgrenze überschritten/, ergebnis.ausgabe);
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.doesNotMatch(ergebnis.ausgabe, /Wackelig/, ergebnis.ausgabe);
});
