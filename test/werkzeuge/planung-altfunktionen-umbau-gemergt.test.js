import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { AUFTRAG, EXIT_AUFRUF, planeAntworten } from "./planung-plane-probe.js";
import { HINWEIS, LAUF_FRIST_MS, ORDNER, aufrufe, exit, planOrdner, planeIn } from "./planung-probe.js";
import { commitPaths, mitUpstreamMaster, runIn, writeFiles } from "./probe-repo.js";

const EXIT_ALTFUNKTIONEN = 6;
const VORGAENGER = "P-001-t1-umbau-davor";
const KOPF = `Teil von: P-001-gross; nach: ${VORGAENGER}`;
const UMBAU_SCHNITT = `plaene/${VORGAENGER}/planung/schnitt.json`;
const FUNKTION = "setzeHinweis";
const RUECKNAHME = "notizen/ruecknahme.txt";
const ZEILEN_IN_DER_PROBE = { von: 6, bis: 9 };
const UMBAU_EINTRAG = `- Umbau: \`${HINWEIS}:${FUNKTION}\``;
const NICHT_BERUEHRT_EINTRAG = `- nicht berührt: \`${HINWEIS}:${FUNKTION}\`, weil die Änderung nur den Rückgabewert liest`;
const ABSCHNITT = /^## Altfunktionen\n[\s\S]*?\n(?=## )/m;
const FALSCH = `„Umbau: ${HINWEIS}:${FUNKTION}“ unter „## Altfunktionen“ ist laut karte keine Funktion mit Lint-Befunden in ${HINWEIS}`;

function teilPitch(wurzel, eintrag) {
  const pitch = join(wurzel, ORDNER, "pitch.md");
  const text = readFileSync(pitch, "utf8").replace("\nIssue: ", `\n${KOPF}\nIssue: `).replace(ABSCHNITT, `## Altfunktionen\n${eintrag}\n\n`);
  writeFileSync(pitch, text);
}

function umbauGebaut(wurzel, funktion = FUNKTION) {
  const schnitt = { auftraege: [{ id: "u1", art: "umbau", bereich: HINWEIS, altfunktionen: [{ datei: HINWEIS, funktion, ...ZEILEN_IN_DER_PROBE }] }] };
  writeFiles(wurzel, { [UMBAU_SCHNITT]: `${JSON.stringify(schnitt, null, 2)}\n` });
  commitPaths(wurzel, [UMBAU_SCHNITT], `${funktion} lintfrei umbauen\n\nAuftrag: ${VORGAENGER}/u1\nArt: umbau`);
  return runIn(wurzel, "git", ["rev-parse", "--short=7", "HEAD"]).stdout.trim();
}

function gemergt(wurzel, funktion = FUNKTION) {
  const gebaut = umbauGebaut(wurzel, funktion);
  mitUpstreamMaster(wurzel);
  return gebaut;
}

function zurueckgenommen(wurzel) {
  const sha = runIn(wurzel, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(wurzel, { [RUECKNAHME]: "zurück\n" });
  commitPaths(wurzel, [RUECKNAHME], `Revert "Umbau"\n\nThis reverts commit ${sha}.`);
}

function planeTeil(context, vorbereiten, eintrag = UMBAU_EINTRAG) {
  const wurzel = planOrdner(context);
  teilPitch(wurzel, eintrag);
  const sha = vorbereiten(wurzel);
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: ["plane", ORDNER] });
  assert.deepEqual(aufrufe(lauf, "planer"), [], lauf.stderr);
  assert.deepEqual(aufrufe(lauf, "erkunder"), [], lauf.stderr);
  return { lauf, sha };
}

function haeltAmEintrag(lauf, falsch = FALSCH) {
  exit(lauf, EXIT_ALTFUNKTIONEN);
  assert.ok(lauf.stderr.includes(falsch), lauf.stderr);
  assert.doesNotMatch(lauf.stdout, /gemergt/u);
}

test("altfunktionen-vorab: Umbau-Eintrag eines gemergten Vorgängers aus nach gilt als erledigt, wenn die Funktion keine Befunde mehr hat", { timeout: LAUF_FRIST_MS }, (context) => {
  const { lauf, sha } = planeTeil(context, gemergt);

  exit(lauf, EXIT_AUFRUF);
  assert.ok(!lauf.stderr.includes(FALSCH), lauf.stderr);
  assert.ok(lauf.stderr.includes("plane plant keinen Teil ohne Teilung"), lauf.stderr);
  assert.ok(lauf.stdout.includes(`Umbau von ${HINWEIS}:${FUNKTION} durch ${VORGAENGER} gemergt, ${sha}`), lauf.stdout);
});

test("altfunktionen-vorab: Umbau-Eintrag ohne Befunde und ohne gemergten Vorgänger bleibt ein falscher Eintrag", { timeout: LAUF_FRIST_MS }, (context) => {
  const { lauf } = planeTeil(context, mitUpstreamMaster);

  haeltAmEintrag(lauf);
});

test("altfunktionen-vorab: Umbau-Eintrag eines Vorgängers, der nur auf dem eigenen Branch steht, bleibt ein falscher Eintrag", { timeout: LAUF_FRIST_MS }, (context) => {
  const { lauf } = planeTeil(context, (wurzel) => {
    mitUpstreamMaster(wurzel);
    return umbauGebaut(wurzel);
  });

  haeltAmEintrag(lauf);
});

test("altfunktionen-vorab: ein gemergter Umbau des Vorgängers an einer anderen Funktion erledigt den Eintrag nicht", { timeout: LAUF_FRIST_MS }, (context) => {
  const { lauf } = planeTeil(context, (wurzel) => gemergt(wurzel, "nimmAnruf"));

  haeltAmEintrag(lauf);
});

test("altfunktionen-vorab: Umbau-Eintrag eines Vorgängers, der auf upstream/master gemergt ist, aber dem eigenen Stand fehlt, bleibt ein falscher Eintrag", { timeout: LAUF_FRIST_MS }, (context) => {
  const { lauf } = planeTeil(context, (wurzel) => {
    gemergt(wurzel);
    runIn(wurzel, "git", ["reset", "-q", "--hard", "HEAD~1"]);
  });

  haeltAmEintrag(lauf);
});

test("altfunktionen-vorab: ein zurückgenommener Umbau-Commit des Vorgängers erledigt den Eintrag nicht", { timeout: LAUF_FRIST_MS }, (context) => {
  const { lauf } = planeTeil(context, (wurzel) => {
    umbauGebaut(wurzel);
    zurueckgenommen(wurzel);
    mitUpstreamMaster(wurzel);
  });

  haeltAmEintrag(lauf);
});

test("altfunktionen-vorab: „nicht berührt“ für eine Funktion, deren Umbau ein Vorgänger gemergt hat, bleibt ein falscher Eintrag", { timeout: LAUF_FRIST_MS }, (context) => {
  const { lauf } = planeTeil(context, gemergt, NICHT_BERUEHRT_EINTRAG);

  haeltAmEintrag(lauf, `„nicht berührt: ${HINWEIS}:${FUNKTION}“ unter „## Altfunktionen“ ist laut karte keine Funktion mit Lint-Befunden in ${HINWEIS}`);
});
