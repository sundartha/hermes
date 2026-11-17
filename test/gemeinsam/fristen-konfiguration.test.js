import { test } from "node:test";
import assert from "node:assert/strict";
import { gebauteKonfiguration } from "./gebaute-konfiguration.js";

const FELDER = ["safety.fristenTaktMs", "safety.fristenLimitJeMandant"];
function pruefe(env, takt, limit) {
  const gebaut = gebauteKonfiguration(env, FELDER);
  assert.deepEqual(gebaut, { "safety.fristenTaktMs": takt, "safety.fristenLimitJeMandant": limit });
}

test("Fristen-Einstellungen: ohne Angabe gelten Takt 15000 ms und Limit 20", () => {
  pruefe({}, 15000, 20);
});

test("Fristen-Einstellungen: kleinste Werte 1 und 1 werden uebernommen", () => {
  pruefe({ FRISTEN_TAKT_MS: "1", FRISTEN_LIMIT_JE_MANDANT: "1" }, 1, 1);
});

test("Fristen-Einstellungen: ein Wert im Bereich wird uebernommen", () => {
  pruefe({ FRISTEN_TAKT_MS: "5000", FRISTEN_LIMIT_JE_MANDANT: "5" }, 5000, 5);
});

test("Fristen-Einstellungen: 0 unterschreitet das Minimum, es gelten die Standardwerte", () => {
  pruefe({ FRISTEN_TAKT_MS: "0", FRISTEN_LIMIT_JE_MANDANT: "0" }, 15000, 20);
});

test("Fristen-Einstellungen: ein Takt ueber 15000 ms und ein Limit ueber 1000 werden gekappt", () => {
  pruefe({ FRISTEN_TAKT_MS: "15001", FRISTEN_LIMIT_JE_MANDANT: "1001" }, 15000, 1000);
});

test("Fristen-Einstellungen: genau 15000 ms und genau 1000 gelten unveraendert", () => {
  pruefe({ FRISTEN_TAKT_MS: "15000", FRISTEN_LIMIT_JE_MANDANT: "1000" }, 15000, 1000);
});
