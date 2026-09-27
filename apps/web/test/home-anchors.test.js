// Anker der Startseite (lib/home-anchors.js): Unterseiten fuehren mit "So funktioniert's"
// und "Preise" auf die Ebenen der Startseite statt auf die ruhenden Unterseiten
// (Owner-Wunsch 2026-09-27). Rein, ohne astro-Build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { HOME_ANCHORS, anchorFromHash, homeHref } from "../src/lib/home-anchors.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(WEB_ROOT, path), "utf8");

test("anchorFromHash: bekannter Anker -> Ebene, alles andere -> null", () => {
  assert.deepEqual(anchorFromHash("#so-funktionierts"), HOME_ANCHORS["so-funktionierts"]);
  assert.deepEqual(anchorFromHash("#preise"), HOME_ANCHORS.preise);
  assert.deepEqual(anchorFromHash("preise"), HOME_ANCHORS.preise, "auch ohne #");
  for (const hash of [
    "",
    "#",
    "#toString",
    "#constructor",
    "#PREISE",
    "#%E0%A4%A",
    null,
    undefined,
  ]) {
    assert.equal(anchorFromHash(hash), null, `${String(hash)} ist keine Ebene`);
  }
});

test("homeHref: bekannter Anker -> /#anker, ein unbekannter bricht den Build ab", () => {
  assert.equal(homeHref("so-funktionierts"), "/#so-funktionierts");
  assert.equal(homeHref("preise"), "/#preise");
  assert.throws(() => homeHref("pricing"), /Unbekannter Startseiten-Anker/);
});

test("Anker treffen dieselbe Ebene auf Desktop-Buehne und Handy-Screens", () => {
  const index = read("src/pages/index.astro");
  const mobileScript = read("src/scripts/hermes-mobile.js");
  for (const target of Object.values(HOME_ANCHORS)) {
    assert.ok(
      index.includes(`data-goto="${target.sheet}:${target.index}"`),
      `Desktop: keine Sektion ${target.sheet}:${target.index}`,
    );
  }
  assert.ok(mobileScript.includes(`const SCREEN_HOW = ${HOME_ANCHORS["so-funktionierts"].index};`));
  assert.ok(mobileScript.includes(`const SCREEN_PRICE = ${HOME_ANCHORS.preise.index};`));
  for (const script of ["hermes-scroll.js", "hermes-mobile.js"]) {
    assert.ok(
      read(`src/scripts/${script}`).includes("anchorFromHash(window.location.hash)"),
      `${script} liest den Anker nicht`,
    );
  }
});

test("Unterseiten verlinken So funktioniert's und Preise auf die Startseite", () => {
  const layout = read("src/layouts/Hermes.astro");
  assert.ok(layout.includes('homeHref("so-funktionierts")'), "Nav: So funktioniert's");
  assert.ok(layout.includes('homeHref("preise")'), "Nav: Preise");
  for (const path of [
    "src/layouts/Hermes.astro",
    "src/pages/404.astro",
    "src/pages/registrieren.astro",
  ]) {
    assert.doesNotMatch(
      read(path),
      /href(=|: )"\/(so-funktionierts|preise)"/,
      `${path} fuehrt noch auf die ruhende Unterseite`,
    );
  }
});
