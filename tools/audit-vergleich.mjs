import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCKFILE = "package-lock.json";
const MANIFEST = "package.json";
const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const MAX_OUTPUT_BYTES = 268_435_456;
const NODE_MODULES_SEGMENT = "node_modules/";
const UNKNOWN_VERSION = "unbekannt";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  console.error(message);
  process.exit(EXIT_USAGE);
}

function isCommit(basis) {
  if (basis === "") return false;
  const check = spawnSync("git", ["rev-parse", "--verify", "--quiet", basis + "^{commit}"], {
    stdio: "ignore",
  });
  return check.status === 0;
}

function runAudit(dir) {
  try {
    return execFileSync("npm", ["audit", "--json"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.length > 0) return error.stdout;
    throw error;
  }
}

function auditAtBasis(basis) {
  const dir = mkdtempSync(join(tmpdir(), "audit-basis-"));
  try {
    for (const file of [LOCKFILE, MANIFEST]) {
      const text = execFileSync("git", ["show", `${basis}:${file}`], {
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
      });
      writeFileSync(join(dir, file), text);
    }
    return runAudit(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseAudit(text, label) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    fail(`npm audit lieferte für ${label} keine lesbare Ausgabe`);
  }
  if (report.vulnerabilities === undefined) {
    fail(`npm audit meldet für ${label} einen Fehler: ${JSON.stringify(report.error ?? report)}`);
  }
  return report;
}

function blockingAdvisories(report) {
  const advisories = new Map();
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || !BLOCKING_SEVERITIES.has(via.severity)) continue;
      const id = via.url ?? String(via.source);
      advisories.set(`${via.name ?? name}|${id}`, { name: via.name ?? name, id });
    }
  }
  return advisories;
}

function installedVersions() {
  try {
    return JSON.parse(readFileSync(LOCKFILE, "utf8")).packages ?? {};
  } catch {
    return {};
  }
}

function versionOf(packages, name) {
  const matches = Object.entries(packages).filter(
    ([key]) => key.slice(key.lastIndexOf(NODE_MODULES_SEGMENT) + NODE_MODULES_SEGMENT.length) === name,
  );
  const versions = [...new Set(matches.map(([, entry]) => entry.version))];
  return versions.length === 0 ? UNKNOWN_VERSION : versions.join(", ");
}

const basis = optionValue("--basis");
const basisAuditFile = optionValue("--basis-audit");
if (basis === undefined && basisAuditFile === undefined) {
  fail("Aufruf: node tools/audit-vergleich.mjs --basis <sha>");
}
if (basisAuditFile === undefined && !isCommit(basis)) {
  fail(`Basis fehlt oder ist kein Commit: ${JSON.stringify(basis)}`);
}

const basisText =
  basisAuditFile === undefined ? auditAtBasis(basis) : readFileSync(basisAuditFile, "utf8");
const currentAuditFile = optionValue("--arbeitsstand-audit");
const currentText =
  currentAuditFile === undefined ? runAudit(process.cwd()) : readFileSync(currentAuditFile, "utf8");

const known = blockingAdvisories(parseAudit(basisText, "die Basis"));
const current = blockingAdvisories(parseAudit(currentText, "den Arbeitsstand"));
const introduced = [...current].filter(([key]) => !known.has(key)).map(([, advisory]) => advisory);

if (introduced.length === 0) {
  console.log(
    `Audit: keine neuen Meldungen der Stufe high oder critical gegenüber der Basis (${current.size} im Arbeitsstand, ${known.size} auf der Basis)`,
  );
  process.exit(EXIT_OK);
}

const packages = installedVersions();
for (const { name, id } of introduced) {
  console.error(`Audit: neue Meldung ${name}@${versionOf(packages, name)} ${id}`);
}
process.exit(EXIT_FINDING);
