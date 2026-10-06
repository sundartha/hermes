import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PROMPT, codeTokens, typeableLength, typedSplit } from "../src/lib/mobile-code.js";
import { MCP_CMD, MCP_URL } from "../src/lib/agent-docs.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(WEB_ROOT, path), "utf8");
const kinds = (line) => line.map((token) => `${token.kind}:${token.en}`);

test("Code-Feld: Terminal-Befehl mit Prompt, Flag samt Wert und URL farbig", () => {
  const [line] = codeTokens(MCP_CMD, { prompt: true });
  assert.deepEqual(kinds(line), [
    `p:${PROMPT}`,
    "n:claude ",
    "n:mcp ",
    "n:add ",
    "f:--transport ",
    "f:http ",
    "n:hermes ",
    `u:${MCP_URL}`,
  ]);
  assert.equal(line.map((token) => token.en).join(""), `${PROMPT}${MCP_CMD}`);
});

test("Code-Feld: eine reine URL bleibt ein Stueck (wie im Prototyp)", () => {
  assert.deepEqual(kinds(codeTokens(MCP_URL)[0]), [`n:${MCP_URL}`]);
});

test("Tippen: stehender Teil, transparenter Rest und Cursor", () => {
  const texts = ["claude ", "--transport "];
  const total = texts[0].length + texts[1].length;
  const intoFlag = texts[0].length + "--".length;
  assert.equal(typeableLength(texts), total);
  const start = typedSplit(texts, 0);
  assert.equal(start.caret, 0);
  assert.deepEqual(start.parts[0], { on: "", off: "claude " });

  const middle = typedSplit(texts, intoFlag);
  assert.equal(middle.caret, 1);
  assert.deepEqual(middle.parts[0], { on: "claude ", off: "" });
  assert.deepEqual(middle.parts[1], { on: "--", off: "transport " });

  const done = typedSplit(texts, total);
  assert.equal(done.caret, -1);
  assert.equal(done.parts.map((part) => part.on).join(""), texts.join(""));
});

test("Handy v9: Glaskapsel im Kopf, eine weisse Pille je Screen, Footer in zwei Zeilen", () => {
  const markup = read("src/components/MobileHome.astro");
  assert.match(markup, /class="mh-cap"/, "Header-Kapsel fehlt");
  assert.doesNotMatch(markup, /mh-pill--ghost/, "Start traegt wieder eine zweite Pille");
  assert.match(markup, /class="mh-how-link"/, '"How it works" als Textbutton fehlt');
  assert.match(markup, /class="mh-links__row"/, "Footer-Zeilen fehlen");
  assert.match(markup, /mh-fog__layer--back/, "ziehende Wolken fehlen");
});

test("Handy v9: reduzierte Bewegung schaltet Wolken, Tropfen und Kamerafahrt ab", () => {
  const css = read("src/styles/hermes-mobile-motion.css");
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(block.length > 0, "Block fuer reduzierte Bewegung fehlt");
  assert.match(block, /\.mh-clouds \{\s*transform: none;/);
  assert.match(block, /\.mh-fog,\s*\.mh-drop,\s*\.mh-bloom \{\s*display: none;/);
});
