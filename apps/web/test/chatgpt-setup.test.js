import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHATGPT_PLUGINS_URL, MCP_URL } from "../src/lib/agent-docs.js";
import { HOME_GERMAN } from "../src/lib/home-german.js";

const OFFIZIELL = "https://chatgpt.com/plugins";
// chatgpt.com/.well-known/apple-app-site-association: "/plugins" oeffnet sonst die ChatGPT-App,
// in der es kein "Add custom MCP server" gibt; dieses Fragment schliesst den Universal Link aus.
const IM_BROWSER = "#no_universal_links";
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

const EINSTIEGE_ZUR_KARTE = 2;
const SCHRITTE = 3;
const KURZE_BESCHREIBUNG = 110;

test("ChatGPT-Setup: der Plugins-Link ist die offizielle Adresse, bleibt im Browser und hat keine Parameter", () => {
  assert.equal(CHATGPT_PLUGINS_URL, OFFIZIELL + IM_BROWSER);
  assert.ok(!CHATGPT_PLUGINS_URL.includes("?"));
});

test("ChatGPT-Setup: die Karte sagt, dass ChatGPT im Browser einrichtet und nicht in jedem Tarif", () => {
  const texte = (key) => [ENGLISCH.find((e) => e.key === key).text, HOME_GERMAN[key]];
  const [descEn, descDe] = texte("opt1Desc");
  assert.match(descEn, /browser/i);
  assert.match(descEn, /not on every plan/i);
  assert.match(descDe, /Browser/);
  assert.match(descDe, /nicht in jedem Tarif/i);
});

test("ChatGPT-Setup: die Setup-Karte verlinkt Plugins in neuem Tab und kopiert weiter die Server-URL", () => {
  assert.match(KARTE, /href=\{CHATGPT_PLUGINS_URL\} target="_blank" rel="noopener noreferrer"/);
  assert.match(KARTE, /data-copy=\{MCP_URL\}/);
  assert.ok(MCP_URL.endsWith("/mcp"));
});

test("ChatGPT-Setup: Hero und Schluss fuehren zur selben Karte", () => {
  assert.equal(SEITE.match(/href="#chatgpt"/g).length, EINSTIEGE_ZUR_KARTE);
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
  assert.equal((KARTE.match(/<li data-i18n="opt1Step/g) || []).length, SCHRITTE);
  assert.equal(HOME_GERMAN.opt1Step4, undefined);
});

test("ChatGPT-Setup: die immer sichtbare Beschreibung ist kurz wie in den Nachbarkarten und nennt Plugins", () => {
  const englisch = ENGLISCH.find(({ key }) => key === "opt1Desc").text;
  for (const text of [englisch, HOME_GERMAN.opt1Desc]) {
    assert.ok(text.length <= KURZE_BESCHREIBUNG, `Beschreibung zu lang (${text.length} Zeichen): ${text}`);
    assert.match(text, /Plugins/);
  }
});

test("ChatGPT-Setup: kein Text verspricht Vorausfuellen oder Ein-Klick", () => {
  const alle = [KARTE, ...ENGLISCH.map(({ key }) => HOME_GERMAN[key])].join(" ");
  assert.doesNotMatch(alle, VERSPRECHEN);
});
