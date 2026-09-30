import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT_PATH = resolve(REPO_ROOT, "tools/lockfile-alter.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const MS_PER_DAY = 86_400_000;
const OLD_AGE_DAYS = 30;
const YOUNG_AGE_DAYS = 1;
const LOCKFILE = "package-lock.json";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

function publishedDaysAgo(days) {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

function lockfile(entries) {
  return JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "probe" }, ...entries } });
}

function entryFor(name, resolved) {
  return { [`node_modules/${name}`]: { version: "1.0.0", resolved } };
}

function registryEntry(registryUrl, name) {
  return entryFor(name, `${registryUrl}/${name}/-/${name}-1.0.0.tgz`);
}

async function withRegistry(packuments, body) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const packument = packuments[decodeURIComponent(request.url.slice(1))];
    const status = packument === undefined ? HTTP_NOT_FOUND : HTTP_OK;
    response.writeHead(status).end(JSON.stringify(packument ?? {}));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    return await body(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    await new Promise((done) => server.close(done));
  }
}

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function runScript(dir, options) {
  const args = Object.entries(options).flatMap(([name, value]) => [`--${name}`, value]);
  return new Promise((done) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], { cwd: dir });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => done({ status, output }));
  });
}

async function checkChange({ before, after, packuments, exceptions = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "lockfile-alter-"));
  try {
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "probe@example.invalid");
    git(dir, "config", "user.name", "probe");
    writeFileSync(join(dir, LOCKFILE), lockfile(before));
    git(dir, "add", LOCKFILE);
    git(dir, "commit", "-q", "-m", "basis");
    const basis = git(dir, "rev-parse", "HEAD");
    const exceptionsFile = join(dir, "ausnahmen.json");
    writeFileSync(exceptionsFile, JSON.stringify(exceptions));
    return await withRegistry(packuments, async (registryUrl, requests) => {
      writeFileSync(join(dir, LOCKFILE), lockfile(after(registryUrl)));
      const result = await runScript(dir, {
        basis,
        registry: registryUrl,
        ausnahmen: exceptionsFile,
      });
      return { ...result, requests };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ageOf = (days) => ({ time: { "1.0.0": publishedDaysAgo(days) } });

test("lockfile-alter: eine junge Version stoppt mit Name, Version und Alter", async () => {
  const result = await checkChange({
    before: {},
    after: (url) => registryEntry(url, "frisch"),
    packuments: { frisch: ageOf(YOUNG_AGE_DAYS) },
  });
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /frisch@1\.0\.0: 1 Tage alt/);
});

test("lockfile-alter: eine alte Version geht durch", async () => {
  const result = await checkChange({
    before: {},
    after: (url) => registryEntry(url, "alt"),
    packuments: { alt: ageOf(OLD_AGE_DAYS) },
  });
  assert.equal(result.status, EXIT_OK, result.output);
  assert.match(result.output, /1 geänderte Versionen geprüft, alle älter als 7 Tage/);
});

test("lockfile-alter: eine fremde resolved-Adresse stoppt", async () => {
  const result = await checkChange({
    before: {},
    after: () => entryFor("fremd", "https://evil.example.invalid/fremd.tgz"),
    packuments: { fremd: ageOf(OLD_AGE_DAYS) },
  });
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /fremd@1\.0\.0: resolved zeigt nicht auf/);
});

test("lockfile-alter: eine nicht erreichbare Registry stoppt", async () => {
  const result = await checkChange({
    before: {},
    after: (url) => registryEntry(url, "unbekannt"),
    packuments: {},
  });
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /unbekannt@1\.0\.0: Registry nicht erreichbar/);
});

test("lockfile-alter: eine der Registry unbekannte Version stoppt", async () => {
  const result = await checkChange({
    before: {},
    after: (url) => registryEntry(url, "andere"),
    packuments: { andere: { time: { "2.0.0": publishedDaysAgo(OLD_AGE_DAYS) } } },
  });
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /andere@1\.0\.0: Version in der Registry unbekannt/);
});

test("lockfile-alter: ein Eintrag der Ausnahmeliste geht durch", async () => {
  const result = await checkChange({
    before: {},
    after: (url) => registryEntry(url, "eilig"),
    packuments: { eilig: ageOf(YOUNG_AGE_DAYS) },
    exceptions: [{ name: "eilig", version: "1.0.0", grund: "Sicherheitskorrektur" }],
  });
  assert.equal(result.status, EXIT_OK, result.output);
});

test("lockfile-alter: ein unverändertes Lockfile geht ohne Registry-Abfrage durch", async () => {
  const same = () => registryEntry("http://127.0.0.1:1", "gleich");
  const result = await checkChange({
    before: same(),
    after: same,
    packuments: { gleich: ageOf(YOUNG_AGE_DAYS) },
  });
  assert.equal(result.status, EXIT_OK, result.output);
  assert.equal(result.output.trim(), "Lockfiles unverändert");
  assert.deepEqual(result.requests, []);
});
