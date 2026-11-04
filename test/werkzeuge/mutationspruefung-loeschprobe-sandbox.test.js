import assert from "node:assert/strict";
import { test } from "node:test";

import { GRUPPE as GRUPPENGROESSE } from "../../tools/mutationspruefung/gruppen.mjs";
import { aufgeteilt, BASIS, EXIT_ABBRUCH, EXIT_ROT, mitProtokoll, NEGATIV, PROTOKOLL, protokolltest, pruefe, quelle, testdatei, testdateien } from "./mutationspruefung-hilfen.js";
import { probeRepository, writeFiles } from "./probe-repo.js";

const GRUND = "im Grundlauf der Löschprobe nur in der Sandbox rot, ohne Sandbox grün";
const LOKAL = "liest die lokale Datei";
const SANDKASTEN = "nur in Strykers Sandbox grün";
const ZWEITER_LAUF = "in der Kopie der Löschprobe nur beim ersten Lauf grün";
const ABBRUCH = /^Abbruch: Grundlauf rot, Löschprobe nicht aussagekräftig: /m;
const ROTER_TEST = /^Grundlauf rot, roter Test: not ok \d+ - /;
const KEIN_TEST_UEBRIG = "Grundlauf rot, ohne die nur in der Sandbox roten Tests bestand kein Test";

function einzelTest(name, pruefung, gruppe) {
  const fall = [`test(${JSON.stringify(name)}, () => {`, `  ${pruefung}`, "});"];
  return [
    'import assert from "node:assert/strict";',
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { describe, test } from "node:test";',
    'import "../src/zahl.js";',
    ...(gruppe === undefined ? fall : [`describe(${JSON.stringify(gruppe)}, () => {`, ...fall, "});"]),
    "",
  ].join("\n");
}

const LOKAL_PRUEFUNG = 'assert.equal(readFileSync("lokal/wert.txt", "utf8"), "ja");';
const NUR_LOKAL = einzelTest(LOKAL, LOKAL_PRUEFUNG);
const GRUPPE = "Gruppe #1";
const NUR_LOKAL_IN_GRUPPE = einzelTest(LOKAL, LOKAL_PRUEFUNG, GRUPPE);
const NUR_IM_SANDKASTEN = einzelTest(SANDKASTEN, 'assert.ok(process.cwd().includes("sandbox"));');
const NUR_ERSTER_LAUF = einzelTest(ZWEITER_LAUF, 'if (process.cwd().includes("loeschprobe-")) { assert.ok(!existsSync("marke")); writeFileSync("marke", ""); }');
const OFFEN = 'import { test } from "node:test";\nimport "../src/zahl.js";\ntest("noch offen", { todo: true }, () => {\n  throw new Error("noch offen");\n});\n';
const LOKAL_AUCH = "liest die lokale Datei auch hier";
const VERLANGT_PROTOKOLL = protokolltest('assert.equal(zahl.einordnen(-1), "negativ");', "assert.deepEqual(zahl.protokoll, [-1]);");

function loeschprobeRepo(context, tests) {
  const repo = probeRepository(context, {
    ...BASIS,
    ".gitignore": "node_modules/\nlokal/\n",
    "src/zahl.js": mitProtokoll(quelle(NEGATIV)),
    ...tests,
  });
  writeFiles(repo, { "lokal/wert.txt": "ja", "src/zahl.js": mitProtokoll(quelle(PROTOKOLL, NEGATIV)) });
  return repo;
}

function loeschprobeMit(context, tests) {
  const lauf = pruefe(loeschprobeRepo(context, tests), "--basis", "HEAD");
  return { ...lauf, aus: lauf.stdout.split("\n"), fehler: lauf.stderr.split("\n") };
}

test("ein Test, der im Grundlauf der Löschprobe nur in der Sandbox rot und ohne Sandbox einzeln grün ist, fällt heraus und wird genannt, die übrigen Tests prüfen die gelöschte Zeile", (context) => {
  const lauf = loeschprobeMit(context, { "test/zahl.test.js": VERLANGT_PROTOKOLL, "test/lokal.test.js": NUR_LOKAL_IN_GRUPPE, "test/offen.test.js": OFFEN });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(lauf.fehler.includes(`ohne test/lokal.test.js › ${GRUPPE} > ${LOKAL}: ${GRUND}`), lauf.stderr);
  assert.ok(lauf.aus.includes(`Hinweis: Löschprobe ohne test/lokal.test.js › ${GRUPPE} > ${LOKAL} (${GRUND}): src/zahl.js:3 Zeile gelöscht`), lauf.stdout);
  assert.doesNotMatch(lauf.stderr, /^Abbruch:/m);
});

test("ist im Grundlauf der Löschprobe ein Test auch ohne Sandbox rot, bricht sie ab wie bisher und nennt ihn, auch wenn ein anderer Test nur in der Sandbox rot ist", (context) => {
  const lauf = loeschprobeMit(context, { "test/zahl.test.js": VERLANGT_PROTOKOLL, "test/lokal.test.js": NUR_LOKAL, "test/sandkasten.test.js": NUR_IM_SANDKASTEN });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, ABBRUCH);
  assert.ok(lauf.fehler.includes(`Grundlauf rot, auch ohne Sandbox rot: test/sandkasten.test.js › ${SANDKASTEN}`), lauf.stderr);
  assert.ok(lauf.fehler.some((zeile) => zeile.startsWith(`Meldung des roten Tests: test/sandkasten.test.js › ${SANDKASTEN} (Seite neu): `)), lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /^ohne test\//m);
});

test("fallen im Grundlauf der Löschprobe alle Tests der Gruppe als nur in der Sandbox rot heraus, ist sie nicht aussagekräftig wie bisher", (context) => {
  const lauf = loeschprobeMit(context, { "test/zahl.test.js": NUR_LOKAL_IN_GRUPPE, "test/lokal.test.js": einzelTest(LOKAL_AUCH, LOKAL_PRUEFUNG), "test/offen.test.js": OFFEN });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, ABBRUCH);
  assert.ok(lauf.fehler.includes(`ohne test/zahl.test.js › ${GRUPPE} > ${LOKAL}: ${GRUND}`), lauf.stderr);
  assert.ok(lauf.fehler.includes(`ohne test/lokal.test.js › ${LOKAL_AUCH}: ${GRUND}`), lauf.stderr);
  assert.ok(lauf.fehler.includes(KEIN_TEST_UEBRIG), lauf.stderr);
});

test("wird der Grundlauf der Löschprobe ohne die nur in der Sandbox roten Tests rot, bricht sie ab und nennt den neuen roten Test", (context) => {
  const lauf = loeschprobeMit(context, { "test/zahl.test.js": VERLANGT_PROTOKOLL, "test/lokal.test.js": NUR_LOKAL, "test/zweiter.test.js": NUR_ERSTER_LAUF });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, ABBRUCH);
  assert.ok(lauf.fehler.includes(`ohne test/lokal.test.js › ${LOKAL}: ${GRUND}`), lauf.stderr);
  assert.ok(lauf.fehler.some((zeile) => ROTER_TEST.test(zeile) && zeile.endsWith(` - ${ZWEITER_LAUF}`)), lauf.stderr);
  assert.ok(!lauf.fehler.includes(KEIN_TEST_UEBRIG), lauf.stderr);
});

const ANTEILSFAELLE = [
  { rot: "test/lokal.test.js", weitere: {}, status: EXIT_ROT },
  { rot: "test/a-lokal.test.js", weitere: {}, status: EXIT_ROT },
  { rot: "test/lokal.test.js", weitere: { "test/zahl.test.js": VERLANGT_PROTOKOLL }, status: 0 },
];

test("aufgeteilt nennt das Urteil einen nur in der Sandbox roten Test genau einmal, auch wenn der Eintrag eines anderen Anteils ohne Auslassung beim Vereinen gewinnt, überlebt oder getötet, und der Status der Zeile bleibt", (context) => {
  const fuellung = Object.fromEntries(testdateien(GRUPPENGROESSE, "test/fuellung").map((datei) => [datei, testdatei([-1, "negativ"], [1, "positiv"])]));
  for (const { rot, weitere, status } of ANTEILSFAELLE) {
    const { urteil } = aufgeteilt(context, loeschprobeRepo(context, { ...fuellung, ...weitere, [rot]: NUR_LOKAL }), { basis: "HEAD" });
    assert.equal(urteil.status, status, urteil.stdout + urteil.stderr);
    assert.equal(/^Verstoß: Mutant überlebt: src\/zahl\.js:3 Zeile gelöscht$/m.test(urteil.stdout), status === EXIT_ROT, urteil.stdout);
    const hinweis = `Hinweis: Löschprobe ohne ${rot} › ${LOKAL} (${GRUND}): src/zahl.js:3 Zeile gelöscht`;
    assert.deepEqual(urteil.stdout.split("\n").filter((zeile) => zeile === hinweis), [hinweis], urteil.stdout);
  }
});
