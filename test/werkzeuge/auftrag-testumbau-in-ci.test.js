import assert from "node:assert/strict";
import { test } from "node:test";

import { MIT_MUTATION } from "./auftrag-lauf-hilfen.js";
import { starte } from "./auftrag-lauf-probe.js";

const UMBAU_AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";
const UMGEBAUT = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { gross } from "../src/text.js";\nconst A = "A";\ntest("gross", () => assert.equal(gross("a"), A));\n';
const AUFTRAG = {
  id: "A1",
  art: "testumbau",
  ziel: "Ziehe die Vorbereitung in eine Hilfe",
  bereich: "test/",
  erwarteteDateien: ["test/text.test.js"],
  vorbild: "test/text.test.js",
  abnahme: "test/text.test.js",
  prueft: UMBAU_AUSWEG,
};

function mutationsBefehl(context, schalter) {
  const { lauf, beleg } = starte(context, { auftrag: AUFTRAG, drehbuch: { test: { "test/text.test.js": UMGEBAUT } }, dateien: MIT_MUTATION, umgebung: { HERMES_MUTATION_IN_CI: schalter } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const befehle = beleg.pruefungen.filter(({ name }) => name === "mutation testumbau").map(({ befehl }) => befehl);
  assert.equal(befehle.length, 1, lauf.stdout + lauf.stderr);
  return befehle[0];
}

test("mit HERMES_MUTATION_IN_CI=1 fährt die Testumbau-Mutation des Auftrags über die CI", (context) => {
  assert.match(mutationsBefehl(context, "1"), /^npm --silent run test:mutation -- --in-ci --basis \S+ --testumbau$/);
});

test("ohne HERMES_MUTATION_IN_CI fährt die Testumbau-Mutation des Auftrags lokal", (context) => {
  assert.match(mutationsBefehl(context, ""), /^npm --silent run test:mutation -- --basis \S+ --testumbau$/);
});
