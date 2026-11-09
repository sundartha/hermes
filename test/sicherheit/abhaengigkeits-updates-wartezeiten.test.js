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

const SPERR_EINTRAG = /dependency-name/;
const KOMMENTAR = /^\s*#/;
const GRUND = /^\s*# Grund: \S/;
const ABLAUF = /^\s*# Ablauf: (\d{4}-\d{2}-\d{2})\s*$/;
const ISO_TAG_LAENGE = 10;
const HEUTE_PROBE = "2026-11-09";

function kommentareUeber(zeilen, index) {
  const kommentare = [];
  for (let i = index - 1; i >= 0 && KOMMENTAR.test(zeilen[i]); i -= 1) kommentare.push(zeilen[i]);
  return kommentare;
}

function istEchterTag(tag) {
  const zeit = Date.parse(`${tag}T00:00:00Z`);
  return !Number.isNaN(zeit) && new Date(zeit).toISOString().slice(0, ISO_TAG_LAENGE) === tag;
}

function ablaufBefund(kommentare, heute) {
  const tag = kommentare.map((zeile) => ABLAUF.exec(zeile)?.[1]).find(Boolean);
  if (tag === undefined || !istEchterTag(tag)) return "Ablaufdatum fehlt oder ist ungültig";
  return tag < heute ? `Ablaufdatum ${tag} ist vorbei` : null;
}

function sperrBefunde(text, heute) {
  const zeilen = text.split("\n");
  return zeilen.flatMap((zeile, index) => {
    if (!SPERR_EINTRAG.test(zeile) || KOMMENTAR.test(zeile)) return [];
    const kommentare = kommentareUeber(zeilen, index);
    const grund = kommentare.some((kommentar) => GRUND.test(kommentar)) ? null : "Grund fehlt";
    return [grund, ablaufBefund(kommentare, heute)].filter(Boolean).map((befund) => `${zeile.trim()}: ${befund}`);
  });
}

function sperrEintrag(...kommentare) {
  return [...kommentare.map((text) => `      # ${text}`), '      - dependency-name: "x"', ""].join("\n");
}

test("Sperrliste: jeder Eintrag der echten dependabot.yml hat Grund und ein nicht abgelaufenes Datum", () => {
  assert.equal(TEXT.match(/- dependency-name:/g).length >= 2, true);
  assert.deepEqual(sperrBefunde(TEXT, new Date().toISOString().slice(0, ISO_TAG_LAENGE)), []);
});

test("Sperrliste: ein Eintrag mit Grund und künftigem Datum ist in Ordnung", () => {
  assert.deepEqual(sperrBefunde(sperrEintrag("Grund: bricht den Build", "Ablauf: 2027-01-01"), HEUTE_PROBE), []);
});

test("Sperrliste: am letzten gültigen Tag ist der Eintrag noch in Ordnung", () => {
  assert.deepEqual(sperrBefunde(sperrEintrag("Grund: bricht den Build", `Ablauf: ${HEUTE_PROBE}`), HEUTE_PROBE), []);
});

test("Sperrliste: ein Eintrag ohne Grund wird rot", () => {
  const befunde = sperrBefunde(sperrEintrag("Ablauf: 2027-01-01"), HEUTE_PROBE);
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /Grund fehlt/);
});

test("Sperrliste: ein leerer Grund wird rot", () => {
  assert.match(sperrBefunde(sperrEintrag("Grund: ", "Ablauf: 2027-01-01"), HEUTE_PROBE)[0], /Grund fehlt/);
});

test("Sperrliste: ein Eintrag ohne Ablaufdatum wird rot", () => {
  const befunde = sperrBefunde(sperrEintrag("Grund: bricht den Build"), HEUTE_PROBE);
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /Ablaufdatum fehlt/);
});

test("Sperrliste: ein abgelaufenes Datum wird rot", () => {
  const befunde = sperrBefunde(sperrEintrag("Grund: bricht den Build", "Ablauf: 2026-11-08"), HEUTE_PROBE);
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /2026-11-08 ist vorbei/);
});

test("Sperrliste: ein Datum, das es nicht gibt, wird rot", () => {
  assert.match(sperrBefunde(sperrEintrag("Grund: bricht den Build", "Ablauf: 2027-02-31"), HEUTE_PROBE)[0], /ungültig/);
});

test("Sperrliste: eine Leerzeile trennt den Kommentar vom Eintrag", () => {
  const text = ["      # Grund: bricht den Build", "      # Ablauf: 2027-01-01", "", '      - dependency-name: "x"'].join("\n");
  assert.equal(sperrBefunde(text, HEUTE_PROBE).length, 2);
});

test("Sperrliste: auch ein Eintrag in anderer Schreibweise braucht Grund und Datum", () => {
  assert.equal(sperrBefunde('    ignore: [{ dependency-name: "x" }]\n', HEUTE_PROBE).length, 2);
});
