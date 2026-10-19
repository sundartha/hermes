import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { EINGANG_QUELLE, GATE_TEST } from "./ausmisten/hilfen.mjs";
import { testDatei } from "./ausmisten/messung.mjs";
import { EXIT_GRUEN, EXIT_ROT, leseStufe, schritt, totcodeLauf } from "./ausmisten/totcode.mjs";

const EINRUECKUNG = 2;
const EINGANG_TEST = "test/post/eingang.test.js";
const LEER_TEST = "test/post/leer.test.js";
const LEER_HILFE = "test/hilfe/leer.js";
const LEER_QUELLE = "src/post/leer.js";
const SPERRE = "src/sperre.js";
const ZWEITER_GATE_TEST = "test/gate-zwei.test.js";
const SPERRE_NUTZER = "test/sperre-nutzer.test.js";
const LEER_FALL = "erkennt den leeren Eingang";
const LEBENDER_FALL = "kürzt den Eingang";
const LEER_PRUEFUNG = 'assert.equal(modul.leer(""), true);';
const EINGANG = "export function eingang(text) {\n  return text.trim();\n}\n";
const LEER_FUNKTION = "export function leer(text) {\n  return text.length === 0;\n}\n";
const MIT_LEER = `${LEER_FUNKTION}\n${EINGANG}`;
const IST_LEER = "export function istLeer(text) {\n  return text.length === 0;\n}\n";
const EINGANG_IMPORT = "../../src/post/eingang.js";
const NEUE_QUELLE = "src/post/kurz.js";
const NAMENS_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  `import { leer } from ${JSON.stringify(EINGANG_IMPORT)};`,
  "",
  `test(${JSON.stringify(LEER_FALL)}, () => {`,
  '  assert.equal(leer(""), true);',
  "});",
  "",
].join("\n");
const ALTE_SPERRE = "export function alteSperre(ziel) {\n  return ziel === '+900';\n}\n\n";
const SPERRE_TEXT = "export function gesperrt(ziel) {\n  return ziel.startsWith('+900');\n}\n";

const LEER_MUTANT = {
  datei: EINGANG_QUELLE,
  text: "text.length === 0",
  mutator: "EqualityOperator",
  ersatz: "text.length !== 0",
  toetend: [LEER_TEST],
};

function trimMutant(toetend) {
  return {
    datei: EINGANG_QUELLE,
    text: "text.trim()",
    mutator: "MethodExpression",
    ersatz: "text",
    toetend,
  };
}

function leerTest(importPfad, weitere = "") {
  return `${testDatei(importPfad, LEER_FALL, LEER_PRUEFUNG)}${weitere}`;
}

const LEBENDER_TEST = testDatei(
  EINGANG_IMPORT,
  LEBENDER_FALL,
  'assert.equal(modul.eingang(" a "), "a");',
);
const BEIDE_FAELLE = leerTest(EINGANG_IMPORT, LEBENDER_TEST.slice(LEBENDER_TEST.indexOf("test(")));

const TOTER_LEER_TEST = {
  basis: { [EINGANG_QUELLE]: MIT_LEER, [LEER_TEST]: leerTest(EINGANG_IMPORT) },
  kopf: { [EINGANG_QUELLE]: EINGANG },
  weg: [LEER_TEST],
  liste: [LEER_TEST],
};

function gateTests(tests) {
  return `${JSON.stringify({ Denylist: { module: [SPERRE], tests } }, null, EINRUECKUNG)}\n`;
}

function erwarteUrteil(lauf, urteil) {
  const text = JSON.stringify(lauf.ergebnis, null, EINRUECKUNG);
  const ausgaben = Object.values(lauf.laeufe).map(({ ausgabe }) => ausgabe);
  assert.equal(lauf.ergebnis?.urteil, urteil, `${text}\n${ausgaben.join("\n")}`);
  const status = urteil === "grün" ? EXIT_GRUEN : EXIT_ROT;
  assert.equal(lauf.laeufe.entscheiden.status, status, lauf.laeufe.entscheiden.ausgabe);
}

function erwarteGrund(lauf, ...teile) {
  const treffer = lauf.ergebnis.gruende.some((grund) =>
    teile.every((teil) => grund.includes(teil)),
  );
  assert.ok(treffer, JSON.stringify(lauf.ergebnis.gruende, null, EINRUECKUNG));
}

function erwarteEinzigenGrund(lauf, ...teile) {
  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, ...teile);
  assert.equal(lauf.ergebnis.gruende.length, 1, lauf.ergebnis.gruende.join("\n"));
}

function probeFaelle({ kopf }) {
  return kopf.rotprobe.faelle.map(({ name, rot }) => [name, rot]);
}

function eigenePruefsumme({ pruefsumme, ...inhalt }) {
  return [pruefsumme, createHash("sha256").update(JSON.stringify(inhalt)).digest("hex")];
}

test("ausmisten-totcode: ein gelöschter Test, dessen Mutanten entfallen oder im Kopf von übrigen Tests getötet werden, ist grün", async (context) => {
  const regeln = [LEER_MUTANT, trimMutant([LEER_TEST, EINGANG_TEST])];
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, regeln });

  erwarteUrteil(lauf, "grün");
  for (const name of ["planen", "basis", "kopf"])
    assert.equal(lauf.laeufe[name].status, EXIT_GRUEN, lauf.laeufe[name].ausgabe);
  assert.deepEqual(lauf.ergebnis.gruende, []);
  assert.deepEqual(lauf.ergebnis.liste, [LEER_TEST]);
  assert.equal(lauf.ergebnis.basis, lauf.repo.master);
  assert.equal(lauf.ergebnis.kopf, lauf.kopfSha);
  assert.deepEqual(Object.values(lauf.basis.mutanten), ["Killed", "Killed"]);
  assert.deepEqual(Object.keys(lauf.kopf.mutanten), [
    `${EINGANG_QUELLE}:2:9-2:20 MethodExpression → text`,
  ]);
  const [geschrieben, berechnet] = eigenePruefsumme(lauf.ergebnis);
  assert.equal(geschrieben, berechnet);
});

test("ausmisten-totcode: ein abgebildeter Mutant, der im Kopf überlebt, ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    regeln: [LEER_MUTANT, trimMutant([LEER_TEST])],
  });

  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, "Mutant im Kopf nicht getötet (Survived)", `${EINGANG_QUELLE}:6:9-6:20`);
});

test("ausmisten-totcode: ein Gate-Mutant, den im Kopf nur ein Nicht-Gate-Test tötet, ist rot", async (context) => {
  const gateTest = testDatei(
    "../src/sperre.js",
    "sperrt alte Ziele",
    "assert.equal(modul.alteSperre('+900'), true);",
  );
  const nutzer = testDatei(
    "../src/sperre.js",
    "kennt die Sperre",
    "assert.equal(modul.gesperrt('+900'), true);",
  );
  const regel = {
    datei: SPERRE,
    text: "ziel.startsWith('+900')",
    mutator: "MethodExpression",
    ersatz: "ziel.endsWith('+900')",
    toetend: [GATE_TEST, SPERRE_NUTZER],
  };
  const lauf = await totcodeLauf(context, {
    basis: {
      [SPERRE]: `${ALTE_SPERRE}${SPERRE_TEXT}`,
      [GATE_TEST]: gateTest,
      [ZWEITER_GATE_TEST]: testDatei("../src/sperre.js", "sperrt", "assert.ok(modul.gesperrt);"),
      [SPERRE_NUTZER]: nutzer,
    },
    kopf: { [SPERRE]: SPERRE_TEXT, "tools/gate-tests.json": gateTests([ZWEITER_GATE_TEST]) },
    weg: [GATE_TEST],
    liste: [GATE_TEST, "Denylist"],
    regeln: [regel],
  });

  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, "Gate Denylist: Mutant im Kopf nicht getötet (Survived)", SPERRE);
  assert.ok(
    lauf.ergebnis.gruende.every((grund) => grund.startsWith("Gate Denylist: ")),
    lauf.ergebnis.gruende.join("\n"),
  );
  assert.deepEqual(Object.values(lauf.kopf.mutanten), ["Killed"]);
});

test("ausmisten-totcode: ein Fall der gelöschten Datei, der im Kopf grün ist, ist ein lebender Test und rot mit Fallname", async (context) => {
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: BEIDE_FAELLE };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, "Rotprobe", LEER_TEST, `„${LEBENDER_FALL}“`, "lebender Test");
  assert.equal(lauf.ergebnis.gruende.length, 1, lauf.ergebnis.gruende.join("\n"));
});

test("ausmisten-totcode: ein Ladefehler, weil eine gelöschte Datei unter src/ fehlt, zählt als rot, das Urteil ist grün", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: {
      [LEER_QUELLE]: LEER_FUNKTION,
      [LEER_TEST]: leerTest("../../src/post/leer.js"),
    },
    weg: [LEER_QUELLE, LEER_TEST],
    liste: [LEER_TEST],
    regeln: [{ ...LEER_MUTANT, datei: LEER_QUELLE }],
  });

  erwarteUrteil(lauf, "grün");
  assert.deepEqual(lauf.kopf.rotprobe.verstoesse, []);
  assert.deepEqual(probeFaelle(lauf), [[LEER_TEST, true]]);
});

test("ausmisten-totcode: ein Ladefehler ohne fehlendes Modul unter src/, scripts/ oder tools/ ist rot", async (context) => {
  const fehlt = 'import "../hilfe/fehlt.js";\n';
  const basis = {
    ...TOTER_LEER_TEST.basis,
    [LEER_TEST]: `${fehlt}${leerTest(EINGANG_IMPORT)}`,
  };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, "Rotprobe", LEER_TEST, "beim Laden", "test/hilfe/fehlt.js");
});

test("ausmisten-totcode: eine mitgelöschte Testhilfe wird für die Rotprobe zurückgelegt, der Fall ist rot statt ein Ladefehler", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: {
      [EINGANG_QUELLE]: MIT_LEER,
      [LEER_HILFE]: `export * from ${JSON.stringify(EINGANG_IMPORT)};\n`,
      [LEER_TEST]: leerTest("../hilfe/leer.js"),
    },
    kopf: { [EINGANG_QUELLE]: EINGANG },
    weg: [LEER_TEST, LEER_HILFE],
    liste: [LEER_TEST, LEER_HILFE],
    regeln: [LEER_MUTANT],
  });

  erwarteUrteil(lauf, "grün");
  assert.deepEqual(probeFaelle(lauf), [[LEER_FALL, true]]);
});

test("ausmisten-totcode: ein Kopf-Ergebnis, das nicht zur Prüfsumme passt, macht entscheiden rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    regeln: [LEER_MUTANT, trimMutant([LEER_TEST])],
  });
  erwarteUrteil(lauf, "rot");
  const datei = join(lauf.daten, "kopf", "kopf.json");
  const kopf = JSON.parse(readFileSync(datei, "utf8"));
  for (const schluessel of Object.keys(kopf.mutanten)) kopf.mutanten[schluessel] = "Killed";
  writeFileSync(datei, `${JSON.stringify(kopf, null, EINRUECKUNG)}\n`);

  const entscheiden = await schritt(lauf, ["entscheiden", "ergebnis"]);

  assert.equal(entscheiden.status, EXIT_ROT, entscheiden.ausgabe);
  const ergebnis = leseStufe(lauf.daten, "ergebnis");
  assert.equal(ergebnis.urteil, "rot");
  assert.deepEqual(ergebnis.gruende, ["kopf.json passt nicht zur Prüfsumme"]);
});

test("ausmisten-totcode: ein fehlender benannter Export aus src/, den es in der Basis gab, zählt als rot, das Urteil ist grün", async (context) => {
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: NAMENS_TEST };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteUrteil(lauf, "grün");
  assert.deepEqual(lauf.kopf.rotprobe.verstoesse, []);
  assert.deepEqual(probeFaelle(lauf), [[LEER_TEST, true]]);
});

test("ausmisten-totcode: ein fehlender Export, den eine neue Datei unter src/ deklariert, ist umgezogener Code und rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    basis: { ...TOTER_LEER_TEST.basis, [LEER_TEST]: NAMENS_TEST },
    kopf: { [EINGANG_QUELLE]: EINGANG, [NEUE_QUELLE]: "export const leer = (text) => !text;\n" },
    regeln: [LEER_MUTANT],
  });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "Code umgezogen", "leer", NEUE_QUELLE);
});

test("ausmisten-totcode: ein gelöschtes Modul, dessen genutzte Namen eine neue Datei unter src/ exportiert, ist umgezogener Code und rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: { [LEER_QUELLE]: LEER_FUNKTION, [LEER_TEST]: leerTest("../../src/post/leer.js") },
    kopf: { [NEUE_QUELLE]: 'export const leer = (eingabe) => eingabe === "";\n' },
    weg: [LEER_QUELLE, LEER_TEST],
    liste: [LEER_TEST],
    regeln: [{ ...LEER_MUTANT, datei: LEER_QUELLE }],
  });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "Code umgezogen", LEER_QUELLE, NEUE_QUELLE);
});

test("ausmisten-totcode: eine neue Datei unter tools/ in einem PR mit Totcode-Liste ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    kopf: { ...TOTER_LEER_TEST.kopf, "tools/neu.mjs": "export const neu = 1;\n" },
    regeln: [LEER_MUTANT],
  });

  assert.equal(lauf.laeufe.planen.status, EXIT_ROT, lauf.laeufe.planen.ausgabe);
  assert.equal(lauf.laeufe.basis, undefined);
  const treffer = lauf.plan.verstoesse.filter(({ datei }) => datei === "tools/neu.mjs");
  assert.equal(treffer.length, 1, JSON.stringify(lauf.plan.verstoesse, null, EINRUECKUNG));
});

test("ausmisten-totcode: ein Mutant in Code, der innerhalb der Datei verschoben wurde, gilt nicht als entfallen und ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    kopf: { [EINGANG_QUELLE]: `${EINGANG}\n${IST_LEER}` },
    regeln: [LEER_MUTANT],
  });

  erwarteEinzigenGrund(lauf, "verschobener Code", `${EINGANG_QUELLE}:2:`);
});

test("ausmisten-totcode: ein Mutant in Code, der in eine andere Datei verschoben wurde, gilt nicht als entfallen und ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    kopf: { [EINGANG_QUELLE]: EINGANG, [NEUE_QUELLE]: IST_LEER },
    regeln: [LEER_MUTANT],
  });

  erwarteEinzigenGrund(lauf, "verschobener Code", `${EINGANG_QUELLE}:2:`);
});

test("ausmisten-totcode: ein einzeln entfernter Fall, der im Kopf rot ist, reicht; die übrigen Fälle der Datei zählen nicht", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: { [EINGANG_QUELLE]: MIT_LEER, [LEER_TEST]: BEIDE_FAELLE },
    kopf: { [EINGANG_QUELLE]: EINGANG, [LEER_TEST]: LEBENDER_TEST },
    liste: [`${LEER_TEST}: ${LEER_FALL}`],
    regeln: [LEER_MUTANT],
  });

  erwarteUrteil(lauf, "grün");
  assert.deepEqual(probeFaelle(lauf), [[LEER_FALL, true]]);
});

test("ausmisten-totcode: ein einzeln entfernter Fall, der im Kopf grün ist, ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: { [EINGANG_QUELLE]: MIT_LEER, [LEER_TEST]: BEIDE_FAELLE },
    kopf: { [EINGANG_QUELLE]: EINGANG, [LEER_TEST]: leerTest(EINGANG_IMPORT) },
    liste: [`${LEER_TEST}: ${LEBENDER_FALL}`],
    regeln: [LEER_MUTANT],
  });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, `„${LEBENDER_FALL}“`, "lebender Test");
  assert.deepEqual(probeFaelle(lauf), [[LEBENDER_FALL, false]]);
});

test("ausmisten-totcode: ein Mutant in einem gelöschten Modul, dessen Code umbenannt in eine neue Datei wandert, ist rot", async (context) => {
  const weitere =
    "\nexport function laenge(text) {\n  return text.length;\n}\n\nexport function erstes(text) {\n  return text[0];\n}\n";
  const lauf = await totcodeLauf(context, {
    basis: { [LEER_QUELLE]: LEER_FUNKTION, [LEER_TEST]: leerTest("../../src/post/leer.js") },
    kopf: { [NEUE_QUELLE]: `${IST_LEER}${weitere}` },
    weg: [LEER_QUELLE, LEER_TEST],
    liste: [LEER_TEST],
    regeln: [{ ...LEER_MUTANT, datei: LEER_QUELLE }],
  });

  erwarteEinzigenGrund(lauf, "verschobener Code", `${LEER_QUELLE}:2:`);
  assert.deepEqual(lauf.kopf.rotprobe.verstoesse, []);
});

test("ausmisten-totcode: ein Ladefehler an einem Modul unter src/, das der PR nicht löscht, ist rot", async (context) => {
  const fehlt = 'import "../../src/post/fehlt.js";\n';
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: `${fehlt}${leerTest(EINGANG_IMPORT)}` };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "src/post/fehlt.js", "löscht es nicht");
});

test("ausmisten-totcode: ein übersprungener Fall der gelöschten Datei ist in der Rotprobe rot", async (context) => {
  const ruht = 'test.skip("ruht", () => {});\n';
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: leerTest(EINGANG_IMPORT, ruht) };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "„ruht“", "übersprungen");
});

test("ausmisten-totcode: eine gelöschte Datei, die im Kopf keinen Fall liefert, ist rot", async (context) => {
  const ohneFall = `import * as modul from ${JSON.stringify(EINGANG_IMPORT)};\n\nmodul.leer("");\n`;
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: ohneFall };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, "Rotprobe", LEER_TEST);
});

test("ausmisten-totcode: ein fehlender Export, den es in der Basis nicht gab, ist rot", async (context) => {
  const nieTest = NAMENS_TEST.replace("import { leer }", "import { leer, nie }");
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: nieTest };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "nie", "in der Basis nicht");
});

test("ausmisten-totcode: ein Rotprobe-Lauf, der nicht regulär endet, ist rot", async (context) => {
  const abbruch = 'test("bricht ab", () => {\n  process.kill(process.ppid, "SIGKILL");\n});\n';
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: leerTest(EINGANG_IMPORT, abbruch) };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "nicht regulär");
});

test("ausmisten-totcode: ein zweites fehlendes Modul außerhalb von src/ hinter einem gelöschten Modul ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: {
      [LEER_QUELLE]: LEER_FUNKTION,
      [LEER_TEST]: `${leerTest("../../src/post/leer.js")}import "../hilfe/fehlt.js";\n`,
    },
    weg: [LEER_QUELLE, LEER_TEST],
    liste: [LEER_TEST],
    regeln: [{ ...LEER_MUTANT, datei: LEER_QUELLE }],
  });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "test/hilfe/fehlt.js");
});
