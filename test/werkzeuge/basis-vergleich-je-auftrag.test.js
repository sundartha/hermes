import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import { commitAll, isolatedEnvironment, mitUpstreamMaster, probeDirectory, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";

const SCRIPT = join(REPO_ROOT, "tools/basis-vergleich.mjs");

function echterCiLokalSchritt(name) {
  const { schritte } = JSON.parse(readFileSync(join(REPO_ROOT, "tools/ci-lokal.json"), "utf8"));
  const { befehl } = schritte.find((schritt) => schritt.name === name);
  return befehl.replace("tools/basis-vergleich.mjs", JSON.stringify(SCRIPT));
}

const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_ABORT = 1;
const EXECUTABLE_MODE = 0o755;
const PER_JOB = "--je-auftrag";
const BEFORE_JOB = ["--basis", "HEAD"];
const TOLERATED = "bestehen aber schon auf dem Stand vor dem Auftrag";
const COUNTS_LATER = "Am Phasenende (ci:lokal gegen master) und in der CI zählen sie";
const HARMLESS = "export function harmlos() {\n  return 1;\n}\n";
const OLD = "export const alt = 0;\n";
const FAKE_SEMGREP = `#!/usr/bin/env node
const { appendFileSync, readFileSync, readdirSync } = require("node:fs");
const argv = process.argv.slice(2);
if (argv.includes("--version")) return console.log("1.0.0");
const targets = argv.slice(argv.indexOf("--exclude") + 2);
appendFileSync(process.env.PROBE_LOG, JSON.stringify({ cwd: process.cwd(), targets }) + "\\n");
const files = targets.includes(".") ? readdirSync("src").map((name) => "src/" + name) : targets;
const hits = (path) => [...readFileSync(path, "utf8").matchAll(/exec\\(/g)].map(({ index }) => ({ check_id: "probe", path, start: { line: 1, offset: index }, end: { offset: index + 5 } }));
console.log(JSON.stringify({ errors: [], results: files.flatMap(hits) }));
`;
const RULES_FILE = "tools/basis/semgrep-regeln.json";
const INJECTION = "export const lauf = (befehl) => exec(befehl);\n";

function run(repo, args, environment = isolatedEnvironment()) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8", env: environment });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function expectRun(result, status, shows = []) {
  assert.equal(result.status, status, result.output);
  for (const text of shows) assert.ok(result.output.includes(text), result.output);
}

function semgrepAfterEarlierJob(context, { listed = {}, earlier }) {
  const bin = probeDirectory(context, { semgrep: FAKE_SEMGREP });
  chmodSync(join(bin, "semgrep"), EXECUTABLE_MODE);
  const log = join(bin, "aufrufe.jsonl");
  const environment = { ...isolatedEnvironment(), PATH: `${bin}${delimiter}${process.env.PATH}`, PROBE_LOG: log };
  const repo = probeRepository(context, { "src/alt.js": OLD, [RULES_FILE]: '{"rules":[]}\n', ...listed });
  expectRun(run(repo, ["semgrep", "--basis-anlegen"], environment), EXIT_OK);
  commitAll(repo, "Liste");
  mitUpstreamMaster(repo);
  writeFiles(repo, earlier);
  commitAll(repo, "Früherer Auftrag");
  rmSync(log, { force: true });
  return { repo, environment, log };
}

function semgrepPerJob({ repo, environment }) {
  return run(repo, ["semgrep", ...BEFORE_JOB, PER_JOB], environment);
}

function loggedScans(log) {
  const lines = readFileSync(log, "utf8").split("\n");
  return lines.filter(Boolean).map((line) => JSON.parse(line));
}

function ciLokalAgainstMaster(name, repo, environment = isolatedEnvironment()) {
  const result = spawnSync("sh", ["-c", echterCiLokalSchritt(name)], { cwd: repo, encoding: "utf8", env: { ...environment, BASIS: "upstream/master" } });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("je-auftrag: eine frühere Injektion, die nicht in der Liste steht, macht den späteren Auftrag nicht rot, ohne die Option bleibt sie rot", (context) => {
  const phase = semgrepAfterEarlierJob(context, { earlier: { "src/befehl.js": INJECTION } });
  writeFiles(phase.repo, { "src/harmlos.js": HARMLESS });
  expectRun(run(phase.repo, ["semgrep", ...BEFORE_JOB], phase.environment), EXIT_FINDING, ["src/befehl.js"]);
  expectRun(semgrepPerJob(phase), EXIT_OK, [TOLERATED, COUNTS_LATER, "src/befehl.js"]);
});

test("je-auftrag: derselbe Injektions-Schnipsel ein zweites Mal in derselben Datei bleibt rot", (context) => {
  const phase = semgrepAfterEarlierJob(context, { earlier: { "src/befehl.js": INJECTION } });
  writeFiles(phase.repo, { "src/befehl.js": `${INJECTION}${INJECTION}` });
  expectRun(semgrepPerJob(phase), EXIT_FINDING, ["src/befehl.js"]);
});

test("je-auftrag: dieselbe Injektion in einer neuen Datei bleibt rot", (context) => {
  const phase = semgrepAfterEarlierJob(context, { earlier: { "src/befehl.js": INJECTION } });
  writeFiles(phase.repo, { "src/zweiter.js": INJECTION });
  expectRun(semgrepPerJob(phase), EXIT_FINDING, ["src/zweiter.js"]);
});

test("je-auftrag: ändert der Auftrag die Semgrep-Regeln, gibt es keine Duldung", (context) => {
  const phase = semgrepAfterEarlierJob(context, { earlier: { "src/befehl.js": INJECTION } });
  writeFiles(phase.repo, { [RULES_FILE]: '{"rules":[{"id":"andere"}]}\n' });
  expectRun(semgrepPerJob(phase), EXIT_FINDING, ["src/befehl.js"]);
});

test("je-auftrag: der Schritt semgrep aus ci-lokal.json meldet die frühere Injektion gegen master weiter rot, obwohl der Auftrag grün ist", (context) => {
  const phase = semgrepAfterEarlierJob(context, { earlier: { "src/befehl.js": INJECTION } });
  writeFiles(phase.repo, { "src/harmlos.js": HARMLESS });
  expectRun(semgrepPerJob(phase), EXIT_OK);
  expectRun(ciLokalAgainstMaster("semgrep", phase.repo, phase.environment), EXIT_FINDING, ["src/befehl.js"]);
});

test("je-auftrag: semgrep scannt den Stand vor dem Auftrag nur auf den Dateien der offenen Befunde", (context) => {
  const listed = { "src/gelistet.js": INJECTION };
  const phase = semgrepAfterEarlierJob(context, { listed, earlier: { "src/befehl.js": INJECTION } });
  writeFiles(phase.repo, { "src/harmlos.js": HARMLESS });
  expectRun(semgrepPerJob(phase), EXIT_OK);
  const scans = loggedScans(phase.log);
  assert.deepEqual(scans.map(({ targets }) => targets), [["."], ["src/befehl.js"]]);
  assert.notEqual(scans[1].cwd, scans[0].cwd);
});

test("je-auftrag: ohne --basis und für ein Werkzeug ohne diese Betriebsart ist die Option ein Aufruffehler", (context) => {
  const repo = probeRepository(context, { "src/alt.js": OLD });
  expectRun(run(repo, ["semgrep", PER_JOB]), EXIT_ABORT, ["Aufruf:"]);
  expectRun(run(repo, ["knip", ...BEFORE_JOB, PER_JOB]), EXIT_ABORT, ["Aufruf:"]);
});
