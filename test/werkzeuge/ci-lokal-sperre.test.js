import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, repoMitCiLokalListe } from "./probe-repo.js";
import { FRIST, SCHWERLAUF, WARTET, halter, stand, starte, umgebung, wartet, zeile } from "./schwerlauf-lauf.js";

const CI_LOKAL = [join(REPO_ROOT, "tools/ci-lokal.mjs"), "--basis", "HEAD~1"];
const ZWEI_PLAETZE = 2;
const EIN_PLATZ = 1;
const PUSH_VORRANG = { SCHWERLAUF_VORRANG: "push" };
const STAND_IM_SCHRITT = "stand.txt";
const ANLASS = "ci-lokal --basis HEAD~1";

function repoMitStandImSchritt(context) {
  const schritt = { name: "stand", befehl: `${JSON.stringify(process.execPath)} ${JSON.stringify(SCHWERLAUF)} --stand > ${STAND_IM_SCHRITT}` };
  return repoMitCiLokalListe(context, [schritt]);
}

function mitAufraeumen(context, lauf) {
  context.after(() => lauf.kind.kill("SIGKILL"));
  return lauf;
}

function starteCiLokal(context, repo, env) {
  return mitAufraeumen(context, starte(CI_LOKAL, { env, cwd: repo }));
}

function standImSchritt(repo) {
  return readFileSync(join(repo, STAND_IM_SCHRITT), "utf8");
}

test("ci:lokal mit Push-Vorrang nimmt den freien Push-Platz, während beide gewöhnlichen Plätze belegt sind", FRIST, async (context) => {
  const env = umgebung(context, ZWEI_PLAETZE);
  const erster = await halter(context, env);
  const zweiter = await halter(context, env);
  const repo = repoMitStandImSchritt(context);
  const lauf = starteCiLokal(context, repo, { ...env, ...PUSH_VORRANG });
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^ci-lokal: grün$/m);
  assert.doesNotMatch(lauf.stderr, /Schwerer Lauf wartet/);
  const waehrend = standImSchritt(repo);
  assert.match(waehrend, new RegExp(`^Platz 1: belegt von PID ${erster.kind.pid}, Halter im Test, `, "m"));
  assert.match(waehrend, new RegExp(`^Platz 2: belegt von PID ${zweiter.kind.pid}, Halter im Test, `, "m"));
  assert.match(waehrend, new RegExp(`^Push-Platz: belegt von PID ${lauf.kind.pid}, ${ANLASS}, `, "m"));
});

test("ci:lokal ohne Vorrang wartet auf einen gewöhnlichen Platz", FRIST, async (context) => {
  const env = umgebung(context, ZWEI_PLAETZE);
  const erster = await halter(context, env);
  await halter(context, env);
  const repo = repoMitStandImSchritt(context);
  const lauf = starteCiLokal(context, repo, env);
  await wartet(lauf);
  const wartend = await stand(env);
  erster.kind.kill("SIGKILL");
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, 0, lauf.stdout + lauf.stderr);
  assert.match(wartend, /^Push-Platz: frei$/m);
  assert.match(wartend, new RegExp(`^Wartet: PID ${lauf.kind.pid}, ${ANLASS}, .*, seit [^,]+$`, "m"));
  const waehrend = standImSchritt(repo);
  assert.match(waehrend, new RegExp(`^Platz 1: belegt von PID ${lauf.kind.pid}, ${ANLASS}, `, "m"));
  assert.match(waehrend, /^Push-Platz: frei$/m);
});

test("ci:lokal unter einer geerbten Sperre nimmt keinen zweiten Platz", FRIST, async (context) => {
  const env = umgebung(context, EIN_PLATZ);
  const repo = repoMitStandImSchritt(context);
  const lauf = mitAufraeumen(context, starte([SCHWERLAUF, "--", process.execPath, ...CI_LOKAL], { env, cwd: repo }));
  const zuerst = await Promise.race([lauf.ende.then(() => "geendet"), zeile(lauf.kind.stderr, WARTET).then(() => "wartet")]);

  assert.equal(zuerst, "geendet", lauf.stderr);
  assert.equal(lauf.kind.exitCode, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^ci-lokal: grün$/m);
  const waehrend = standImSchritt(repo);
  assert.match(waehrend, new RegExp(`^Platz 1: belegt von PID ${lauf.kind.pid}, `, "m"));
  assert.match(waehrend, /^Push-Platz: frei$/m);
  assert.match(waehrend, /^Wartet: niemand$/m);
});
