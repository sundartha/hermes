import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { issueBefunde } from "../../tools/auftrag/phase.mjs";
import { LAUF_FRIST_MS, ORDNER, aufrufe, exit, planOrdner, planeIn } from "./planung-probe.js";
import { REPO_ROOT } from "./probe-repo.js";
import { AUFTRAG, EXIT_AUFRUF, EXIT_GRUEN, phaseDatei, planeAntworten, werkzeug } from "./planung-plane-probe.js";

const ISSUE_ZEILE = /^Issue:.*\n/m;
const STATUS_ZEILE = /^(Status: .*\n)/m;

function pitchMitIssue(context, zeile) {
  const wurzel = planOrdner(context);
  const datei = join(wurzel, ORDNER, "pitch.md");
  const ohne = readFileSync(datei, "utf8").replace(ISSUE_ZEILE, "");
  writeFileSync(datei, zeile === undefined ? ohne : ohne.replace(STATUS_ZEILE, `$1${zeile}\n`));
  return wurzel;
}

function planeMit(context, { zeile, argumente = [] }) {
  return planeIn(context, pitchMitIssue(context, zeile), { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: ["plane", ORDNER, ...argumente] });
}

function erzeugtePhase(lauf) {
  exit(lauf, EXIT_GRUEN);
  return JSON.parse(readFileSync(phaseDatei(lauf), "utf8"));
}

function ohnePlanung(lauf, meldung) {
  exit(lauf, EXIT_AUFRUF);
  assert.ok(lauf.stderr.includes(meldung), lauf.stderr);
  assert.equal(aufrufe(lauf, "planer").length, 0);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung")), false);
}

test("plane mit der Pitch-Kopfzeile „Issue: 12“ schreibt issue 12 in phase.json, und pruefe, die Abdeckungsprüfung und issueBefunde melden für die Phase nichts", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, { zeile: "Issue: 12" });
  const phase = erzeugtePhase(lauf);

  assert.equal(phase.issue, 12);
  assert.deepEqual(issueBefunde(phase), []);
  assert.equal(werkzeug(lauf, AUFTRAG, "pruefe", phaseDatei(lauf)).status, EXIT_GRUEN);
  assert.equal(werkzeug(lauf, join(REPO_ROOT, "tools/abdeckung-pruefen.mjs"), join(lauf.wurzel, ORDNER)).status, EXIT_GRUEN);
});

test("plane --issue 7 geht vor die Pitch-Kopfzeile „Issue: 12“: phase.json hat issue 7", { timeout: LAUF_FRIST_MS }, (context) => {
  assert.equal(erzeugtePhase(planeMit(context, { zeile: "Issue: 12", argumente: ["--issue", "7"] })).issue, 7);
});

test("plane --issue 7 ohne Pitch-Kopfzeile „Issue:“ schreibt issue 7 in phase.json", { timeout: LAUF_FRIST_MS }, (context) => {
  assert.equal(erzeugtePhase(planeMit(context, { argumente: ["--issue", "7"] })).issue, 7);
});

test("plane ohne Pitch-Kopfzeile „Issue:“ und ohne --issue schreibt phase.json ohne issue", { timeout: LAUF_FRIST_MS }, (context) => {
  assert.equal(Object.hasOwn(erzeugtePhase(planeMit(context, {})), "issue"), false);
});

function ungueltigeZeile(context, zeile) {
  ohnePlanung(planeMit(context, { zeile }), `pitch.md: die Zeile „${zeile}“ braucht die Form „Issue: <Nummer>“ mit einer ganzen Zahl über 0`);
}

function ungueltigerSchalter(context, angabe) {
  ohnePlanung(planeMit(context, { zeile: "Issue: 12", argumente: ["--issue", angabe] }), `--issue braucht die Nummer eines Issues als ganze Zahl über 0, nicht ${angabe}`);
}

test("plane mit der Pitch-Kopfzeile „Issue: abc“ endet mit Exit 2, nennt die verlangte Form und startet keinen Agenten", { timeout: LAUF_FRIST_MS }, (context) => {
  ungueltigeZeile(context, "Issue: abc");
});

test("plane mit der Pitch-Kopfzeile „Issue: 0“ endet mit Exit 2, nennt die verlangte Form und startet keinen Agenten", { timeout: LAUF_FRIST_MS }, (context) => {
  ungueltigeZeile(context, "Issue: 0");
});

test("plane --issue abc endet mit Exit 2, nennt die Angabe und startet keinen Agenten", { timeout: LAUF_FRIST_MS }, (context) => {
  ungueltigerSchalter(context, "abc");
});

test("plane --issue 0 endet mit Exit 2, nennt die Angabe und startet keinen Agenten", { timeout: LAUF_FRIST_MS }, (context) => {
  ungueltigerSchalter(context, "0");
});
