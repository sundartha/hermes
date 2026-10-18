import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ABGEBILDET,
  ENTFAELLT,
  GEMISCHT,
  bildeMutant,
  dateiAbbildung,
  entscheideTotcode,
  zeilenabbildung,
} from "../../tools/tests-ausmisten/zeilenabbildung.mjs";

const DATEI = "src/modul.js";
const DIFF = [
  "diff --git a/src/modul.js b/src/modul.js",
  "index c3dc545..284a563 100644",
  "--- a/src/modul.js",
  "+++ b/src/modul.js",
  "@@ -2,2 +1,0 @@ z1",
  "-z2",
  "-z3",
  "@@ -6,0 +5,3 @@ z6",
  "+a",
  "+b",
  "+c",
  "@@ -9 +10 @@ z8",
  "-z9",
  "+x9",
  "",
].join("\n");
const LEER = "src/leer.js";
const LEER_DIFF = [
  "diff --git a/src/leer.js b/src/leer.js",
  "index df9712c..7f708f1 100644",
  "--- a/src/leer.js",
  "+++ b/src/leer.js",
  "@@ -1,4 +1,4 @@",
  "-function f(a, b) {",
  '-  if (a && b) return "x";',
  '-  return "y";',
  "-}",
  "+function f(a, b)  {",
  '+    if (a && b) return "x";',
  '+    return "y";',
  "+  }",
  "",
].join("\n");
const AM_ANFANG_EINGEFUEGT = "@@ -0,0 +1 @@\n+neu\n";
const GEFOLGT = {
  [DATEI]: { kopf: DATEI, diff: DIFF },
  [LEER]: { kopf: LEER, diff: LEER_DIFF },
};
const GEMISCHTER_MUTANT = `${DATEI}:8:0-9:4 LogicalOperator → a && b`;
const LEER_BLOCK = `${LEER}:1:17-4:1 BlockStatement → {}`;
const LEER_X = `${LEER}:2:21-2:24 StringLiteral → ""`;
const LEER_Y = `${LEER}:3:9-3:12 StringLiteral → ""`;

function entscheide(basis, kopf, abbildung = GEFOLGT) {
  return entscheideTotcode({ basis, kopf, abbildung });
}

function erwarteRot(ergebnis, ...teile) {
  assert.equal(ergebnis.gruen, false);
  assert.ok(
    ergebnis.gruende.some((grund) => teile.every((teil) => grund.includes(teil))),
    ergebnis.gruende.join("\n"),
  );
}

function erwarteGruen(ergebnis) {
  assert.equal(ergebnis.gruen, true, ergebnis.gruende.join("\n"));
}

test("ausmisten-zeilenabbildung: unveränderte Zeilen wandern mit dem Versatz nach oben und nach unten", () => {
  const zeile = zeilenabbildung(DIFF);
  assert.deepEqual([1, 4, 5, 6, 7, 8, 10].map(zeile), [1, 2, 3, 4, 8, 9, 11]);
});

test("ausmisten-zeilenabbildung: geänderte und gelöschte Zeilen haben keine Abbildung", () => {
  const zeile = zeilenabbildung(DIFF);
  assert.deepEqual([2, 3, 9].map(zeile), [undefined, undefined, undefined]);
});

test("ausmisten-zeilenabbildung: eine am Dateianfang eingefügte Zeile verschiebt alle Zeilen", () => {
  assert.equal(zeilenabbildung(AM_ANFANG_EINGEFUEGT)(1), 2);
});

test("ausmisten-zeilenabbildung: ein Mutant auf unveränderten Zeilen behält Spalten, Mutator und Ersatz", () => {
  const unten = bildeMutant(`${DATEI}:7:4-8:2 ConditionalExpression → true`, GEFOLGT[DATEI]);
  const oben = bildeMutant(`${DATEI}:4:0-5:3 StringLiteral → ""`, GEFOLGT[DATEI]);
  assert.deepEqual(unten, {
    art: ABGEBILDET,
    schluessel: `${DATEI}:8:4-9:2 ConditionalExpression → true`,
  });
  assert.deepEqual(oben, { art: ABGEBILDET, schluessel: `${DATEI}:2:0-3:3 StringLiteral → ""` });
});

test("ausmisten-zeilenabbildung: ein Mutant nur in reinen Lösch-Hunks entfällt", () => {
  const mutant = `${DATEI}:2:0-3:5 BlockStatement → {}`;
  assert.deepEqual(bildeMutant(mutant, GEFOLGT[DATEI]), { art: ENTFAELLT });
  assert.deepEqual(entscheide({ [mutant]: "Killed" }, {}), {
    gruen: true,
    gruende: [],
    abgebildet: 0,
    gemischt: 0,
    entfallen: 1,
  });
});

test("ausmisten-zeilenabbildung: ein Mutant nur in einem Änderungs-Hunk ist gemischt und ohne Gegenstück rot", () => {
  const mutant = `${DATEI}:9:0-9:2 StringLiteral → ""`;
  assert.equal(bildeMutant(mutant, GEFOLGT[DATEI]).art, GEMISCHT);
  erwarteRot(entscheide({ [mutant]: "Killed" }, {}), "Gemischter Mutant", mutant);
  erwarteGruen(
    entscheide({ [mutant]: "Killed" }, { [`${DATEI}:10:0-10:2 StringLiteral → ""`]: "Killed" }),
  );
});

test("ausmisten-zeilenabbildung: ein Mutant über geänderte und unveränderte Zeilen oder über eine Einfügung ist gemischt", () => {
  assert.equal(bildeMutant(GEMISCHTER_MUTANT, GEFOLGT[DATEI]).art, GEMISCHT);
  assert.equal(bildeMutant(`${DATEI}:1:0-2:2 BlockStatement → {}`, GEFOLGT[DATEI]).art, GEMISCHT);
  assert.equal(bildeMutant(`${DATEI}:6:0-7:1 BlockStatement → {}`, GEFOLGT[DATEI]).art, GEMISCHT);
});

test("ausmisten-zeilenabbildung: ein gemischter Mutant mit getötetem Gegenstück im Kopf ist grün", () => {
  const ergebnis = entscheide(
    { [GEMISCHTER_MUTANT]: "Killed" },
    { [`${DATEI}:9:0-10:6 LogicalOperator →  a  &&  b `]: "Killed" },
  );
  erwarteGruen(ergebnis);
  assert.equal(ergebnis.gemischt, 1);
  erwarteGruen(
    entscheide(
      { [`${DATEI}:6:0-7:1 BlockStatement → {}`]: "Killed" },
      { [`${DATEI}:4:0-8:1 BlockStatement → {}`]: "Killed" },
    ),
  );
});

test("ausmisten-zeilenabbildung: ein gemischter Mutant ohne getötetes Gegenstück im Kopf ist rot", () => {
  const ohne = [
    {},
    { [`${DATEI}:9:0-10:6 LogicalOperator → a && b`]: "Survived" },
    { [`${DATEI}:9:0-10:6 ConditionalExpression → a && b`]: "Killed" },
    { [`${DATEI}:9:0-10:6 LogicalOperator → x9 || b`]: "Killed" },
    { [`${DATEI}:10:0-10:6 LogicalOperator → a && b`]: "Killed" },
    { [`${DATEI}:9:0-11:2 LogicalOperator → a && b`]: "Killed" },
    { [`src/anderes.js:9:0-10:6 LogicalOperator → a && b`]: "Killed" },
  ];
  for (const kopf of ohne)
    erwarteRot(
      entscheide({ [GEMISCHTER_MUTANT]: "Killed" }, kopf),
      "Gemischter Mutant",
      GEMISCHTER_MUTANT,
    );
  erwarteRot(
    entscheide(
      { [`${DATEI}:6:0-7:1 BlockStatement → {}`]: "Killed" },
      { [`${DATEI}:5:0-8:1 BlockStatement → {}`]: "Killed" },
    ),
    "Gemischter Mutant",
  );
});

test("ausmisten-zeilenabbildung: eine Leerzeichenänderung über alle Zeilen einer Funktion braucht ein getötetes Gegenstück", () => {
  assert.equal(bildeMutant(LEER_BLOCK, GEFOLGT[LEER]).art, GEMISCHT);
  erwarteRot(entscheide({ [LEER_BLOCK]: "Killed" }, {}), "Gemischter Mutant", LEER_BLOCK);
  erwarteRot(
    entscheide(
      { [LEER_BLOCK]: "Killed" },
      { [`${LEER}:1:18-4:3 BlockStatement → {}`]: "Survived" },
    ),
    LEER_BLOCK,
  );
  erwarteGruen(
    entscheide({ [LEER_BLOCK]: "Killed" }, { [`${LEER}:1:18-4:3 BlockStatement → {}`]: "Killed" }),
  );
});

test("ausmisten-zeilenabbildung: ein Kopf-Mutant deckt höchstens einen gemischten Basis-Mutanten", () => {
  const basis = { [LEER_X]: "Killed", [LEER_Y]: "Killed" };
  const gegenstueckX = `${LEER}:2:23-2:26 StringLiteral → ""`;
  const gegenstueckY = `${LEER}:3:11-3:14 StringLiteral → ""`;
  erwarteRot(entscheide(basis, { [gegenstueckX]: "Killed" }), "Gemischter Mutant");
  erwarteRot(
    entscheide(basis, { [gegenstueckX]: "Killed", [gegenstueckY]: "Survived" }),
    "Gemischter Mutant",
  );
  erwarteGruen(entscheide(basis, { [gegenstueckX]: "Killed", [gegenstueckY]: "Killed" }));
  const breit = `${LEER}:1:0-4:3 StringLiteral → ""`;
  erwarteGruen(entscheide(basis, { [breit]: "Killed", [gegenstueckY]: "Killed" }));
});

test("ausmisten-zeilenabbildung: ein abgebildeter Kopf-Mutant deckt keinen gemischten Basis-Mutanten mit", () => {
  const abgebildet = `${DATEI}:1:0-1:2 BlockStatement → {}`;
  const gemischt = `${DATEI}:1:0-2:2 BlockStatement → {}`;
  const kopf = { [abgebildet]: "Killed" };
  erwarteGruen(entscheide({ [abgebildet]: "Killed" }, kopf));
  erwarteGruen(entscheide({ [gemischt]: "Killed" }, kopf));
  erwarteRot(
    entscheide({ [abgebildet]: "Killed", [gemischt]: "Killed" }, kopf),
    "Gemischter Mutant",
    gemischt,
  );
});

test("ausmisten-zeilenabbildung: ein abgebildeter Mutant, der im Kopf überlebt, ist rot mit Schlüssel im Grund", () => {
  const alt = `${DATEI}:7:4-8:2 ConditionalExpression → true`;
  const neu = `${DATEI}:8:4-9:2 ConditionalExpression → true`;
  erwarteRot(entscheide({ [alt]: "Killed" }, { [neu]: "Survived" }), alt, neu, "Survived");
  erwarteRot(entscheide({ [alt]: "Killed" }, { [alt]: "Killed" }), alt, neu);
  erwarteGruen(entscheide({ [alt]: "Killed" }, { [neu]: "Killed" }));
});

test("ausmisten-zeilenabbildung: ein im Kopf nicht gemessener Mutant ist rot", () => {
  const alt = `${DATEI}:7:4-8:2 ConditionalExpression → true`;
  erwarteRot(entscheide({ [alt]: "Killed" }, {}), alt, "nicht gemessen");
});

test("ausmisten-zeilenabbildung: Timeout im Kopf ohne Timeout in der Basis ist rot", () => {
  const alt = `${DATEI}:1:0-1:2 StringLiteral → ""`;
  erwarteRot(entscheide({ [alt]: "Killed" }, { [alt]: "Timeout" }), alt, "Timeout");
  erwarteRot(entscheide({ [alt]: "Killed" }, { [alt]: "RuntimeError" }), alt, "RuntimeError");
  erwarteGruen(entscheide({ [alt]: "Timeout" }, { [alt]: "Timeout" }));
  erwarteRot(
    entscheide({ [LEER_BLOCK]: "Killed" }, { [`${LEER}:1:18-4:3 BlockStatement → {}`]: "Timeout" }),
    LEER_BLOCK,
  );
  erwarteGruen(
    entscheide(
      { [LEER_BLOCK]: "Timeout" },
      { [`${LEER}:1:18-4:3 BlockStatement → {}`]: "Timeout" },
    ),
  );
});

test("ausmisten-zeilenabbildung: nur auf der Basis getötete Mutanten werden abgebildet", () => {
  const basis = {
    [`${DATEI}:1:0-1:2 StringLiteral → ""`]: "Survived",
    [`${DATEI}:9:0-9:2 StringLiteral → ""`]: "NoCoverage",
  };
  assert.deepEqual(entscheide(basis, {}), {
    gruen: true,
    gruende: [],
    abgebildet: 0,
    gemischt: 0,
    entfallen: 0,
  });
});

test("ausmisten-zeilenabbildung: die Mutanten einer gelöschten Quelldatei entfallen", () => {
  const datei = "src/tot.js";
  const abbildung = {
    [datei]: dateiAbbildung({ datei, geloescht: new Set([datei]), umbenannt: [], diff: undefined }),
  };
  const ergebnis = entscheide(
    { [`${datei}:3:0-3:9 BlockStatement → {}`]: "Killed" },
    {},
    abbildung,
  );
  assert.deepEqual(ergebnis, {
    gruen: true,
    gruende: [],
    abgebildet: 0,
    gemischt: 0,
    entfallen: 1,
  });
});

test("ausmisten-zeilenabbildung: eine umbenannte Quelldatei ohne Abbildung ist rot", () => {
  const datei = "src/alt.js";
  const alt = `${datei}:3:0-3:9 BlockStatement → {}`;
  const umbenannt = [
    [{ alt: datei, neu: "src/neu.js" }],
    [{ alt: datei, neu: "src/alt.ts", nurTypen: false }],
  ];
  for (const paare of umbenannt) {
    const eintrag = dateiAbbildung({
      datei,
      geloescht: new Set([datei]),
      umbenannt: paare,
      diff: "",
    });
    erwarteRot(entscheide({ [alt]: "Killed" }, {}, { [datei]: eintrag }), alt, paare[0].neu);
  }
});

test("ausmisten-zeilenabbildung: einer Umbenennung, die nur Typen ergänzt, wird gefolgt", () => {
  const datei = "src/alt.js";
  const paare = [{ alt: datei, neu: "src/alt.ts", nurTypen: true }];
  const eintrag = dateiAbbildung({
    datei,
    geloescht: new Set([datei]),
    umbenannt: paare,
    diff: AM_ANFANG_EINGEFUEGT,
  });
  const ergebnis = entscheide(
    { [`${datei}:3:0-3:9 BlockStatement → {}`]: "Killed" },
    { ["src/alt.ts:4:0-4:9 BlockStatement → {}"]: "Killed" },
    { [datei]: eintrag },
  );
  erwarteGruen(ergebnis);
  assert.equal(ergebnis.abgebildet, 1);
});

test("ausmisten-zeilenabbildung: eine Quelldatei ohne Eintrag oder ohne Diff ist rot", () => {
  const alt = `src/fremd.js:1:0-1:2 StringLiteral → ""`;
  erwarteRot(entscheide({ [alt]: "Killed" }, { [alt]: "Killed" }), "Keine Zeilenabbildung", alt);
  const ohneDiff = { "src/fremd.js": { kopf: "src/fremd.js" } };
  erwarteRot(
    entscheide({ [alt]: "Killed" }, { [alt]: "Killed" }, ohneDiff),
    "Keine Zeilenabbildung",
    alt,
  );
  const datei = "src/alt.js";
  const typenOhneDiff = dateiAbbildung({
    datei,
    geloescht: new Set([datei]),
    umbenannt: [{ alt: datei, neu: "src/alt.ts", nurTypen: true }],
    diff: undefined,
  });
  erwarteRot(
    entscheide(
      { [`${datei}:1:0-1:2 StringLiteral → ""`]: "Killed" },
      {},
      { [datei]: typenOhneDiff },
    ),
    "Keine Zeilenabbildung",
  );
  erwarteRot(entscheide({ unlesbar: "Killed" }, {}), "Schlüssel nicht lesbar");
  const rueckwaerts = `${DATEI}:3:0-2:2 BlockStatement → {}`;
  erwarteRot(entscheide({ [rueckwaerts]: "Killed" }, {}), "Schlüssel nicht lesbar", rueckwaerts);
});
