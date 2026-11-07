import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BASIS, EXIT_ABBRUCH, NEGATIV, NULL, quelle, testdatei } from "./mutationspruefung-hilfen.js";
import { gitAusgabe, probeDirectory, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";
import { lokaleUmgebung, starte } from "./schwerlauf-lauf.js";
import { SANDBOXORDNER } from "../../tools/tests-ausmisten/arbeitsordner.mjs";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const OHNE_MUTANTEN = "grün: keine geänderte Zeile unter src/ mit Mutanten oder löschbarer Anweisung.";
const URTEIL = /^(?:grün|rot): .+$/gm;
const KONSTANTE = "const GRENZE = 0;\n";
const ERSTLAUF_ABBRUCH = ["Abbruch: Erstlauf rot: test/zahl.test.js › einordnen", "Abbruch: There were failed tests in the initial test run."];
const ABBRUCH = /^Abbruch: .+$/gm;
const EXIT_GESPERRT = 3;

async function lokalerLauf(context, repo, ...argumente) {
  const lauf = starte([WERKZEUG, "--basis", "HEAD", ...argumente], { env: lokaleUmgebung(), cwd: repo });
  context.after(() => lauf.kind.kill("SIGKILL"));
  const [code] = await lauf.ende;
  return { ...lauf, code };
}

function markierenderTest(marke) {
  return ['import { appendFileSync } from "node:fs";', `appendFileSync(${JSON.stringify(marke)}, "lief\\n");`, testdatei([-1, "negativ"], [1, "positiv"])].join("\n");
}

test("ein Lauf ohne geplante Mutanten endet lokal mit dem Urteil, ohne die Sperre für schwere Läufe zu brauchen", async (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": `${quelle(NEGATIV)}${KONSTANTE}` });
  writeFiles(repo, { "src/zahl.js": `${quelle(NEGATIV)}export ${KONSTANTE}` });
  const lauf = await lokalerLauf(context, repo);
  assert.equal(lauf.code, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(lauf.stdout.match(URTEIL), [OHNE_MUTANTEN], lauf.stdout);
});

test("ein Lauf ohne Mutanten mit rotem betroffenem Test bricht lokal wie bisher ab, ohne die Sperre zu brauchen", async (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": `${quelle(NEGATIV)}${KONSTANTE}`, "test/zahl.test.js": testdatei([-1, "positiv"]) });
  writeFiles(repo, { "src/zahl.js": `${quelle(NEGATIV)}export ${KONSTANTE}` });
  const lauf = await lokalerLauf(context, repo);
  assert.equal(lauf.code, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.deepEqual(lauf.stderr.match(ABBRUCH), ERSTLAUF_ABBRUCH, lauf.stderr);
});

test("ein Lauf mit Mutanten wird lokal abgelehnt, bevor ein Testprozess startet", async (context) => {
  const marke = join(probeDirectory(context, {}), "testlauf");
  const repo = probeRepository(context, { ...BASIS, "test/zahl.test.js": markierenderTest(marke) });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const lauf = await lokalerLauf(context, repo);
  assert.equal(lauf.code, EXIT_GESPERRT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /^test:mutation --basis HEAD läuft nur auf GitHub Actions /m);
  assert.equal(existsSync(marke), false, "ein Testprozess lief trotz Ablehnung");
});

test("ein Lauf gegen den alten Stand wird lokal abgelehnt, bevor ein Arbeitsordner oder Worktree entsteht", async (context) => {
  const repo = probeRepository(context, { ...BASIS });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV.replace("<", "<=")) });
  const lauf = await lokalerLauf(context, repo, "--alter-stand");
  assert.equal(lauf.code, EXIT_GESPERRT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /^test:mutation --basis HEAD läuft nur auf GitHub Actions /m);
  const sandbox = join(repo, SANDBOXORDNER);
  assert.deepEqual(existsSync(sandbox) ? readdirSync(sandbox).filter((name) => name.startsWith("alter-stand-")) : [], [], "Arbeitsordner blieb liegen");
  assert.equal(gitAusgabe(repo, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1, "Worktree blieb angemeldet");
});
