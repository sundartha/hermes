import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { bestaetige, bestaetigt } from "../../tools/mutationspruefung/bestaetigung.mjs";

import { BASIS, EXIT_ROT, NEGATIV, NULL, quelle } from "./mutationspruefung-hilfen.js";
import { isolatedEnvironment, probeDirectory, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const ERSATZ = fileURLToPath(new URL("mutationspruefung-zeitablauf-urteil-ersatz.mjs", import.meta.url));
const ERSTE_ZEITGRENZE = 1;
const LAENGERE_ZEITGRENZE = 3;
const ALLE = ["ueberlebt", "haenger", "getoetet"];

function lauf(context) {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const aufrufe = join(probeDirectory(context, {}), "aufrufe.jsonl");
  const ergebnis = spawnSync(process.execPath, ["--import", ERSATZ, WERKZEUG, "--basis", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), STRYKER_AUFRUFE: aufrufe },
  });
  const protokoll = readFileSync(aufrufe, "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile));
  return { ausgabe: ergebnis.stdout, status: ergebnis.status, protokoll, fehler: ergebnis.stderr };
}

test("Zeitüberschreitung im ersten Lauf: der Bestätigungslauf entscheidet über überlebt, Hänger und bestätigt getötet", (context) => {
  const { ausgabe, status, fehler } = lauf(context);
  assert.equal(status, EXIT_ROT, ausgabe + fehler);
  assert.match(ausgabe, /^Verstoß: Mutant überlebt: src\/zahl\.js:\S+ .* → ueberlebt$/m);
  assert.doesNotMatch(ausgabe, /^Verstoß: Mutant überlebt: .*(haenger|getoetet)/m);
  assert.match(ausgabe, /^Bestätigung: 1 bestätigt getötet, 1 nur durch Zeitablauf oder Absturz erkannt\.$/m);
});

test("Zeitüberschreitung im ersten Lauf: zwischen erstem Lauf und Bestätigungslauf läuft kein weiterer Stryker-Lauf", (context) => {
  const { protokoll } = lauf(context);
  assert.deepEqual(
    protokoll.map(({ faktor, mutanten }) => [faktor, mutanten]),
    [
      [ERSTE_ZEITGRENZE, ALLE],
      [LAENGERE_ZEITGRENZE, ALLE],
      [LAENGERE_ZEITGRENZE, ["getoetet"]],
    ],
  );
  assert.deepEqual(protokoll[2].tests, protokoll[2].tests.slice(0, 1));
});

test("Zeitüberschreitung im ersten Lauf: der bestätigt getötete Mutant behält Status und tötende Datei des roten Laufs", async () => {
  const datei = "test/a.test.js";
  const lage = { start: { line: 3, column: 7 }, end: { line: 3, column: 15 } };
  const mutant = (status, toeter = []) => ({ schluessel: "src/zahl.js:3:7", lage, status, toeter });
  const antworten = [[mutant("Killed", [datei])], [mutant("Killed", [datei])]];
  const [ergebnis] = await bestaetige([mutant("Timeout")], async () => antworten.shift());
  assert.equal(bestaetigt(ergebnis), true);
  assert.equal(ergebnis.status, "Killed");
  assert.deepEqual(ergebnis.toeter, [datei]);
});
