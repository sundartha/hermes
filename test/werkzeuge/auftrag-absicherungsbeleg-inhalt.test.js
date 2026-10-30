import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { belegZeilen, vorabGeprueft } from "../../tools/auftrag/absicherungsbeleg.mjs";
import { LAUF, aufbau, pruefe, summen } from "./absicherungsbeleg-hilfen.js";

const FUNKTION_A = ["export function a() {", "  const x = lies();", "  return x + 1;", "}"];
const FUNKTION_B = ["export function b() {", "  const y = schreibe();", "  return y * 2;", "}"];
const FUNKTION_C = ["export function c() {", "  const z = rechne();", "  return z - 3;", "}"];
const KOPF = ["import { lies } from './lies.js';", ""];
const NACH_KOPF = KOPF.length + 1;
const NACH_FUNKTION_A = NACH_KOPF + FUNKTION_A.length;
const WEIT_DAHINTER = 100;

function block(zeilen, von = 1, datei = "src/m.js") {
  return { datei, von, pruefsummen: summen(zeilen) };
}

function ohne(quelle, zeilen) {
  const start = quelle.findIndex((zeile, index) => zeilen.every((andere, versatz) => quelle[index + versatz] === andere));
  return [...quelle.slice(0, start), ...quelle.slice(start + zeilen.length)];
}

function belegVon(stand, bloecke = [block(stand)]) {
  return { bloecke, dateien: { "src/m.js": summen(stand) } };
}

function gedecktDurch(context, { quelle, entfernt, beleg }) {
  return pruefe(context, { quelle, geaendert: ohne(quelle, entfernt), beleg });
}

function istVerworfen(ergebnis) {
  assert.equal(ergebnis.weglassen, false);
  assert.match(ergebnis.grund, /nicht wortgleich/);
}

test("ein geprüfter Block, der durch frühere Aufträge an eine andere Zeilennummer gerutscht ist, gilt als gedeckt", (context) => {
  const geprueft = [...KOPF, ...FUNKTION_A, ...FUNKTION_B, ...FUNKTION_C];
  const jetzt = [...KOPF, "// neu", "// neu 2", "// neu 3", ...FUNKTION_B, ...FUNKTION_C];
  const ergebnis = gedecktDurch(context, { quelle: jetzt, entfernt: FUNKTION_B, beleg: belegVon(geprueft) });
  assert.equal(ergebnis.weglassen, true, ergebnis.grund);
  assert.equal(ergebnis.lauf, LAUF);
});

test("ein einziges anderes Zeichen im Block macht ihn ungedeckt", (context) => {
  const geprueft = [...KOPF, ...FUNKTION_A, ...FUNKTION_B];
  const abweichend = FUNKTION_B.map((zeile) => zeile.replace("y * 2", "y * 3"));
  const jetzt = [...KOPF, "// neu", ...abweichend];
  istVerworfen(gedecktDurch(context, { quelle: jetzt, entfernt: abweichend, beleg: belegVon(geprueft) }));
});

test("eine Folge, die im geprüften Block zweimal vorkommt, ist nicht eindeutig und gilt als ungedeckt", (context) => {
  const geprueft = [...KOPF, ...FUNKTION_B, ...FUNKTION_A, ...FUNKTION_B];
  const jetzt = [...KOPF, "// neu", ...FUNKTION_A, ...FUNKTION_C, ...FUNKTION_B];
  istVerworfen(gedecktDurch(context, { quelle: jetzt, entfernt: FUNKTION_B, beleg: belegVon(geprueft) }));
});

test("eine Folge, die in zwei verschiedenen geprüften Blöcken vorkommt, ist nicht eindeutig und gilt als ungedeckt", (context) => {
  const jetzt = [...KOPF, "// neu", ...FUNKTION_A, ...FUNKTION_C, ...FUNKTION_B];
  istVerworfen(gedecktDurch(context, { quelle: jetzt, entfernt: FUNKTION_B, beleg: belegVon(FUNKTION_B, [block(FUNKTION_B), block(FUNKTION_B, WEIT_DAHINTER)]) }));
});

test("eine Folge, die auf dem Stand vor dem Auftrag zweimal in der Datei steht, gilt als ungedeckt, auch wenn der Beleg sie nur einmal zeigt", (context) => {
  const jetzt = [...KOPF, "// neu", ...FUNKTION_B, ...FUNKTION_A, ...FUNKTION_B];
  const weg = [...KOPF, "// neu", ...FUNKTION_A, ...FUNKTION_B];
  const ergebnis = pruefe(context, { quelle: jetzt, geaendert: weg, beleg: belegVon([...FUNKTION_B, ...FUNKTION_A], [block([...FUNKTION_B, ...FUNKTION_A], NACH_KOPF)]) });
  istVerworfen(ergebnis);
});

test("eine Folge aus nur leeren Zeilen und Klammern gilt als ungedeckt, auch wenn sie im Beleg einmal vorkommt", (context) => {
  const trivial = ["", "}", ");", "", "]);"];
  const geprueft = [...KOPF, ...FUNKTION_A, ...trivial, ...FUNKTION_C];
  const jetzt = [...KOPF, "// neu", ...FUNKTION_A, ...trivial, ...FUNKTION_C];
  istVerworfen(gedecktDurch(context, { quelle: jetzt, entfernt: trivial, beleg: belegVon(geprueft) }));
});

test("eine einzelne Zeile mit Inhalt gilt als ungedeckt, wenn sie nur an anderer Zeilennummer wiedergefunden wird", (context) => {
  const geprueft = [...KOPF, ...FUNKTION_A, ...FUNKTION_B];
  const jetzt = [...KOPF, "// neu", ...FUNKTION_A, ...FUNKTION_B];
  istVerworfen(gedecktDurch(context, { quelle: jetzt, entfernt: [FUNKTION_B[2]], beleg: belegVon(geprueft) }));
});

test("ein Block, der nur in einer anderen Datei geprüft wurde, deckt den Block in dieser Datei nicht", (context) => {
  const geprueft = [...KOPF, ...FUNKTION_A, ...FUNKTION_B];
  const jetzt = [...KOPF, "// neu", ...FUNKTION_B];
  istVerworfen(gedecktDurch(context, { quelle: jetzt, entfernt: FUNKTION_B, beleg: belegVon(geprueft, [block(geprueft, 1, "src/anders.js")]) }));
});

test("ein Block, der über zwei geprüfte Blöcke derselben Datei reicht, gilt als ungedeckt", (context) => {
  const jetzt = [...KOPF, "// neu", ...FUNKTION_A, ...FUNKTION_B];
  const ergebnis = gedecktDurch(context, { quelle: jetzt, entfernt: [...FUNKTION_A, ...FUNKTION_B], beleg: belegVon([...KOPF, ...FUNKTION_A, ...FUNKTION_B], [block(FUNKTION_A, NACH_KOPF), block(FUNKTION_B, NACH_FUNKTION_A)]) });
  istVerworfen(ergebnis);
});

test("ein Beleg für zwei Aufträge deckt beide ab, ein nicht genannter dritter bleibt ohne Beleg", (context) => {
  const geprueft = [...KOPF, ...FUNKTION_A, ...FUNKTION_B, ...FUNKTION_C];
  const jetzt = [...KOPF, "// neu", "// neu 2", ...FUNKTION_A, ...FUNKTION_B, ...FUNKTION_C];
  const probe = aufbau(context, { quelle: jetzt, auftraege: ["A1", "A2"], beleg: belegVon(geprueft) });
  const fuer = (auftragId, entfernt) => {
    writeFileSync(join(probe.repo, "src/m.js"), `${ohne(jetzt, entfernt).join("\n")}\n`);
    return vorabGeprueft({ root: probe.repo, basis: probe.basis, auftragId });
  };
  const ersten = fuer("A1", FUNKTION_A);
  const zweiten = fuer("A2", FUNKTION_C);
  const dritten = fuer("A3", FUNKTION_B);
  assert.equal(ersten.weglassen, true, ersten.grund);
  assert.equal(zweiten.weglassen, true, zweiten.grund);
  assert.equal(ersten.lauf, LAUF);
  assert.equal(zweiten.lauf, LAUF);
  assert.equal(dritten.weglassen, false);
  assert.equal(dritten.lauf, null);
});

test("eine seit dem Beleg geänderte Testdatei macht auch einen verschobenen Block ungedeckt", (context) => {
  const geprueft = [...KOPF, ...FUNKTION_A, ...FUNKTION_B];
  const jetzt = [...KOPF, "// neu", ...FUNKTION_B];
  const ergebnis = pruefe(context, { quelle: jetzt, geaendert: ohne(jetzt, FUNKTION_B), beleg: belegVon(geprueft) }, (repo) => writeFileSync(join(repo, "test/a.test.js"), "b\n"));
  assert.equal(ergebnis.weglassen, false);
  assert.match(ergebnis.grund, /geändert oder gelöscht: test\/a\.test\.js/);
});

test("eine seit dem Beleg gelöschte Testdatei macht auch einen verschobenen Block ungedeckt", (context) => {
  const geprueft = [...KOPF, ...FUNKTION_A, ...FUNKTION_B];
  const jetzt = [...KOPF, "// neu", ...FUNKTION_B];
  const ergebnis = pruefe(context, { quelle: jetzt, geaendert: ohne(jetzt, FUNKTION_B), beleg: belegVon(geprueft) }, (repo) => rmSync(join(repo, "test/a.test.js")));
  assert.equal(ergebnis.weglassen, false);
  assert.match(ergebnis.grund, /geändert oder gelöscht/);
});

test("eine Folge, die zur Beleg-Zeit zweimal in der Datei stand und deren eine Stelle ein früherer Auftrag entfernt hat, gilt als ungedeckt", (context) => {
  const standZurBelegZeit = [...KOPF, ...FUNKTION_B, ...FUNKTION_A, ...FUNKTION_B];
  const zweiteStelle = NACH_KOPF + FUNKTION_B.length + FUNKTION_A.length;
  const jetzt = [...KOPF, "// neu", ...FUNKTION_A, ...FUNKTION_B];
  istVerworfen(gedecktDurch(context, { quelle: jetzt, entfernt: FUNKTION_B, beleg: belegVon(standZurBelegZeit, [block(FUNKTION_B, zweiteStelle)]) }));
});

test("eine Folge mit genau zwei Zeilen mit Inhalt gilt als gedeckt", (context) => {
  const geprueft = [...KOPF, ...FUNKTION_A, ...FUNKTION_B];
  const jetzt = [...KOPF, "// neu", ...FUNKTION_A, ...FUNKTION_B];
  const ergebnis = gedecktDurch(context, { quelle: jetzt, entfernt: FUNKTION_B.slice(1, 3), beleg: belegVon(geprueft) });
  assert.equal(ergebnis.weglassen, true, ergebnis.grund);
});

test("eine Folge mit nur einer Zeile mit Inhalt und einer Klammerzeile gilt als ungedeckt", (context) => {
  const geprueft = [...KOPF, ...FUNKTION_A, ...FUNKTION_B];
  const jetzt = [...KOPF, "// neu", ...FUNKTION_A, ...FUNKTION_B];
  istVerworfen(gedecktDurch(context, { quelle: jetzt, entfernt: FUNKTION_B.slice(2), beleg: belegVon(geprueft) }));
});

test("ein Beleg ohne den Stand der Dateien zur Beleg-Zeit ist kein gültiger Beleg", (context) => {
  const ergebnis = pruefe(context, { beleg: { dateien: undefined } });
  assert.equal(ergebnis.weglassen, false);
  assert.match(ergebnis.grund, /keinen gültigen Beleg/);
});

test("der Beleg der CI nennt zu jeder Datei mit Blöcken die Prüfsummen ihres ganzen Stands vor der Entfernung", (context) => {
  const probe = aufbau(context, { trailer: false, quelle: [...KOPF, ...FUNKTION_A, ...FUNKTION_B] });
  writeFileSync(join(probe.repo, "src/m.js"), `${[...KOPF, ...FUNKTION_B].join("\n")}\n`);
  const beleg = belegZeilen({ root: probe.repo, basis: probe.basis, urteil: 0 });
  assert.deepEqual(beleg.dateien, { "src/m.js": summen([...KOPF, ...FUNKTION_A, ...FUNKTION_B, ""]) });
});
