import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
  budgetDatei,
  budgetOrdner,
  EXIT_ROT,
  REPO,
  rueckfrageKartePruefen,
  TEST_FRIST,
} from "./karten-lauf-hilfen.js";
import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const GROSSZUEGIG_MS = 60000;
const KNAPP_MS = 1;
const MARKIERT = ["elevenlabs-consult", "elevenlabs-lookup"];

const ordner = budgetOrdner("antwortzeiten-test-");

const budgets = (name, werte) => budgetDatei(ordner, name, werte);

function allePlus(wert, zusatz = {}) {
  return { ...Object.fromEntries(MARKIERT.map((name) => [name, wert])), ...zusatz };
}

test("Antwortzeit über dem Budget macht die Karte rot", TEST_FRIST, async () => {
  const lauf = await rueckfrageKartePruefen(
    budgets("zu-knapp", allePlus(GROSSZUEGIG_MS, { "elevenlabs-consult": KNAPP_MS })),
  );
  assert.equal(lauf.exit, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /elevenlabs-consult[^\n]*\b\d+ ms[^\n]*Budget[^\n]*\b1 ms/);
});

test("Antwortzeit im Budget bleibt sauber", TEST_FRIST, async () => {
  const lauf = await rueckfrageKartePruefen(budgets("im-budget", allePlus(GROSSZUEGIG_MS)));
  assert.equal(lauf.exit, 0, lauf.ausgabe);
  assert.match(lauf.ausgabe, /Funktionskarte: sauber/);
});

test("Markierter Schritt ohne Budget ist rot", TEST_FRIST, async () => {
  const ohneConsult = Object.entries(allePlus(GROSSZUEGIG_MS)).filter(
    ([name]) => name !== "elevenlabs-consult",
  );
  const lauf = await rueckfrageKartePruefen(
    budgets("ohne-budget", Object.fromEntries(ohneConsult)),
  );
  assert.equal(lauf.exit, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /elevenlabs-consult[^\n]*hat kein Budget/);
});

test("Budget ohne markierten Schritt ist rot", TEST_FRIST, async () => {
  const lauf = await rueckfrageKartePruefen(
    budgets("totes-budget", allePlus(GROSSZUEGIG_MS, { "gibt-es-nicht": GROSSZUEGIG_MS })),
  );
  assert.equal(lauf.exit, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /gibt-es-nicht[^\n]*hat keinen Schritt/);
});

const BUDGET_DATEI = ".github/antwortzeiten.json";
const STRENGER_FALL = "(e) Antwortzeit-Budget nur kleiner";
const AUFRUF_STRENGER = [
  `import { stricterCases } from ${JSON.stringify(pathToFileURL(join(REPO, "tools/freigabe-strenger.mjs")).href)};`,
  "const [, pfad] = process.argv;",
  'const faelle = stricterCases("HEAD~1", [{ status: "M", path: pfad }]);',
  "console.log(JSON.stringify(faelle ?? null));",
].join("\n");
const VORHER = { "elevenlabs-consult": 800, "elevenlabs-lookup": 100 };

function einstufung(context, nachher) {
  const verzeichnis = probeRepository(context, {
    [BUDGET_DATEI]: `${JSON.stringify({ attrappen: VORHER, staging: {} })}\n`,
  });
  writeFiles(verzeichnis, { [BUDGET_DATEI]: `${JSON.stringify(nachher)}\n` });
  commitAll(verzeichnis, "geaendert");
  const lauf = runIn(verzeichnis, process.execPath, [
    "--input-type=module",
    "-e",
    AUFRUF_STRENGER,
    BUDGET_DATEI,
  ]);
  assert.equal(lauf.status, 0, lauf.stderr);
  return JSON.parse(lauf.stdout);
}

function budgetFall(context, attrappen, staging = {}) {
  return einstufung(context, { attrappen, staging });
}

const NUR_KLEINER = [{ path: BUDGET_DATEI, fall: STRENGER_FALL }];

test("freigabe-strenger: in .github/antwortzeiten.json ist ein kleineres Budget bei gleichen Schlüsseln strenger", (context) => {
  assert.deepEqual(budgetFall(context, { ...VORHER, "elevenlabs-consult": 700 }), NUR_KLEINER);
});

test("freigabe-strenger: in .github/antwortzeiten.json ist ein größeres Budget keine strengere Änderung", (context) => {
  assert.equal(budgetFall(context, { ...VORHER, "elevenlabs-lookup": 101 }), null);
});

test("freigabe-strenger: in .github/antwortzeiten.json ist ein Budget von 0 keine strengere Änderung", (context) => {
  assert.equal(budgetFall(context, { ...VORHER, "elevenlabs-lookup": 0 }), null);
});

test("freigabe-strenger: in .github/antwortzeiten.json ist ein Budget mit Nachkommastellen keine strengere Änderung", (context) => {
  assert.equal(budgetFall(context, { ...VORHER, "elevenlabs-lookup": 99.5 }), null);
});

test("freigabe-strenger: in .github/antwortzeiten.json ist ein zusätzlicher Schlüssel keine strengere Änderung", (context) => {
  assert.equal(budgetFall(context, { ...VORHER, "neu-hinzu": 50 }), null);
});

test("freigabe-strenger: in .github/antwortzeiten.json ist ein fehlender Schlüssel keine strengere Änderung", (context) => {
  assert.equal(budgetFall(context, { "elevenlabs-consult": 700 }), null);
});

test("freigabe-strenger: in .github/antwortzeiten.json ist ein Budget für Staging keine strengere Änderung", (context) => {
  const staging = { "elevenlabs-consult": 5000 };
  assert.equal(budgetFall(context, { ...VORHER, "elevenlabs-consult": 700 }, staging), null);
});
