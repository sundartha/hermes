import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { env } from "node:process";

export const ROTPROBEN_DIR = "test/werkzeuge/rotproben";
export const FEHLALARME_DIR = "test/werkzeuge/fehlalarme";
export const GESTOPPT = "gestoppt";
export const DURCHGELASSEN = "durchgelassen";
export const NICHT_AUSGEFUEHRT = "nicht ausgeführt";
export const LOCKERER = "lockerer";
const STRENGER = "strenger";
const GLEICH = "gleich";
const NEU = "neu";
export const MANIFEST_FILE = "pruefung.json";
const WILDCARD = "*";
const PLACEHOLDER = /\{(wurzel|attrappe|basis)\}/g;
const TRAILING_NUMBER = /(\d+)$/;
const HTTP_OK = 200;
const ESLINT_ERROR = 2;
const MAX_GIT_OUTPUT_BYTES = 268_435_456;
const PROBE_GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Rotprobe",
  GIT_AUTHOR_EMAIL: "rotprobe@example.invalid",
  GIT_COMMITTER_NAME: "Rotprobe",
  GIT_COMMITTER_EMAIL: "rotprobe@example.invalid",
};

function cleanEnvironment(extra = {}) {
  const inherited = Object.entries(env).filter(([name]) => !name.startsWith("GIT_"));
  return { ...Object.fromEntries(inherited), GITHUB_TOKEN: "", ...extra };
}

export function git(args, { cwd = ".", probe = false } = {}) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    env: cleanEnvironment(probe ? PROBE_GIT_ENV : {}),
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function fileAt(commit, path) {
  try {
    return git(["show", `${commit}:${path}`]);
  } catch {
    return undefined;
  }
}

export function matches(pattern, path) {
  if (pattern.endsWith("/")) return path.startsWith(pattern);
  const [head, tail, ...more] = pattern.split(WILDCARD);
  if (more.length > 0) throw new Error(`Das Muster ${pattern} hat mehr als ein Sternchen.`);
  if (tail === undefined) return path === pattern;
  const middle = path.slice(head.length, path.length - tail.length);
  const fits = path.length >= head.length + tail.length;
  return fits && path.startsWith(head) && path.endsWith(tail) && !middle.includes("/");
}

export function isInstalled(program) {
  return spawnSync(program, ["--version"], { stdio: "ignore" }).error?.code !== "ENOENT";
}

function run(command, { cwd, extraEnv }) {
  const [program, ...args] = command;
  return new Promise((done) => {
    const executable = program === "node" ? process.execPath : program;
    const child = spawn(executable, args, { cwd, env: cleanEnvironment(extraEnv) });
    const output = { stdout: "", stderr: "" };
    child.stdout.on("data", (chunk) => (output.stdout += chunk));
    child.stderr.on("data", (chunk) => (output.stderr += chunk));
    child.on("error", (error) =>
      done({ ...output, missing: error.code === "ENOENT", status: null }),
    );
    child.on("close", (status) => done({ ...output, status }));
  });
}

function prepare(definition, context, files = []) {
  const values = { wurzel: context.root, attrappe: context.fake, basis: context.basis };
  const fill = (text) => text.replace(PLACEHOLDER, (_placeholder, name) => values[name]);
  const command = definition.befehl.flatMap((part) =>
    part === "{dateien}" ? files : [fill(part)],
  );
  const variables = Object.entries(definition.umgebung ?? {});
  return {
    command,
    extraEnv: Object.fromEntries(variables.map(([key, value]) => [key, fill(value)])),
  };
}

export function fileText(content) {
  if (!Array.isArray(content)) return content;
  const lines = content.map((line) => (Array.isArray(line) ? line.join("") : line));
  return `${lines.join("\n")}\n`;
}

function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, fileText(content));
  }
}

function removeFiles(root, paths = []) {
  for (const path of paths) {
    if (!existsSync(join(root, path)))
      throw new Error(`Die Rot-Probe löscht ${path}, das es im Vorher-Stand nicht gibt.`);
    rmSync(join(root, path));
  }
}

function commitAll(directory, message) {
  git(["add", "-A"], { cwd: directory, probe: true });
  git(["commit", "-q", "--allow-empty", "-m", message], { cwd: directory, probe: true });
}

function carriedPaths(root, path) {
  if (!path.endsWith("/")) return [path];
  const folder = join(root, path);
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${path}${relative(folder, join(entry.parentPath, entry.name))}`);
}

function carriedFiles(root, paths = []) {
  const present = paths
    .flatMap((path) => carriedPaths(root, path))
    .filter((path) => existsSync(join(root, path)));
  return Object.fromEntries(present.map((path) => [path, readFileSync(join(root, path), "utf8")]));
}

function caseVerdict(result, expected) {
  if (result.missing) return NICHT_AUSGEFUEHRT;
  const output = `${result.stdout}${result.stderr}`;
  const stopped = result.status !== 0 && (expected === undefined || output.includes(expected));
  return stopped ? GESTOPPT : DURCHGELASSEN;
}

export async function runCase(context, probe, fall) {
  const directory = mkdtempSync(join(tmpdir(), "rotprobe-"));
  try {
    git(["init", "-q"], { cwd: directory, probe: true });
    const carried = carriedFiles(context.root, probe.mitnehmen);
    writeTree(directory, { ".gitignore": ["node_modules"], ...carried, ...fall.vorher });
    commitAll(directory, "vorher");
    removeFiles(directory, fall.loeschen);
    writeTree(directory, fall.dateien);
    commitAll(directory, "nachher");
    const modules = join(context.root, "node_modules");
    if (existsSync(modules)) symlinkSync(modules, join(directory, "node_modules"));
    const { command, extraEnv } = prepare(probe, context, Object.keys(fall.dateien));
    return caseVerdict(await run(command, { cwd: directory, extraEnv }), fall.erwartet);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function eslintCount({ stdout }, { regel }) {
  const perRule = {};
  const errors = JSON.parse(stdout)
    .flatMap(({ messages }) => messages)
    .filter(({ severity }) => severity === ESLINT_ERROR);
  for (const { ruleId } of errors) {
    const rule = ruleId ?? "Parser";
    perRule[rule] = (perRule[rule] ?? 0) + 1;
  }
  return { count: regel === undefined ? errors.length : (perRule[regel] ?? 0), perRule };
}

function stderrLineCount({ stderr }) {
  return { count: stderr.split("\n").filter((line) => line.trim() !== "").length };
}

function numbersBefore({ stdout, stderr }, { vor }) {
  const output = `${stdout}${stderr}`;
  const numbers = vor.map((marker) => {
    const index = output.indexOf(marker);
    return index === -1 ? undefined : TRAILING_NUMBER.exec(output.slice(0, index))?.[1];
  });
  if (numbers.includes(undefined)) return { error: "die Ausgabe nennt keine Trefferzahl" };
  return { count: numbers.reduce((sum, number) => sum + Number(number), 0) };
}

const COUNTERS = new Map([
  ["eslint-json", eslintCount],
  ["stderr-zeilen", stderrLineCount],
  ["zahlen", numbersBefore],
]);

async function countHits(context, definition) {
  if (context === undefined || definition === undefined) return undefined;
  const { command, extraEnv } = prepare(definition, context);
  const result = await run(command, { cwd: context.root, extraEnv });
  if (result.missing) return { error: `${command[0]} fehlt in diesem Lauf` };
  try {
    return COUNTERS.get(definition.zaehlen)(result, definition);
  } catch (error) {
    return { error: `Ausgabe nicht lesbar: ${error.message}` };
  }
}

function leaves(value) {
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(leaves);
  return [value];
}

function entryCount(data) {
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.befunde)) return data.befunde.length;
  return data !== null && typeof data === "object" ? Object.keys(data).length : 0;
}

function exceptionData(root, definition) {
  const path = join(root, definition.datei);
  return existsSync(path) ? readJson(path) : [];
}

export function listedEntries(data) {
  const entries = Array.isArray(data) ? data : data?.befunde;
  const isList = Array.isArray(entries) && entries.every((entry) => typeof entry === "string");
  return isList ? entries : undefined;
}

function countExceptions(root, definition) {
  if (root === undefined || definition === undefined) return undefined;
  const data = exceptionData(root, definition);
  if (definition.zaehlen !== "summe") return { count: entryCount(data) };
  return {
    count: leaves(data)
      .filter(Number.isFinite)
      .reduce((sum, number) => sum + number, 0),
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function manifests(root) {
  const path = join(root, ROTPROBEN_DIR);
  const ids = existsSync(path) ? readdirSync(path).sort() : [];
  const withManifest = ids.filter((id) => existsSync(join(path, id, MANIFEST_FILE)));
  return new Map(withManifest.map((id) => [id, readJson(join(path, id, MANIFEST_FILE))]));
}

export function cases(root, directory) {
  const path = join(root ?? ".", directory);
  const exists = root !== undefined && existsSync(path);
  const names = exists ? readdirSync(path).filter((name) => name.endsWith(".json")) : [];
  const own = names.filter((name) => name !== MANIFEST_FILE).sort();
  return new Map(own.map((name) => [`${directory}/${name}`, readJson(join(path, name))]));
}

function isAffected(id, manifest, changedFiles) {
  const own = [`${ROTPROBEN_DIR}/${id}/`, `${FEHLALARME_DIR}/${id}/`, ...manifest.pfade];
  return changedFiles.some((path) => own.some((pattern) => matches(pattern, path)));
}

function worktreeWithBasisFiles(basis, checkFiles) {
  const directory = mkdtempSync(join(tmpdir(), "freigabe-basis-"));
  git(["worktree", "add", "-q", "--detach", "--force", directory, "HEAD"]);
  for (const path of checkFiles) {
    if (fileAt(basis, path) === undefined) rmSync(join(directory, path), { force: true });
    else git(["checkout", basis, "--", path], { cwd: directory });
  }
  if (existsSync("node_modules"))
    symlinkSync(resolve("node_modules"), join(directory, "node_modules"));
  return directory;
}

async function caseVerdicts(contexts, probe, allCases) {
  const verdicts = [];
  for (const [path, fall] of allCases) {
    const basis = contexts.basis && (await runCase(contexts.basis, probe, fall));
    verdicts.push({ path, titel: fall.titel, basis, pr: await runCase(contexts.pr, probe, fall) });
  }
  return verdicts;
}

function trend(before, after) {
  if (before?.count === undefined || after?.count === undefined) return 0;
  return Math.sign(after.count - before.count);
}

async function freshBaseline(definition, { basis, fake, checkFiles }) {
  if (definition.anlegen === undefined) return undefined;
  const root = worktreeWithBasisFiles(basis, checkFiles);
  try {
    rmSync(join(root, definition.datei), { force: true });
    const { command, extraEnv } = prepare(definition.anlegen, { root, fake, basis });
    const result = await run(command, { cwd: root, extraEnv });
    return result.status === 0 ? exceptionData(root, definition) : undefined;
  } finally {
    git(["worktree", "remove", "--force", root]);
  }
}

function without(entries, removed) {
  const left = [...entries];
  for (const entry of removed) {
    const index = left.indexOf(entry);
    if (index !== -1) left.splice(index, 1);
  }
  return left;
}

function versionOf(data) {
  return Array.isArray(data) ? undefined : data?.version;
}

function isVersionUpdate(before, after, fresh) {
  const version = versionOf(after);
  return version !== undefined && version !== versionOf(before) && version === versionOf(fresh);
}

async function isOnlyWidening(definition, { roots, basis, fake, changedFiles, checkFiles }) {
  const basisData = exceptionData(roots.basis, definition);
  const prData = exceptionData(roots.pr, definition);
  const freshBefore = await freshBaseline(definition, { basis, fake, checkFiles });
  const freshAfter = await freshBaseline(definition, { basis, fake, checkFiles: [] });
  const lists = [basisData, prData, freshBefore, freshAfter].map(listedEntries);
  if (lists.includes(undefined)) return false;
  const [before, after, reportedBefore, reportedAfter] = lists;
  const added = without(after, before);
  const updated = isVersionUpdate(basisData, prData, freshAfter);
  const reportedOnlyAfter = updated ? reportedAfter : without(reportedAfter, reportedBefore);
  const touchesChange = (entry) => changedFiles.some((path) => entry.includes(path));
  return (
    without(reportedBefore, reportedAfter).length === 0 &&
    without(added, reportedOnlyAfter).length === 0 &&
    !added.some(touchesChange)
  );
}

export function losesProbe(result) {
  return result.proben.some(({ basis, pr }) => basis === GESTOPPT && pr !== GESTOPPT);
}

function withoutMoved({ basis, umgezogen }) {
  return basis?.count === undefined ? basis : { count: basis.count - umgezogen };
}

function judge(result) {
  if (result.neu) return NEU;
  const lostProbe = losesProbe(result);
  const newProbe = result.proben.some(({ basis, pr }) => basis !== GESTOPPT && pr === GESTOPPT);
  const hits = trend(withoutMoved(result.treffer), result.treffer.pr);
  const counted = trend(result.ausnahmen.basis, result.ausnahmen.pr);
  const exceptions = result.ausnahmen.nurAusweitung ? 0 : counted;
  if (lostProbe || hits < 0 || exceptions > 0) return LOCKERER;
  if (newProbe || hits > 0 || exceptions < 0) return STRENGER;
  return GLEICH;
}

function isFalseAlarmProven(basis, fehlalarme) {
  const isNew = (path) => fileAt(basis, path) === undefined;
  return fehlalarme.some(
    ({ path, basis: before, pr }) => isNew(path) && before === GESTOPPT && pr === DURCHGELASSEN,
  );
}

function skipped(allCases) {
  return [...allCases].map(([path, { titel }]) => ({
    path,
    titel,
    basis: NICHT_AUSGEFUEHRT,
    pr: NICHT_AUSGEFUEHRT,
  }));
}

async function isGrowthOnlyWidening(definition, ausnahmen, measuring) {
  if (trend(ausnahmen.basis, ausnahmen.pr) <= 0) return false;
  return isOnlyWidening(definition, measuring);
}

async function movedHits(manifest, { contexts, basis, umzug, changedFiles }) {
  const countsEslint = manifest.treffer?.zaehlen === "eslint-json";
  if (umzug === undefined || !countsEslint || contexts.basis === undefined) return 0;
  return umzug({
    basis,
    hilfe: contexts.basis.root,
    pr: contexts.pr.root,
    dateien: changedFiles,
    gezaehlteRegel: manifest.treffer.regel,
  });
}

async function measureCheck(id, manifest, measuring) {
  const { contexts, roots, basis } = measuring;
  const own = `${ROTPROBEN_DIR}/${id}`;
  const probes = new Map([...cases(roots.pr, own), ...cases(roots.basis, own)]);
  const alarms = cases(roots.pr, `${FEHLALARME_DIR}/${id}`);
  const missing = manifest.benoetigt !== undefined && !isInstalled(manifest.benoetigt);
  const verdicts = (allCases) =>
    missing ? skipped(allCases) : caseVerdicts(contexts, manifest.probe, allCases);
  const hits = (context) => (missing ? undefined : countHits(context, manifest.treffer));
  const result = {
    id,
    titel: manifest.titel,
    neu: roots.basis === undefined,
    fehlt: missing ? manifest.benoetigt : undefined,
    treffer: {
      basis: await hits(contexts.basis),
      pr: await hits(contexts.pr),
      umgezogen: await movedHits(manifest, measuring),
    },
    ausnahmen: {
      bezeichnung: manifest.ausnahmen?.bezeichnung,
      basis: countExceptions(roots.basis, manifest.ausnahmen),
      pr: countExceptions(roots.pr, manifest.ausnahmen),
    },
    proben: await verdicts(probes),
    fehlalarme: await verdicts(alarms),
  };
  result.ausnahmen.nurAusweitung = await isGrowthOnlyWidening(
    manifest.ausnahmen,
    result.ausnahmen,
    measuring,
  );
  const fehlalarmBelegt = isFalseAlarmProven(basis, result.fehlalarme);
  return { ...result, urteil: judge(result), fehlalarmBelegt };
}

export function fakeGitHub() {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(HTTP_OK, { "content-type": "application/json" });
    response.end("{}");
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

async function measureAll(basis, { changedFiles, checkFiles, worktree, fake, umzug }) {
  const basisManifests = manifests(worktree);
  const prManifests = manifests(".");
  const ids = [...new Set([...basisManifests.keys(), ...prManifests.keys()])].sort();
  const results = [];
  for (const id of ids) {
    const manifest = basisManifests.get(id) ?? prManifests.get(id);
    if (!isAffected(id, manifest, changedFiles)) continue;
    const basisRoot = basisManifests.has(id) ? worktree : undefined;
    const roots = { basis: basisRoot, pr: resolve(".") };
    const contexts = {
      basis: basisRoot && { root: basisRoot, fake, basis },
      pr: { root: roots.pr, fake, basis },
    };
    const measuring = { contexts, roots, basis, fake, changedFiles, checkFiles, umzug };
    results.push(await measureCheck(id, manifest, measuring));
  }
  return { results, all: [...basisManifests, ...prManifests] };
}

export async function measureChecks(basis, { changedFiles, checkFiles, umzug }) {
  const worktree = worktreeWithBasisFiles(basis, checkFiles);
  const server = await fakeGitHub();
  try {
    const fake = `http://127.0.0.1:${server.address().port}`;
    const { results, all } = await measureAll(basis, {
      changedFiles,
      checkFiles,
      worktree,
      fake,
      umzug,
    });
    const covered = (path) => all.some(([id, manifest]) => isAffected(id, manifest, [path]));
    return { pruefungen: results, ohneMessung: checkFiles.filter((path) => !covered(path)) };
  } finally {
    server.close();
    git(["worktree", "remove", "--force", worktree]);
  }
}
