import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TEXT = readFileSync(new URL("../../.github/dependabot.yml", import.meta.url), "utf8");

function bloecke() {
  return TEXT.split(/^ {2}- package-ecosystem: /m)
    .slice(1)
    .map((block) => {
      const [kopf, ...rest] = block.split("\n");
      const koerper = rest.join("\n");
      return {
        art: kopf.replaceAll('"', "").trim(),
        verzeichnis: /^ {4}directory: "([^"]+)"/m.exec(koerper)?.[1],
        koerper,
      };
    });
}

function block(art, verzeichnis) {
  const treffer = bloecke().find((b) => b.art === art && b.verzeichnis === verzeichnis);
  assert.ok(treffer, `${art} ${verzeichnis} fehlt`);
  return treffer;
}

function tage(b, schluessel) {
  const wert = new RegExp(`^ {6}${schluessel}: (\\d+)$`, "m").exec(b.koerper)?.[1];
  return wert === undefined ? undefined : Number(wert);
}

function gruppen(b) {
  const abschnitt = /^ {4}groups:\n((?: {6,}.*\n?)+)/m.exec(b.koerper)?.[1] ?? "";
  return abschnitt
    .split(/^ {6}(?=\S)/m)
    .filter(Boolean)
    .map((g) => ({
      name: g.split(":")[0],
      arten: /update-types: \[([^\]]*)\]/.exec(g)?.[1].replaceAll('"', "").split(",").map((s) => s.trim()) ?? [],
    }));
}

const ZIELE = [
  ["npm", "/"],
  ["npm", "/apps/web"],
  ["github-actions", "/"],
];

for (const [art, verzeichnis] of ZIELE) {
  test(`Abhaengigkeits-Updates ${art} ${verzeichnis}: Patch wartet 3 Tage`, () => {
    assert.equal(tage(block(art, verzeichnis), "semver-patch-days"), 3);
  });

  test(`Abhaengigkeits-Updates ${art} ${verzeichnis}: Minor wartet 7 Tage`, () => {
    assert.equal(tage(block(art, verzeichnis), "semver-minor-days"), 7);
  });

  test(`Abhaengigkeits-Updates ${art} ${verzeichnis}: Major wartet 14 Tage`, () => {
    assert.equal(tage(block(art, verzeichnis), "semver-major-days"), 14);
  });

  test(`Abhaengigkeits-Updates ${art} ${verzeichnis}: Patch und Minor gemeinsam, Major nie in einer Gruppe`, () => {
    const g = gruppen(block(art, verzeichnis));
    assert.equal(g.length, 1);
    assert.deepEqual([...g[0].arten].sort(), ["minor", "patch"]);
  });
}

test("Abhaengigkeits-Updates: bestehende Sperren fuer typescript und @types/node bleiben", () => {
  const k = block("npm", "/").koerper;
  assert.match(k, /dependency-name: "typescript"\n\s+versions: \[">=6\.1\.0"\]/);
  assert.match(k, /dependency-name: "@types\/node"\n\s+update-types: \["version-update:semver-major"\]/);
});
