import assert from "node:assert/strict";
import { test } from "node:test";

import { STUECK_MINDEST_MS, aufteilen, einheitGewicht, einheitName, stueckeln } from "../../tools/mutationspruefung/teile.mjs";

const SCHWER = STUECK_MINDEST_MS * 100;

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
  const mutanten = Array.from({ length: 12 }, (_leer, index) => mutant(index + 1));
  const stuecke = stueckeln([einheit("src/a.js", mutanten, SCHWER), einheit("src/b.js", [mutant(1)], STUECK_MINDEST_MS)], 4);
  const vonA = stuecke.filter(({ datei }) => datei === "src/a.js");
  assert.ok(vonA.length > 1, `${vonA.length} Stücke`);
  assert.deepEqual(schluesselAller(vonA), mutanten.map(({ schluessel }) => schluessel).sort());
  assert.deepEqual(vonA.map(({ stueck }) => stueck), Array.from({ length: vonA.length }, (_leer, index) => index + 1));
  assert.ok(vonA.every(({ stuecke: anzahl, mutanten: eigene }) => anzahl === vonA.length && eigene.length > 0));
  assert.deepEqual(vonA[0].alleMutanten, mutanten);
  assert.ok(vonA.slice(1).every((stueck) => stueck.alleMutanten === undefined));
});

test("Mutanten an derselben Stelle bleiben im selben Stück", () => {
  const mutanten = Array.from({ length: 6 }, (_leer, index) => [mutant(index + 1, "EqualityOperator"), mutant(index + 1, "ConditionalExpression")]).flat();
  const stuecke = stueckeln([einheit("src/a.js", mutanten, SCHWER)]);
  for (const stueck of stuecke) {
    const zeilen = new Set(stueck.mutanten.map(({ zeilen: [zeile] }) => zeile));
    for (const zeile of zeilen) assert.equal(stueck.mutanten.filter(({ zeilen: [eigene] }) => eigene === zeile).length, 2, `Zeile ${zeile}`);
  }
  assert.equal(stuecke.length, 6);
});

test("es gibt nie mehr Stücke als Stellen mit Mutanten, und eine Einheit ohne Mutantenliste bleibt ganz", () => {
  assert.equal(stueckeln([einheit("src/a.js", [mutant(1), mutant(2)], SCHWER)]).length, 2);
  assert.equal(stueckeln([einheit("src/a.js", null, SCHWER)]).length, 1);
});

test("die Teile werden nach Last gefüllt: der längste Teil ist nicht länger als die schwerste Einheit oder der Durchschnitt nötig macht", () => {
  const gewichte = [90, 10, 10, 10, 10, 10, 10, 10, 10, 10];
  const einheiten = gewichte.map((gewicht, index) => einheit(`src/${index}.js`, [mutant(1)], gewicht * STUECK_MINDEST_MS));
  const teile = aufteilen([...einheiten, ...einheiten.map((eintrag) => ({ ...eintrag, anteil: 2 }))]);
  assert.equal(teile.length, 20);
  assert.equal(laengster(teile), 90 * STUECK_MINDEST_MS);
  assert.ok(teile.every((teil) => teil.length > 0));
});

test("bei mehr Einheiten als Plätzen trägt kein Teil mehr als nötig", () => {
  const einheiten = Array.from({ length: 600 }, (_leer, index) => einheit(`src/${index}.js`, [mutant(1)], (index % 7) + 1));
  const teile = aufteilen(einheiten);
  const summe = einheiten.reduce((gesamt, { gewicht }) => gesamt + gewicht, 0);
  assert.equal(teile.length, 256);
  assert.ok(laengster(teile) <= Math.ceil(summe / 256) + 7, `längster Teil ${laengster(teile)}`);
  assert.equal(teile.flat().length, 600);
});

test("Einheiten ohne Last verteilen sich gleichmäßig statt alle in den ersten Teil", () => {
  const einheiten = Array.from({ length: 6 }, (_leer, index) => einheit(`src/${index}.js`, [], 0));
  assert.deepEqual(aufteilen(einheiten).map((teil) => teil.length), [1, 1, 1, 1, 1, 1]);
});

test("der Name eines Stücks nennt Testdateien und Mutanten", () => {
  assert.equal(einheitName({ pruefung: 0, datei: "src/a.js", anteil: 2, von: 3, stueck: 1, stuecke: 4 }), "src/a.js (Testdateien 2 von 3, Mutanten 1 von 4)");
  assert.equal(einheitName({ pruefung: 2, datei: "src/a.js", anteil: 1, von: 1 }), "Umbau 2: src/a.js (Testdateien 1 von 1)");
});
