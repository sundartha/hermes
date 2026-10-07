import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, isolatedEnvironment, outputLines, probeDirectory } from "./probe-repo.js";

const PRUEFSKRIPT = join(REPO_ROOT, "tools/openai-doku-pruefen.mjs");
const DOKU_P10A = join(REPO_ROOT, "docs/OPENAI-TOOL-INVENTORY.md");
const DOKU_REVIEWER = join(REPO_ROOT, "docs/OPENAI-REVIEWER-ACCESS.md");
const EXIT_SAUBER = 0;
const EXIT_BEFUND = 1;
const EXIT_AUFRUF = 2;
const SKRIPT_FRIST_MS = 150_000;
const ERFUNDENES_WERKZEUG = "erfundenes_werkzeug";
const ERFUNDENE_ZEILE_A = `${ERFUNDENES_WERKZEUG}|Erfundenes Werkzeug|always|true|false|false|true`;
const TABELLE_A_ANFANG = "TABLE-A-BEGIN";
const INTERNE_KENNUNG = "T2-99";
const SAUBERE_ZUSAMMENFASSUNG = /: 0 Befunde in \d+ Faellen$/;

function pruefe(argumente) {
  return spawnSync(process.execPath, [PRUEFSKRIPT, ...argumente], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: isolatedEnvironment(),
    timeout: SKRIPT_FRIST_MS,
  });
}

function kopienMitVerstoessen(context) {
  const verzeichnis = probeDirectory(context, {});
  const p10a = join(verzeichnis, "p10a-kopie.md");
  const reviewer = join(verzeichnis, "reviewer-kopie.md");
  copyFileSync(DOKU_P10A, p10a);
  copyFileSync(DOKU_REVIEWER, reviewer);
  const inventar = readFileSync(p10a, "utf8");
  writeFileSync(
    p10a,
    inventar.replace(TABELLE_A_ANFANG, `${TABELLE_A_ANFANG}\n${ERFUNDENE_ZEILE_A}`),
  );
  appendFileSync(reviewer, `\nSiehe ${INTERNE_KENNUNG} fuer Details.\n`);
  return ["--doku-p10a", p10a, "--doku-reviewer", reviewer];
}

test("auf den echten Dokus meldet die Pruefung keinen Befund", () => {
  const lauf = pruefe([]);
  assert.equal(lauf.status, EXIT_SAUBER, lauf.stdout + lauf.stderr);
  assert.match(outputLines(lauf.stdout).at(-1), SAUBERE_ZUSAMMENFASSUNG);
});

test("eine interne Kennung in der Reviewer-Doku und ein erfundenes Werkzeug im Inventar werden gemeldet", (context) => {
  const lauf = pruefe(kopienMitVerstoessen(context));
  const zeilen = outputLines(lauf.stdout);
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stdout + lauf.stderr);
  assert.ok(
    zeilen.some((zeile) => zeile.includes(`interne Kennung: ${INTERNE_KENNUNG}`)),
    lauf.stdout,
  );
  assert.ok(
    zeilen.some((zeile) => zeile.startsWith("p10a") && zeile.includes(ERFUNDENES_WERKZEUG)),
    lauf.stdout,
  );
});

test("fehlt ein Dokument, endet die Pruefung mit Exit 2 und nennt den Pfad", (context) => {
  const fehlend = join(probeDirectory(context, {}), "gibt-es-nicht.md");
  const lauf = pruefe(["--doku-reviewer", fehlend]);
  assert.equal(lauf.status, EXIT_AUFRUF, lauf.stdout + lauf.stderr);
  assert.ok(
    outputLines(lauf.stdout).some((zeile) => zeile.includes(fehlend)),
    lauf.stdout,
  );
});

test("eine unbekannte Option endet mit Exit 2", () => {
  const lauf = pruefe(["--unbekannte-option"]);
  assert.equal(lauf.status, EXIT_AUFRUF, lauf.stdout + lauf.stderr);
});
