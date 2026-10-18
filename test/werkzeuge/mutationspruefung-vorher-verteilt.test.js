import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { test } from "node:test";

import { gelesen } from "../../tools/syntaxbaum.mjs";
import { vorherGetoetet } from "../../tools/mutationspruefung/testumbau.mjs";
import { PLANDATEI, schneide, vereineStuecke, vorherPlan, vorherStueck } from "../../tools/mutationspruefung/vorher-verteilt.mjs";
import { werkzeug as werkzeugAufruf } from "./mutationspruefung-probe.js";
import { probeDirectory, probeRepository, runIn, REPO_ROOT } from "./probe-repo.js";

const EXIT_ABBRUCH = 2;
const MODUL = { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: {}, loc: true };
const RECHNEN = [
  "export const GRENZE = 3;",
  "",
  "export function einordnen(zahl) {",
  '  if (zahl < 0) return "negativ";',
  '  if (zahl > GRENZE) return "gross";',
  '  return "klein";',
  "}",
  "",
  "export const NAMEN = {",
  '  eins: "a",',
  '  zwei: "b",',
  "};",
  "export const doppelt = (zahl) => zahl * 2;",
  "",
].join("\n");
const WORT = 'export const gross = (wort) => wort.toUpperCase();\nexport const leer = "";\n';
const DATEIEN = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "src/rechnen.js": RECHNEN,
  "src/wort.js": WORT,
  "test/rechnen.test.js": 'import { einordnen } from "../src/rechnen.js";\nimport { gross } from "../src/wort.js";\nexport { einordnen, gross };\n',
};
const AM_STUECK = 1_000_000;
const KLEINSTE = 1;

function knoten(baum) {
  const alle = [];
  const offen = [...baum.body];
  while (offen.length > 0) {
    const eintrag = offen.pop();
    alle.push(eintrag);
    for (const [schluessel, wert] of Object.entries(eintrag)) {
      if (schluessel !== "loc" && schluessel !== "range") offen.push(...[wert].flat().filter((kind) => typeof kind?.type === "string" && kind.loc));
    }
  }
  return alle;
}

function strykerAttrappe(datei, zeilen) {
  const baum = gelesen(readFileSync(datei, "utf8"), MODUL);
  const enthalten = ({ start, end }) => zeilen.some(([von, bis]) => von <= start.line && end.line <= bis);
  return knoten(baum)
    .filter(({ loc }) => enthalten(loc))
    .map(({ type, loc: { start, end } }) => ({
      schluessel: `${datei}:${start.line}:${start.column} ${type}`,
      status: start.line % 2 === 1 ? "Killed" : "Survived",
      zeilen: [start.line, end.line],
    }));
}

function attrappe(repo) {
  return {
    alterStand: () => {
      const vorher = cwd();
      chdir(repo);
      return () => chdir(vorher);
    },
    durchgang: async (datei, zeilen) => strykerAttrappe(datei, zeilen),
    ueberlebt: ({ status }) => status === "Survived",
  };
}

const STAND = { basis: "basis", tests: ["test/rechnen.test.js"] };

async function verteilt(werkzeug, stueckSekunden) {
  const plan = await vorherPlan(STAND, werkzeug, stueckSekunden);
  const berichte = [];
  for (const stueck of plan.stuecke) berichte.push(await vorherStueck(STAND, stueck, werkzeug));
  return { plan, vereint: vereineStuecke(plan, berichte), berichte };
}

function schluessel(getoetet) {
  return getoetet.map((eintrag) => eintrag.schluessel).sort();
}

test("mutationspruefung vorher verteilt: der Schnitt trennt nie eine Anweisung der obersten Ebene und deckt die Datei lückenlos ab", () => {
  const baum = gelesen(RECHNEN, MODUL);
  const stuecke = schneide(RECHNEN, baum, KLEINSTE);
  const bereiche = stuecke.map(({ zeilen: [bereich] }) => bereich);
  assert.ok(bereiche.length > 1);
  assert.deepEqual(bereiche[0][0], 1);
  assert.equal(bereiche.at(-1)[1], RECHNEN.split("\n").length);
  bereiche.slice(1).forEach(([von], index) => assert.equal(von, bereiche[index][1] + 1));
  for (const { loc } of knoten(baum)) {
    assert.ok(bereiche.some(([von, bis]) => von <= loc.start.line && loc.end.line <= bis), `Knoten ${loc.start.line}-${loc.end.line} liegt über einer Grenze`);
  }
  assert.equal(bereiche.some(([von]) => von > 3 && von <= 7), false);
});

test("mutationspruefung vorher verteilt: ein Schnitt mitten in einer Anweisung verlöre Mutanten, die Attrappe bemerkt das", (context) => {
  const repo = probeRepository(context, DATEIEN);
  const datei = join(repo, "src/rechnen.js");
  const ganz = strykerAttrappe(datei, [[1, RECHNEN.split("\n").length]]);
  const zerschnitten = [...strykerAttrappe(datei, [[1, 4]]), ...strykerAttrappe(datei, [[5, RECHNEN.split("\n").length]])];
  assert.ok(zerschnitten.length < ganz.length);
});

test("mutationspruefung vorher verteilt: die vereinten Stücke töten genau die Mutanten, die die Vorher-Seite am Stück tötet", async (context) => {
  const repo = probeRepository(context, DATEIEN);
  const werkzeug = attrappe(repo);
  const amStueck = await vorherGetoetet(STAND.basis, STAND.tests, werkzeug);
  const ganz = await verteilt(werkzeug, AM_STUECK);
  const geteilt = await verteilt(werkzeug, KLEINSTE);
  assert.deepEqual(ganz.plan.stuecke.map(({ datei }) => datei), ["src/rechnen.js", "src/wort.js"]);
  assert.ok(geteilt.plan.stuecke.length > ganz.plan.stuecke.length);
  assert.ok(amStueck.getoetet.length > 0);
  assert.deepEqual(schluessel(geteilt.vereint.getoetet), schluessel(amStueck.getoetet));
  assert.deepEqual(schluessel(ganz.vereint.getoetet), schluessel(amStueck.getoetet));
  assert.deepEqual(geteilt.vereint.quellen, amStueck.quellen);
  assert.deepEqual(geteilt.vereint.tests, amStueck.tests);
  const mutanten = (vereint) => vereint.stuecke.reduce((summe, { anzahl }) => summe + anzahl, 0);
  assert.equal(mutanten(geteilt.vereint), mutanten(ganz.vereint));
});

test("mutationspruefung vorher verteilt: ein fehlendes, doppeltes oder fremdes Stück ist ein Fehler, kein stilles Grün", async (context) => {
  const repo = probeRepository(context, DATEIEN);
  const { plan, berichte } = await verteilt(attrappe(repo), KLEINSTE);
  assert.throws(() => vereineStuecke(plan, berichte.slice(1)), /es fehlen die Stücke 1 von/);
  assert.throws(() => vereineStuecke(plan, [...berichte, berichte[0]]), /Stück 1 liegt doppelt vor/);
  assert.throws(() => vereineStuecke(plan, [{ ...berichte[0], basis: "andere" }, ...berichte.slice(1)]), /Stück 1 gehört zu einem anderen Plan/);
  const verschoben = { ...berichte[0], stueck: { ...berichte[0].stueck, zeilen: [[1, 99]] } };
  assert.throws(() => vereineStuecke(plan, [verschoben, ...berichte.slice(1)]), /Stück 1 gehört zu einem anderen Plan/);
  assert.throws(() => vereineStuecke({ ...plan, stuecke: plan.stuecke.slice(1) }, berichte.slice(1)), /nicht lückenlos/);

  const ordner = probeDirectory(context, {});
  writeFileSync(join(ordner, PLANDATEI), JSON.stringify(plan));
  for (const bericht of berichte.slice(1)) writeFileSync(join(ordner, `stueck-${bericht.stueck.nummer}.json`), JSON.stringify(bericht));
  const lauf = runIn(ordner, process.execPath, [join(REPO_ROOT, "tools/mutationspruefung.mjs"), "--vorher-zusammen", ordner, "--ergebnis", join(ordner, "ergebnis.out")]);
  assert.equal(lauf.status, EXIT_ABBRUCH);
  assert.match(lauf.stderr, /Abbruch: es fehlen die Stücke 1 von/);
});

test("mutationspruefung vorher verteilt: ein Stück für eine Datei, die die betroffenen Tests nicht importieren, bricht ab", async (context) => {
  const repo = probeRepository(context, { ...DATEIEN, "src/fremd.js": WORT });
  const stueck = { nummer: 1, datei: "src/fremd.js", zeilen: [[1, 2]] };
  await assert.rejects(vorherStueck(STAND, stueck, attrappe(repo)), /src\/fremd\.js ist im Stand basis keine Quelldatei der betroffenen Tests/);
});

test("mutationspruefung vorher verteilt: --vorher-plan schreibt den Plan auf dem Basisstand, ohne Stryker", (context) => {
  const repo = probeRepository(context, DATEIEN);
  const ziel = join(repo, "node_modules", "plan.out");
  mkdirSync(join(repo, "node_modules"), { recursive: true });
  const lauf = werkzeugAufruf(repo, "HEAD", "--tests", "test/rechnen.test.js", "--vorher-plan", ziel, "--stueck-sekunden", "1");
  assert.equal(lauf.status, 0, lauf.stderr);
  const plan = JSON.parse(readFileSync(ziel, "utf8"));
  assert.match(plan.basis, /^[0-9a-f]{40}$/);
  assert.deepEqual(plan.betroffen, ["test/rechnen.test.js"]);
  assert.deepEqual([...new Set(plan.stuecke.map(({ datei }) => datei))], ["src/rechnen.js", "src/wort.js"]);
  assert.deepEqual(plan.stuecke.map(({ nummer }) => nummer), plan.stuecke.map((_stueck, index) => index + 1));
  assert.match(lauf.stdout, /^Plan: \d+ Stücke gegen 1 Testdateien$/m);
});

test("mutationspruefung vorher verteilt: falsche Aufrufe und unsichere Pfade brechen ab", (context) => {
  const repo = probeRepository(context, DATEIEN);
  const falsch = [
    ["--vorher-plan", "plan.out"],
    ["--tests", "test/rechnen.test.js", "--vorher-stueck", "{}"],
    ["--tests", "test/rechnen.test.js", "--vorher-plan", "plan.out", "--testumbau"],
    ["--tests", "test/rechnen.test.js", "--vorher-plan", "plan.out", "--plan", "x.out"],
    ["--tests", "test/rechnen.test.js", "--vorher-plan", "plan.out", "--stueck-sekunden", "0"],
    ["--tests", "test/rechnen.test.js", "--vorher-plan", "plan.out", "--vorher-zusammen", "ordner"],
    ["--tests", "test/rechnen.test.js", "--stueck-sekunden", "5"],
    ["--tests", "test/rechnen.test.js"],
  ];
  for (const argumente of falsch) {
    const lauf = werkzeugAufruf(repo, "HEAD", ...argumente);
    assert.equal(lauf.status, EXIT_ABBRUCH, argumente.join(" "));
    assert.match(lauf.stderr, /^Aufruf: /, argumente.join(" "));
  }
  const ohneBasis = runIn(repo, process.execPath, [join(REPO_ROOT, "tools/mutationspruefung.mjs"), "--vorher-zusammen", repo, "--ergebnis", "x.out", "--basis", "HEAD"]);
  assert.equal(ohneBasis.status, EXIT_ABBRUCH);
  const ausserhalb = werkzeugAufruf(repo, "HEAD", "--tests", "test/../src/rechnen.js", "--vorher-plan", "plan.out");
  assert.equal(ausserhalb.status, EXIT_ABBRUCH);
  assert.match(ausserhalb.stderr, /--tests verlangt Pfade unter test\//);
  const stueck = JSON.stringify({ nummer: 1, datei: "src/../package.json", zeilen: [[1, 2]] });
  const fremdesStueck = werkzeugAufruf(repo, "HEAD", "--tests", "test/rechnen.test.js", "--vorher-stueck", stueck, "--ergebnis", "x.out");
  assert.equal(fremdesStueck.status, EXIT_ABBRUCH);
  assert.match(fremdesStueck.stderr, /--vorher-stueck verlangt/);
});
