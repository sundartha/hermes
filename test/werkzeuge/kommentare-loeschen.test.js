import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, isolatedEnvironment, probeRepository } from "./probe-repo.js";

const SCRIPT = join(REPO_ROOT, "tools/kommentare-loeschen.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const ESLINT_KONFIGURATION = "export default [{ ignores: ['ausgelassen/**'] }];\n";

function loeschen(directory, args) {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: isolatedEnvironment(),
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function inhalt(directory, pfad) {
  return readFileSync(join(directory, pfad), "utf8");
}

test("kommentare-loeschen: eine Datei mit Kommentaren verliert genau ihre Kommentare", (context) => {
  const vorher = [
    "#!/usr/bin/env node",
    "// Kopf",
    "",
    "/**",
    " * Block",
    " */",
    "export const wert = 1; // am Ende",
    "",
    "// allein",
    "",
    "export function summe(a, /* mitten */ b) {",
    "  return /* mit",
    "  Umbruch */ a + b;",
    "}",
    "",
  ].join("\n");
  const nachher = [
    "#!/usr/bin/env node",
    "export const wert = 1;",
    "",
    "export function summe(a, b) {",
    "  return",
    "  a + b;",
    "}",
    "",
  ].join("\n");
  const directory = probeRepository(context, { "eslint.config.js": ESLINT_KONFIGURATION, "src/a.js": vorher });
  const lauf = loeschen(directory, ["src"]);
  assert.equal(lauf.status, EXIT_OK, lauf.output);
  assert.equal(inhalt(directory, "src/a.js"), nachher);
  assert.match(lauf.output, /src\/a\.js: bereinigt \(6 Kommentare\)/);
});

test("kommentare-loeschen: Template-Strings bleiben Zeichen für Zeichen erhalten", (context) => {
  const vorlage = "const text = `Zeile mit Leerzeichen am Ende   \n\n\n\nnach drei Leerzeilen // kein Kommentar`;";
  const directory = probeRepository(context, {
    "eslint.config.js": ESLINT_KONFIGURATION,
    "src/vorlage.js": `${vorlage} // Kommentar\nexport default text;\n`,
  });
  const lauf = loeschen(directory, ["src"]);
  assert.equal(lauf.status, EXIT_OK, lauf.output);
  assert.equal(inhalt(directory, "src/vorlage.js"), `${vorlage}\nexport default text;\n`);
});

test("kommentare-loeschen: mit --trocken bleibt jede Datei unverändert", (context) => {
  const vorher = "export const a = 1; // weg\n";
  const directory = probeRepository(context, { "eslint.config.js": ESLINT_KONFIGURATION, "src/a.js": vorher });
  const lauf = loeschen(directory, ["--trocken", "src"]);
  assert.equal(lauf.status, EXIT_OK, lauf.output);
  assert.equal(inhalt(directory, "src/a.js"), vorher);
  assert.match(lauf.output, /1 Kommentare würden entfernt/);
});

test("kommentare-loeschen: Dateien, die ESLint auslässt, und Dateien außerhalb des Ordners bleiben unverändert", (context) => {
  const kommentiert = "export const a = 1; // bleibt\n";
  const directory = probeRepository(context, {
    "eslint.config.js": ESLINT_KONFIGURATION,
    "src/a.js": "export const a = 1; // weg\n",
    "ausgelassen/b.js": kommentiert,
    "anderer/c.js": kommentiert,
  });
  const lauf = loeschen(directory, ["src", "ausgelassen"]);
  assert.equal(lauf.status, EXIT_OK, lauf.output);
  assert.equal(inhalt(directory, "src/a.js"), "export const a = 1;\n");
  assert.equal(inhalt(directory, "ausgelassen/b.js"), kommentiert);
  assert.equal(inhalt(directory, "anderer/c.js"), kommentiert);
});

test("kommentare-loeschen: eine Datei, die danach keinen Code mehr hat, wird gemeldet und führt zu Exit 1", (context) => {
  const directory = probeRepository(context, {
    "eslint.config.js": ESLINT_KONFIGURATION,
    "src/ports.js": "/**\n * @typedef {object} Port\n */\n\nexport {};\n",
    "src/code.js": "export {}; // weg\nexport const wert = 1;\n",
  });
  const lauf = loeschen(directory, ["src"]);
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.equal(inhalt(directory, "src/ports.js"), "export {};\n");
  assert.equal(inhalt(directory, "src/code.js"), "export {};\nexport const wert = 1;\n");
  assert.match(lauf.output, /src\/ports\.js: hat danach keinen Code mehr/);
  assert.match(lauf.output, /src\/code\.js: bereinigt/);
});

test("kommentare-loeschen: eine Datei, die sich nicht lesen lässt, bleibt unverändert und führt zu Exit 1", (context) => {
  const kaputt = "export const a = ; // Kommentar\n";
  const directory = probeRepository(context, {
    "eslint.config.js": ESLINT_KONFIGURATION,
    "src/kaputt.js": kaputt,
    "src/gut.js": "export const b = 2; // weg\n",
  });
  const lauf = loeschen(directory, ["src"]);
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.equal(inhalt(directory, "src/kaputt.js"), kaputt);
  assert.equal(inhalt(directory, "src/gut.js"), "export const b = 2;\n");
  assert.match(lauf.output, /src\/kaputt\.js: nicht lesbar, Datei bleibt unverändert/);
});

test("kommentare-loeschen: Shell- und YAML-Kommentare verschwinden, Zeichenketten und Startzeile bleiben", (context) => {
  const directory = probeRepository(context, {
    "eslint.config.js": ESLINT_KONFIGURATION,
    "scripts/lauf.sh": '#!/bin/sh\n# erklärt\necho "a # b" # hinten\n\nexit 0\n',
    "render.yaml": "# Kopf\nservices:\n  - name: probe # Name\n    region: frankfurt\n",
  });
  const lauf = loeschen(directory, ["scripts", "render.yaml"]);
  assert.equal(lauf.status, EXIT_OK, lauf.output);
  assert.equal(inhalt(directory, "scripts/lauf.sh"), '#!/bin/sh\necho "a # b"\n\nexit 0\n');
  assert.equal(inhalt(directory, "render.yaml"), "services:\n  - name: probe\n    region: frankfurt\n");
});

test("kommentare-loeschen: ein Shell-Skript, das Bash danach anders liest, bleibt unverändert und führt zu Exit 1", (context) => {
  const heredoc = "#!/bin/sh\ncat <<EOF > notiz.md\n# Überschrift\nEOF\n";
  const directory = probeRepository(context, { "eslint.config.js": ESLINT_KONFIGURATION, "scripts/notiz.sh": heredoc });
  const lauf = loeschen(directory, ["scripts"]);
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.equal(inhalt(directory, "scripts/notiz.sh"), heredoc);
  assert.match(lauf.output, /scripts\/notiz\.sh: Bash liest danach einen anderen Befehl, Datei bleibt unverändert/);
});

test("kommentare-loeschen: ohne Ordner endet der Aufruf mit Exit 2", (context) => {
  const directory = probeRepository(context, { "eslint.config.js": ESLINT_KONFIGURATION });
  assert.equal(loeschen(directory, []).status, EXIT_USAGE);
});
