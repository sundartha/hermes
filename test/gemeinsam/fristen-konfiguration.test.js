import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { kindUmgebung } from "./kind-umgebung.mjs";
import { BASE_ENV, ROOT } from "../helpers.js";

const SKRIPT = [
  'import("./src/config.ts").then(({ fristenEinstellungen }) =>',
  "  process.stdout.write(JSON.stringify(fristenEinstellungen)));",
].join("\n");

function pruefe(env, takt, limit) {
  const ausgabe = execFileSync(process.execPath, ["--input-type=module", "-e", SKRIPT], {
    cwd: ROOT,
    env: kindUmgebung({ ...BASE_ENV, NODE_ENV: "test", ...env }),
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(ausgabe), { fristenTaktMs: takt, fristenLimitJeMandant: limit });
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

const GELD_WACHE_FALLE = [
  ["Geld-Wache schneller als der Takt", { BUDGET_WATCHDOG_INTERVAL_MS: "5000" }, 5000],
  ["Geld-Wache gleich dem Takt", { BUDGET_WATCHDOG_INTERVAL_MS: "15000" }, 15000],
  ["Geld-Wache langsamer als der Takt", { BUDGET_WATCHDOG_INTERVAL_MS: "20000" }, 15000],
  ["Geld-Wache aus (0): eingestellter Takt", { BUDGET_WATCHDOG_INTERVAL_MS: "0", FRISTEN_TAKT_MS: "9000" }, 9000],
  ["Geld-Wache aus (0): Standardtakt", { BUDGET_WATCHDOG_INTERVAL_MS: "0" }, 15000],
  ["Takt kleiner als die Geld-Wache", { BUDGET_WATCHDOG_INTERVAL_MS: "5000", FRISTEN_TAKT_MS: "3000" }, 3000],
  ["Geld-Wache 1 ms", { BUDGET_WATCHDOG_INTERVAL_MS: "1" }, 1],
];

for (const [name, env, takt] of GELD_WACHE_FALLE) {
  test(`Fristen-Takt an Geld-Wache gebunden: ${name}`, () => {
    pruefe(env, takt, 20);
  });
}
