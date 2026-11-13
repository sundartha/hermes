import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { gruenAufMaster, mutationUrteil } from "../../tools/pruefen.mjs";

const TEST_DATEI = "test/gemeinsam/ohne-passwort.test.js";
const PR_TEXT = `## Was\n\nText mit \`src/a.js:1/1\` wird getötet von \`test/x.test.js\`\n\n## Überlebende Mutanten\n\n- \`src/log-maske.js:35/4\` wird getötet von \`${TEST_DATEI}\` (leeres Passwort würde jede Zeile zerhacken).\n\n## Danach\n\n- \`src/b.js:2/2\` wird getötet von \`test/y.test.js\`\n`;

function urteil(prText, mutanten, { gruen = TEST_DATEI, teil = "0", teile = "1" } = {}) {
  const vorher = { PR_TEXT: process.env.PR_TEXT, TEIL: process.env.TEIL, TEILE: process.env.TEILE, ROTPROBE_GRUEN: process.env.ROTPROBE_GRUEN };
  Object.assign(process.env, { PR_TEXT: prText, TEIL: teil, TEILE: teile, ROTPROBE_GRUEN: gruen });
  const log = console.log;
  console.log = () => {};
  try {
    return mutationUrteil(mutanten, 1);
  } finally {
    console.log = log;
    for (const [name, wert] of Object.entries(vorher)) wert === undefined ? delete process.env[name] : (process.env[name] = wert);
  }
}

const getoetet = (test) => ({ schluessel: "src/log-maske.js:35/4", mutation: "m", ergebnis: "getötet", test });

test("Nur die Zeile unter „Überlebende Mutanten“ nennt eine Testdatei, die auf master grün sein darf", () => {
  assert.deepEqual(gruenAufMaster(PR_TEXT), [{ schluessel: "src/log-maske.js:35/4", id: "4", datei: TEST_DATEI }]);
  assert.deepEqual(gruenAufMaster(undefined), []);
});

test("Die Mutation bleibt grün, wenn genau die genannte Testdatei den Mutanten tötet", () => {
  assert.equal(urteil(PR_TEXT, [getoetet(TEST_DATEI)]), true);
});

test("Die Mutation ist rot, wenn eine andere Testdatei den Mutanten tötet oder er überlebt oder fehlt", () => {
  assert.equal(urteil(PR_TEXT, [getoetet("test/anders.test.js")]), false);
  assert.equal(urteil(PR_TEXT, [{ ...getoetet(TEST_DATEI), ergebnis: "überlebt", test: undefined }]), false);
  assert.equal(urteil(PR_TEXT, []), false);
});

test("Die Mutation ist rot, wenn der PR-Text eine auf master grüne Datei nicht nennt, auch wenn er nach der Rotprobe geändert wurde", () => {
  assert.equal(urteil("## Was\n\nnichts", []), false);
  assert.equal(urteil("## Was\n\nnichts", [], { gruen: "" }), true);
});

test("Ein Eintrag mit der Id eines fremden Teils wird dort ignoriert und im eigenen Teil geprüft", () => {
  assert.equal(urteil(PR_TEXT, [], { teil: "0", teile: "6" }), true);
  assert.equal(urteil(PR_TEXT, [], { teil: "4", teile: "6" }), false);
  assert.equal(urteil(PR_TEXT, [getoetet(TEST_DATEI)], { teil: "4", teile: "6" }), true);
});

test("Die Rotprobe-Ausnahmen kommen aus dem PR-Text, ohne Eintrag gibt es keine", () => {
  const ausgabe = (prText) => execFileSync("node", ["tools/pruefen.mjs", "rotprobe-ausnahmen"], { encoding: "utf8", env: { ...process.env, PR_TEXT: prText } });
  assert.equal(ausgabe(PR_TEXT), `${TEST_DATEI}\n`);
  assert.equal(ausgabe("## Was\n\nnichts"), "");
});
