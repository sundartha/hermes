import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { entnimmVolleAntwort, setzeEin } from "../../tools/auftrag/einsatz.mjs";
import { probeRepository } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const KURZE_ANTWORT = 1000;
const FUELLUNG = "x".repeat(1500);
const ERSATZ_CLAUDE = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const eingabe = readFileSync(0, "utf8").trim();
console.log(JSON.stringify({ type: "result", result: eingabe + " ${FUELLUNG}", is_error: false }));
`;
const LESER = { agent: "leser", argumente: [], kontextGrenze: null };

function sitzungenMitErsatz(context) {
  const root = probeRepository(context, { "claude.mjs": ERSATZ_CLAUDE });
  chmodSync(join(root, "claude.mjs"), AUSFUEHRBAR);
  const vorher = process.env.HERMES_CLAUDE;
  process.env.HERMES_CLAUDE = join(root, "claude.mjs");
  context.after(() => {
    if (vorher === undefined) delete process.env.HERMES_CLAUDE;
    else process.env.HERMES_CLAUDE = vorher;
  });
  return (id, prompt) => setzeEin({ rolle: "leser", phase: { phase: "phase-v" }, auftrag: { id }, root }, prompt, LESER);
}

test("der erste Abruf liefert die volle Antwort, der zweite nur die gekürzte", (context) => {
  const sitzung = sitzungenMitErsatz(context);
  const lauf = sitzung("V1", "eins");
  assert.equal(lauf.antwort.length, KURZE_ANTWORT);
  assert.equal(entnimmVolleAntwort(lauf), `eins ${FUELLUNG}`);
  assert.equal(entnimmVolleAntwort(lauf), lauf.antwort);
});

test("nach einer Sitzung eines anderen Auftrags liefert auch eine frühere Sitzung ihre volle Antwort", (context) => {
  const sitzung = sitzungenMitErsatz(context);
  const frueher = sitzung("V2", "zwei");
  const spaeter = sitzung("V3", "drei");
  assert.equal(entnimmVolleAntwort(frueher), `zwei ${FUELLUNG}`);
  assert.equal(entnimmVolleAntwort(spaeter), `drei ${FUELLUNG}`);
});

test("eine zweite Sitzung desselben Auftrags lässt die volle Antwort der ersten bestehen", (context) => {
  const sitzung = sitzungenMitErsatz(context);
  const erste = sitzung("V4", "vier");
  const zweite = sitzung("V4", "fünf");
  assert.equal(entnimmVolleAntwort(erste), `vier ${FUELLUNG}`);
  assert.equal(entnimmVolleAntwort(zweite), `fünf ${FUELLUNG}`);
});
