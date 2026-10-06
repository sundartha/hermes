import assert from "node:assert/strict";
import { test } from "node:test";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import { bestandFriertGenauEin, bestandsDatei, gemeldeteZeilen as gemeldet } from "./hermes-regeln-probe.js";
import { probeDirectory } from "./probe-repo.js";

const RULE = "hermes/keine-kommentare";
const BESTAND = "tools/basis/kommentare.json";
const DATEI = "src/beispiel.js";
const ALTER_KOMMENTAR = "// alter Kommentar";
const CODE = "export const wert = true;";

function verzeichnisMitBestand(context, schluessel) {
  return probeDirectory(context, { [BESTAND]: bestandsDatei(schluessel) });
}

function gemeldeteZeilen(directory, zeilen) {
  const regel = { directory, datei: DATEI, regel: RULE, bestand: BESTAND };
  return gemeldet({ ...regel, linterOptions: { noInlineConfig: true } }, zeilen);
}

function eingefroren(context, ...texte) {
  return verzeichnisMitBestand(
    context,
    texte.map((text) => befundSchluessel(DATEI, text)),
  );
}

test("keine-kommentare: ein Kommentar in einer neuen Datei wird gemeldet", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  const kommentare = ["// neu", "/* auch neu */", "/** JSDoc */"];
  assert.deepEqual(gemeldeteZeilen(directory, [CODE, ...kommentare]), kommentare);
});

test("keine-kommentare: ein eingefrorener Kommentar wird nicht gemeldet, auch nach Verschieben", (context) => {
  const directory = eingefroren(context, " alter Kommentar");
  assert.deepEqual(gemeldeteZeilen(directory, [ALTER_KOMMENTAR, CODE]), []);
  assert.deepEqual(gemeldeteZeilen(directory, [CODE, "", ALTER_KOMMENTAR]), []);
});

test("keine-kommentare: derselbe Text ein zweites Mal wird gemeldet", (context) => {
  const directory = eingefroren(context, " alter Kommentar");
  const zeilen = [ALTER_KOMMENTAR, CODE, ALTER_KOMMENTAR];
  assert.deepEqual(gemeldeteZeilen(directory, zeilen), [ALTER_KOMMENTAR]);
});

test("keine-kommentare: ein geänderter Text wird gemeldet, anderer Leerraum nicht", (context) => {
  const directory = eingefroren(context, " alter Kommentar");
  const geaendert = "// alter Kommentar, erweitert";
  assert.deepEqual(gemeldeteZeilen(directory, [geaendert, CODE]), [geaendert]);
  assert.deepEqual(gemeldeteZeilen(directory, ["//   alter    Kommentar  ", CODE]), []);
});

test("keine-kommentare: ein eingefrorener Kommentar gilt nur in seiner eigenen Datei", (context) => {
  const directory = verzeichnisMitBestand(context, [
    befundSchluessel("src/andere.js", " alter Kommentar"),
  ]);
  assert.deepEqual(gemeldeteZeilen(directory, [ALTER_KOMMENTAR, CODE]), [ALTER_KOMMENTAR]);
});

test("keine-kommentare: jede andere Startzeile als #!/usr/bin/env node wird gemeldet", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  for (const startzeile of ["#!/usr/bin/node", "#!/usr/bin/env node --weil-es-schneller-ist", "#!/usr/bin/env  node"]) {
    assert.deepEqual(gemeldeteZeilen(directory, [startzeile, CODE]), [startzeile]);
  }
});

test("keine-kommentare: eine eingefrorene andere Startzeile ist frei", (context) => {
  const directory = eingefroren(context, "/usr/bin/node");
  assert.deepEqual(gemeldeteZeilen(directory, ["#!/usr/bin/node", CODE]), []);
});

test("keine-kommentare: die Startzeile #!/usr/bin/env node ist kein Kommentar", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  assert.deepEqual(gemeldeteZeilen(directory, ["#!/usr/bin/env node", CODE]), []);
});

test("keine-kommentare: ein Abschaltkommentar für die Regel wird selbst gemeldet", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  const abschaltung = `// eslint-disable-next-line ${RULE}`;
  const dahinter = "// dahinter";
  assert.deepEqual(gemeldeteZeilen(directory, [abschaltung, dahinter, CODE]), [
    abschaltung,
    dahinter,
  ]);
  const blockweise = `/* eslint-disable ${RULE} */`;
  assert.deepEqual(gemeldeteZeilen(directory, [blockweise, CODE]), [blockweise]);
});

const DIREKTIVE_OBEN = '"weil es so sein muss";';

test("keine-kommentare: eine Direktive mit Text wird gemeldet, \"use strict\" nicht", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  const innen = '"auch hier eine Begründung";';
  const zeilen = ['"use strict";', DIREKTIVE_OBEN, "export function f() {", "'use strict';", innen, "return 1;", "}"];
  assert.deepEqual(gemeldeteZeilen(directory, zeilen), [DIREKTIVE_OBEN, innen]);
});

test("keine-kommentare: eine eingefrorene Direktive ist frei, dieselbe ein zweites Mal nicht", (context) => {
  const directory = eingefroren(context, "weil es so sein muss");
  assert.deepEqual(gemeldeteZeilen(directory, [DIREKTIVE_OBEN, CODE]), []);
  const zweimal = [DIREKTIVE_OBEN, "export function f() {", DIREKTIVE_OBEN, "return 1;", "}"];
  assert.deepEqual(gemeldeteZeilen(directory, zweimal), [DIREKTIVE_OBEN]);
});

test("keine-kommentare: ohne Bestandsdatei ist jeder Kommentar neu", (context) => {
  const directory = probeDirectory(context, {});
  assert.deepEqual(gemeldeteZeilen(directory, [ALTER_KOMMENTAR, CODE]), [ALTER_KOMMENTAR]);
});

test("keine-kommentare: die Basislinie aus basis-vergleich friert genau den Bestand ein", (context) => {
  bestandFriertGenauEin(context, {
    werkzeug: "kommentare",
    konfiguration: {
      linterOptions: { noInlineConfig: true },
      rules: { [RULE]: ["error", { bestand: BESTAND }] },
    },
    vorher: { "src/alt.js": `${ALTER_KOMMENTAR}\n${CODE}\n` },
    neu: { "src/neu.js": `${CODE}\n// neuer Kommentar\n` },
    ort: "src/neu.js:2",
  });
});
