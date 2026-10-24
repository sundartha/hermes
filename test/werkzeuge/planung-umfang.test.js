import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { AUFTRAG, EXIT_AUFRUF, EXIT_GRUEN, planeAntworten, planungsBericht } from "./planung-plane-probe.js";
import { HINWEIS, LAUF_FRIST_MS, ORDNER, exit, plane } from "./planung-probe.js";
import { REPO_ROOT, isolatedEnvironment, probeRepository } from "./probe-repo.js";

const PAKET = "plaene/P-009-probe";
const KB = 1024;
const DOKUMENT_KB = 3;
const PITCH = `# Probe

## Anforderungen

#### Szenario S1: Hinweis erscheint
Die Änderung liegt in \`src/hinweis.js:4\`.

#### Szenario S2: Hinweis bleibt aus
Siehe \`src/grund.js:1\` und \`test/hinweis.test.js:1\`.

## Bleibt unverändert

### Szenario B1: Alter Weg
Die Datei \`src/fehlt.js:3\` gibt es nicht.
`;
const SICHERHEIT = `# Sicherheit

## 2. Angriffswege

### T1: Fremde Nummer
Ausgang: verhindern
Szenario: fremde Nummer wird abgelehnt

### T2: Lange Leitung
Ausgang: hinnehmen
`;
const DESIGN_KOPF = "# Design\n\n";
const QUELLEN = {
  "src/hinweis.js": `import { grund } from "./grund.js";\n\nexport function alt(nummer) {\n  var text = grund(nummer);\n  return text;\n}\n\nexport function neu(nummer) {\n  return nummer;\n}\n`,
  "src/grund.js": `export function grund(nummer) {\n  return nummer;\n}\n`,
  "test/hinweis.test.js": `import { alt } from "../src/hinweis.js";\n\nalt("x");\n`,
  "test/grund.test.js": `import { grund } from "../src/grund.js";\n\ngrund("x");\n`,
  "tools/bereiche.json": "[]",
  "eslint.config.js": 'export default [{ rules: { "no-var": "error" } }];\n',
  "package.json": JSON.stringify({ type: "module" }),
  ".gitignore": "node_modules\n",
};

function design() {
  const belegt = Buffer.byteLength(PITCH) + Buffer.byteLength(SICHERHEIT) + Buffer.byteLength(DESIGN_KOPF);
  return DESIGN_KOPF + "x".repeat(DOKUMENT_KB * KB - belegt);
}

function paketRepo(context, dokumente) {
  const wurzel = probeRepository(context, { ...QUELLEN, ...Object.fromEntries(Object.entries(dokumente).map(([name, text]) => [`${PAKET}/${name}`, text])) });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(wurzel, "node_modules"));
  return wurzel;
}

function umfangIn(wurzel, ordner) {
  return spawnSync(process.execPath, [AUFTRAG, "umfang", ordner], { cwd: wurzel, encoding: "utf8", env: isolatedEnvironment(), timeout: LAUF_FRIST_MS });
}

test("umfang zählt Nummern, belegte Code- und Testdateien, getroffene Funktionen, Altfunktionen, erreichende Tests und die Dokumentgröße eines Pitch-Ordners", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = paketRepo(context, { "pitch.md": PITCH, "sicherheit.md": SICHERHEIT, "design.md": design() });

  const lauf = umfangIn(wurzel, PAKET);

  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(JSON.parse(lauf.stdout), {
    nummern: 4,
    codeDateien: ["src/grund.js", "src/hinweis.js"],
    testDateien: ["test/hinweis.test.js"],
    funktionen: 2,
    altfunktionen: 1,
    testsAnDateien: ["test/grund.test.js", "test/hinweis.test.js"],
    dokumentKB: DOKUMENT_KB,
  });
});

test("umfang ohne sicherheit.md endet mit Exit 2, nennt die fehlende Datei und gibt kein JSON aus", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = paketRepo(context, { "pitch.md": PITCH });

  const lauf = umfangIn(wurzel, PAKET);

  exit(lauf, EXIT_AUFRUF);
  assert.match(lauf.stderr, /enthält kein sicherheit\.md/u);
  assert.equal(lauf.stdout, "");
});

function mitBeleg(wurzel) {
  appendFileSync(join(wurzel, ORDNER, "design.md"), `\nBeleg für den Hinweis: \`${HINWEIS}:7\`\n`);
  return ["plane", ORDNER];
}

test("plane schreibt den Umfang des Pitches in planung.json, gleich der Ausgabe von umfang", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: mitBeleg });
  exit(lauf, EXIT_GRUEN);

  const { umfang } = planungsBericht(lauf);

  const gemessen = umfangIn(lauf.wurzel, ORDNER);
  exit(gemessen, EXIT_GRUEN);
  assert.deepEqual(umfang, JSON.parse(gemessen.stdout));
  assert.ok(umfang.codeDateien.includes(HINWEIS), JSON.stringify(umfang));
});
