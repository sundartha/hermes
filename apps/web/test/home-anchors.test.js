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
  assert.equal(homeHref("so-funktionierts"), "/#idea");
  assert.equal(homeHref("preise"), "/#pricing");
  assert.throws(() => homeHref("pricing"), /Unbekannter Startseiten-Anker/);
});

test("Anker treffen eine echte Sektion der Startseite, alte und neue Hash-Namen", () => {
  const index = read("src/pages/index.astro");
  const script = read("src/scripts/home.js");
  for (const [legacy, target] of Object.entries(HOME_ANCHORS)) {
    assert.ok(index.includes(`id="${target.id}"`), `#${legacy}: keine Sektion id="${target.id}"`);
    assert.deepEqual(anchorFromHash(`#${target.id}`), { id: target.id }, `#${target.id} wird nicht erkannt`);
  }
  assert.ok(
    script.includes('import { anchorFromHash } from "../lib/home-anchors.js";'),
    "home.js bindet die Anker-Aufloesung nicht ein",
  );
  assert.match(script, /window\.location\.hash/, "home.js liest den Anker nicht");
  assert.match(script, /anchorFromHash\(/, "home.js loest den Anker nicht auf");
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
