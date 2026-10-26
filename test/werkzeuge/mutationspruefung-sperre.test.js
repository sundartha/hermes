import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BASIS, EXIT_ABBRUCH, EXIT_ROT, mitProtokoll, NEGATIV, NULL, PROTOKOLL, quelle, schluessel, testdatei, UEBERLEBT } from "./mutationspruefung-hilfen.js";
import { probeDirectory, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";
import { halter, starte, umgebung, wartet, WARTET, zeile } from "./schwerlauf-lauf.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const OHNE_MUTANTEN = "grün: keine geänderte Zeile unter src/ mit Mutanten oder löschbarer Anweisung.";
const URTEIL = /^(?:grün|rot): .+$/gm;
const KONSTANTE = "const GRENZE = 0;\n";
const UNLESBAR = "  const grenze = (;";
const GELOESCHT = "src/zahl.js:3 Zeile gelöscht";
const ERSTLAUF_ABBRUCH = ["Abbruch: Erstlauf rot: test/zahl.test.js › einordnen", "Abbruch: There were failed tests in the initial test run."];
const ABBRUCH = /^Abbruch: .+$/gm;
const EIN_PLATZ = 1;
const NICHT_ZAEHLBAR = /^src\/zahl\.js: Mutanten vorab nicht zählbar \(.+/m;

function mutationslauf(context, { repo, env }, ...argumente) {
  const lauf = starte([WERKZEUG, "--basis", "HEAD", ...argumente], { env, cwd: repo });
  context.after(() => lauf.kind.kill("SIGKILL"));
  return lauf;
}

async function ohneWarten(lauf) {
  const gewartet = zeile(lauf.kind.stderr, WARTET).then(() => assert.fail(`Lauf wartet auf die Sperre: ${lauf.stderr}`));
  const [code] = await Promise.race([lauf.ende, gewartet]);
  return code;
}

async function belegteSperre(context) {
  const env = umgebung(context, EIN_PLATZ);
  return { env, gehalten: await halter(context, env) };
}

async function nachFreigabe(lauf, gehalten) {
  gehalten.kind.kill("SIGKILL");
  const [code] = await lauf.ende;
  assert.equal(code, EXIT_ROT, lauf.stdout + lauf.stderr);
}

function markierenderTest(marke) {
  return ['import { appendFileSync } from "node:fs";', `appendFileSync(${JSON.stringify(marke)}, "lief\\n");`, testdatei([-1, "negativ"], [1, "positiv"])].join("\n");
}

test("ein Lauf ohne geplante Mutanten endet mit dem Urteil wie heute, ohne auf die belegte Sperre zu warten", async (context) => {
  const { env } = await belegteSperre(context);
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": `${quelle(NEGATIV)}${KONSTANTE}` });
  writeFiles(repo, { "src/zahl.js": `${quelle(NEGATIV)}export ${KONSTANTE}` });
  for (const argumente of [[], ["--alter-stand"]]) {
    const lauf = mutationslauf(context, { repo, env }, ...argumente);
    assert.equal(await ohneWarten(lauf), 0, lauf.stdout + lauf.stderr);
    assert.deepEqual(lauf.stdout.match(URTEIL), [OHNE_MUTANTEN], lauf.stdout);
  }
});

test("ein Lauf ohne Mutanten mit rotem betroffenem Test bricht bei belegter Sperre wie bisher ab, ohne zu warten", async (context) => {
  const { env } = await belegteSperre(context);
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": `${quelle(NEGATIV)}${KONSTANTE}`, "test/zahl.test.js": testdatei([-1, "positiv"]) });
  writeFiles(repo, { "src/zahl.js": `${quelle(NEGATIV)}export ${KONSTANTE}` });
  const lauf = mutationslauf(context, { repo, env });
  assert.equal(await ohneWarten(lauf), EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.deepEqual(lauf.stderr.match(ABBRUCH), ERSTLAUF_ABBRUCH, lauf.stderr);
});

test("ein Lauf mit Mutanten wartet an der belegten Sperre, bevor ein Testprozess startet, und prüft nach der Freigabe wie heute", async (context) => {
  const { env, gehalten } = await belegteSperre(context);
  const marke = join(probeDirectory(context, {}), "testlauf");
  const repo = probeRepository(context, { ...BASIS, "test/zahl.test.js": markierenderTest(marke) });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const lauf = mutationslauf(context, { repo, env });
  await wartet(lauf);
  assert.equal(existsSync(marke), false, "ein Testprozess lief, bevor die Sperre frei war");
  await nachFreigabe(lauf, gehalten);
  assert.equal(existsSync(marke), true, lauf.stdout + lauf.stderr);
  assert.ok(schluessel(lauf.stdout, UEBERLEBT).length > 0, lauf.stdout);
});

test("ein Lauf, dessen geänderte Datei sich nicht parsen lässt, meldet das und wartet an der belegten Sperre", async (context) => {
  const { env } = await belegteSperre(context);
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, UNLESBAR) });
  const lauf = mutationslauf(context, { repo, env });
  await wartet(lauf);
  assert.match(lauf.stdout, NICHT_ZAEHLBAR, lauf.stdout);
});

test("ein Lauf ohne Mutanten, aber mit einer löschbaren geänderten Zeile wartet an der belegten Sperre und macht nach der Freigabe die Löschprobe", async (context) => {
  const { env, gehalten } = await belegteSperre(context);
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": mitProtokoll(quelle(NEGATIV)) });
  writeFiles(repo, { "src/zahl.js": mitProtokoll(quelle(PROTOKOLL, NEGATIV)) });
  const lauf = mutationslauf(context, { repo, env });
  await wartet(lauf);
  await nachFreigabe(lauf, gehalten);
  assert.deepEqual(schluessel(lauf.stdout, UEBERLEBT), [GELOESCHT], lauf.stdout);
});
