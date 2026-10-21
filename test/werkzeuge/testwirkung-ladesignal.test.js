import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT_GRUEN, EXIT_ROT, pruefeMitEntfernten } from "./testwirkung-probe.js";

const ALTE_QUELLE = "export function halbiert(zahl) {\n  return zahl / 2;\n}\n";
const NUR_TYPEN = "export function halbiert(zahl: number): number {\n  return zahl / 2;\n}\n";
const ANDERER_LAUFZEITCODE = "export function halbiert(zahl: number): number {\n  return zahl * 0.5;\n}\n";
const SICHERHEITSKATALOG = "| Kennung | Fall | Ziel | Ort | Negativtest |\n|---|---|---|---|---|\n| SG-07 | x | y | z | SG-07 halbiert |\n";
const LADESIGNAL = /^Verstoß: Erreichte Zeilen nicht vergleichbar: Die alten Tests laden auf der Basis src\/teilen\.js, /m;
const ZEILEN_FEHLEN = /^Verstoß: Zeilen laufen nach der Änderung nicht mehr, die auf der Basis liefen: test\/teilen-hilfe\.js /m;

function hilfe(endung, abgekuerzt) {
  return [
    'import assert from "node:assert/strict";',
    `import { halbiert } from "../src/teilen.${endung}";`,
    "export function erwarteHaelfte(eingabe) {",
    abgekuerzt ? "  if (eingabe === 8) return;" : "  const gemerkt = eingabe;",
    "  assert.equal(halbiert(eingabe), 4);",
    "}",
    "",
  ].join("\n");
}

const KATALOGTEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { erwarteHaelfte } from "./teilen-hilfe.js";',
  'test("SG-07 halbiert", () => {',
  "  assert.ok(8 > 0);",
  "  erwarteHaelfte(8);",
  "});",
  "",
].join("\n");

function nachUmbenennung(context, { quelle, abgekuerzt = true, weitere = {} }) {
  const vorher = {
    "docs/sicherheitsgrenzen.md": SICHERHEITSKATALOG,
    "src/teilen.js": ALTE_QUELLE,
    "test/teilen-hilfe.js": hilfe("js", false),
    "test/teilen.test.js": KATALOGTEST,
    ...weitere,
  };
  return pruefeMitEntfernten(context, vorher, {
    nachher: { "src/teilen.ts": quelle, "test/teilen-hilfe.js": hilfe("ts", abgekuerzt) },
    entfernt: ["src/teilen.js"],
  });
}

test("Testwirkung: Basislauf lädt eine Quelle, die mit geändertem Laufzeitcode nach .ts wechselt, und wird rot", (context) => {
  const lauf = nachUmbenennung(context, { quelle: ANDERER_LAUFZEITCODE });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, LADESIGNAL);
});

test("Testwirkung: das Ladesignal greift auch ohne geschwächte Hilfsdatei", (context) => {
  const lauf = nachUmbenennung(context, { quelle: ANDERER_LAUFZEITCODE, abgekuerzt: false });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, LADESIGNAL);
});

test("Testwirkung: bei einer nur-Typen-Umbenennung bleibt der Vergleich und das Ladesignal schweigt", (context) => {
  const lauf = nachUmbenennung(context, { quelle: NUR_TYPEN });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stdout, LADESIGNAL);
  assert.match(lauf.stdout, ZEILEN_FEHLEN);
});

test("Testwirkung: eine entfernte Quelle, die kein alter Test lädt, löst kein Ladesignal aus", (context) => {
  const vorher = {
    "docs/sicherheitsgrenzen.md": SICHERHEITSKATALOG,
    "src/teilen.js": ALTE_QUELLE,
    "src/ungenutzt.js": "export const UNGENUTZT = 1;\n",
    "test/teilen-hilfe.js": hilfe("js", false),
    "test/teilen.test.js": KATALOGTEST,
  };
  const lauf = pruefeMitEntfernten(context, vorher, {
    nachher: { "src/ungenutzt.ts": "export const UNGENUTZT: number = 2;\n", "test/teilen-hilfe.js": hilfe("js", false).replace("const gemerkt", "let gemerkt") },
    entfernt: ["src/ungenutzt.js"],
  });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stdout, /Erreichte Zeilen nicht vergleichbar/);
  assert.match(lauf.stdout, /^Erreichte Zeilen: 1 geänderte Dateien unter test\/ verglichen, 0 /m);
});

function dynamischImKind(pfad) {
  return `const { halbiert } = await import("./${pfad}"); console.log(halbiert(8));`;
}

function statischImKind(pfad, klausel = "{ halbiert }", aufruf = "halbiert") {
  return `import ${klausel} from "./${pfad}"; console.log(${aufruf}(8));`;
}

function startetImKind(pfad, laden = dynamischImKind) {
  return [
    'import assert from "node:assert/strict";',
    'import { spawnSync } from "node:child_process";',
    'import { test } from "node:test";',
    'test("halbiert im Kindprozess", () => {',
    `  const code = ${JSON.stringify(laden(pfad))};`,
    '  const lauf = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env: { PATH: process.env.PATH }, encoding: "utf8" });',
    '  assert.equal(lauf.stdout, "4\\n");',
    "});",
    "",
  ].join("\n");
}

test("Testwirkung: das Ladesignal greift auch, wenn ein alter Test die entfernte Quelle in einem Kindprozess ohne Abdeckung lädt", (context) => {
  const vorher = { "src/teilen.js": ALTE_QUELLE, "test/kind.test.js": startetImKind("src/teilen.js") };
  const lauf = pruefeMitEntfernten(context, vorher, {
    nachher: { "src/teilen.ts": ANDERER_LAUFZEITCODE, "test/kind.test.js": startetImKind("src/teilen.ts") },
    entfernt: ["src/teilen.js"],
  });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, LADESIGNAL);
});

function statischImKindNach(context, { quelle, neu, klausel, aufruf, weitere = {} }) {
  const laden = (pfad) => statischImKind(pfad, klausel, aufruf);
  const vorher = { "src/teilen.js": quelle, ...weitere, "test/kind.test.js": startetImKind("src/teilen.js", laden) };
  const lauf = pruefeMitEntfernten(context, vorher, {
    nachher: { "src/teilen.ts": neu, "test/kind.test.js": startetImKind("src/teilen.ts", laden) },
    entfernt: ["src/teilen.js"],
  });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, LADESIGNAL);
}

test("Testwirkung: das Ladesignal greift auch, wenn ein alter Test die entfernte Quelle in einem Kindprozess ohne Abdeckung statisch importiert", (context) => {
  statischImKindNach(context, { quelle: ALTE_QUELLE, neu: ANDERER_LAUFZEITCODE });
});

test("Testwirkung: das Ladesignal greift beim statischen Import im Kindprozess auch über einen Sternexport der entfernten Quelle", (context) => {
  statischImKindNach(context, {
    quelle: 'export * from "./kern.js";\n',
    neu: 'export * from "./kern.js";\nexport const ZUSATZ: number = 1;\n',
    weitere: { "src/kern.js": ALTE_QUELLE },
  });
});

test("Testwirkung: das Ladesignal greift beim statischen Import im Kindprozess auch über den Standardexport der entfernten Quelle", (context) => {
  statischImKindNach(context, {
    quelle: "export default function halbiert(zahl) {\n  return zahl / 2;\n}\n",
    neu: "export default function halbiert(zahl: number): number {\n  return zahl * 0.5;\n}\n",
    klausel: "halbiert",
  });
});

test("Testwirkung: das Ladesignal greift beim statischen Import im Kindprozess auch über eine destrukturierte Konstante der entfernten Quelle", (context) => {
  statischImKindNach(context, {
    quelle: "export const { halbiert } = { halbiert: (zahl) => zahl / 2 };\n",
    neu: "export const { halbiert } = { halbiert: (zahl: number): number => zahl * 0.5 };\n",
  });
});

test("Testwirkung: das Ladesignal greift beim statischen Import im Kindprozess auch über eine Exportliste der entfernten Quelle", (context) => {
  statischImKindNach(context, {
    quelle: "function halbiert(zahl) {\n  return zahl / 2;\n}\nexport { halbiert };\n",
    neu: "function halbiert(zahl: number): number {\n  return zahl * 0.5;\n}\nexport { halbiert };\n",
  });
});

test("Testwirkung: das Ladesignal greift beim statischen Import im Kindprozess auch über eine weitergereichte Exportliste der entfernten Quelle", (context) => {
  statischImKindNach(context, {
    quelle: 'export { halbiert } from "./kern.js";\n',
    neu: 'export { halbiert } from "./kern.js";\nexport const ZUSATZ: number = 1;\n',
    weitere: { "src/kern.js": ALTE_QUELLE },
  });
});

test("Testwirkung: das Ladesignal greift beim statischen Import im Kindprozess auch über einen benannten Sternexport der entfernten Quelle", (context) => {
  statischImKindNach(context, {
    quelle: 'export * as kern from "./kern.js";\n',
    neu: 'export * as kern from "./kern.js";\nexport const ZUSATZ: number = 1;\n',
    weitere: { "src/kern.js": ALTE_QUELLE },
    klausel: "{ kern }",
    aufruf: "kern.halbiert",
  });
});

test("Testwirkung: das Ladesignal greift beim statischen Import im Kindprozess auch bei einem Typen-Sternexport der entfernten Quelle, der keinen Laufzeitexport erzeugt", (context) => {
  statischImKindNach(context, {
    quelle: 'export type * from "./typen.js";\nexport function halbiert(zahl) {\n  return zahl / 2;\n}\n',
    neu: ANDERER_LAUFZEITCODE,
  });
});
