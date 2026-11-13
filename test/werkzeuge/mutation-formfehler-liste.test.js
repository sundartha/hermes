import assert from "node:assert/strict";
import { test } from "node:test";

import { mutationUrteil, prTextFormfehler } from "../../tools/pruefen.mjs";

const GRUND = "äquivalent, beide Seiten liefern denselben Wert";
const MUTANT = { schluessel: "src/a.js:3/7", datei: "src/a.js", zeile: "const x = 1;", mutation: "BooleanLiteral: false", ergebnis: "überlebt" };

function urteil(mutanten, aequivalente, prText = "") {
  const vorher = process.env.PR_TEXT;
  process.env.PR_TEXT = prText;
  try {
    return mutationUrteil(mutanten, 1, aequivalente);
  } finally {
    if (vorher === undefined) delete process.env.PR_TEXT;
    else process.env.PR_TEXT = vorher;
  }
}

const vorhanden = () => true;

test("Ein PR-Text ohne Abschnitt Überlebende Mutanten hat keinen Formfehler", () => {
  assert.deepEqual(prTextFormfehler("Closes #1\n", vorhanden), []);
  assert.deepEqual(prTextFormfehler(undefined, vorhanden), []);
});

test("Beide vorgeschriebenen Zeilenformen gelten als Form", () => {
  const text = `## Überlebende Mutanten\n\`src/a.js:3/7\` wird getötet von \`test/a.test.js\`\n\`src/a.js:4/8\`: ${GRUND}\n`;
  assert.deepEqual(prTextFormfehler(text, vorhanden), []);
});

test("Ein Schlüssel ohne Backticks oder ohne Mutantennummer ist ein Formfehler", () => {
  for (const zeile of ["src/a.js:3/7 wird getötet von `test/a.test.js`", "`src/a.js:3` wird getötet von `test/a.test.js`", "`src/a.js:3/7` wird getötet durch `test/a.test.js`"]) {
    const fehler = prTextFormfehler(`## Überlebende Mutanten\n${zeile}\n`, vorhanden);
    assert.equal(fehler.length, 1, zeile);
    assert.match(fehler[0], /nicht die vorgeschriebene Form/);
  }
});

test("Eine Begründung unter 20 Zeichen ist ein Formfehler", () => {
  assert.equal(prTextFormfehler("## Überlebende Mutanten\n`src/a.js:3/7`: äquivalent\n", vorhanden).length, 1);
});

test("Eine genannte Testdatei, die es nicht gibt, ist ein Formfehler", () => {
  const fehler = prTextFormfehler("## Überlebende Mutanten\n`src/a.js:3/7` wird getötet von `test/fehlt.test.js`\n", (datei) => datei !== "test/fehlt.test.js");
  assert.equal(fehler.length, 1);
  assert.match(fehler[0], /test\/fehlt\.test\.js` eine Testdatei, die es nicht gibt/);
});

test("Ein überlebender Mutant mit Eintrag in der Liste gilt als begründet", () => {
  const liste = [{ datei: "src/a.js", mutation: "BooleanLiteral: false", zeile: "const x = 1;", grund: GRUND }];
  assert.equal(urteil([MUTANT], liste), true);
});

test("Die Liste gilt nur für dieselbe Datei, Mutation und Zeile und nur mit Begründung ab 20 Zeichen", () => {
  const eintrag = { datei: "src/a.js", mutation: "BooleanLiteral: false", zeile: "const x = 1;", grund: GRUND };
  for (const abweichung of [{ datei: "src/b.js" }, { mutation: "BooleanLiteral: true" }, { zeile: "const x = 2;" }, { grund: "kurz" }]) {
    assert.equal(urteil([MUTANT], [{ ...eintrag, ...abweichung }]), false, JSON.stringify(abweichung));
  }
});

test("Ein getöteter oder nicht geprüfter Mutant wird durch einen Listeneintrag nicht begründet", () => {
  const liste = [{ datei: "src/a.js", mutation: "BooleanLiteral: false", zeile: "const x = 1;", grund: GRUND }];
  assert.equal(urteil([{ ...MUTANT, ergebnis: "nicht geprüft (Frist)" }], liste), false);
});
