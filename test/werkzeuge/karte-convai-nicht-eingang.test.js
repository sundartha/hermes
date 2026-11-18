import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const karte = JSON.parse(readFileSync(resolve(WURZEL, "tools/bausteine.json"), "utf8"));

test("Kein Baustein der Karte führt convai.ts als Eingang", () => {
  const treffer = karte.bausteine
    .filter((baustein) => Array.isArray(baustein.eingaenge) && baustein.eingaenge.includes("src/elevenlabs/convai.ts"))
    .map((baustein) => baustein.baustein);
  assert.deepEqual(treffer, []);
});
