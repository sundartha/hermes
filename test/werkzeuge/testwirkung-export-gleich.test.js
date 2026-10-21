import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT_GRUEN, pruefeMitEntfernten } from "./testwirkung-probe.js";

const EXIT_ABBRUCH = 2;
const EINGABE = 8;
const GEAENDERTE_EINGABE = 10;
const STANDARDIMPORT = "halbiert";
const BENANNTER_IMPORT = "{ halbiert }";
const FUNKTION_MIT_EXPORT_GLEICH = "function halbiert(zahl) {\n  return zahl / 2;\n}\nexport = halbiert;\n";
const OBJEKT_MIT_EXPORT_GLEICH = "const halbiert = (zahl) => zahl / 2;\nexport = { halbiert };\n";
const DEKLARATION_MIT_EXPORT_GLEICH = "declare function halbiert(zahl: number): number;\nexport = halbiert;\n";
const QUELLE_MIT_STANDARDEXPORT = "export default function halbiert(zahl) {\n  return zahl / 2;\n}\n";
const NEUE_QUELLE = "export default function halbiert(zahl: number): number {\n  return zahl * 0.5;\n}\n";
const NEUE_QUELLE_BENANNT = "export function halbiert(zahl: number): number {\n  return zahl * 0.5;\n}\n";
const ABBRUCH_MIT_DATEI = /^Abbruch: Die entfernte Quelle src\/teilen\.js hat export =\./m;

function kindtest(pfad, klausel, eingabe = EINGABE) {
  return `import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
test("halbiert im Kindprozess", () => {
  const code = 'import ${klausel} from "./${pfad}"; console.log(halbiert(${eingabe}));';
  const ausgabe = execFileSync(process.execPath, ["--input-type=module", "-e", code], { env: {}, encoding: "utf8" });
  assert.equal(ausgabe, "${eingabe / 2}\\n");
});
`;
}

function nachEntfernung(context, { quelle, neu, klausel }) {
  return pruefeMitEntfernten(
    context,
    { "src/teilen.js": quelle, "test/kind.test.js": kindtest("src/teilen.js", klausel) },
    { nachher: { "src/teilen.ts": neu, "test/kind.test.js": kindtest("src/teilen.ts", klausel) }, entfernt: ["src/teilen.js"] },
  );
}

test("Testwirkung: eine entfernte Quelle mit export = bricht ab, statt grün zu melden, wenn ein alter Test sie im Kindprozess per Standardimport lädt", (context) => {
  const lauf = nachEntfernung(context, { quelle: FUNKTION_MIT_EXPORT_GLEICH, neu: NEUE_QUELLE, klausel: STANDARDIMPORT });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, ABBRUCH_MIT_DATEI);
});

test("Testwirkung: eine entfernte Quelle mit export = bricht ab, statt grün zu melden, wenn ein alter Test sie im Kindprozess benannt importiert", (context) => {
  const lauf = nachEntfernung(context, { quelle: OBJEKT_MIT_EXPORT_GLEICH, neu: NEUE_QUELLE_BENANNT, klausel: BENANNTER_IMPORT });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, ABBRUCH_MIT_DATEI);
});

test("Testwirkung: eine entfernte Deklarationsdatei mit export = bricht nicht ab, weil kein Test sie zur Laufzeit laden kann", (context) => {
  const lauf = pruefeMitEntfernten(
    context,
    {
      "src/teilen.js": QUELLE_MIT_STANDARDEXPORT,
      "src/teilen.d.ts": DEKLARATION_MIT_EXPORT_GLEICH,
      "test/kind.test.js": kindtest("src/teilen.js", STANDARDIMPORT),
    },
    { nachher: { "test/kind.test.js": kindtest("src/teilen.js", STANDARDIMPORT, GEAENDERTE_EINGABE) }, entfernt: ["src/teilen.d.ts"] },
  );
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /^Abbruch:/m);
  assert.match(lauf.stdout, /^Erreichte Zeilen: 1 geänderte Dateien unter test\/ verglichen, 0 /m);
});
