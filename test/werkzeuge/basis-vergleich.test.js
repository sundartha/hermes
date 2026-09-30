import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { isolatedEnvironment, probeDirectory, REPO_ROOT } from "./probe-repo.js";

const SCRIPT = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const CREATE = "--basis-anlegen";
const SHORTEN = "--basis-kuerzen";
const FAKE_SEMGREP_BIN = "bin";
const BASELINE_SEMGREP_VERSION = "1.0.0";
const OTHER_SEMGREP_VERSION = "2.0.0";
const EXECUTABLE_MODE = 0o755;

const DUPLICATED_BLOCK = `export function summe(werte) {
  let ergebnis = 0;
  for (const wert of werte) {
    if (typeof wert !== "number") throw new TypeError(\`kein Wert: \${wert}\`);
    ergebnis += wert * 2 + 1;
  }
  const mittel = ergebnis / werte.length;
  return { ergebnis, mittel, anzahl: werte.length, leer: werte.length === 0 };
}
`;
const UNRELATED_CODE = "export const wert = 1;\n";
const SHIFTING_BLANK_LINES = "\n\n\n\n";

const KNIP_PROJECT = {
  "package.json": `${JSON.stringify({ name: "probe", type: "module", private: true })}\n`,
  "knip.json": `${JSON.stringify({ entry: ["src/main.js"], project: ["src/**/*.js"] })}\n`,
  "src/main.js": 'import { genutzt } from "./werkzeug.js";\n\nconsole.log(genutzt());\n',
  "src/werkzeug.js":
    "export function genutzt() {\n  return 1;\n}\n\nexport function alt() {\n  return 2;\n}\n",
};

const FAKE_SEMGREP = `#!/usr/bin/env node
const { readdirSync, readFileSync } = require("node:fs");
const MARKER = "exec(";
if (process.argv.includes("--version")) {
  console.log(process.env.PROBE_SEMGREP_VERSION);
  process.exit(0);
}
const results = readdirSync("src").flatMap((name) => {
  const path = "src/" + name;
  const text = readFileSync(path, "utf8");
  const found = [];
  for (let offset = text.indexOf(MARKER); offset !== -1; offset = text.indexOf(MARKER, offset + 1)) {
    const line = text.slice(0, offset).split("\\n").length;
    found.push({ check_id: "probe.exec", path, start: { line, offset }, end: { offset: offset + MARKER.length } });
  }
  return found;
});
console.log(JSON.stringify({ results, errors: [] }));
`;
const INJECTION_LINE = "export const lauf = (befehl) => exec(befehl);\n";

function runComparison(directory, args, environment = isolatedEnvironment()) {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: environment,
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function assertExit(result, expected) {
  assert.equal(result.status, expected, result.output);
}

function jscpdProject(context) {
  const directory = probeDirectory(context, {
    "src/eins.js": DUPLICATED_BLOCK,
    "src/zwei.js": DUPLICATED_BLOCK,
  });
  assertExit(runComparison(directory, ["jscpd", CREATE]), EXIT_OK);
  return directory;
}

function writeProbeFile(directory, path, content) {
  writeFileSync(join(directory, path), content);
}

function prependLines(directory, path) {
  const content = readFileSync(join(directory, path), "utf8");
  writeProbeFile(directory, path, `${JSON.stringify(path)}${SHIFTING_BLANK_LINES}${content}`);
}

function knipProject(context) {
  const directory = probeDirectory(context, KNIP_PROJECT);
  assertExit(runComparison(directory, ["knip", CREATE]), EXIT_OK);
  return directory;
}

function semgrepEnvironment(directory, version) {
  return {
    ...isolatedEnvironment(),
    PATH: `${join(directory, FAKE_SEMGREP_BIN)}${delimiter}${process.env.PATH}`,
    PROBE_SEMGREP_VERSION: version,
  };
}

function semgrepProject(context) {
  const directory = probeDirectory(context, {
    [`${FAKE_SEMGREP_BIN}/semgrep`]: FAKE_SEMGREP,
    "src/befehl.js": `import { exec } from "node:child_process";\n\n${INJECTION_LINE}`,
  });
  chmodSync(join(directory, FAKE_SEMGREP_BIN, "semgrep"), EXECUTABLE_MODE);
  const environment = semgrepEnvironment(directory, BASELINE_SEMGREP_VERSION);
  assertExit(runComparison(directory, ["semgrep", CREATE], environment), EXIT_OK);
  return directory;
}

test("basis-vergleich: unveraenderter Stand ist gruen", (context) => {
  const directory = jscpdProject(context);
  const result = runComparison(directory, ["jscpd"]);
  assertExit(result, EXIT_OK);
  assert.ok(!result.output.includes(SHORTEN), result.output);
});

test("basis-vergleich: eine neue Kopie ist rot und nennt die neue Datei", (context) => {
  const directory = jscpdProject(context);
  writeProbeFile(directory, "src/drei.js", DUPLICATED_BLOCK);
  const result = runComparison(directory, ["jscpd"]);
  assertExit(result, EXIT_FINDING);
  assert.match(result.output, /src\/drei\.js/);
});

test("basis-vergleich: eine behobene Kopie ist gruen und nennt den Befehl zum Kuerzen", (context) => {
  const directory = jscpdProject(context);
  writeProbeFile(directory, "src/zwei.js", UNRELATED_CODE);
  const result = runComparison(directory, ["jscpd"]);
  assertExit(result, EXIT_OK);
  assert.ok(result.output.includes(SHORTEN), result.output);
});

test("basis-vergleich: verschobene Zeilen machen aus einer bekannten Kopie keine neue", (context) => {
  const directory = jscpdProject(context);
  prependLines(directory, "src/eins.js");
  prependLines(directory, "src/zwei.js");
  const result = runComparison(directory, ["jscpd"]);
  assertExit(result, EXIT_OK);
  assert.ok(!result.output.includes(SHORTEN), result.output);
});

test("basis-vergleich: --basis-kuerzen entfernt eine behobene Kopie aus der Basislinie", (context) => {
  const directory = jscpdProject(context);
  writeProbeFile(directory, "src/zwei.js", UNRELATED_CODE);
  assertExit(runComparison(directory, ["jscpd", SHORTEN]), EXIT_OK);
  writeProbeFile(directory, "src/zwei.js", DUPLICATED_BLOCK);
  assertExit(runComparison(directory, ["jscpd"]), EXIT_FINDING);
});

test("basis-vergleich: --basis-kuerzen nimmt eine neue Kopie nicht auf", (context) => {
  const directory = jscpdProject(context);
  writeProbeFile(directory, "src/drei.js", DUPLICATED_BLOCK);
  assertExit(runComparison(directory, ["jscpd", SHORTEN]), EXIT_OK);
  assertExit(runComparison(directory, ["jscpd"]), EXIT_FINDING);
});

test("basis-vergleich: --basis-anlegen ueberschreibt keine vorhandene Basislinie", (context) => {
  const directory = jscpdProject(context);
  writeProbeFile(directory, "src/drei.js", DUPLICATED_BLOCK);
  assertExit(runComparison(directory, ["jscpd", CREATE]), EXIT_FINDING);
  assertExit(runComparison(directory, ["jscpd"]), EXIT_FINDING);
});

test("basis-vergleich: ohne Basislinie ist der Vergleich rot", (context) => {
  const directory = probeDirectory(context, { "src/eins.js": DUPLICATED_BLOCK });
  const result = runComparison(directory, ["jscpd"]);
  assertExit(result, EXIT_FINDING);
  assert.match(result.output, /fehlt/);
});

test("basis-vergleich: ein neuer ungenutzter Export ist rot (knip)", (context) => {
  const directory = knipProject(context);
  writeProbeFile(
    directory,
    "src/werkzeug.js",
    `${KNIP_PROJECT["src/werkzeug.js"]}\nexport function neu() {\n  return 3;\n}\n`,
  );
  const result = runComparison(directory, ["knip"]);
  assertExit(result, EXIT_FINDING);
  assert.match(result.output, /\bneu\b/);
});

test("basis-vergleich: verschobene Zeilen lassen einen bekannten ungenutzten Export bekannt (knip)", (context) => {
  const directory = knipProject(context);
  prependLines(directory, "src/werkzeug.js");
  const result = runComparison(directory, ["knip"]);
  assertExit(result, EXIT_OK);
  assert.ok(!result.output.includes(SHORTEN), result.output);
});

test("basis-vergleich: ein neuer Semgrep-Befund ist rot", (context) => {
  const directory = semgrepProject(context);
  writeProbeFile(directory, "src/zweiter.js", INJECTION_LINE);
  const environment = semgrepEnvironment(directory, BASELINE_SEMGREP_VERSION);
  const result = runComparison(directory, ["semgrep"], environment);
  assertExit(result, EXIT_FINDING);
  assert.match(result.output, /src\/zweiter\.js/);
});

test("basis-vergleich: verschobene Zeilen lassen einen bekannten Semgrep-Befund bekannt", (context) => {
  const directory = semgrepProject(context);
  prependLines(directory, "src/befehl.js");
  const environment = semgrepEnvironment(directory, BASELINE_SEMGREP_VERSION);
  const result = runComparison(directory, ["semgrep"], environment);
  assertExit(result, EXIT_OK);
  assert.ok(!result.output.includes(SHORTEN), result.output);
});

test("basis-vergleich: eine andere Semgrep-Version als die der Basislinie ist rot", (context) => {
  const directory = semgrepProject(context);
  const environment = semgrepEnvironment(directory, OTHER_SEMGREP_VERSION);
  const result = runComparison(directory, ["semgrep"], environment);
  assertExit(result, EXIT_FINDING);
  assert.ok(result.output.includes(OTHER_SEMGREP_VERSION), result.output);
});
