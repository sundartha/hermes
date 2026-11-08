import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TEXT = readFileSync(new URL("../../.github/dependabot.yml", import.meta.url), "utf8");
const ARTEN = ["patch", "minor", "major"];
const MINDEST_TAGE = 7;

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

function wirksameWartezeit(b, art) {
  const standard = tage(b, "default-days");
  if (b.art === "github-actions") return standard;
  return tage(b, `semver-${art}-days`) ?? standard;
}

function artenAus(gruppe) {
  const liste = /update-types: \[([^\]]*)\]/.exec(gruppe)?.[1] ?? "";
  const ohneAnfuehrung = liste.replaceAll('"', "");
  return ohneAnfuehrung.split(",").map((s) => s.trim()).filter(Boolean);
}

function gruppen(b) {
  const abschnitt = /^ {4}groups:\n((?: {6,}.*\n?)+)/m.exec(b.koerper)?.[1] ?? "";
  return abschnitt
    .split(/^ {6}(?=\S)/m)
    .filter(Boolean)
    .map((g) => ({ name: g.split(":")[0], arten: artenAus(g) }));
}

const NPM = [
  ["npm", "/"],
  ["npm", "/apps/web"],
];
const ACTIONS = [["github-actions", "/"]];
const NPM_TAGE = { patch: 7, minor: 7, major: 14 };

for (const [art, verzeichnis] of NPM) {
  for (const sorte of ARTEN) {
    test(`Abhaengigkeits-Updates ${art} ${verzeichnis}: ${sorte} wartet wirksam ${NPM_TAGE[sorte]} Tage`, () => {
      assert.equal(wirksameWartezeit(block(art, verzeichnis), sorte), NPM_TAGE[sorte]);
    });
  }
}

for (const [art, verzeichnis] of ACTIONS) {
  for (const sorte of ARTEN) {
    test(`Abhaengigkeits-Updates ${art} ${verzeichnis}: ${sorte} wartet wirksam 14 Tage`, () => {
      assert.equal(wirksameWartezeit(block(art, verzeichnis), sorte), 14);
    });
  }

  test(`Abhaengigkeits-Updates ${art} ${verzeichnis}: kein semver-*-days, Dependabot ignoriert ihn dort`, () => {
    assert.doesNotMatch(block(art, verzeichnis).koerper, /semver-(patch|minor|major)-days/);
  });
}

for (const [art, verzeichnis] of [...NPM, ...ACTIONS]) {
  for (const sorte of ARTEN) {
    test(`Abhaengigkeits-Updates ${art} ${verzeichnis}: ${sorte} wartet wirksam mindestens ${MINDEST_TAGE} Tage`, () => {
      const wirksam = wirksameWartezeit(block(art, verzeichnis), sorte);
      assert.ok(wirksam >= MINDEST_TAGE, `wirksame Wartezeit ${wirksam} liegt unter ${MINDEST_TAGE}`);
    });
  }

  test(`Abhaengigkeits-Updates ${art} ${verzeichnis}: Patch und Minor gemeinsam, Major nie in einer Gruppe`, () => {
    const g = gruppen(block(art, verzeichnis));
    assert.equal(g.length, 1);
    assert.equal(g[0].name, "klein");
    assert.deepEqual([...g[0].arten].sort(), ["minor", "patch"]);
  });
}

test("Abhaengigkeits-Updates: bestehende Sperren fuer typescript und @types/node bleiben", () => {
  const k = block("npm", "/").koerper;
  assert.match(k, /dependency-name: "typescript"\n\s+versions: \[">=6\.1\.0"\]/);
  assert.match(k, /dependency-name: "@types\/node"\n\s+update-types: \["version-update:semver-major"\]/);
});
