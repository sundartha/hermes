import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CSS = readFileSync(join(WEB_ROOT, "src/styles/home-sound.css"), "utf8");

const MAX_KNOPF_PX = 24;
const TREFFER_PX = 44;
const MAX_SCHRIFT_PX = 11;
const MIN_SCHRIFT_PX = 10;
const MAX_GEWICHT = 400;

const clean = (text) => text.replace(/\s+/g, " ").trim();
const listOf = (text, separator) => text.split(separator).map(clean).filter(Boolean);
const RULES = Array.from(CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
  selectors: listOf(match[1], ","),
  decls: listOf(match[2], ";"),
}));
const declsOf = (selector) =>
  RULES.filter((rule) => rule.selectors.includes(selector)).flatMap((rule) => rule.decls);
const valueOf = (selector, property) => {
  const found = declsOf(selector).filter((decl) => decl.startsWith(`${property}:`));
  assert.equal(found.length, 1, `${selector}: ${property} fehlt oder steht mehrfach`);
  return clean(found[0].slice(property.length + 1));
};
const pxOf = (selector, property) => Number.parseFloat(valueOf(selector, property));
const fontOf = (selector) => {
  const parts = /^(\d+) ([\d.]+)px/.exec(valueOf(selector, "font"));
  assert.ok(parts, `${selector}: Schrift nicht lesbar`);
  return { weight: Number(parts[1]), size: Number(parts[2]) };
};

test("Steuerknöpfe unter dem Film sind höchstens 24 px hoch, in jeder Breite gleich", () => {
  const sizes = RULES.flatMap((rule) => rule.decls).filter((decl) => decl.startsWith("--vctl:"));
  assert.equal(sizes.length, 1, "Knopfgröße steht mehrfach");
  const size = Number.parseFloat(sizes[0].split(":")[1]);
  assert.ok(size <= MAX_KNOPF_PX, `Knopf ist ${size} px hoch`);
  assert.equal(pxOf(".vslot .vsound", "--vctl-hit"), TREFFER_PX);
  assert.equal(valueOf(".vslot .vsound", "height"), "var(--vctl)");
  assert.equal(valueOf(".vslot .vpause", "width"), "var(--vctl)");
});

test("Ton-Beschriftung ist normal gewichtet und klein, aber nicht winzig", () => {
  const sound = fontOf(".vslot .vsound");
  assert.ok(sound.weight <= MAX_GEWICHT, `Ton-Beschriftung hat Gewicht ${sound.weight}`);
  assert.ok(sound.size <= MAX_SCHRIFT_PX, `Ton-Beschriftung ist ${sound.size} px groß`);
  assert.ok(sound.size >= MIN_SCHRIFT_PX, `Ton-Beschriftung ist ${sound.size} px klein`);
  assert.ok(pxOf(".vsound-n", "font-size") >= MIN_SCHRIFT_PX, "Sprachhinweis ist winzig");
});
