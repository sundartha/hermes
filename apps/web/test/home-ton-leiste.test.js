import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Window } from "happy-dom";
import { wireSound } from "../src/scripts/home-sound.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CSS = readFileSync(join(WEB_ROOT, "src/styles/home-sound.css"), "utf8");
const PAGE = readFileSync(join(WEB_ROOT, "src/pages/index.astro"), "utf8");

const clean = (text) => text.replace(/\s+/g, " ").trim();
const listOf = (text, separator) => text.split(separator).map(clean).filter(Boolean);
const RULES = Array.from(CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
  selectors: listOf(match[1], ","),
  decls: listOf(match[2], ";"),
}));
const declsOf = (selector) =>
  RULES.filter((rule) => rule.selectors.includes(selector)).flatMap((rule) => rule.decls);

function soundPage(lang) {
  const window = new Window({ url: "https://sundartha.test/" });
  const { document } = window;
  document.documentElement.lang = lang;
  document.body.innerHTML = `<article class="scene"><div class="vslot">
    <span class="label">II · Hermes books</span>
    <video data-clip="uc2" muted></video>
    <button type="button" class="vsound" aria-pressed="false" hidden><span class="vsound-l">Sound</span> <span class="vsound-s" aria-hidden="true">off</span></button>
  </div></article>`;
  const video = document.querySelector("video");
  const media = { muted: true, paused: true };
  Object.defineProperties(video, {
    muted: {
      get: () => media.muted,
      set: (value) => {
        media.muted = value;
      },
    },
    paused: { get: () => media.paused },
    textTracks: { get: () => [] },
    play: { value: () => Promise.resolve() },
  });
  wireSound(document);
  const button = document.querySelector(".vsound");
  const shown = () => clean(button.textContent);
  return { button, shown };
}

test("Ton-Knopf: die Beschriftung ist sichtbar und nennt den Zustand", () => {
  const hidden = declsOf(".vsound-l").filter((decl) =>
    /^(clip-path|width: 1px|height: 1px|overflow)/.test(decl),
  );
  assert.deepEqual(hidden, [], "Beschriftung ist nur für Screenreader da");
  assert.match(
    PAGE,
    /class="vsound-s" aria-hidden="true"/,
    "Seite liefert keinen sichtbaren Zustand mit",
  );

  const english = soundPage("en");
  assert.equal(english.shown(), "Sound off");
  english.button.click();
  assert.equal(english.shown(), "Sound on");
  english.button.click();
  assert.equal(english.shown(), "Sound off");

  const german = soundPage("de");
  assert.equal(german.shown(), "Ton aus");
  german.button.click();
  assert.equal(german.shown(), "Ton an");
});

test("Ton- und Pause-Knopf stehen unter dem Film, nicht auf dem Bild", () => {
  const controls = declsOf(".vslot .vpause");
  assert.ok(
    controls.some((decl) => decl.startsWith("top: calc(100%")),
    "Knöpfe liegen auf dem Film",
  );
  assert.ok(controls.includes("bottom: auto"), "Knöpfe hängen noch am unteren Bildrand");
  const film = declsOf(".ucs > .scene .vslot");
  assert.ok(film.includes("overflow: visible"), "Leiste unter dem Film wird abgeschnitten");
  assert.ok(
    film.includes("margin-bottom: var(--vbar)"),
    "Leiste hat keinen eigenen Platz unter dem Film",
  );
});

test("Ton- und Pause-Knopf: Trefferfläche bleibt in jeder Breite 44 px", () => {
  const all = RULES.flatMap((rule) => rule.decls);
  const hit = all.filter((decl) => decl.startsWith("--vctl-hit:"));
  assert.deepEqual(hit, ["--vctl-hit: 44px"]);
  const sizes = all.filter((decl) => decl.startsWith("--vctl:"));
  assert.deepEqual(sizes, ["--vctl: 32px"], "Knopf schrumpft auf schmalen Geräten");
});

test("Leiste unter dem Film ist am Desktop im Höhenbudget des Films reserviert", () => {
  for (const selector of [".ucs > .scene .vslot", ".ucs > .scene:first-child .vslot"]) {
    const limits = declsOf(selector).filter((decl) => decl.startsWith("max-height:") || decl.startsWith("width: min("));
    assert.ok(limits.length > 0, `${selector}: Höhenbudget fehlt`);
    for (const limit of limits) assert.ok(limit.includes("- var(--vbar)"), `${selector}: ${limit}`);
  }
});
