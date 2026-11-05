import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import { KOPIEN_LISTE, MIT_MUTATION_DES_TESTUMBAUS, MUTATION_DES_TESTUMBAUS, ROTER_TEST, VERDOPPELT, funktion, namen } from "./auftrag-lauf-hilfen.js";
import { BASIS, TESTUMBAU, starte } from "./auftrag-lauf-probe.js";
import { probeDirectory } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const AUFRUFE = "aufrufe.txt";
const MARKE = "betroffen-gelaufen.txt";
const DREHBUCH = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
const SEMGREP_JSON = `${JSON.stringify({ version: "1.0.0", befunde: [] })}\n`;
const MARKE_SKRIPT = 'import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.MARKE_DATEI, "gelaufen");\n';
const DATEIEN = {
  ...KOPIEN_LISTE,
  "tools/basis/semgrep.json": SEMGREP_JSON,
  "marke.mjs": MARKE_SKRIPT,
  "package.json": BASIS["package.json"].replace('"node -e 0 --"', '"node marke.mjs"'),
};
const STUFEN_FUNKTION = ["tests/statisch", "jscpd", "rot", "abnahme", "commit"];
const STUFEN_TESTUMBAU = ["testumbau fälle", "jscpd", "abnahme", MUTATION_DES_TESTUMBAUS, "commit"];

function spione(context) {
  const ordner = probeDirectory(context, {
    semgrep: `#!/bin/sh\necho "$@" >> "$(dirname "$0")/${AUFRUFE}"\necho 1.0.0\n`,
    pg_isready: "#!/bin/sh\nexit 0\n",
  });
  for (const name of ["semgrep", "pg_isready"]) chmodSync(join(ordner, name), AUSFUEHRBAR);
  const marke = join(probeDirectory(context, {}), MARKE);
  return { ordner, marke, umgebung: { PATH: `${ordner}${delimiter}${process.env.PATH}`, MARKE_DATEI: marke } };
}

function aufrufeVonSemgrep(ordner) {
  const datei = join(ordner, AUFRUFE);
  return existsSync(datei) ? readFileSync(datei, "utf8").split("\n").filter(Boolean) : [];
}

function ohneBeideAufrufe(context, stufen, optionen) {
  const { ordner, marke, umgebung } = spione(context);
  const { lauf, beleg } = starte(context, { drehbuch: DREHBUCH, dateien: DATEIEN, ...optionen, umgebung });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  for (const name of stufen) assert.ok(namen(beleg).includes(name), `${name}: ${namen(beleg).join(", ")}`);
  assert.deepEqual(aufrufeVonSemgrep(ordner).filter((zeile) => zeile !== "--version"), []);
  assert.equal(existsSync(marke), false);
  assert.ok(!namen(beleg).includes("semgrep") && !namen(beleg).includes("betroffene tests"), namen(beleg).join(", "));
  return beleg;
}

test("ein Funktionsauftrag ruft weder semgrep noch test:betroffen auf, Abnahme, Rot-Lauf und die schnellen Prüfungen laufen", (context) => {
  ohneBeideAufrufe(context, STUFEN_FUNKTION, { auftrag: funktion("2 !== 4") });
});

test("ein Testumbau ruft weder semgrep noch test:betroffen auf, die Mutation des Testumbaus läuft", (context) => {
  ohneBeideAufrufe(context, STUFEN_TESTUMBAU, {
    auftrag: TESTUMBAU,
    drehbuch: { test: { "test/rechnen.test.js": ROTER_TEST } },
    dateien: { ...DATEIEN, ...MIT_MUTATION_DES_TESTUMBAUS, "src/rechnen.js": VERDOPPELT },
  });
});
