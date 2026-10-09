import assert from "node:assert/strict";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const TOR = "scripts/check-staged-suppressions.js";
const VORAB_HAKEN = ".githooks/pre-commit";
const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

function unterdrueckungen(zahlen) {
  const liste = {};
  for (const [datei, count] of Object.entries(zahlen)) liste[datei] = { complexity: { count } };
  return `${JSON.stringify(liste)}\n`;
}

function repoMit(context, zahlen) {
  return probeRepository(context, {
    [TOR]: readFileSync(join(REPO_ROOT, TOR), "utf8"),
    [VORAB_HAKEN]: readFileSync(join(REPO_ROOT, VORAB_HAKEN), "utf8"),
    "package.json": `${JSON.stringify({ type: "module", scripts: { lint: "true" } })}\n`,
    "eslint-legacy-exceptions.json": "{}\n",
    [UNTERDRUECKUNGEN]: unterdrueckungen(zahlen),
  });
}

function vormerken(repo, zahlen) {
  writeFiles(repo, { [UNTERDRUECKUNGEN]: unterdrueckungen(zahlen) });
  const vorgemerkt = runIn(repo, "git", ["add", UNTERDRUECKUNGEN]);
  assert.equal(vorgemerkt.status, EXIT_GRUEN, vorgemerkt.stderr);
}

function tor(repo, argumente = []) {
  const lauf = runIn(repo, process.execPath, [TOR, ...argumente]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

test("Unterdrückungen: eine vorgemerkte höhere Zahl in eslint-suppressions.json ist am Tor rot", (context) => {
  const repo = repoMit(context, { "src/alt.js": 2 });
  vormerken(repo, { "src/alt.js": 3 });
  const lauf = tor(repo);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /src\/alt\.js -> complexity: 2 -> 3/);
});

test("Unterdrückungen: ein vorgemerkter neuer Eintrag in eslint-suppressions.json ist am Tor rot", (context) => {
  const repo = repoMit(context, { "src/alt.js": 2 });
  vormerken(repo, { "src/alt.js": 1, "src/neu.js": 1 });
  const lauf = tor(repo);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /src\/neu\.js -> complexity: 0 -> 1/);
});

test("Unterdrückungen: vorgemerktes Senken und Streichen in eslint-suppressions.json ist am Tor grün", (context) => {
  const repo = repoMit(context, { "src/alt.js": 2, "src/weg.js": 1 });
  vormerken(repo, { "src/alt.js": 1 });
  const lauf = tor(repo);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.ausgabe);
});

test("Unterdrückungen: der Pre-Commit-Haken ist rot, wenn nur eslint-suppressions.json mit höherer Zahl vorgemerkt ist", (context) => {
  const repo = repoMit(context, { "src/alt.js": 2 });
  vormerken(repo, { "src/alt.js": 3 });
  const haken = runIn(repo, "sh", [VORAB_HAKEN]);
  assert.equal(haken.status, EXIT_ROT, `${haken.stdout}${haken.stderr}`);
});

test("Unterdrückungen: mit --basis ist ein Branch rot, der eine Zahl erhöht, und grün, der nur senkt", (context) => {
  const erhoeht = repoMit(context, { "src/alt.js": 2, "src/b.js": 2 });
  writeFiles(erhoeht, { [UNTERDRUECKUNGEN]: unterdrueckungen({ "src/alt.js": 1, "src/b.js": 3 }) });
  commitAll(erhoeht, "erhöht");
  const gesenkt = repoMit(context, { "src/alt.js": 2, "src/b.js": 2 });
  writeFiles(gesenkt, { [UNTERDRUECKUNGEN]: unterdrueckungen({ "src/alt.js": 1 }) });
  commitAll(gesenkt, "gesenkt");
  const laeufe = [tor(erhoeht, ["--basis", "HEAD~1"]), tor(gesenkt, ["--basis", "HEAD~1"])];
  assert.deepEqual(laeufe.map(({ status }) => status), [EXIT_ROT, EXIT_GRUEN], laeufe.map(({ ausgabe }) => ausgabe).join("\n"));
  assert.match(laeufe[0].ausgabe, /src\/b\.js -> complexity: 2 -> 3/);
});

const VERSTOESSE_IN_ALT = 2;

function lintRepo(context, gezaehlt) {
  const { scripts } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const repo = probeRepository(context, {
    "package.json": `${JSON.stringify({ type: "module", scripts: { lint: scripts.lint } })}\n`,
    "eslint.config.js": 'export default [{ rules: { "no-var": "error" } }];\n',
    "src/alt.js": "var erster = 1;\nvar zweiter = 2;\nexport { erster, zweiter };\n",
    [UNTERDRUECKUNGEN]: `${JSON.stringify({ "src/alt.js": { "no-var": { count: gezaehlt } } })}\n`,
  });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
  return runIn(repo, "npm", ["run", "--silent", "lint"]);
}

test("npm run lint bleibt grün, wenn eslint-suppressions.json mehr unterdrückt, als es Verstöße gibt", (context) => {
  const lauf = lintRepo(context, VERSTOESSE_IN_ALT + 1);
  assert.equal(lauf.status, EXIT_GRUEN, `${lauf.stdout}${lauf.stderr}`);
});

test("npm run lint ist rot, wenn eslint-suppressions.json weniger unterdrückt, als es Verstöße gibt", (context) => {
  const lauf = lintRepo(context, VERSTOESSE_IN_ALT - 1);
  assert.equal(lauf.status, EXIT_ROT, `${lauf.stdout}${lauf.stderr}`);
});
