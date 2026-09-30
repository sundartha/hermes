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
const EXECUTABLE_MODE = 0o755;
const BASELINE_VERSION = "1.0.0";
const OTHER_VERSION = "2.0.0";
const DUPLICATED_BLOCK = `export function summe(werte) {
  let ergebnis = 0;
  for (const wert of werte) ergebnis += wert * 2 + 1;
  const mittel = ergebnis / werte.length;
  return { ergebnis, mittel, anzahl: werte.length, leer: werte.length === 0 };
}
`;
const OTHER_CODE = "export const wert = 1;\n";
const INJECTION = "export const lauf = (befehl) => exec(befehl);\n";
const FAKE_SEMGREP = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) return console.log(process.env.PROBE_SEMGREP_VERSION);
const found = (path, text = fs.readFileSync(path, "utf8")) => [...text.matchAll(/exec\\(/g)].map(({ index }) => ({ check_id: "probe", path, start: { line: text.slice(0, index).split("\\n").length, offset: index }, end: { offset: index + 5 } }));
console.log(JSON.stringify({ errors: [], results: fs.readdirSync("src").flatMap((name) => found("src/" + name)) }));
`;
const JSCPD = { "src/eins.js": DUPLICATED_BLOCK, "src/zwei.js": DUPLICATED_BLOCK };
const KNIP = {
  "package.json": '{"type":"module","knip":{"entry":["src/main.js"],"project":["src/*.js"]}}',
  "src/main.js": 'import { genutzt } from "./werkzeug.js";\nconsole.log(genutzt);\n',
  "src/werkzeug.js": "export const genutzt = 1;\nexport const alt = 2;\n",
};
const SEMGREP = { "bin/semgrep": FAKE_SEMGREP, "src/befehl.js": INJECTION };

function environmentFor(directory, version = BASELINE_VERSION) {
  const PATH = `${join(directory, "bin")}${delimiter}${process.env.PATH}`;
  return { ...isolatedEnvironment(), PATH, PROBE_SEMGREP_VERSION: version };
}

function expectRun({ directory, environment }, args, { status, shows, hides }) {
  const env = environment ?? environmentFor(directory);
  const options = { cwd: directory, encoding: "utf8", env };
  const run = spawnSync(process.execPath, [SCRIPT, ...args], options);
  const output = `${run.stdout}${run.stderr}`;
  assert.equal(run.status, status, output);
  if (shows !== undefined) assert.ok(output.includes(shows), output);
  if (hides !== undefined) assert.ok(!output.includes(hides), output);
}

function probe(context, files, tool) {
  const probed = { directory: probeDirectory(context, files) };
  if (files === SEMGREP) chmodSync(join(probed.directory, "bin/semgrep"), EXECUTABLE_MODE);
  expectRun(probed, [tool, CREATE], { status: EXIT_OK });
  return probed;
}

function write({ directory }, path, content) {
  writeFileSync(join(directory, path), content);
}

function shift(probed, path) {
  const content = readFileSync(join(probed.directory, path), "utf8");
  write(probed, path, `${JSON.stringify(path)}\n\n\n\n${content}`);
}

test("basis-vergleich: unveraenderter Stand ist gruen", (context) => {
  expectRun(probe(context, JSCPD, "jscpd"), ["jscpd"], { status: EXIT_OK, hides: SHORTEN });
});

test("basis-vergleich: eine neue Kopie ist rot und nennt die neue Datei", (context) => {
  const probed = probe(context, JSCPD, "jscpd");
  write(probed, "src/drei.js", DUPLICATED_BLOCK);
  expectRun(probed, ["jscpd"], { status: EXIT_FINDING, shows: "src/drei.js" });
});

test("basis-vergleich: eine behobene Kopie ist gruen und nennt --basis-kuerzen", (context) => {
  const probed = probe(context, JSCPD, "jscpd");
  write(probed, "src/zwei.js", OTHER_CODE);
  expectRun(probed, ["jscpd"], { status: EXIT_OK, shows: SHORTEN });
});

test("basis-vergleich: verschobene Zeilen machen aus einer bekannten Kopie keine neue", (context) => {
  const probed = probe(context, JSCPD, "jscpd");
  shift(probed, "src/eins.js");
  shift(probed, "src/zwei.js");
  expectRun(probed, ["jscpd"], { status: EXIT_OK, hides: SHORTEN });
});

test("basis-vergleich: die Basislinie waechst weder durch Kuerzen noch durch Anlegen", (context) => {
  const probed = probe(context, JSCPD, "jscpd");
  write(probed, "src/zwei.js", OTHER_CODE);
  write(probed, "src/drei.js", DUPLICATED_BLOCK);
  expectRun(probed, ["jscpd", CREATE], { status: EXIT_FINDING });
  expectRun(probed, ["jscpd", SHORTEN], { status: EXIT_OK });
  expectRun(probed, ["jscpd"], { status: EXIT_FINDING, shows: "src/drei.js" });
  write(probed, "src/drei.js", OTHER_CODE);
  write(probed, "src/zwei.js", DUPLICATED_BLOCK);
  expectRun(probed, ["jscpd"], { status: EXIT_FINDING, shows: "src/zwei.js" });
});

test("basis-vergleich: ohne Basislinie ist der Vergleich rot", (context) => {
  const directory = probeDirectory(context, JSCPD);
  expectRun({ directory }, ["jscpd"], { status: EXIT_FINDING, shows: "fehlt" });
});

test("basis-vergleich: ein anderer ungenutzter Export statt des bekannten ist rot (knip)", (context) => {
  const probed = probe(context, KNIP, "knip");
  write(probed, "src/werkzeug.js", "export const genutzt = 1;\nexport const neu = 3;\n");
  expectRun(probed, ["knip"], { status: EXIT_FINDING, shows: "exports neu" });
});

test("basis-vergleich: ein neuer Semgrep-Befund ist rot", (context) => {
  const probed = probe(context, SEMGREP, "semgrep");
  write(probed, "src/zweiter.js", INJECTION);
  expectRun(probed, ["semgrep"], { status: EXIT_FINDING, shows: "src/zweiter.js" });
});

test("basis-vergleich: verschobene Zeilen lassen einen Semgrep-Befund bekannt", (context) => {
  const probed = probe(context, SEMGREP, "semgrep");
  shift(probed, "src/befehl.js");
  expectRun(probed, ["semgrep"], { status: EXIT_OK, hides: SHORTEN });
});

test("basis-vergleich: eine andere Semgrep-Version als die der Basislinie ist rot", (context) => {
  const probed = probe(context, SEMGREP, "semgrep");
  const environment = environmentFor(probed.directory, OTHER_VERSION);
  expectRun({ ...probed, environment }, ["semgrep"], {
    status: EXIT_FINDING,
    shows: OTHER_VERSION,
  });
});
