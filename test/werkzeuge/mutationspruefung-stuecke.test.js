import assert from "node:assert/strict";
import { test } from "node:test";

import { MATRIX_HOECHSTENS, STUECK_MINDEST_MS, aufteilen, einheitGewicht, einheitName, stueckeln } from "../../tools/mutationspruefung/teile.mjs";
import { uebernommen } from "../../tools/mutationspruefung/uebernahme.mjs";
import { instrumenterOptionen } from "../../tools/mutationspruefung/vorplanung.mjs";

const SCHWER = STUECK_MINDEST_MS * 100;
const SCHWERSTE_EINHEIT = 90;
const LEICHTE_EINHEIT = 10;
const LEICHTE_EINHEITEN = 9;
const ANTEILE_JE_EINHEIT = 2;
const EINHEITEN_UEBER_PLAETZEN = 600;
const GROESSTES_GEWICHT = 7;
const MUTANTEN_DER_SCHWEREN_EINHEIT = 12;
const PLAETZE_IN_DER_MATRIX = 4;
const STELLEN_MIT_MUTANTEN = 6;
const MUTANTEN_JE_STELLE = 2;
const EINHEITEN_OHNE_LAST = 6;

function lage(zeile, spalte = 1) {
  return { start: { line: zeile, column: spalte }, end: { line: zeile, column: spalte + 5 } };
}

function mutant(zeile, art = "ConditionalExpression", spalte = 1) {
  return { schluessel: `src/a.js:${zeile}:${spalte} ${art}`, lage: lage(zeile, spalte), zeilen: [zeile, zeile], art };
}

function einheit(datei, mutanten, gewicht) {
  return { pruefung: 0, datei, bereiche: [[1, 99]], anteil: 1, von: 1, mutanten, gewicht };
}

function schluesselAller(stuecke) {
  return stuecke.flatMap(({ mutanten }) => mutanten.map(({ schluessel }) => schluessel)).sort();
}

function laengster(teile) {
  return Math.max(...teile.map((teil) => teil.reduce((summe, { gewicht }) => summe + gewicht, 0)));
}

test("das Gewicht einer Einheit ist die gemessene Dauer ihrer Testdateien je Mutant plus ein Erstlauf", () => {
  const dauern = { "test/a.test.js": 1000, "test/b.test.js": 3000 };
  const faelle = [
    { mutanten: [mutant(1), mutant(2)], tests: ["test/a.test.js", "test/b.test.js"], erwartet: 3 * 4000 },
    { mutanten: [], tests: ["test/a.test.js"], erwartet: 1000 },
    { mutanten: null, tests: ["test/b.test.js"], erwartet: 3000 },
    { mutanten: [mutant(1)], tests: ["test/neu.test.js"], erwartet: 2 * 3000 },
  ];
  for (const { mutanten, tests, erwartet } of faelle) assert.equal(einheitGewicht(mutanten, tests, dauern), erwartet, JSON.stringify(tests));
  assert.equal(einheitGewicht([mutant(1)], ["test/a.test.js"], null), undefined);
  assert.equal(einheitGewicht([mutant(1)], ["test/a.test.js"], {}), undefined);
});

test("ohne gemessene Laufzeiten bleibt jede Einheit ganz und die Teile gehen reihum wie bisher", () => {
  const einheiten = ["a", "b", "c"].map((name) => einheit(`src/${name}.js`, [mutant(1), mutant(2)], undefined));
  const stuecke = stueckeln(einheiten);
  assert.deepEqual(stuecke.map(({ stueck, stuecke: anzahl }) => [stueck, anzahl]), [[1, 1], [1, 1], [1, 1]]);
  assert.deepEqual(aufteilen(stuecke).map((teil) => teil.map(({ datei }) => datei)), [["src/a.js"], ["src/b.js"], ["src/c.js"]]);
});

test("eine leichte Einheit unter der Mindestdauer wird nicht geteilt", () => {
  const stuecke = stueckeln([einheit("src/a.js", [mutant(1), mutant(2), mutant(3)], STUECK_MINDEST_MS)]);
  assert.equal(stuecke.length, 1);
  assert.equal(stuecke[0].stuecke, 1);
});

test("eine schwere Einheit wird in Stücke geteilt, jeder Mutant liegt in genau einem Stück", () => {
  const mutanten = Array.from({ length: MUTANTEN_DER_SCHWEREN_EINHEIT }, (_leer, index) => mutant(index + 1));
  const stuecke = stueckeln([einheit("src/a.js", mutanten, SCHWER), einheit("src/b.js", [mutant(1)], STUECK_MINDEST_MS)], PLAETZE_IN_DER_MATRIX);
  const vonA = stuecke.filter(({ datei }) => datei === "src/a.js");
  assert.ok(vonA.length > 1, `${vonA.length} Stücke`);
  assert.deepEqual(schluesselAller(vonA), mutanten.map(({ schluessel }) => schluessel).sort());
  assert.deepEqual(vonA.map(({ stueck }) => stueck), Array.from({ length: vonA.length }, (_leer, index) => index + 1));
  assert.ok(vonA.every(({ stuecke: anzahl, mutanten: eigene }) => anzahl === vonA.length && eigene.length > 0));
  assert.deepEqual(vonA[0].alleMutanten, mutanten);
  assert.ok(vonA.slice(1).every((stueck) => stueck.alleMutanten === undefined));
});

test("Mutanten an derselben Stelle bleiben im selben Stück", () => {
  const mutanten = Array.from({ length: STELLEN_MIT_MUTANTEN }, (_leer, index) => [mutant(index + 1, "EqualityOperator"), mutant(index + 1, "ConditionalExpression")]).flat();
  const stuecke = stueckeln([einheit("src/a.js", mutanten, SCHWER)]);
  for (const stueck of stuecke) {
    const zeilen = new Set(stueck.mutanten.map(({ zeilen: [zeile] }) => zeile));
    for (const zeile of zeilen) assert.equal(stueck.mutanten.filter(({ zeilen: [eigene] }) => eigene === zeile).length, MUTANTEN_JE_STELLE, `Zeile ${zeile}`);
  }
  assert.equal(stuecke.length, STELLEN_MIT_MUTANTEN);
});

test("es gibt nie mehr Stücke als Stellen mit Mutanten, und eine Einheit ohne Mutantenliste bleibt ganz", () => {
  assert.equal(stueckeln([einheit("src/a.js", [mutant(1), mutant(2)], SCHWER)]).length, 2);
  assert.equal(stueckeln([einheit("src/a.js", null, SCHWER)]).length, 1);
});

test("die Teile werden nach Last gefüllt: der längste Teil ist nicht länger als die schwerste Einheit oder der Durchschnitt nötig macht", () => {
  const gewichte = [SCHWERSTE_EINHEIT, ...Array.from({ length: LEICHTE_EINHEITEN }, () => LEICHTE_EINHEIT)];
  const einheiten = gewichte.map((gewicht, index) => einheit(`src/${index}.js`, [mutant(1)], gewicht * STUECK_MINDEST_MS));
  const teile = aufteilen([...einheiten, ...einheiten.map((eintrag) => ({ ...eintrag, anteil: ANTEILE_JE_EINHEIT }))]);
  assert.equal(teile.length, gewichte.length * ANTEILE_JE_EINHEIT);
  assert.equal(laengster(teile), SCHWERSTE_EINHEIT * STUECK_MINDEST_MS);
  assert.ok(teile.every((teil) => teil.length > 0));
});

test("bei mehr Einheiten als Plätzen trägt kein Teil mehr als nötig", () => {
  const einheiten = Array.from({ length: EINHEITEN_UEBER_PLAETZEN }, (_leer, index) => einheit(`src/${index}.js`, [mutant(1)], (index % GROESSTES_GEWICHT) + 1));
  const teile = aufteilen(einheiten);
  const summe = einheiten.reduce((gesamt, { gewicht }) => gesamt + gewicht, 0);
  assert.equal(teile.length, MATRIX_HOECHSTENS);
  assert.ok(laengster(teile) <= Math.ceil(summe / MATRIX_HOECHSTENS) + GROESSTES_GEWICHT, `längster Teil ${laengster(teile)}`);
  assert.equal(teile.flat().length, EINHEITEN_UEBER_PLAETZEN);
});

test("Einheiten ohne Last verteilen sich gleichmäßig statt alle in den ersten Teil", () => {
  const einheiten = Array.from({ length: EINHEITEN_OHNE_LAST }, (_leer, index) => einheit(`src/${index}.js`, [], 0));
  assert.deepEqual(aufteilen(einheiten).map((teil) => teil.length), Array.from({ length: EINHEITEN_OHNE_LAST }, () => 1));
});

test("der Name eines Stücks nennt Testdateien und Mutanten", () => {
  assert.equal(einheitName({ pruefung: 0, datei: "src/a.js", anteil: 2, von: 3, stueck: 1, stuecke: 4 }), "src/a.js (Testdateien 2 von 3, Mutanten 1 von 4)");
  assert.equal(einheitName({ pruefung: 2, datei: "src/a.js", anteil: 1, von: 1 }), "Umbau 2: src/a.js (Testdateien 1 von 1)");
});

test("ohne aufgezählte Mutanten übernimmt die Teilung keinen Beleg, mit ihnen den passenden", () => {
  const getoetet = { ...mutant(3), toeter: ["test/a.test.js"], stand: "stand-a" };
  const index = new Map([["neu", new Map([["src/a.js", new Map([[getoetet.schluessel, [{ seite: "neu", lauf: 4711, eintrag: getoetet }]]])]])]]);
  const kontext = { pruefung: 0, echt: true, index, tests: { vorher: {}, jetzt: {} } };
  const lageMit = (mutanten) => ({ seite: "neu", mutanten, alle: ["test/a.test.js"], stand: () => "stand-a" });
  const faelle = [
    [null, null],
    [[mutant(3)], [getoetet.schluessel]],
  ];
  for (const [mutanten, erwartet] of faelle) assert.deepEqual(uebernommen(kontext, "src/a.js", lageMit(mutanten))?.uebernommen.map(({ schluessel }) => schluessel) ?? null, erwartet, JSON.stringify(mutanten));
});

test("die Planung zählt Mutanten mit den Ausschlüssen der Stryker-Konfiguration und lehnt ab, was sie nicht nachbilden kann", () => {
  const ohne = { plugins: null, ignorers: [], excludedMutations: [] };
  const faelle = [
    [{}, ohne],
    [{ mutator: { excludedMutations: ["StringLiteral"] } }, { ...ohne, excludedMutations: ["StringLiteral"] }],
    [{ ignorers: ["eigener-ignorer"] }, null],
    [{ mutator: { plugins: ["eigener-mutator"] } }, null],
  ];
  for (const [konfiguration, erwartet] of faelle) {
    if (erwartet === null) assert.throws(() => instrumenterOptionen(konfiguration), Error, JSON.stringify(konfiguration));
    else assert.deepEqual(instrumenterOptionen(konfiguration), erwartet, JSON.stringify(konfiguration));
  }
});
