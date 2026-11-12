import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");
const KATALOG = "docs/sicherheitsgrenzen.md";
const LISTE = "tools/basis/katalog-ohne-test.txt";
const KENNUNG = "SG-99";
const EXIT_BEFUND = 1;
const ordner = [];

after(() => {
  for (const eintrag of ordner) rmSync(eintrag, { recursive: true, force: true });
});

function wegwerfWurzel({ liste }) {
  const wurzel = mkdtempSync(join(tmpdir(), "katalog-ohne-liste-"));
  ordner.push(wurzel);
  cpSync(join(WURZEL, "docs"), join(wurzel, "docs"), { recursive: true });
  for (const eintrag of ["src", "test", "node_modules", "package.json"]) {
    symlinkSync(join(WURZEL, eintrag), join(wurzel, eintrag));
  }
  const katalog = readFileSync(join(wurzel, KATALOG), "utf8");
  const zeile = katalog.split("\n").find((text) => text.startsWith("| SG-01 |"));
  const neu = zeile.replace("| SG-01 |", `| ${KENNUNG} |`).replace(/SG-01 [^|]*\|$/, `${KENNUNG} erfundener Fall ohne Test |`);
  writeFileSync(join(wurzel, KATALOG), katalog.replace(zeile, `${zeile}\n${neu}`));
  mkdirSync(join(wurzel, "tools/basis"), { recursive: true });
  if (liste !== undefined) writeFileSync(join(wurzel, LISTE), liste);
  return wurzel;
}

function pruefen(wurzel) {
  return spawnSync(process.execPath, [join(WURZEL, "tools/katalog-pruefen.mjs")], { cwd: wurzel, encoding: "utf8" });
}

test("eine Katalogzeile ohne Negativtest wird gemeldet, auch wenn eine Liste sie aufführt", () => {
  const lauf = pruefen(wegwerfWurzel({ liste: `${KENNUNG}\n` }));
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.match(lauf.stderr, new RegExp(`${KATALOG}: ${KENNUNG} hat keinen Negativtest unter test/`));
});

test("ohne Liste wird dieselbe Zeile ebenso gemeldet", () => {
  const lauf = pruefen(wegwerfWurzel({}));
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.match(lauf.stderr, new RegExp(`${KATALOG}: ${KENNUNG} hat keinen Negativtest unter test/`));
});

test("der echte Katalog meldet keine Zeile ohne Negativtest", () => {
  const lauf = spawnSync(process.execPath, ["tools/katalog-pruefen.mjs"], { cwd: WURZEL, encoding: "utf8" });
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.match(lauf.stdout, /^Bedrohungskatalog: \d+ Zeilen\.$/m);
});
