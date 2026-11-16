import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const TESTLAUF = resolve(import.meta.dirname, "../testbaenke-run.mjs");

function laufen(quelltext) {
  const ordner = mkdtempSync(join(tmpdir(), "testlauf-stderr-"));
  try {
    const datei = join(ordner, "abbruch.test.js");
    writeFileSync(datei, quelltext);
    const ergebnis = spawnSync("node", [TESTLAUF, "regression", datei], {
      encoding: "utf8",
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    return { ausgabe: ergebnis.stdout, status: ergebnis.status };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Eine beim Laden abbrechende Testdatei zeigt ihre Fehlermeldung in der Ausgabe und bleibt rot", () => {
  const { ausgabe, status } = laufen('throw new Error("Datenbank antwortet nicht: ECONNRESET");\n');
  assert.match(ausgabe, /Datenbank antwortet nicht: ECONNRESET/);
  assert.notEqual(status, 0);
});

test("Von der stderr-Ausgabe erscheinen höchstens die letzten 20 Zeilen mit höchstens 200 Zeichen", () => {
  const { ausgabe } = laufen(
    'for (let i = 1; i <= 30; i++) console.error("zeile-" + i + "-" + "x".repeat(300));\nthrow new Error("ende");\n',
  );
  assert.doesNotMatch(ausgabe, /zeile-10-/);
  assert.match(ausgabe, /zeile-30-/);
  assert.doesNotMatch(ausgabe, /x{201}/);
  const block = ausgabe.split("\n").filter((zeile) => zeile.startsWith("    "));
  assert.equal(block.length, 20);
  assert.equal(Math.max(...block.map((zeile) => zeile.length)), 204);
});

test("Eine rote Datei mit eigener Testmeldung bekommt keinen stderr-Block", () => {
  const { ausgabe, status } = laufen(
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("rechnet", () => { console.error("nur-im-stderr"); assert.equal(1, 2); });\n',
  );
  assert.match(ausgabe, /✗ rechnet/);
  assert.doesNotMatch(ausgabe, /nur-im-stderr/);
  assert.notEqual(status, 0);
});
