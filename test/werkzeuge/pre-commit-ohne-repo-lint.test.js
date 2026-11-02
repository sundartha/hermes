import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { EXIT_GRUEN, EXIT_ROT, TOR, UNTERDRUECKUNGEN } from "./unterdrueckungen-probe.js";

const HAKEN_ORDNER = join(REPO_ROOT, ".githooks");
const LINT_ROT = `${JSON.stringify({ type: "module", scripts: { lint: 'node -e "process.exit(1)"' } })}\n`;
const FREMDE_DATEI = "src/fremd.js";
const FREMDER_VERSTOSS = "debugger;\n";
const FREMDE_NOTIZ = "notiz.md";

function unterdrueckungen(zahl) {
  return `${JSON.stringify({ "src/alt.js": { complexity: { count: zahl } } })}\n`;
}

function repoMitRotemLint(context) {
  return probeRepository(context, {
    [TOR]: readFileSync(join(REPO_ROOT, TOR), "utf8"),
    "package.json": LINT_ROT,
    "eslint-legacy-exceptions.json": "{}\n",
    [UNTERDRUECKUNGEN]: unterdrueckungen(2),
    [FREMDE_DATEI]: FREMDER_VERSTOSS,
    [FREMDE_NOTIZ]: "alt\n",
  });
}

function commitMitHaken(repo, pfade) {
  const vorgemerkt = runIn(repo, "git", ["add", ...pfade]);
  assert.equal(vorgemerkt.status, EXIT_GRUEN, vorgemerkt.stderr);
  const lauf = runIn(repo, "git", [
    "-c", `core.hooksPath=${HAKEN_ORDNER}`,
    "-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "-q", "-m", "Probe",
  ]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

test("pre-commit: ein Commit geht durch, obwohl eine fremde Datei einen Lint-Verstoß hat und das Repo-Lint rot wäre", (context) => {
  const repo = repoMitRotemLint(context);
  writeFiles(repo, { [FREMDE_DATEI]: `${FREMDER_VERSTOSS}debugger;\n`, [FREMDE_NOTIZ]: "neu\n" });
  const lauf = commitMitHaken(repo, [FREMDE_NOTIZ]);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.ausgabe);
});

test("pre-commit: ein Commit, der eine Zahl in eslint-suppressions.json erhöht, wird weiter abgelehnt", (context) => {
  const repo = repoMitRotemLint(context);
  writeFiles(repo, { [UNTERDRUECKUNGEN]: unterdrueckungen(3) });
  const lauf = commitMitHaken(repo, [UNTERDRUECKUNGEN]);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /src\/alt\.js -> complexity: 2 -> 3/);
});
