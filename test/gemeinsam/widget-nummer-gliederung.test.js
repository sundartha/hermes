import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const WIDGETS = await ausgelieferteWidgets();
const SKRIPT = skriptbloecke(WIDGETS.call).find((s) => s.includes("function groupNumber"));
const FUNKTION = /function groupNumber\(raw\) \{[\s\S]*?\n    \}/.exec(SKRIPT)[0];
const gliedere = vm.runInNewContext("(" + FUNKTION + ")");

const TABELLE = [
  ["Berlin", "+493012345678", "+49 30 12345678"],
  ["Hamburg", "+49401234567", "+49 40 1234567"],
  ["Frankfurt", "+496912345678", "+49 69 12345678"],
  ["Muenchen", "+498912345678", "+49 89 12345678"],
  ["Mobil 151", "+4915112345678", "+49 151 12345678"],
  ["Mobil 160", "+4916012345678", "+49 160 12345678"],
  ["Mobil 179", "+4917912345678", "+49 179 12345678"],
  ["Koeln, Vorwahllaenge unbekannt", "+492211234567", "+492211234567"],
  ["Nummer ohne Rest nach der Vorwahl", "+4930123", "+4930123"],
  ["Ausland", "+14155550123", "+14155550123"],
  ["Oesterreich", "+43151234567", "+43151234567"],
];

for (const [name, roh, erwartet] of TABELLE) {
  test("widget-nummer-gliederung: " + name + " erscheint als " + erwartet, () => {
    assert.equal(gliedere(roh), erwartet);
  });
}
