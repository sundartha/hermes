import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const LOCKFILES = ["package-lock.json", "apps/web/package-lock.json"];
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const EXCEPTIONS_PATH = "tools/basis/lieferkette-ausnahmen.json";
const MIN_AGE_HOURS = 168;
const HOURS_PER_DAY = 24;
const MIN_AGE_DAYS = MIN_AGE_HOURS / HOURS_PER_DAY;
const MS_PER_HOUR = 3_600_000;
const MAX_OUTPUT_LINES = 20;
const NODE_MODULES_SEGMENT = "node_modules/";
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const MAX_GIT_OUTPUT_BYTES = 268_435_456;

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const registry = (optionValue("--registry") ?? DEFAULT_REGISTRY).replace(/\/+$/, "");
const exceptionsPath = optionValue("--ausnahmen") ?? EXCEPTIONS_PATH;

function namesCommit(basis) {
  try {
    execFileSync("git", ["cat-file", "-e", basis + "^{commit}"], { stdio: "ignore" });
    return basis !== "";
  } catch {
    return false;
  }
}

function lockfileAtBasis(basis, path) {
  try {
    const text = execFileSync("git", ["show", `${basis}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    return JSON.parse(text).packages ?? {};
  } catch {
    return {};
  }
}

function lockfileAtWorktree(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).packages ?? {};
  } catch {
    return {};
  }
}

function packageName(key, entry) {
  const start = key.lastIndexOf(NODE_MODULES_SEGMENT);
  if (start === -1) return undefined;
  return entry.name ?? key.slice(start + NODE_MODULES_SEGMENT.length);
}

function changedEntries(before, after) {
  const changed = [];
  for (const [key, entry] of Object.entries(after)) {
    if (entry.link === true || entry.version === undefined) continue;
    const previous = before[key];
    const versionChanged = previous?.version !== entry.version;
    if (!versionChanged && previous.resolved === entry.resolved) continue;
    const name = packageName(key, entry);
    if (name === undefined) continue;
    changed.push({ name, version: entry.version, resolved: entry.resolved, versionChanged });
  }
  return changed;
}

function loadExceptions() {
  const list = JSON.parse(readFileSync(exceptionsPath, "utf8"));
  return new Set(list.map((item) => `${item.name}@${item.version}`));
}

const packuments = new Map();

function fetchPackument(name) {
  if (!packuments.has(name)) {
    const url = `${registry}/${name.replace("/", "%2F")}`;
    packuments.set(
      name,
      fetch(url).then((response) => {
        if (!response.ok) throw new Error(`Registry antwortet mit ${response.status}`);
        return response.json();
      }),
    );
  }
  return packuments.get(name);
}

async function findingFor({ name, version, resolved, versionChanged }) {
  const label = `${name}@${version}`;
  if (typeof resolved !== "string" || !resolved.startsWith(`${registry}/`)) {
    return `${label}: resolved zeigt nicht auf ${registry}/`;
  }
  if (!versionChanged) return undefined;
  try {
    const published = (await fetchPackument(name)).time?.[version];
    if (published === undefined) return `${label}: Version in der Registry unbekannt`;
    const ageHours = (Date.now() - Date.parse(published)) / MS_PER_HOUR;
    if (Number.isNaN(ageHours)) return `${label}: Veröffentlichungsdatum unlesbar`;
    if (ageHours >= MIN_AGE_HOURS) return undefined;
    return `${label}: ${Math.floor(ageHours / HOURS_PER_DAY)} Tage alt, verlangt sind ${MIN_AGE_DAYS}`;
  } catch (error) {
    return `${label}: Registry nicht erreichbar (${error.message})`;
  }
}

function report(findings, checkedCount, changedAnything) {
  if (findings.length > 0) {
    console.log(findings.slice(0, MAX_OUTPUT_LINES).join("\n"));
    return EXIT_FINDING;
  }
  console.log(
    changedAnything
      ? `${checkedCount} geänderte Versionen geprüft, alle älter als ${MIN_AGE_DAYS} Tage`
      : "Lockfiles unverändert",
  );
  return EXIT_OK;
}

async function main() {
  const basis = optionValue("--basis");
  if (basis === undefined) {
    console.error("Aufruf: node tools/lockfile-alter.mjs --basis <sha>");
    return EXIT_USAGE;
  }
  if (!namesCommit(basis)) {
    console.error(`Basis fehlt oder ist kein Commit: ${JSON.stringify(basis)}`);
    return EXIT_USAGE;
  }
  const exceptions = loadExceptions();
  const changed = LOCKFILES.flatMap((path) =>
    changedEntries(lockfileAtBasis(basis, path), lockfileAtWorktree(path)),
  );
  const toCheck = changed.filter(({ name, version }) => !exceptions.has(`${name}@${version}`));
  const findings = (await Promise.all(toCheck.map(findingFor))).filter(Boolean);
  return report(findings, toCheck.length, changed.length > 0);
}

process.exitCode = await main();
