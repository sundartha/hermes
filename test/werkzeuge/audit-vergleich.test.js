import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT_PATH = resolve(REPO_ROOT, "tools/audit-vergleich.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;

const BRACE_EXPANSION = {
  name: "brace-expansion",
  url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  severity: "high",
};
const NODEMAILER = {
  name: "nodemailer",
  url: "https://github.com/advisories/GHSA-dddd-eeee-ffff",
  severity: "critical",
};
const MODERATE_ONLY = {
  name: "minimatch",
  url: "https://github.com/advisories/GHSA-gggg-hhhh-iiii",
  severity: "moderate",
};

function auditReport(advisories) {
  const vulnerabilities = {};
  for (const advisory of advisories) {
    vulnerabilities[advisory.name] = { name: advisory.name, severity: advisory.severity, via: [advisory] };
  }
  vulnerabilities.eslint = { name: "eslint", severity: "high", via: ["brace-expansion"] };
  return JSON.stringify({ auditReportVersion: 2, vulnerabilities });
}

function lockfile(packages) {
  const entries = Object.fromEntries(
    Object.entries(packages).map(([name, version]) => [`node_modules/${name}`, { version }]),
  );
  return JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "probe" }, ...entries } });
}

function runScript(dir, args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], { cwd: dir });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => done({ status, output }));
  });
}

async function compare({ basis, current, packages = {} }) {
  const dir = mkdtempSync(join(tmpdir(), "audit-vergleich-"));
  try {
    writeFileSync(join(dir, "basis.json"), basis);
    writeFileSync(join(dir, "arbeitsstand.json"), current);
    writeFileSync(join(dir, "package-lock.json"), lockfile(packages));
    return await runScript(dir, [
      "--basis-audit",
      join(dir, "basis.json"),
      "--arbeitsstand-audit",
      join(dir, "arbeitsstand.json"),
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("audit-vergleich: dieselbe Meldung auf Basis und Arbeitsstand geht durch", async () => {
  const report = auditReport([BRACE_EXPANSION]);
  const result = await compare({ basis: report, current: report });
  assert.equal(result.status, EXIT_OK, result.output);
  assert.match(result.output, /keine neuen Meldungen/);
});

test("audit-vergleich: eine neue Meldung im Arbeitsstand stoppt mit Paket, Version und Kennung", async () => {
  const result = await compare({
    basis: auditReport([BRACE_EXPANSION]),
    current: auditReport([BRACE_EXPANSION, NODEMAILER]),
    packages: { nodemailer: "6.9.0" },
  });
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /nodemailer@6\.9\.0 https:\/\/github\.com\/advisories\/GHSA-dddd-eeee-ffff/);
  assert.doesNotMatch(result.output, /brace-expansion/);
});

test("audit-vergleich: eine Meldung nur auf der Basis geht durch", async () => {
  const result = await compare({
    basis: auditReport([BRACE_EXPANSION]),
    current: auditReport([]),
  });
  assert.equal(result.status, EXIT_OK, result.output);
});

test("audit-vergleich: eine neue Meldung der Stufe moderate stoppt nicht", async () => {
  const result = await compare({
    basis: auditReport([]),
    current: auditReport([MODERATE_ONLY]),
  });
  assert.equal(result.status, EXIT_OK, result.output);
});

test("audit-vergleich: eine unlesbare Audit-Ausgabe stoppt, statt durchzugehen", async () => {
  const result = await compare({ basis: auditReport([]), current: "kein json" });
  assert.equal(result.status, EXIT_USAGE, result.output);
});

test("audit-vergleich: eine Fehlerantwort von npm audit stoppt, statt durchzugehen", async () => {
  const result = await compare({
    basis: auditReport([]),
    current: JSON.stringify({ error: { code: "ENOAUDIT" } }),
  });
  assert.equal(result.status, EXIT_USAGE, result.output);
});
