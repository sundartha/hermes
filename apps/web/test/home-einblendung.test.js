import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildSite, removeBuild } from "./gebaute-seite.js";

const NO_PREFERENCE = "prefers-reduced-motion:no-preference";
const SCROLL_DRIVEN = [
  { selector: ".herozoom", name: "heroZoom", timeline: "scroll(root)" },
  { selector: ".px", name: "pan", timeline: "view()" },
  { selector: ".sz", name: "slowzoom", timeline: "view()" },
  { selector: ".clipin", name: "clip", timeline: "view()" },
  { selector: ".ucs .vslot.clipin>.bg", name: "clip", timeline: "view()" },
];
const DESKTOP = "width>=761px";
const MOBILE = "width<=760px";

let workDir;
let rules;

function rulesOf(css) {
  const preludes = [];
  const found = [];
  let buffer = "";
  let decls = [];
  for (const char of css) {
    if (char === "{") {
      preludes.push(buffer.trim());
      buffer = "";
      decls = [];
    } else if (char === "}") {
      if (buffer.trim()) decls.push(buffer.trim());
      const selector = preludes.pop();
      if (decls.length) found.push({ selector, decls, gates: [...preludes] });
      buffer = "";
      decls = [];
    } else if (char === ";") {
      decls.push(buffer.trim());
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return found;
}

const rulesFor = (selector) => rules.filter((rule) => rule.selector.split(",").includes(selector));
const declsFor = (selector) => rulesFor(selector).flatMap((rule) => rule.decls);

before(() => {
  const built = buildSite(".home-einblendung-", "dist");
  workDir = built.workDir;
  const cssDir = join(built.distDir, "_astro");
  const sheets = readdirSync(cssDir).filter((name) => name.endsWith(".css"));
  rules = sheets.flatMap((name) => rulesOf(readFileSync(join(cssDir, name), "utf8")));
});

after(() => {
  removeBuild(workDir);
});

test("Gebaute Startseite: keine Scroll-Zeitleiste in der Kurzform animation (Browser verwerfen die ganze Angabe)", () => {
  const broken = rules
    .flatMap((rule) => rule.decls.map((decl) => `${rule.selector}{${decl}}`))
    .filter((text) => /\{animation:[^}]*\b(view|scroll)\(/.test(text));
  assert.deepEqual(broken, []);
});

test("Gebaute Startseite: jede Scroll-Einblendung nennt Animation und Zeitleiste als eigene Angaben", () => {
  for (const { selector, name, timeline } of SCROLL_DRIVEN) {
    const decls = declsFor(selector);
    assert.ok(
      decls.includes(`animation-name:${name}`),
      `${selector}: animation-name:${name} fehlt (${decls.join(";")})`,
    );
    assert.ok(
      decls.includes(`animation-timeline:${timeline}`),
      `${selector}: animation-timeline:${timeline} fehlt (${decls.join(";")})`,
    );
    assert.ok(
      decls.includes("animation-fill-mode:both"),
      `${selector}: Endzustand bleibt nicht stehen`,
    );
  }
});

test("Gebaute Startseite: Scroll-Einblendungen laufen nur ohne Wunsch nach reduzierter Bewegung", () => {
  for (const { selector } of SCROLL_DRIVEN) {
    const animated = rulesFor(selector).filter((rule) =>
      rule.decls.some((decl) => decl.startsWith("animation-name:")),
    );
    assert.ok(animated.length > 0, `${selector}: keine Einblendung gefunden`);
    for (const rule of animated) {
      assert.ok(
        rule.gates.some((gate) => gate.includes(NO_PREFERENCE)),
        `${selector}: ohne Bewegungs-Schalter (${rule.gates.join(" / ")})`,
      );
    }
  }
});

test("Bild im Ideen-Abschnitt: sein Rahmen ist kein eigener Scroll-Bereich, sonst steht die Bildfahrt still", () => {
  const frame = rulesFor(".idea-img").filter((rule) => rule.decls.includes("overflow:clip"));
  assert.ok(frame.length > 0, "Rahmen .idea-img schneidet weiter mit overflow:hidden ab");
  for (const rule of frame) {
    assert.ok(rule.gates.some((gate) => gate.includes("animation-timeline")), "Regel gilt auch ohne Scroll-Zeitleisten");
    assert.ok(rule.gates.some((gate) => gate.includes(NO_PREFERENCE)), "Regel gilt auch bei reduzierter Bewegung");
  }
});

test("Szenen-Film: der Rahmen mit der Steuerzeile wird in keiner Fensterbreite beschnitten", () => {
  const frameOff = rulesFor(".ucs .vslot.clipin").filter((rule) => rule.decls.includes("animation:none"));
  const anyWidth = frameOff.filter((rule) => !rule.gates.some((gate) => gate.includes("width")));
  assert.ok(anyWidth.length > 0, "der Rahmen .vslot ist nur in einem Breitenbereich von der Einblendung ausgenommen");
  const carousel = rulesFor(".ucs .clipin").filter((rule) => rule.decls.includes("animation:none"));
  assert.ok(carousel.some((rule) => rule.gates.some((gate) => gate.includes(MOBILE))), "bis 760 px läuft die Einblendung im Karussell");
});

test("Szenen-Film: am Desktop blendet nur das Bild ein, mobil bleibt der Film ohne Einblendung", () => {
  const film = rulesFor(".ucs .vslot.clipin>.bg").filter((rule) => rule.decls.includes("animation-name:clip"));
  assert.ok(film.length > 0, "Einblendung des Bildes fehlt");
  for (const rule of film) {
    assert.ok(rule.gates.some((gate) => gate.includes(DESKTOP)), `Einblendung gilt auch mobil (${rule.gates.join(" / ")})`);
  }
});
