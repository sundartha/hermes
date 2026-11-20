import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const WIDGETS = await ausgelieferteWidgets();
const TOTE_SCHLUESSEL = ["Goal", "Outcome", "Goal reached", "Goal not reached"];

function woerterbuch(html) {
  const code = skriptbloecke(html).find((block) => block.includes("var WIDGET_DICT = "));
  return JSON.parse(code.match(/var WIDGET_DICT = (.*);\n/)[1]);
}

for (const [id, html] of Object.entries(WIDGETS)) {
  test(`Woerterbuch in ${id}: Goal, Outcome, Goal reached und Goal not reached fehlen in jeder Sprache`, () => {
    const dict = woerterbuch(html);
    assert.deepEqual(Object.keys(dict).sort(), ["de", "fr"]);
    for (const [sprache, tabelle] of Object.entries(dict)) {
      for (const schluessel of TOTE_SCHLUESSEL) {
        assert.equal(Object.hasOwn(tabelle, schluessel), false, `${id}/${sprache}: ${schluessel}`);
      }
    }
  });

  test(`Woerterbuch in ${id}: Result being evaluated bleibt mit seiner Uebersetzung`, () => {
    const dict = woerterbuch(html);
    assert.equal(dict.de["Result being evaluated"], "Wird ausgewertet");
    assert.equal(dict.fr["Result being evaluated"], "Évaluation en cours");
  });
}
