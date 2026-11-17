import assert from "node:assert/strict";
import { test } from "node:test";

import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";

const LISTE = (await ausgelieferteWidgets()).calls;
const ANRUFE = 20;
const MIN_ZEILENHOEHE_PX = 14 + 22 + 14;

function regelWerte(selektor) {
  const css = [...LISTE.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const start = css.indexOf(selektor + "{");
  assert.notEqual(start, -1, "Regel " + selektor + " fehlt");
  return Object.fromEntries(
    css
      .slice(start + selektor.length + 1, css.indexOf("}", start))
      .split(";")
      .filter(Boolean)
      .map((e) => [e.slice(0, e.indexOf(":")).trim(), e.slice(e.indexOf(":") + 1).trim()]),
  );
}

test("widget-anrufliste-hoehe: die Liste mit 20 Anrufen hat eine feste Obergrenze und scrollt intern", () => {
  const liste = regelWerte(".liste");
  assert.match(liste["max-height"] ?? "", /^\d+px$/);
  const grenze = parseInt(liste["max-height"], 10);
  assert.ok(grenze < ANRUFE * MIN_ZEILENHOEHE_PX, "20 Anrufe sprengen die Obergrenze " + grenze + " px nicht");
  assert.ok(grenze >= 3 * MIN_ZEILENHOEHE_PX, "die Obergrenze zeigt mindestens drei Anrufe");
  assert.equal(liste["overflow-y"], "auto");
  assert.equal(liste["box-sizing"], "border-box");
});
