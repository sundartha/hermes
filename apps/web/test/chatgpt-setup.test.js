import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHATGPT_PLUGINS_URL, MCP_URL } from "../src/lib/agent-docs.js";
import { HOME_GERMAN } from "../src/lib/home-german.js";

const OFFIZIELL = "https://chatgpt.com/plugins";
const SEITE = readFileSync(
  fileURLToPath(new URL("../src/pages/index.astro", import.meta.url)),
  "utf8",
);
const KARTE = SEITE.slice(
  SEITE.indexOf('id="chatgpt"'),
  SEITE.indexOf('<div class="opt rv">', SEITE.indexOf('id="chatgpt"')),
);
const ENGLISCH = [...KARTE.matchAll(/data-i18n="(opt1\w+|chatgpt\w+)">([^<]+)</g)].map(
  ([, key, text]) => ({ key, text }),
);
const VERSPRECHEN =
  /prefill|pre-fill|vorausgef|one[- ]click|ein[- ]klick|automatisch verbunden|already connected/i;

test("ChatGPT-Setup: der Plugins-Link ist die offiziell dokumentierte Adresse ohne Parameter", () => {
  assert.equal(CHATGPT_PLUGINS_URL, OFFIZIELL);
  assert.ok(!CHATGPT_PLUGINS_URL.includes("?"));
});

test("ChatGPT-Setup: die Setup-Karte verlinkt Plugins in neuem Tab und kopiert weiter die Server-URL", () => {
  assert.match(KARTE, /href=\{CHATGPT_PLUGINS_URL\} target="_blank" rel="noopener noreferrer"/);
  assert.match(KARTE, /data-copy=\{MCP_URL\}/);
  assert.ok(MCP_URL.endsWith("/mcp"));
});

test("ChatGPT-Setup: Hero und Schluss fuehren zur selben Karte", () => {
  assert.equal(SEITE.match(/href="#chatgpt"/g).length, 2);
  assert.ok(SEITE.indexOf('id="setup"') < SEITE.indexOf('id="chatgpt"'));
});

test("ChatGPT-Setup: die Schritte folgen dem offiziellen Ablauf in Deutsch und Englisch", () => {
  const englisch = ENGLISCH.map(({ text }) => text).join(" ");
  const deutsch = ENGLISCH.map(({ key }) => HOME_GERMAN[key]).join(" ");
  for (const text of [englisch, deutsch]) {
    assert.match(text, /Plugins/);
    assert.match(text, /Add custom MCP server/);
    assert.match(text, /Hermes/);
  }
  for (const { key } of ENGLISCH) assert.ok(HOME_GERMAN[key], `DE fehlt fuer ${key}`);
});

test("ChatGPT-Setup: genau drei Schritte, passend zu den festen Zeilen des Mobil-Rasters", () => {
  assert.equal((KARTE.match(/<li data-i18n="opt1Step/g) || []).length, 3);
  assert.equal(HOME_GERMAN.opt1Step4, undefined);
});

test("ChatGPT-Setup: die immer sichtbare Beschreibung nennt den ganzen offiziellen Weg samt Tarif und Workspace", () => {
  const englisch = ENGLISCH.find(({ key }) => key === "opt1Desc").text;
  for (const text of [englisch, HOME_GERMAN.opt1Desc]) {
    assert.match(text, /Plugins/);
    assert.match(text, /Add custom MCP server/);
    assert.match(text, /Connection/);
    assert.match(text, /Admin/i);
  }
});

test("ChatGPT-Setup: kein Text verspricht Vorausfuellen oder Ein-Klick", () => {
  const alle = [KARTE, ...ENGLISCH.map(({ key }) => HOME_GERMAN[key])].join(" ");
  assert.doesNotMatch(alle, VERSPRECHEN);
});
