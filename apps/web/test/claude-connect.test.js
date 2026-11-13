import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_ADMIN_CONNECT_URL, CLAUDE_CONNECT_URL, MCP_URL } from "../src/lib/agent-docs.js";
import { HOME_GERMAN } from "../src/lib/home-german.js";

const USER_URL =
  "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Hermes&connectorUrl=https%3A%2F%2Fapp.sundartha.com%2Fmcp";
const ADMIN_URL =
  "https://claude.ai/admin-settings/connectors?modal=add-custom-connector&connectorName=Hermes&connectorUrl=https%3A%2F%2Fapp.sundartha.com%2Fmcp";

const COPY = {
  en: {
    btn: "Add to Claude",
    newTab: " (opens in new tab)",
  },
  de: {
    btn: "Mit Claude verbinden",
    newTab: " (öffnet in neuem Tab)",
  },
};

const CLAUDE_LINK_COUNT = 3;

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

function readSrc(relativePath) {
  return readFileSync(join(WEB_ROOT, "src", relativePath), "utf8");
}

const FRONTMATTER_FENCE = "---";
const FRONTMATTER_CLOSE = `\n${FRONTMATTER_FENCE}`;

function markupOf(source) {
  const end = source.indexOf(FRONTMATTER_CLOSE, source.indexOf(FRONTMATTER_FENCE) + FRONTMATTER_FENCE.length);
  assert.ok(end > 0, "Frontmatter-Ende fehlt");
  return source.slice(end + FRONTMATTER_CLOSE.length);
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

test("index.astro: Claude-Links echt mit target=_blank, noopener, ohne Handler, EN-Copy", () => {
  const markup = markupOf(readSrc("pages/index.astro"));
  const links = [...markup.matchAll(/<a [^>]*href=\{CLAUDE_CONNECT_URL\}[^>]*>/g)].map(([link]) => link);
  assert.equal(links.length, CLAUDE_LINK_COUNT, "Hero, Setup und Abschluss: je ein Claude-Link");
  for (const link of links) {
    assert.match(
      link,
      /^<a href=\{CLAUDE_CONNECT_URL\} target="_blank" rel="noopener noreferrer"[ >]/,
      `${link}: target=_blank und rel=noopener noreferrer fehlen`,
    );
  }
  assert.ok(!/\son[a-z]+=|\sstyle=/i.test(markup), "Inline-Handler oder style (CSP)");
  const { btn, newTab } = COPY.en;
  assert.ok(markup.includes(`data-i18n="addClaude">${btn}<`), `EN-Copy fehlt oder weicht ab: ${btn}`);
  assert.ok(markup.includes(`data-i18n="newTab">${newTab}<`), `EN-Copy fehlt oder weicht ab: ${newTab}`);
  assert.ok(!/cursor:\/\/|vscode:mcp|Add to Cursor/.test(markup), "Cursor/VS Code auf der Startseite");
});

test("DE-Woerterbuch (home.js) kennt die Claude-Keys wortgleich", () => {
  const expected = {
    addClaude: COPY.de.btn,
    newTab: COPY.de.newTab,
  };
  for (const [key, text] of Object.entries(expected)) {
    assert.equal(HOME_GERMAN[key], text, `DE-Woerterbuch: ${key} fehlt oder weicht ab`);
  }
});
