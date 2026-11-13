import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HOME_GERMAN } from "../src/lib/home-german.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const SEITE = read("../src/pages/index.astro");
const CSS = read("../src/styles/home.css");
const KARTE = SEITE.slice(
  SEITE.indexOf('id="chatgpt"'),
  SEITE.indexOf('<div class="opt rv">', SEITE.indexOf('id="chatgpt"')),
);
const KNOEPFE = KARTE.slice(KARTE.indexOf('class="obox obtns"'));
const LINKS_IN_DER_KARTE = 2;

function declsOf(selector) {
  const start = CSS.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `${selector} fehlt im Stylesheet`);
  return CSS.slice(start, CSS.indexOf("}", start));
}

test("ChatGPT-Setup: kein eigener Kopier-Knopf mehr, nur der Claude- und der ChatGPT-Link", () => {
  assert.doesNotMatch(KNOEPFE, /<button\b/, "in der Knopfreihe steht noch ein Knopf");
  assert.equal((KNOEPFE.match(/<a /g) || []).length, LINKS_IN_DER_KARTE);
  assert.doesNotMatch(
    SEITE,
    /chatgptCopy|copy URL/,
    "der alte Kopier-Text steht noch auf der Seite",
  );
  assert.equal(HOME_GERMAN.chatgptCopy, undefined, "der alte Kopier-Text steht noch im Wörterbuch");
});

test("ChatGPT-Setup: der eine ChatGPT-Link öffnet Plugins im neuen Tab und kopiert dabei die Server-URL", () => {
  const [link] = KNOEPFE.match(/<a href=\{CHATGPT_PLUGINS_URL\}[^>]*>/) || [];
  assert.ok(link, "ChatGPT-Link fehlt in der Knopfreihe");
  assert.match(link, /target="_blank" rel="noopener noreferrer"/);
  assert.match(link, /data-copy=\{MCP_URL\}/, "der Link kopiert die Server-URL nicht");
  assert.match(
    KNOEPFE,
    /<span class="olbl" data-i18n="chatgptOpen">Open ChatGPT Plugins<\/span>/,
    "Beschriftung fehlt oder kann die Kopier-Rückmeldung nicht zeigen",
  );
  assert.equal(HOME_GERMAN.chatgptOpen, "ChatGPT-Plugins öffnen");
});

test("ChatGPT-Setup: die Server-URL steht als sichtbarer, markierbarer Text in der Karte", () => {
  const zeile = KNOEPFE.match(
    /<p class="ourl"><span data-i18n="chatgptUrl">([^<]+)<\/span> <code>\{MCP_URL\}<\/code><\/p>/,
  );
  assert.ok(zeile, "URL-Zeile fehlt");
  assert.match(zeile[1], /URL/);
  assert.match(HOME_GERMAN.chatgptUrl || "", /URL/, "deutsche Beschriftung der URL-Zeile fehlt");
  assert.match(
    declsOf(".ourl code"),
    /user-select: all/,
    "URL lässt sich nicht mit einem Tipp markieren",
  );
  assert.match(
    declsOf(".ourl"),
    /flex: 1 0 100%/,
    "URL-Zeile teilt sich die Reihe mit den Knöpfen",
  );
});
