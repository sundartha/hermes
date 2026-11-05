import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { aenderungenSeit, legeWorktreeAn } from "./auftrag/git.mjs";
import { MELDUNG, zweckBlock } from "./auftrag/zweck.mjs";
import { runNodeTool, toolFailure } from "./basis-vergleich.mjs";
import { isCommit } from "./ts-dateien.mjs";

const JSCPD_REPORT_FILE = "jscpd-report.json";
const JSCPD_CONFIG_FILE = ".jscpd.json";
const WHITESPACE_PATTERN = /\s+/g;
const EXIT_FAILURE = 1;
const EMBEDDED_SUFFIX = /:[a-z]+$/;

function pathOf(root, name) {
  return relative(root, resolve(root, name.replace(EMBEDDED_SUFFIX, "")));
}

function textOf(root, { name, start, end }) {
  const lines = readFileSync(resolve(root, name.replace(EMBEDDED_SUFFIX, "")), "utf8").split("\n");
  return lines.slice(start - 1, end).join("\n").replace(WHITESPACE_PATTERN, "");
}

function fingerprint(root, clone) {
  const sides = [textOf(root, clone.firstFile), textOf(root, clone.secondFile)].sort();
  return createHash("sha256").update([clone.tokens, ...sides].join("\0")).digest("hex");
}

function describe(root, { firstFile, secondFile, tokens }) {
  const place = ({ name, start, end }) => `${pathOf(root, name)}:${start}-${end}`;
  return `${place(firstFile)} gleicht ${place(secondFile)} (${tokens} Tokens)`;
}

export function clonesIn(root) {
  const outputDir = mkdtempSync(join(tmpdir(), "kopien-diff-"));
  try {
    const args = [".", "--reporters", "json", "--output", outputDir, "--silent"];
    const result = runNodeTool("jscpd", args, root);
    if (result.status !== 0) throw toolFailure("jscpd", result);
    const report = JSON.parse(readFileSync(join(outputDir, JSCPD_REPORT_FILE), "utf8"));
    return report.duplicates.map((clone) => ({
      fingerprint: fingerprint(root, clone),
      files: [clone.firstFile.name, clone.secondFile.name].map((name) => pathOf(root, name)),
      location: describe(root, clone),
    }));
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

export function candidatesAmong(clones, changed, configChanged) {
  if (configChanged) return clones;
  return clones.filter(({ files }) => files.some((file) => changed.has(file)));
}

export function newClones(now, before) {
  const available = new Map();
  for (const { fingerprint: key } of before) available.set(key, (available.get(key) ?? 0) + 1);
  return now.filter(({ fingerprint: key }) => {
    const left = available.get(key) ?? 0;
    if (left === 0) return true;
    available.set(key, left - 1);
    return false;
  });
}

function clonesOnBasis(root, basis) {
  const directory = mkdtempSync(join(tmpdir(), "kopien-diff-basis-"));
  const remove = legeWorktreeAn(basis, directory, root);
  try {
    if (existsSync(join(root, JSCPD_CONFIG_FILE))) {
      copyFileSync(join(root, JSCPD_CONFIG_FILE), join(directory, JSCPD_CONFIG_FILE));
    }
    return clonesIn(directory);
  } finally {
    remove();
    rmSync(directory, { recursive: true, force: true });
  }
}

export function findNewClones(root, basis) {
  if (!isCommit(basis)) throw new Error(`Die Basis ${basis} ist kein Commit in diesem Repo.`);
  const now = clonesIn(root);
  const changed = new Set(aenderungenSeit(basis, root).map(({ pfad }) => pfad));
  const candidates = candidatesAmong(now, changed, changed.has(JSCPD_CONFIG_FILE));
  if (candidates.length === 0) return [];
  return newClones(now, clonesOnBasis(root, basis)).filter((clone) => candidates.includes(clone));
}

function main() {
  try {
    const { values } = parseArgs({ options: { basis: { type: "string" } } });
    if (values.basis === undefined) throw new Error("Aufruf: node tools/kopien-diff.mjs --basis <commit>");
    const found = findNewClones(process.cwd(), values.basis);
    console.log(`jscpd: ${found.length} neue Kopien gegenüber ${values.basis}.`);
    if (found.length === 0) return;
    console.error(`${found.length} Kopien, die dieser Diff neu anlegt:`);
    for (const { location } of found) console.error(`  ${location}`);
    console.error(zweckBlock(MELDUNG.JSCPD).join("\n"));
    process.exitCode = EXIT_FAILURE;
  } catch (error) {
    console.error(`Abbruch: ${error.message}`);
    process.exitCode = EXIT_FAILURE;
  }
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) main();
