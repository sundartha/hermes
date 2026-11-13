import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { buildSite, removeBuild } from "./gebaute-seite.js";
import { HOME_GERMAN } from "../src/lib/home-german.js";

const ORIGIN = "https://sundartha.test";
const MCP_ENDE = "/mcp";
const KNOEPFE_IN_DER_REIHE = 2;
const SEITE = readFileSync(new URL("../src/pages/index.astro", import.meta.url), "utf8");
const KNOEPFE = SEITE.slice(
  SEITE.indexOf('class="obox obtns"', SEITE.indexOf('id="chatgpt"')),
  SEITE.indexOf('<div class="opt rv">', SEITE.indexOf('id="chatgpt"')),
);

let workDir;
let distDir;

before(() => {
  ({ workDir, distDir } = buildSite(".chatgpt-hinweis-", "dist"));
});

after(() => {
  removeBuild(workDir);
});

function shown(window, element) {
  for (let node = element; node; node = node.parentElement) {
    if (window.getComputedStyle(node).display === "none") return false;
  }
  return true;
}

async function openHome(clipboardWorks) {
  const window = new Window({
    url: `${ORIGIN}/`,
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
      },
      fetch: { virtualServers: [{ url: `${ORIGIN}/`, directory: distDir }] },
    },
  });
  const copied = [];
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text) => {
        copied.push(text);
        return clipboardWorks ? Promise.resolve() : Promise.reject(new Error("verweigert"));
      },
    },
  });
  window.document.execCommand = () => false;
  window.document.write(readFileSync(join(distDir, "index.html"), "utf8"));
  await window.happyDOM.waitUntilComplete();
  const doc = window.document;
  return {
    window,
    copied,
    link: doc.querySelector('#chatgpt a[data-copy-hint="chatgpt-hint"]'),
    url: doc.getElementById("chatgpt-url"),
    hint: doc.getElementById("chatgpt-hint"),
  };
}

test("ChatGPT-Setup: der ChatGPT-Knopf trägt die 2-Minuten-Beschriftung in EN und DE und sieht aus wie der Claude-Knopf", () => {
  const knoepfe = KNOEPFE.match(/<a href=\{(CLAUDE_CONNECT_URL|CHATGPT_PLUGINS_URL)\}[^>]*class="([^"]+)"/g) || [];
  assert.equal(knoepfe.length, KNOEPFE_IN_DER_REIHE, "Claude- und ChatGPT-Knopf fehlen");
  const klassen = knoepfe.map((tag) => tag.match(/class="([^"]+)"/)[1]);
  assert.deepEqual(klassen, ["opill pri", "opill pri"], "ChatGPT-Knopf hat nicht den Stil des Claude-Knopfs");
  assert.match(KNOEPFE, /data-i18n="chatgptOpen">ChatGPT – Setup in 2 minutes</);
  assert.equal(HOME_GERMAN.chatgptOpen, "ChatGPT – in 2 Minuten eingerichtet");
});

test("ChatGPT-Setup: der Hinweis nach dem Kopieren nennt die nächsten Schritte in EN und DE", () => {
  const [, englisch] = KNOEPFE.match(/data-i18n="chatgptHint">([^<]+)</) || [];
  assert.equal(englisch, "URL copied – in ChatGPT choose + → Add custom MCP server, paste, create and connect");
  assert.equal(HOME_GERMAN.chatgptHint, "URL kopiert – in ChatGPT auf + → Add custom MCP server, einfügen, anlegen und verbinden");
});

test("ChatGPT-Setup: Klick mit funktionierender Zwischenablage kopiert die URL und zeigt den Hinweis statt der URL-Zeile", async () => {
  const { window, copied, link, url, hint } = await openHome(true);
  try {
    assert.ok(link && url && hint, "ChatGPT-Knopf, URL-Zeile oder Hinweis fehlt");
    assert.equal(shown(window, hint), false, "Hinweis ist schon vor dem Klick sichtbar");
    assert.equal(shown(window, url), true, "URL-Zeile ist vor dem Klick nicht sichtbar");
    link.click();
    await window.happyDOM.waitUntilComplete();
    assert.equal(copied.length, 1);
    assert.ok(copied[0].endsWith(MCP_ENDE), "kopiert wird nicht die MCP-URL");
    assert.equal(shown(window, hint), true, "Hinweis erscheint nach dem Kopieren nicht");
    assert.equal(shown(window, url), false, "URL-Zeile bleibt neben dem Hinweis stehen");
    assert.equal(link.getAttribute("aria-describedby"), "chatgpt-hint");
  } finally {
    await window.happyDOM.close();
  }
});

test("ChatGPT-Setup: scheitert das Kopieren, erscheint kein Kopiert-Hinweis und die URL bleibt zum Markieren sichtbar", async () => {
  const { window, link, url, hint } = await openHome(false);
  try {
    link.click();
    await window.happyDOM.waitUntilComplete();
    assert.equal(shown(window, hint), false, "Hinweis behauptet ein Kopieren, das nicht geklappt hat");
    assert.equal(shown(window, url), true, "URL-Zeile verschwindet trotz gescheitertem Kopieren");
  } finally {
    await window.happyDOM.close();
  }
});
