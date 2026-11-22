import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const karte = JSON.parse(readFileSync(resolve(WURZEL, "tools/bausteine.json"), "utf8"));

const EINGANG_MIT_EINZIGEM_IMPORTEUR_INNERHALB_ELEVENLABS = "src/elevenlabs/convai.ts";
const GESPERRTE_ADAPTER = [
  "src/elevenlabs/outbound.js",
  "src/elevenlabs/outbound-vorspann.js",
  "src/elevenlabs/nummern-registrierung.ts",
];

const alleEingaenge = karte.bausteine.flatMap((baustein) =>
  Array.isArray(baustein.eingaenge) ? baustein.eingaenge.map((datei) => ({ baustein: baustein.baustein, datei })) : [],
);

test("Kein Eingang der Karte ist outbound.js", () => {
  assert.deepEqual(alleEingaenge.filter((e) => e.datei === GESPERRTE_ADAPTER[0]), []);
});

test("Kein Eingang der Karte ist outbound-vorspann.js", () => {
  assert.deepEqual(alleEingaenge.filter((e) => e.datei === GESPERRTE_ADAPTER[1]), []);
});

test("Kein Eingang der Karte ist nummern-registrierung.js", () => {
  assert.deepEqual(alleEingaenge.filter((e) => e.datei === GESPERRTE_ADAPTER[2]), []);
});

test("anrufe behält registry.ts als Eingang", () => {
  const anrufe = karte.bausteine.find((baustein) => baustein.baustein === "anrufe");
  assert.ok(anrufe.eingaenge.includes("src/elevenlabs/registry.ts"));
});

test("anrufe führt convai.ts nicht mehr als Eingang, weil elevenlabs-nur-ueber-port ihn außerhalb von src/elevenlabs/ sperrt", () => {
  const anrufe = karte.bausteine.find((baustein) => baustein.baustein === "anrufe");
  assert.equal(anrufe.eingaenge.includes(EINGANG_MIT_EINZIGEM_IMPORTEUR_INNERHALB_ELEVENLABS), false);
});
