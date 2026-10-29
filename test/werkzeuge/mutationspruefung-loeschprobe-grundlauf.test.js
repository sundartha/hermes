import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS, EXIT_ABBRUCH, mitProtokoll, NEGATIV, PROTOKOLL, protokolltest, pruefe, quelle } from "./mutationspruefung-hilfen.js";
import { probeRepository, writeFiles } from "./probe-repo.js";

const UEBRIGER_PROZESS = 'process.getBuiltinModule("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }).unref();';
const VIELE_UEBRIGE = 25;
const STDERR_ZEILEN = 20;
const OFFENER_ROTER_TEST = 'import { test } from "node:test";\nimport "../src/zahl.js";\ntest("noch offen", { todo: true }, () => {\n  throw new Error("noch offen");\n});\n';
const GITIGNORIERTE_DATEI = `try { assert.equal(readFileSync("lokal/wert.txt", "utf8"), "ja"); } catch (fehler) { ${UEBRIGER_PROZESS} throw fehler; }`;
const GITIGNORIERTE_DATEI_MIT_VIELEN_RESTEN = `try { assert.equal(readFileSync("lokal/wert.txt", "utf8"), "ja"); } catch (fehler) { for (let nummer = 0; nummer < ${VIELE_UEBRIGE}; nummer += 1) { ${UEBRIGER_PROZESS} } throw fehler; }`;

function repoMitRotemGrundlauf(context, pruefungen, weitere = {}) {
  const repo = probeRepository(context, {
    ...BASIS,
    ".gitignore": "node_modules/\nlokal/\n",
    "src/zahl.js": mitProtokoll(quelle(NEGATIV)),
    "test/zahl.test.js": protokolltest(...pruefungen),
    ...weitere,
  });
  writeFiles(repo, { "lokal/wert.txt": "ja", "src/zahl.js": mitProtokoll(quelle(PROTOKOLL, NEGATIV)) });
  return repo;
}

test("ein roter Grundlauf nennt in der Abbruchausgabe den roten Test mit Datei und die letzten Zeilen von stderr", (context) => {
  const repo = repoMitRotemGrundlauf(context, [GITIGNORIERTE_DATEI], { "test/offen.test.js": OFFENER_ROTER_TEST });
  const abbruch = pruefe(repo, "--basis", "HEAD");
  assert.equal(abbruch.status, EXIT_ABBRUCH, abbruch.stdout + abbruch.stderr);
  assert.match(abbruch.stderr, /^Grundlauf rot, roter Test: not ok \d+ - protokoll$/m);
  assert.match(abbruch.stderr, /^Grundlauf rot, roter Test: location: .*test\/zahl\.test\.js:\d+:\d+.$/m);
  assert.match(abbruch.stderr, /^Grundlauf rot, stderr: Verstoß: Prozess nach dem Testlauf übrig: /m);
  assert.doesNotMatch(abbruch.stderr, /noch offen/);
  assert.match(abbruch.stderr, /^Grundlauf rot, Ausgang: Exit 1, Signal null$/m);
});

test("ein roter Grundlauf nennt von stderr nur die letzten zwanzig Zeilen in ihrer Reihenfolge", (context) => {
  const repo = repoMitRotemGrundlauf(context, [GITIGNORIERTE_DATEI_MIT_VIELEN_RESTEN]);
  const abbruch = pruefe(repo, "--basis", "HEAD");
  assert.equal(abbruch.status, EXIT_ABBRUCH, abbruch.stdout + abbruch.stderr);
  const zeilen = abbruch.stderr.split("\n").filter((zeile) => zeile.startsWith("Grundlauf rot, stderr: "));
  assert.equal(zeilen.length, STDERR_ZEILEN, abbruch.stderr);
  assert.match(zeilen.at(-1), /^Grundlauf rot, stderr: Ausweg: /);
  assert.match(zeilen[0], /^Grundlauf rot, stderr: Verstoß: Prozess nach dem Testlauf übrig: /);
});
