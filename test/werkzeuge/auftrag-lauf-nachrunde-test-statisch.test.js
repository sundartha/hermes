import assert from "node:assert/strict";
import { test } from "node:test";

import { MIT_MUTATION, ROTER_TEST, VERDOPPELT, funktion } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

const SATZ = "Eine Zahl wird nie falsch verdoppelt.";
const OHNE_WIRKUNG = 'test("[NIE1] drei bleibt kein Text", () => assert.notDeepEqual(verdopple(3), "6"));';
const MIT_WIRKUNG = 'test("[NIE1] drei wird sechs", () => assert.equal(verdopple(3), 6));';
const NACHRUNDE = "## Schutztests ohne Wirkung";
const ABSATZ = "Zweck schutzwirkung: Drehbuchtext des Ersatz-Agenten.";
const ERSATZ_MUTATION = `import { readFileSync } from "node:fs";
const argumente = process.argv.slice(2);
const testdatei = readFileSync("test/rechnen.test.js", "utf8");
const name = /test\\("(\\[NIE1\\][^"]*)"/.exec(testdatei)?.[1];
const ausgabe = (...zeilen) => console.log(zeilen.join("\\n"));
if (argumente.includes("--schutzwirkung")) { process.exitCode = 2; }
else if (name === undefined) ausgabe("grün: 1 Mutanten in den neuen Zeilen unter src/, keiner überlebt.");
else if (!testdatei.includes("notDeepEqual")) ausgabe("grün: 1 Mutanten in den neuen Zeilen unter src/, keiner überlebt.", "Schutztest wirksam: " + name, "grün: 1 Schutztests, 0 ohne nachgewiesene Wirkung.");
else { ausgabe("grün: 1 Mutanten in den neuen Zeilen unter src/, keiner überlebt.", "Verstoß: Schutztest wirkungslos: " + name, "rot: 1 Schutztests, 1 ohne nachgewiesene Wirkung."); process.exitCode = argumente.includes("--schutz-gesondert") ? 0 : 1; }
`;

function schutzfall(fall) {
  return { "test/rechnen.test.js": [ROTER_TEST.trimEnd(), fall, ""].join("\n") };
}

test("nach der Nachrunde zur Schutzwirkung läuft tests/statisch über die nachgeholten Tests, bevor die Schutzwirkung neu gemessen wird", (context) => {
  const drehbuch = { test: schutzfall(OHNE_WIRKUNG), bau: { "src/rechnen.js": VERDOPPELT }, nach: NACHRUNDE, "test-nach": schutzfall(MIT_WIRKUNG), "test-nach-antwort": ABSATZ };
  const dateien = { ...MIT_MUTATION, "mutation.mjs": ERSATZ_MUTATION };
  const { lauf, beleg } = starte(context, { auftrag: { ...funktion("2 !== 4"), wasDarfNiePassieren: [SATZ] }, drehbuch, dateien });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const namen = beleg.pruefungen.map(({ name }) => name);
  const roteWirkung = beleg.pruefungen.findIndex(({ name, exitCode }) => name === "schutzwirkung" && exitCode === EXIT_ROT);
  const nachTest = namen.indexOf("schutzwirkung nach Test");
  assert.ok(roteWirkung >= 0 && nachTest > roteWirkung, namen.join(", "));
  const statischDazwischen = namen.slice(roteWirkung + 1, nachTest).includes("tests/statisch");
  assert.ok(statischDazwischen, namen.join(", "));
});
