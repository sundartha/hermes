import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BASIS } from "./auftrag-lauf-probe.js";
import {
  REPO_ROOT,
  RUNNER,
  isolatedEnvironment,
  outputLines,
  probeDirectory,
  probeRepository,
} from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const ABNAHME = "test/status.test.js";
const NIE = { wiederholung: "-", gleichzeitig: "-", zeitueberschreitung: "-", abbruch: "-" };
const MIT_ERWARTETEM_FEHLER = 0;
const NICHT_MIT_ERWARTETEM_FEHLER = 1;

function abnahmetest(name, rumpf) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `test(${JSON.stringify(name)}, () => {`,
    ...rumpf.map((zeile) => `  ${zeile}`),
    "});",
    "",
  ].join("\n");
}

function rotPruefung(context, testdatei, erwarteterFehler) {
  const repo = probeRepository(context, {
    ...BASIS,
    "package.json": JSON.stringify({
      type: "module",
      scripts: { test: `node ${JSON.stringify(RUNNER)} regression` },
    }),
    [ABNAHME]: testdatei,
  });
  const auftrag = {
    id: "A1",
    art: "funktion",
    ziel: "Melde den Status der eigenen Nummer",
    bereich: "src/text.js",
    erwarteteDateien: ["src/text.js", ABNAHME],
    vorbild: "src/text.js",
    abnahme: ABNAHME,
    erwarteterFehler,
    wasDarfNiePassieren: NIE,
  };
  const werkzeug = probeDirectory(context, {});
  const phasendatei = join(werkzeug, "phase.json");
  writeFileSync(
    phasendatei,
    JSON.stringify({
      phase: "probe",
      entwurf: { "src/text.js": "Entwurf." },
      auftraege: [auftrag],
    }),
  );
  return spawnSync(process.execPath, [EINSTIEG, "rot", phasendatei, "A1"], {
    cwd: repo,
    encoding: "utf8",
    env: isolatedEnvironment(),
  });
}

const MIT = "rot: ja, mit dem erwarteten Fehler";
const OHNE = "rot: ja, aber nicht mit dem erwarteten Fehler";

function pruefeUrteil(context, { testdatei, erwarteterFehler, exitCode, urteil }) {
  const lauf = rotPruefung(context, testdatei, erwarteterFehler);
  assert.equal(
    outputLines(lauf.stdout).at(-1),
    `${urteil} „${erwarteterFehler}“.`,
    lauf.stdout + lauf.stderr,
  );
  assert.equal(lauf.status, exitCode, lauf.stdout + lauf.stderr);
}

test("auftrag rot: ein fehlendes Feld ist rot mit dem erwarteten Wert in Anführungszeichen", (context) => {
  pruefeUrteil(context, {
    testdatei: abnahmetest("meldet den Status", [
      "const body = {};",
      'assert.equal(body.privateNumberStatus, "unbestaetigt");',
    ]),
    erwarteterFehler: "'unbestaetigt'",
    exitCode: MIT_ERWARTETEM_FEHLER,
    urteil: MIT,
  });
});

test("auftrag rot: ein anderer Wert ist rot mit dem erwarteten Wert in Anführungszeichen", (context) => {
  pruefeUrteil(context, {
    testdatei: abnahmetest("meldet den Status", ['assert.equal("offen", "unbestaetigt");']),
    erwarteterFehler: "'unbestaetigt'",
    exitCode: MIT_ERWARTETEM_FEHLER,
    urteil: MIT,
  });
});

test("auftrag rot: die rohe Form von node:assert zählt als erwarteter Fehler", (context) => {
  pruefeUrteil(context, {
    testdatei: abnahmetest("meldet den Status", ["assert.equal(true, false);"]),
    erwarteterFehler: "true !== false",
    exitCode: MIT_ERWARTETEM_FEHLER,
    urteil: MIT,
  });
});

test("auftrag rot: ein Test, der aus einem anderen Grund scheitert und den Text nur ausgibt, ist nicht rot mit dem erwarteten Fehler", (context) => {
  pruefeUrteil(context, {
    testdatei: abnahmetest("meldet den Status", [
      "console.log(\"Status 'unbestaetigt'\");",
      "const x = 1;",
      "x();",
    ]),
    erwarteterFehler: "'unbestaetigt'",
    exitCode: NICHT_MIT_ERWARTETEM_FEHLER,
    urteil: OHNE,
  });
});

test("auftrag rot: ein Testname mit dem erwarteten Fehler macht den Test nicht rot mit dem erwarteten Fehler", (context) => {
  pruefeUrteil(context, {
    testdatei: abnahmetest("der Status bleibt 'unbestaetigt'", [
      'assert.equal("offen", "bestaetigt");',
    ]),
    erwarteterFehler: "'unbestaetigt'",
    exitCode: NICHT_MIT_ERWARTETEM_FEHLER,
    urteil: OHNE,
  });
});
