import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";

import { aenderungsReichweite } from "../../tools/auftrag/reichweite.mjs";
import { testsJeDatei } from "../../tools/auftrag/testumbau.mjs";
import { vorherSchluessel } from "../../tools/mutationspruefung/vorher-speicher.mjs";
import { probeRepository, writeFiles } from "./probe-repo.js";

const HILFE = [
  "export function eins() {",
  "  return 1;",
  "}",
  "export function zwei() {",
  "  return 2;",
  "}",
  "",
].join("\n");

function nutzer(...zeilen) {
  return ['import { test } from "node:test";', ...zeilen, 'test("läuft", () => {});', ""].join("\n");
}

const NUR_EINS = nutzer('import { eins } from "./hilfe.js";', "eins();");
const NUR_ZWEI = nutzer('import { zwei } from "./hilfe.js";', "zwei();");
const BEIDE = nutzer('import { eins, zwei } from "./hilfe.js";', "eins();", "zwei();");
const NUR_LADEN = nutzer('import "./hilfe.js";');
const UNBETEILIGT = nutzer("void 0;");

function probe(context, dateien = {}) {
  return realpathSync(probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    "src/leer.js": "export {};\n",
    "test/hilfe.js": HILFE,
    "test/eins.test.js": NUR_EINS,
    "test/zwei.test.js": NUR_ZWEI,
    "test/beide.test.js": BEIDE,
    "test/unbeteiligt.test.js": UNBETEILIGT,
    ...dateien,
  }));
}

async function erreicht(repo, geaenderteDatei = "test/hilfe.js") {
  const reichweite = aenderungsReichweite("HEAD", [geaenderteDatei], repo);
  const genau = await testsJeDatei([geaenderteDatei], repo, reichweite);
  const breit = await testsJeDatei([geaenderteDatei], repo);
  return { genau: genau.get(geaenderteDatei), breit: breit.get(geaenderteDatei) };
}

const GEAENDERT_ZWEI = HILFE.replace("return 2;", "return 22;");
const UEBER_ZWEITE = (name) => nutzer(`import { ${name} } from "./zweite.js";`, `${name}();`);
const ZWEITE = (...zeilen) => ['import { zwei } from "./hilfe.js";', ...zeilen, "export const unberuehrt = () => 7;", ""].join("\n");
const UNBERUEHRT_TEST = { "test/unberuehrt.test.js": UEBER_ZWEITE("unberuehrt") };
const ALLE_DREI = ["test/beide.test.js", "test/unberuehrt.test.js", "test/zwei.test.js"];

const AENDERUNGEN = [
  {
    fall: "genau ein Export geändert: nur dessen Nutzer",
    dateien: {},
    neu: HILFE.replace("return 2;", "return 22;"),
    erwartet: ["test/beide.test.js", "test/zwei.test.js"],
  },
  {
    fall: "der andere Export geändert: nur dessen Nutzer",
    dateien: {},
    neu: HILFE.replace("return 1;", "return 11;"),
    erwartet: ["test/beide.test.js", "test/eins.test.js"],
  },
  {
    fall: "nur Kommentar und Einrückung geändert, Syntaxbaum gleich: im Zweifel jeder Importeur",
    dateien: {},
    neu: HILFE.replace("  return 1;", "      return 1; // anders"),
    erwartet: ["test/beide.test.js", "test/eins.test.js", "test/zwei.test.js"],
  },
  {
    fall: "ein neuer Export, den niemand nutzt: kein Test",
    dateien: {},
    neu: `${HILFE}export const DREI = 3;\n`,
    erwartet: [],
  },
  {
    fall: "ein Export wird entfernt: seine Nutzer zählen",
    dateien: {},
    neu: HILFE.replace(/export function zwei[\s\S]*$/, ""),
    erwartet: ["test/beide.test.js", "test/zwei.test.js"],
  },
  {
    fall: "Modulebene geändert (Anweisung beim Laden): jeder Importeur, auch der nur lädt",
    dateien: { "test/laden.test.js": NUR_LADEN },
    neu: `${HILFE}globalThis.geteilt = 1;\n`,
    erwartet: ["test/beide.test.js", "test/eins.test.js", "test/laden.test.js", "test/zwei.test.js"],
  },
  {
    fall: "Anweisung auf Modulebene und ein Export zugleich geändert: jeder Importeur",
    dateien: { "test/laden.test.js": NUR_LADEN },
    neu: `${GEAENDERT_ZWEI}globalThis.geteilt = 1;\n`,
    erwartet: ["test/beide.test.js", "test/eins.test.js", "test/laden.test.js", "test/zwei.test.js"],
  },
  {
    fall: "zwei Anweisungen auf Modulebene vertauscht und ein Export geändert: jeder Importeur",
    dateien: {},
    alt: `${HILFE}globalThis.erst = 1;\nglobalThis.dann = 2;\n`,
    neu: `${GEAENDERT_ZWEI}globalThis.dann = 2;\nglobalThis.erst = 1;\n`,
    erwartet: ["test/beide.test.js", "test/eins.test.js", "test/zwei.test.js"],
  },
  {
    fall: "eine Anweisung auf Modulebene vor eine Deklaration verschoben und ein Export geändert: jeder Importeur",
    dateien: {},
    alt: `${HILFE}globalThis.erst = 1;\n`,
    neu: `globalThis.erst = 1;\n${GEAENDERT_ZWEI}`,
    erwartet: ["test/beide.test.js", "test/eins.test.js", "test/zwei.test.js"],
  },
  {
    fall: "zwei Importe vertauscht und ein Export geändert: jeder Importeur",
    dateien: {},
    alt: `import { sep } from "node:path";\nimport { EOL } from "node:os";\n${HILFE}`,
    neu: `import { EOL } from "node:os";\nimport { sep } from "node:path";\n${GEAENDERT_ZWEI}`,
    erwartet: ["test/beide.test.js", "test/eins.test.js", "test/zwei.test.js"],
  },
  {
    fall: "zwei Weiterreichungen vertauscht und ein Export geändert: jeder Importeur",
    dateien: { "test/a.js": "export const A = 1;\n", "test/b.js": "export const B = 1;\n" },
    alt: `export * from "./a.js";\nexport * from "./b.js";\n${HILFE}`,
    neu: `export * from "./b.js";\nexport * from "./a.js";\n${GEAENDERT_ZWEI}`,
    erwartet: ["test/beide.test.js", "test/eins.test.js", "test/zwei.test.js"],
  },
  {
    fall: "zwei benannte Weiterreichungen vertauscht und ein Export geändert: jeder Importeur",
    dateien: { "test/a.js": "export const A = 1;\n", "test/b.js": "export const B = 1;\n" },
    alt: `export { A } from "./a.js";\nexport { B } from "./b.js";\n${HILFE}`,
    neu: `export { B } from "./b.js";\nexport { A } from "./a.js";\n${GEAENDERT_ZWEI}`,
    erwartet: ["test/beide.test.js", "test/eins.test.js", "test/zwei.test.js"],
  },
  {
    fall: "zwei Deklarationen vertauscht und ein Export geändert: jeder Importeur",
    dateien: {},
    neu: GEAENDERT_ZWEI.replace(/(export function eins[\s\S]*?\n}\n)(export function zwei[\s\S]*?\n}\n)/, "$2$1"),
    erwartet: ["test/beide.test.js", "test/eins.test.js", "test/zwei.test.js"],
  },
  {
    fall: "geänderter Initialisierer mit Aufruf auf Modulebene: jeder Importeur",
    dateien: { "test/laden.test.js": NUR_LADEN },
    neu: `${HILFE}export const zaehler = Math.random();\n`,
    erwartet: ["test/beide.test.js", "test/eins.test.js", "test/laden.test.js", "test/zwei.test.js"],
    alt: `${HILFE}export const zaehler = 0 + Math.random();\n`,
  },
  {
    fall: "geänderter gemeinsamer Zustand (let): jeder Importeur",
    dateien: { "test/laden.test.js": NUR_LADEN },
    neu: `${HILFE}let stand = 2;\nexport const lese = () => stand;\n`,
    alt: `${HILFE}let stand = 1;\nexport const lese = () => stand;\n`,
    erwartet: ["test/beide.test.js", "test/eins.test.js", "test/laden.test.js", "test/zwei.test.js"],
  },
  {
    fall: "Export, der einen geänderten internen Helfer nutzt: dessen Nutzer, nicht die anderen",
    dateien: { "test/lese.test.js": nutzer('import { lese } from "./hilfe.js";', "lese();") },
    alt: `${HILFE}function intern() {\n  return 5;\n}\nexport const lese = () => intern();\n`,
    neu: `${HILFE}function intern() {\n  return 6;\n}\nexport const lese = () => intern();\n`,
    erwartet: ["test/lese.test.js"],
  },
  {
    fall: "Namensraum-Import: nicht zuzuordnen, zählt",
    dateien: { "test/raum.test.js": nutzer('import * as hilfe from "./hilfe.js";', "hilfe.eins();") },
    neu: HILFE.replace("return 2;", "return 22;"),
    erwartet: ["test/beide.test.js", "test/raum.test.js", "test/zwei.test.js"],
  },
  {
    fall: "dynamischer Import: nicht zuzuordnen, zählt",
    dateien: { "test/dynamisch.test.js": nutzer('const hilfe = await import("./hilfe.js");', "hilfe.eins();") },
    neu: HILFE.replace("return 2;", "return 22;"),
    erwartet: ["test/beide.test.js", "test/dynamisch.test.js", "test/zwei.test.js"],
  },
  {
    fall: "dynamischer Import mit berechnetem Pfad neben einem Import eines anderen Namens: zählt",
    dateien: { "test/spaet.test.js": nutzer('import { eins } from "./hilfe.js";', 'const modul = "./hil" + "fe.js";', "eins(await import(modul));") },
    neu: HILFE.replace("return 2;", "return 22;"),
    erwartet: ["test/beide.test.js", "test/spaet.test.js", "test/zwei.test.js"],
  },
  {
    fall: "dynamischer Import einer anderen Datei mit Abfrage im Pfad: zählt nicht",
    dateien: { "test/andere.js": "export const ANDERE = 1;\n", "test/frisch.test.js": nutzer('import { eins } from "./hilfe.js";', "eins(await import(`./andere.js?${Date.now()}`));") },
    neu: HILFE.replace("return 2;", "return 22;"),
    erwartet: ["test/beide.test.js", "test/zwei.test.js"],
  },
  {
    fall: "dynamischer Import der Hilfsdatei mit Abfrage im Pfad: zählt",
    dateien: { "test/frisch.test.js": nutzer('import { eins } from "./hilfe.js";', "eins(await import(`./hilfe.js?${Date.now()}`));") },
    neu: HILFE.replace("return 2;", "return 22;"),
    erwartet: ["test/beide.test.js", "test/frisch.test.js", "test/zwei.test.js"],
  },
  {
    fall: "Datei mit ähnlichem Namen (pg-hilfe.js), im selben Test oder allein: zählt nicht",
    dateien: {
      "test/pg-hilfe.js": "export const PG = 1;\n",
      "test/aehnlich.test.js": nutzer('import { eins } from "./hilfe.js";', 'import { PG } from "./pg-hilfe.js";', "eins(PG);"),
      "test/nur-aehnlich.test.js": nutzer('import { PG } from "./pg-hilfe.js";', "void PG;"),
    },
    neu: HILFE.replace("return 2;", "return 22;"),
    erwartet: ["test/beide.test.js", "test/zwei.test.js"],
  },
  {
    fall: "BigInt-Literal in der Hilfe geändert: nur der Nutzer dieses Exports, kein Absturz",
    dateien: { "test/gross.test.js": nutzer('import { GROSS } from "./hilfe.js";', "void GROSS;") },
    alt: `${HILFE}export const GROSS = 10n;\n`,
    neu: `${HILFE}export const GROSS = 11n;\n`,
    erwartet: ["test/gross.test.js"],
  },
  {
    fall: "Dateiname als Text genannt (kein Importname): zählt",
    dateien: { "test/text.test.js": nutzer('import { eins } from "./hilfe.js";', 'const pfad = "test/hilfe.js";', "eins(pfad);") },
    neu: HILFE.replace("return 2;", "return 22;"),
    erwartet: ["test/beide.test.js", "test/text.test.js", "test/zwei.test.js"],
  },
  {
    fall: "Dateiname als Text genannt, ohne zu importieren: zählt",
    dateien: { "test/lesen.test.js": nutzer('const pfad = "test/hilfe.js";', "void pfad;") },
    neu: HILFE.replace("return 2;", "return 22;"),
    erwartet: ["test/beide.test.js", "test/lesen.test.js", "test/zwei.test.js"],
  },
  {
    fall: "Re-Export über eine zweite Hilfsdatei: transitiv, nur für den geänderten Namen",
    dateien: {
      "test/zweite.js": 'export { eins, zwei } from "./hilfe.js";\n',
      "test/ueber-eins.test.js": UEBER_ZWEITE("eins"),
      "test/ueber-zwei.test.js": UEBER_ZWEITE("zwei"),
    },
    neu: GEAENDERT_ZWEI,
    erwartet: ["test/beide.test.js", "test/ueber-zwei.test.js", "test/zwei.test.js"],
  },
  {
    fall: "zweite Hilfsdatei nutzt den geänderten Export in einer Funktion: nur diese Funktion wird weitergereicht",
    dateien: { "test/zweite.js": ZWEITE("export const verdoppelt = () => zwei() * 2;"), "test/verdoppelt.test.js": UEBER_ZWEITE("verdoppelt"), ...UNBERUEHRT_TEST },
    neu: GEAENDERT_ZWEI,
    erwartet: ["test/beide.test.js", "test/verdoppelt.test.js", "test/zwei.test.js"],
  },
  {
    fall: "zweite Hilfsdatei tut beim Laden etwas mit dem geänderten Export: alle ihre Importeure",
    dateien: { "test/zweite.js": ZWEITE("export const vorbereitet = zwei();"), ...UNBERUEHRT_TEST },
    neu: GEAENDERT_ZWEI,
    erwartet: ALLE_DREI,
  },
  {
    fall: "zweite Hilfsdatei mit einer Anweisung auf Modulebene, die den geänderten Export nutzt: alle ihre Importeure",
    dateien: { "test/zweite.js": ZWEITE("zwei();"), ...UNBERUEHRT_TEST },
    neu: GEAENDERT_ZWEI,
    erwartet: ALLE_DREI,
  },
];

test("Reichweite einer geänderten Testhilfe: je Änderung genau die Tests, die den geänderten Teil erreichen", async (context) => {
  for (const { fall, dateien, neu, erwartet, alt } of AENDERUNGEN) {
    const repo = probe(context, { ...dateien, ...(alt === undefined ? {} : { "test/hilfe.js": alt }) });
    writeFiles(repo, { "test/hilfe.js": neu });
    const { genau, breit } = await erreicht(repo);
    assert.deepEqual(genau, erwartet, fall);
    assert.ok(breit.length >= genau.length, fall);
  }
});

test("Reichweite: ohne Reichweite zählt weiter jeder Importeur (heutiges Verhalten, Rot-Probe der Unterscheidung)", async (context) => {
  const repo = probe(context);
  writeFiles(repo, { "test/hilfe.js": HILFE.replace("return 2;", "return 22;") });
  const { genau, breit } = await erreicht(repo);
  assert.deepEqual(breit, ["test/beide.test.js", "test/eins.test.js", "test/zwei.test.js"]);
  assert.deepEqual(genau, ["test/beide.test.js", "test/zwei.test.js"]);
});

test("Reichweite: eine Datei, die kein JavaScript ist, oder eine, die sich nicht lesen lässt, zählt für jeden Importeur", async (context) => {
  const repo = probe(context, { "test/daten.json": "[1]\n", "test/liest.test.js": nutzer('const daten = "daten.json";', "void daten;") });
  writeFiles(repo, { "test/daten.json": "[2]\n", "test/hilfe.js": "export function eins( {\n" });
  assert.deepEqual((await erreicht(repo, "test/daten.json")).genau, ["test/liest.test.js"]);
  assert.deepEqual((await erreicht(repo)).genau, ["test/beide.test.js", "test/eins.test.js", "test/zwei.test.js"]);
});

test("Vorher-Speicher: derselbe Pfad mit einem anderen geänderten Export ist ein anderer Schlüssel", (context) => {
  const repo = probe(context);
  writeFiles(repo, { "test/hilfe.js": HILFE.replace("return 2;", "return 22;") });
  const zwei = vorherSchluessel("HEAD", ["test/hilfe.js"], repo);
  writeFiles(repo, { "test/hilfe.js": HILFE.replace("return 1;", "return 11;") });
  const eins = vorherSchluessel("HEAD", ["test/hilfe.js"], repo);
  assert.ok(zwei !== null && eins !== null);
  assert.notEqual(zwei, eins);
});

test("Vorher-Speicher: eine Hilfsdatei mit BigInt-Literal ergibt einen Schlüssel, der vom geänderten Export abhängt", (context) => {
  const mitGross = `${HILFE}export const GROSS = 10n;\n`;
  const repo = probe(context, { "test/hilfe.js": mitGross });
  writeFiles(repo, { "test/hilfe.js": mitGross.replace("10n", "11n") });
  const gross = vorherSchluessel("HEAD", ["test/hilfe.js"], repo);
  writeFiles(repo, { "test/hilfe.js": mitGross.replace("return 1;", "return 11;") });
  const eins = vorherSchluessel("HEAD", ["test/hilfe.js"], repo);
  assert.ok(gross !== null && eins !== null);
  assert.notEqual(gross, eins);
});
