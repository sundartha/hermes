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
    /<span class="olbl">ChatGPT<\/span>/,
    "Beschriftung ist nicht nur „ChatGPT“ oder kann die Kopier-Rückmeldung nicht zeigen",
  );
  assert.equal(HOME_GERMAN.chatgptOpen, undefined, "die alte 2-Minuten-Beschriftung steht noch im Wörterbuch");
});

test("ChatGPT-Setup: die Server-URL liegt als markierbarer Ersatz bereit, verborgen bis das Kopieren scheitert", () => {
  const zeile = KNOEPFE.match(
    /<p class="ourl" id="chatgpt-url" hidden><span data-i18n="chatgptUrl">([^<]+)<\/span> <code>\{MCP_URL\}<\/code><\/p>/,
  );
  assert.ok(zeile, "verborgene URL-Zeile fehlt");
  const [link] = KNOEPFE.match(/<a href=\{CHATGPT_PLUGINS_URL\}[^>]*>/) || [];
  assert.match(link || "", /data-copy-fail="chatgpt-url"/, "der Link zeigt bei gescheitertem Kopieren nicht die URL-Zeile");
  assert.match(declsOf(".ourl code"), /user-select: all/, "URL lässt sich nicht mit einem Tipp markieren");
  assert.match(declsOf(".ourl"), /flex: 1 0 100%/, "URL-Zeile teilt sich die Reihe mit den Knöpfen");
});

test("ChatGPT-Setup: dass der Klick die URL kopiert, sagt der Link Screenreadern, nicht als Text unter dem Knopf", () => {
  const [, englisch] = KNOEPFE.match(/<span class="sr" data-i18n="chatgptCopies">([^<]+)</) || [];
  assert.match(englisch || "", /copies the Hermes URL/, "EN kündigt das Kopieren nicht an");
  assert.match(HOME_GERMAN.chatgptCopies || "", /kopiert die Hermes-URL/, "DE kündigt das Kopieren nicht an");
  const [, ersatzEn] = KNOEPFE.match(/data-i18n="chatgptUrl">([^<]+)</) || [];
  assert.match(ersatzEn || "", /by hand/, "EN-Ersatzzeile sagt nicht, dass von Hand kopiert werden muss");
  assert.match(HOME_GERMAN.chatgptUrl || "", /von Hand/, "DE-Ersatzzeile sagt nicht, dass von Hand kopiert werden muss");
});
