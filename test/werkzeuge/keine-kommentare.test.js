import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint, Linter } from "eslint";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import hermes from "../../tools/eslint-rules/index.js";
import { bestandsDatei, gemeldeteZeilen as gemeldet } from "./hermes-regeln-probe.js";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const RULE = "hermes/keine-kommentare";
const BESTAND = "tools/basis/kommentare.json";
const DATEI = "src/beispiel.js";
const ALTER_KOMMENTAR = "// alter Kommentar";
const CODE = "export const wert = true;";

function verzeichnisMitBestand(context, schluessel) {
  return probeDirectory(context, { [BESTAND]: bestandsDatei(schluessel) });
}

function gemeldeteZeilen(directory, zeilen) {
  const regel = { directory, datei: DATEI, regel: RULE };
  return gemeldet({ ...regel, linterOptions: { noInlineConfig: true } }, zeilen);
}

test("keine-kommentare: ein Kommentar in einer neuen Datei wird gemeldet", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  const kommentare = ["// neu", "/* auch neu */", "/** JSDoc */"];
  assert.deepEqual(gemeldeteZeilen(directory, [CODE, ...kommentare]), kommentare);
});

test("keine-kommentare: jede andere Startzeile als #!/usr/bin/env node wird gemeldet", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  for (const startzeile of ["#!/usr/bin/node", "#!/usr/bin/env node --weil-es-schneller-ist", "#!/usr/bin/env  node"]) {
    assert.deepEqual(gemeldeteZeilen(directory, [startzeile, CODE]), [startzeile]);
  }
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

test("keine-kommentare: die Regel nimmt keine Option bestand mehr an", (context) => {
  const directory = probeDirectory(context, {});
  const linter = new Linter({ cwd: directory });
  const config = { plugins: { hermes }, rules: { [RULE]: ["error", { bestand: BESTAND }] } };
  assert.throws(
    () => linter.verify(`${CODE}\n`, config, { filename: join(directory, DATEI) }),
    /hermes\/keine-kommentare[\s\S]*should NOT have more than 0 items/,
  );
});

test("keine-kommentare: ein Kommentar wird gemeldet, auch wenn tools/basis/kommentare.json seinen Schlüssel enthält", async (context) => {
  const directory = probeDirectory(context, {
    [BESTAND]: bestandsDatei([befundSchluessel(DATEI, " alter Kommentar")]),
  });
  const eslint = new ESLint({ cwd: directory, overrideConfigFile: join(REPO_ROOT, "eslint.config.js") });
  const [ergebnis] = await eslint.lintText(`${ALTER_KOMMENTAR}\n${CODE}\n`, {
    filePath: join(directory, DATEI),
  });
  const gemeldet = ergebnis.messages.filter(({ ruleId }) => ruleId === RULE).map(({ line }) => line);
  assert.deepEqual(gemeldet, [1]);
});
