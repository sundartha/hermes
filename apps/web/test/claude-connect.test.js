import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_ADMIN_CONNECT_URL, CLAUDE_CONNECT_URL, MCP_URL } from "../src/lib/agent-docs.js";

const USER_URL =
  "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Hermes&connectorUrl=https%3A%2F%2Fapp.sundartha.com%2Fmcp";
const ADMIN_URL =
  "https://claude.ai/admin-settings/connectors?modal=add-custom-connector&connectorName=Hermes&connectorUrl=https%3A%2F%2Fapp.sundartha.com%2Fmcp";

const COPY = {
  en: {
    btn: "Add to Claude",
    hint: "Opens Claude with Hermes already filled in — just click “Add”.",
    admin: "Team or Enterprise admin? Add it for everyone",
    copyUrl: "For ChatGPT & others: copy URL",
    newTab: " (opens in new tab)",
    mobileCopyUrl: "Copy URL",
  },
  de: {
    btn: "Mit Claude verbinden",
    hint: "Öffnet Claude mit Hermes schon eingetragen – du klickst nur noch auf „Hinzufügen“.",
    admin: "Team- oder Enterprise-Admin? Für alle hinzufügen",
    copyUrl: "Für ChatGPT & andere: URL kopieren",
    newTab: " (öffnet in neuem Tab)",
    mobileCopyUrl: "URL kopieren",
  },
};

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

function readSrc(relativePath) {
  return readFileSync(join(WEB_ROOT, "src", relativePath), "utf8");
}

function between(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `Marker fehlt: ${from}`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `Marker fehlt: ${to}`);
  return source.slice(start, end);
}

test("Konstanten: Nutzer- und Admin-Link, MCP_URL als einzige Quelle", () => {
  assert.equal(CLAUDE_CONNECT_URL, USER_URL);
  assert.equal(CLAUDE_ADMIN_CONNECT_URL, ADMIN_URL);
  for (const [url, page] of [
    [CLAUDE_CONNECT_URL, "customize"],
    [CLAUDE_ADMIN_CONNECT_URL, "admin-settings"],
  ]) {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, `https://claude.ai/${page}/connectors`);
    assert.equal(parsed.searchParams.get("modal"), "add-custom-connector");
    assert.equal(parsed.searchParams.get("connectorName"), "Hermes");
    assert.equal(parsed.searchParams.get("connectorUrl"), MCP_URL);
  }
});

test("ConnectClaude.astro: echte Links mit target=_blank, noopener, ohne Handler, EN+DE-Copy", () => {
  const source = readSrc("components/ConnectClaude.astro");
  for (const url of ["CLAUDE_CONNECT_URL", "CLAUDE_ADMIN_CONNECT_URL"]) {
    assert.match(
      source,
      new RegExp(`<a [^>]*href=\\{${url}\\} target="_blank" rel="noopener noreferrer"`),
      `${url}: <a> mit target=_blank und rel=noopener noreferrer fehlt`,
    );
  }
  assert.ok(!/\son[a-z]+=|\sstyle=/i.test(source), "Inline-Handler oder style (CSP)");
  for (const language of ["en", "de"]) {
    const { btn, hint, admin, newTab } = COPY[language];
    for (const text of [btn, hint, admin, newTab]) {
      assert.ok(source.includes(`"${text}"`), `${language}: Copy fehlt oder weicht ab: ${text}`);
    }
  }
  assert.ok(!/cursor:\/\/|vscode:mcp|Add to Cursor/.test(source), "Cursor/VS Code auf der Startseite");
});

test("index.astro: Knopf in Desktop-Karte, Tablet-Liste und Querformat-Blatt, nie im Fenster", () => {
  const index = readSrc("pages/index.astro");
  const card = between(index, 'data-dev-card="a"', 'data-dev-card="b"');
  const list = between(index, '<div class="dev-list">', "devFootnote");
  const sheet = between(index, 'data-sheet="dev"', "devFootnote");
  for (const [where, part] of [["Desktop-Karte", card], ["Tablet-Liste", list], ["Blatt", sheet]]) {
    assert.equal(part.split("<ConnectClaude />").length - 1, 1, `${where}: genau ein <ConnectClaude />`);
  }
  for (const part of [card, sheet]) {
    const windowBlock = between(part, '<span class="dev-window">', "<ConnectClaude");
    assert.ok(
      windowBlock.trimEnd().endsWith("</span>") && !windowBlock.includes("connect-cta"),
      "Knopf steht innerhalb der animierten Fenster-Attrappe",
    );
  }
  assert.ok(!index.includes("dev-connect"), "Attrappen-Knopf 'Connect' ist zurueck");
});

test("HowtoSteps.astro: Schritt 2 traegt den Knopf, Schritt 1 und 3 nicht", () => {
  const source = readSrc("components/HowtoSteps.astro");
  assert.match(source, /\{i === 1 && <ConnectClaude lang=\{lang\} compact \/>\}/);
  assert.equal(source.split("<ConnectClaude").length - 1, 1);
});

test("MobileHome.astro: Links im Entwickler-Screen, EN im Markup, DE je Knoten", () => {
  const source = readSrc("components/MobileHome.astro");
  const dev = between(source, 'class="mh-screen mh-s-content mh-dev"', "Screen 5");
  const newTab = '<span class="mh-sr" data-mh-de=\\{T\\.de\\.newTab\\}>\\{T\\.en\\.newTab\\}<\\/span><\\/a>';
  assert.match(dev, new RegExp('<a class="mh-pill mh-connect__btn" href=\\{CLAUDE_CONNECT_URL\\} target="_blank" rel="noopener noreferrer"><span data-mh-de=\\{T\\.de\\.connect\\}>\\{T\\.en\\.connect\\}<\\/span>' + newTab));
  assert.match(dev, new RegExp('<a class="mh-connect__admin" href=\\{CLAUDE_ADMIN_CONNECT_URL\\} target="_blank" rel="noopener noreferrer"><span data-mh-de=\\{T\\.de\\.connectAdmin\\}>\\{T\\.en\\.connectAdmin\\}<\\/span>' + newTab));
  assert.match(dev, /mh-copy__label--url" data-mh-de=\{T\.de\.copyUrl\}>\{T\.en\.copyUrl\}</);
  assert.match(dev, /<p class="mh-connect__hint" data-mh-de=\{T\.de\.connectHint\}>\{T\.en\.connectHint\}<\/p>/);
  for (const [key, field] of [
    ["connect", "btn"],
    ["connectHint", "hint"],
    ["connectAdmin", "admin"],
    ["newTab", "newTab"],
    ["copyUrl", "mobileCopyUrl"],
  ]) {
    for (const language of ["en", "de"]) {
      assert.ok(
        source.includes(`    ${key}: "${COPY[language][field]}",`),
        `Handy T.${language}.${key} fehlt oder weicht ab`,
      );
    }
  }
  assert.ok(!/\sstyle=/.test(dev), "style-Attribut im Handy-Markup (CSP)");
});

test("DE-Woerterbuch (hermes-scroll.js) kennt alle neuen Keys wortgleich", () => {
  const source = readSrc("scripts/hermes-scroll.js");
  const expected = {
    connectBtn: COPY.de.btn,
    connectHint: COPY.de.hint,
    connectAdmin: COPY.de.admin,
    connectNewTab: COPY.de.newTab,
    copyUrlLabel: COPY.de.copyUrl.replace("&", "&amp;"),
  };
  for (const [key, text] of Object.entries(expected)) {
    assert.ok(source.includes(`  ${key}: "${text}",`), `DE-Woerterbuch: ${key} fehlt oder weicht ab`);
  }
  assert.ok(!source.includes("devConnectBtn"), "Schluessel der entfernten Attrappe lebt noch");
});
