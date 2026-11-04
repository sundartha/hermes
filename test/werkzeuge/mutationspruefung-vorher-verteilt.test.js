import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { test } from "node:test";

import { gelesen } from "../../tools/syntaxbaum.mjs";
import { vorherGetoetet } from "../../tools/mutationspruefung/testumbau.mjs";
import { geschnittenerPlan, knotenIn, PLANDATEI, schneide, SEKUNDEN_JE_KNOTEN_UND_TESTDATEI, vereineStuecke, vorherPlan, vorherStueck } from "../../tools/mutationspruefung/vorher-verteilt.mjs";
import { MATRIX_HOECHSTENS, nachOrt, ortsschluessel } from "../../tools/mutationspruefung/teile.mjs";
import { mutantenListe } from "../../tools/mutationspruefung/vorplanung.mjs";
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
const EINORDNEN_ERSTE_ZEILE = 3;
const EINORDNEN_LETZTE_ZEILE = 7;
const MITTEN_IN_EINORDNEN = 4;
const BEREICH_AUS_ANDEREM_PLAN = [[1, 99]];
const UEBER_DER_MATRIX = Array.from({ length: MATRIX_HOECHSTENS + 1 }, (_wert, index) => `export const wert${index} = ${index};`).join("\n");
const KNOTEN_DER_ANWEISUNG = 5;
const KNOTEN_UEBER_DER_MATRIX = (MATRIX_HOECHSTENS + 1) * KNOTEN_DER_ANWEISUNG;
const KNOTEN_ZWEIER_ANWEISUNGEN = 2 * KNOTEN_DER_ANWEISUNG;
const ZWEI = 2;
const KAPPE_UEBER_EINER_ANWEISUNG = KNOTEN_DER_ANWEISUNG + 1;
const KAPPE_IN_EINORDNEN = 10;
const VIELE_STAND = { basis: "basis", tests: ["test/viele.test.js"] };
const VIELE_DATEIEN = { ...DATEIEN, "src/viele.js": UEBER_DER_MATRIX, "test/viele.test.js": 'export * from "../src/viele.js";\n' };
const STUECKE_HEUTE = [
  {
    stueckSekunden: 600,
    stuecke: [
      { datei: "src/rechnen.js", zeilen: [[1, 14]], knoten: 44, geschaetzt: 8 },
      { datei: "src/wort.js", zeilen: [[1, 3]], knoten: 15, geschaetzt: 3 },
    ],
  },
  {
    stueckSekunden: 1,
    stuecke: [
      { datei: "src/rechnen.js", zeilen: [[1, 2]], knoten: 5, geschaetzt: 1 },
      { datei: "src/rechnen.js", zeilen: [[3, 8]], knoten: 19, geschaetzt: 4 },
      { datei: "src/rechnen.js", zeilen: [[9, 12]], knoten: 11, geschaetzt: 2 },
      { datei: "src/rechnen.js", zeilen: [[13, 14]], knoten: 9, geschaetzt: 2 },
      { datei: "src/wort.js", zeilen: [[1, 1]], knoten: 10, geschaetzt: 2 },
      { datei: "src/wort.js", zeilen: [[2, 3]], knoten: 5, geschaetzt: 1 },
    ],
  },
];

function sekundenFuer(knoten) {
  return knoten * SEKUNDEN_JE_KNOTEN_UND_TESTDATEI;
}

function strykerAttrappe(datei, zeilen) {
  const baum = gelesen(readFileSync(datei, "utf8"), MODUL);
  const enthalten = ({ start, end }) => zeilen.some(([von, bis]) => von <= start.line && end.line <= bis);
  return knotenIn(baum)
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
  for (const { loc } of knotenIn(baum)) {
    assert.ok(bereiche.some(([von, bis]) => von <= loc.start.line && loc.end.line <= bis), `Knoten ${loc.start.line}-${loc.end.line} liegt über einer Grenze`);
  }
  assert.equal(bereiche.some(([von]) => von > EINORDNEN_ERSTE_ZEILE && von <= EINORDNEN_LETZTE_ZEILE), false);
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
  const datei = join(repo, "src/rechnen.js");
  const ende = RECHNEN.split("\n").length;
  const zerschnitten = [...strykerAttrappe(datei, [[1, MITTEN_IN_EINORDNEN]]), ...strykerAttrappe(datei, [[MITTEN_IN_EINORDNEN + 1, ende]])];
  assert.ok(zerschnitten.length < strykerAttrappe(datei, [[1, ende]]).length);
});

test("mutationspruefung vorher verteilt: ein fehlendes, doppeltes oder fremdes Stück ist ein Fehler, kein stilles Grün", async (context) => {
  const repo = probeRepository(context, DATEIEN);
  const { plan, berichte } = await verteilt(attrappe(repo), KLEINSTE);
  assert.throws(() => vereineStuecke(plan, berichte.slice(1)), /es fehlen die Stücke 1 von/);
  assert.throws(() => vereineStuecke(plan, [...berichte, berichte[0]]), /Stück 1 liegt doppelt vor/);
  assert.throws(() => vereineStuecke(plan, [{ ...berichte[0], basis: "andere" }, ...berichte.slice(1)]), /Stück 1 gehört zu einem anderen Plan/);
  const verschoben = { ...berichte[0], stueck: { ...berichte[0].stueck, zeilen: BEREICH_AUS_ANDEREM_PLAN } };
  assert.throws(() => vereineStuecke(plan, [verschoben, ...berichte.slice(1)]), /Stück 1 gehört zu einem anderen Plan/);
  assert.throws(() => vereineStuecke({ ...plan, stuecke: plan.stuecke.slice(1) }, berichte.slice(1)), /nicht lückenlos/);
  assert.throws(() => vereineStuecke({ ...plan, stuecke: plan.stuecke.slice(0, -1) }, berichte.slice(0, -1)), /deckt src\/wort\.js nicht lückenlos ab/);
  assert.throws(() => vereineStuecke({ ...plan, quellen: plan.quellen.slice(1) }, berichte), /nicht lückenlos/);

  const ordner = probeDirectory(context, {});
  writeFileSync(join(ordner, PLANDATEI), JSON.stringify(plan));
  for (const bericht of berichte.slice(1)) writeFileSync(join(ordner, `stueck-${bericht.stueck.nummer}.json`), JSON.stringify(bericht));
  const lauf = runIn(ordner, process.execPath, [join(REPO_ROOT, "tools/mutationspruefung.mjs"), "--vorher-zusammen", ordner, "--ergebnis", join(ordner, "ergebnis.out")]);
  assert.equal(lauf.status, EXIT_ABBRUCH);
  assert.match(lauf.stderr, /Abbruch: es fehlen die Stücke 1 von/);
});

test("mutationspruefung vorher verteilt: --vorher-zusammen vereint vollständige Stücke und nennt Stücke, Rechenzeit und Getötete", async (context) => {
  const repo = probeRepository(context, DATEIEN);
  const { plan, berichte } = await verteilt(attrappe(repo), KLEINSTE);
  const gezeitet = berichte.map((bericht) => ({ ...bericht, sekunden: bericht.stueck.nummer }));
  const ordner = probeDirectory(context, {});
  writeFileSync(join(ordner, PLANDATEI), JSON.stringify(plan));
  for (const bericht of gezeitet) writeFileSync(join(ordner, `stueck-${bericht.stueck.nummer}.json`), JSON.stringify(bericht));
  const ziel = join(ordner, "ergebnis.out");
  const lauf = runIn(ordner, process.execPath, [join(REPO_ROOT, "tools/mutationspruefung.mjs"), "--vorher-zusammen", ordner, "--ergebnis", ziel]);
  assert.equal(lauf.status, 0, lauf.stderr);
  const vereint = vereineStuecke(plan, gezeitet);
  assert.deepEqual(JSON.parse(readFileSync(ziel, "utf8")), vereint);
  const letztes = plan.stuecke.at(-1);
  const mutanten = vereint.stuecke.reduce((summe, { anzahl }) => summe + anzahl, 0);
  assert.match(lauf.stdout, new RegExp(`^- Stücke: ${plan.stuecke.length}$`, "m"));
  assert.match(lauf.stdout, new RegExp(`^- Rechenzeit aller Stücke zusammen: ${(plan.stuecke.length * (plan.stuecke.length + 1)) / 2} s$`, "m"));
  assert.match(lauf.stdout, new RegExp(`^- Längstes Stück: Stück ${letztes.nummer} \\(${letztes.datei}:${letztes.zeilen[0].join("-")}\\) mit ${letztes.nummer} s$`, "m"));
  assert.match(lauf.stdout, new RegExp(`^- Mutanten: ${mutanten}, davon getötet: ${vereint.getoetet.length}$`, "m"));
});

test("mutationspruefung vorher verteilt: mehr Stücke, als eine Matrix fasst, passen sich in die Matrix ein und messen dieselben Mutanten wie am Stück", async (context) => {
  const repo = probeRepository(context, VIELE_DATEIEN);
  const werkzeug = attrappe(repo);
  const amStueck = await vorherGetoetet(VIELE_STAND.basis, VIELE_STAND.tests, werkzeug);
  const plan = await vorherPlan(VIELE_STAND, werkzeug, KLEINSTE);
  assert.ok(plan.stuecke.length <= MATRIX_HOECHSTENS, `${plan.stuecke.length} Stücke`);
  assert.ok(plan.stuecke.length > MATRIX_HOECHSTENS / ZWEI, `${plan.stuecke.length} Stücke sind gröber als nötig`);
  assert.ok(plan.stuecke.every(({ knoten }) => knoten <= KNOTEN_ZWEIER_ANWEISUNGEN), "die kleinste passende Grenze fasst je Stück höchstens zwei Anweisungen");
  const berichte = [];
  for (const stueck of plan.stuecke) berichte.push(await vorherStueck(VIELE_STAND, stueck, werkzeug));
  const vereint = vereineStuecke(plan, berichte);
  assert.ok(amStueck.getoetet.length > MATRIX_HOECHSTENS);
  assert.deepEqual(schluessel(vereint.getoetet), schluessel(amStueck.getoetet));
});

test("mutationspruefung vorher verteilt: kleine Messmengen bekommen genau die Stücke aus der Stückgröße", async (context) => {
  const repo = probeRepository(context, DATEIEN);
  for (const { stueckSekunden, stuecke } of STUECKE_HEUTE) {
    const plan = await vorherPlan(STAND, attrappe(repo), stueckSekunden);
    assert.deepEqual(plan.stuecke, stuecke.map((stueck, index) => ({ nummer: index + 1, ...stueck })), `${stueckSekunden} s`);
  }
});

test("mutationspruefung vorher verteilt: mehr Quelldateien, als eine Matrix fasst, brechen mit den Zahlen ab", async (context) => {
  const anzahl = MATRIX_HOECHSTENS + 1;
  const quellen = Object.fromEntries(Array.from({ length: anzahl }, (_wert, index) => [`src/q${index}.js`, `export const wert = ${index};\n`]));
  const importe = Object.keys(quellen).map((datei, index) => `export { wert as w${index} } from "../${datei}";`).join("\n");
  const repo = probeRepository(context, { ...DATEIEN, ...quellen, "test/viele.test.js": `${importe}\n` });
  await assert.rejects(vorherPlan(VIELE_STAND, attrappe(repo), KLEINSTE), new RegExp(`^Error: ${anzahl} Quelldateien brauchen je ein eigenes Stück, zusammen mit 0 weiteren für große Anweisungen; die Matrix fasst ${MATRIX_HOECHSTENS}`));
});

test("mutationspruefung vorher verteilt: eine Messmenge, die selbst in der vollen Matrix über der Grenze läge, bricht mit den Zahlen ab", async (context) => {
  const repo = probeRepository(context, VIELE_DATEIEN);
  const grenze = sekundenFuer(KAPPE_UEBER_EINER_ANWEISUNG);
  await assert.rejects(
    geschnittenerPlan(VIELE_STAND, attrappe(repo), grenze),
    new RegExp(`^Error: ${KNOTEN_UEBER_DER_MATRIX} Knoten gegen 1 Testdateien passen nicht in die Matrix: bei ${MATRIX_HOECHSTENS} Stücken bräuchte das längste geschätzt ${Math.round(sekundenFuer(KNOTEN_ZWEIER_ANWEISUNGEN))} s, erlaubt sind ${Math.round(grenze)} s`),
  );
  await assert.doesNotReject(geschnittenerPlan(VIELE_STAND, attrappe(repo), sekundenFuer(KNOTEN_ZWEIER_ANWEISUNGEN)));
});

test("mutationspruefung vorher verteilt: eine Anweisung über der Grenze wird nach Mutanten-Stellen geteilt, die Stellen decken jeden Mutanten genau einmal", async (context) => {
  const repo = probeRepository(context, DATEIEN);
  const plan = await geschnittenerPlan(STAND, attrappe(repo), sekundenFuer(KAPPE_IN_EINORDNEN));
  const geteilt = plan.stuecke.filter(({ datei, zeilen }) => datei === "src/rechnen.js" && zeilen[0][0] === EINORDNEN_ERSTE_ZEILE);
  assert.ok(geteilt.length > 1, `${geteilt.length} Teile`);
  assert.deepEqual(geteilt.map(({ stueck }) => stueck), geteilt.map((_teil, index) => index + 1));
  assert.ok(geteilt.every(({ stuecke, knoten }) => stuecke === geteilt.length && knoten <= KAPPE_IN_EINORDNEN + 1), JSON.stringify(geteilt.map(({ knoten }) => knoten)));
  chdir(repo);
  context.after(() => chdir(REPO_ROOT));
  const orte = nachOrt(await mutantenListe("src/rechnen.js", geteilt[0].zeilen)).map(([erster]) => ortsschluessel(erster.lage));
  assert.deepEqual(geteilt.flatMap((teil) => teil.orte.map(ortsschluessel)).sort(), orte.sort());
  const unberuehrt = await vorherPlan(STAND, attrappe(repo), KLEINSTE);
  assert.ok(unberuehrt.stuecke.every(({ orte: stellen }) => stellen === undefined), "der Plan ohne Grenze bleibt bei Zeilenbereichen");
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
