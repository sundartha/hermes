import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { HOME_GERMAN } from "../src/lib/home-german.js";
import { VOICE_SCRIPT } from "../src/lib/home-voice.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGE = readFileSync(join(WEB_ROOT, "src/pages/index.astro"), "utf8");
const SPOKEN_LINES = VOICE_SCRIPT.uc2.en.map((line) => line.text);
const SPOKEN = SPOKEN_LINES.join(" ");

const englishNote = (key) =>
  PAGE.match(new RegExp(`noteKey: "${key}", note: "([^"]*)"`))?.[1] ?? "";
const englishFilm = PAGE.match(/videoKey: "uc2Video",\s*video:\s*"([^"]*)"/)?.[1] ?? "";
const germanScene = (keys) => keys.map((key) => HOME_GERMAN[key]).join(" ");

test("Szene II: die Anfrage nennt denselben Zeitraum wie der Ton", () => {
  assert.match(SPOKEN, /next week/, "Ton nennt keinen Zeitraum mehr");
  assert.match(englishNote("uc2s1n"), /next week/);
  assert.match(HOME_GERMAN.uc2s1n, /nächste Woche/);
  assert.doesNotMatch(
    `${englishNote("uc2s1n")} ${englishNote("uc2s2n")} ${englishFilm}`,
    /this week/,
  );
  assert.doesNotMatch(germanScene(["uc2s1n", "uc2s2n", "uc2Video"]), /diese Woche/);
});

test("Szene II: der Kalender-Schritt nennt den Grund aus dem Film und den aus dem Ton", () => {
  assert.match(
    SPOKEN,
    /Thursday morning is taken/,
    "Ton begründet nicht mehr mit dem Donnerstagvormittag",
  );
  assert.match(englishNote("uc2s2n"), /Wednesday/);
  assert.match(englishNote("uc2s2n"), /Thursday morning/);
  assert.match(englishNote("uc2s2n"), /14:30/);
  assert.match(HOME_GERMAN.uc2s2n, /Mittwoch/);
  assert.match(HOME_GERMAN.uc2s2n, /Donnerstagvormittag/);
  assert.match(HOME_GERMAN.uc2s2n, /14:30/);
});

test("Szene II: die Bildbeschreibung erzählt denselben Ablauf wie Film und Ton", () => {
  for (const part of [/next week/, /Wednesday/, /Thursday morning/, /14:30/])
    assert.match(englishFilm, part);
  for (const part of [/nächsten Woche/, /Mittwoch/, /Donnerstagvormittag/, /14:30/])
    assert.match(HOME_GERMAN.uc2Video, part);
});
