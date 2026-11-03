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
import { dirname, join, relative } from "node:path";
import { env } from "node:process";

export const ROTPROBEN_DIR = "test/werkzeuge/rotproben";
export const GESTOPPT = "gestoppt";
export const DURCHGELASSEN = "durchgelassen";
const NICHT_AUSGEFUEHRT = "nicht ausgeführt";
export const MANIFEST_FILE = "pruefung.json";
const WILDCARD = "*";
const PLACEHOLDER = /\{(wurzel|attrappe|basis)\}/g;
const HTTP_OK = 200;
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

export function fakeGitHub() {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(HTTP_OK, { "content-type": "application/json" });
    response.end("{}");
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}
