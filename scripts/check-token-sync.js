#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HASH_ALGO = "sha256";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_REL = "design-system/_shared/tokens.lock";
const SOURCE_TOKEN_RELS = [
  "apps/web/src/styles/tokens/primitives.css",
  "apps/web/src/styles/tokens/semantic.css",
  "apps/web/src/styles/tokens/hero.css",
];
const COPY_TOKEN_RELS = [
  "design-system/tokens/primitives.css",
  "design-system/tokens/semantic.css",
  "design-system/tokens/dark.css",
];
const HASHED_RELS = [...SOURCE_TOKEN_RELS, ...COPY_TOKEN_RELS];
const MCP_MOCKUP_DIR = "design-system/mcp";
const WIDGET_DIR = "src/ui/widgets";
const HTML_EXT = ".html";
const DSCARD_MARKER = "@dsCard";
const IMPORT_AT_RULE = "@import";
const JSON_INDENT = 2;
const WRITE_FLAG = "--write";
const LOG_PREFIX = "[check-token-sync]";
const LOCK_COMMENT =
  "Auto-generiert via scripts/check-token-sync.js --write. Soll-Hashes der " +
  "Token-Quelle (apps/web/src/styles/tokens/) + gespiegelter Katalog-Kopie " +
  "(design-system/tokens/). Bei legitimer Token-Aenderung: Kopie nachziehen, " +
  "dann --write, dann committen.";

function hashFile(absPath) {
  return createHash(HASH_ALGO).update(readFileSync(absPath)).digest("hex");
}

function fileMissingProblem(rel) {
  return `Datei fehlt (fail-closed): ${rel}`;
}

function readTextOrProblem(rootDir, rel, problems) {
  try {
    return readFileSync(join(rootDir, rel), "utf8");
  } catch {
    problems.push(fileMissingProblem(rel));
    return null;
  }
}

function listHtmlRels(rootDir, relDir, problems) {
  const absDir = join(rootDir, relDir);
  if (!existsSync(absDir)) {
    problems.push(`Verzeichnis fehlt (fail-closed): ${relDir}`);
    return [];
  }
  return readdirSync(absDir)
    .filter((name) => name.endsWith(HTML_EXT))
    .map((name) => `${relDir}/${name}`);
}

function readLock(rootDir, problems) {
  const absLock = join(rootDir, LOCK_REL);
  if (!existsSync(absLock)) {
    problems.push(`Lock-Datei fehlt (fail-closed): ${LOCK_REL}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(absLock, "utf8"));
  } catch {
    problems.push(`Lock-Datei nicht parsebar (fail-closed): ${LOCK_REL}`);
    return null;
  }
}

function checkHashDrift(rootDir, lock, problems) {
  const soll = lock.hashes || {};
  for (const rel of HASHED_RELS) {
    const expected = soll[rel];
    if (!expected) {
      problems.push(`Lock-Eintrag fehlt fuer ${rel} (Lock unvollstaendig)`);
      continue;
    }
    let actual;
    try {
      actual = hashFile(join(rootDir, rel));
    } catch {
      problems.push(fileMissingProblem(rel));
      continue;
    }
    if (actual !== expected) {
      problems.push(`${rel} driftet (Hash weicht vom Lock ab)`);
    }
  }
}

function assertNoImport(rootDir, rel, problems) {
  const content = readTextOrProblem(rootDir, rel, problems);
  if (content === null) return;
  if (content.includes(IMPORT_AT_RULE)) {
    problems.push(`${rel} enthaelt ${IMPORT_AT_RULE} (Iframe-Sandbox-Verbot)`);
  }
}

function assertDsCardLine1(rootDir, rel, problems) {
  const content = readTextOrProblem(rootDir, rel, problems);
  if (content === null) return;
  const firstLine = content.split("\n", 1)[0];
  if (!firstLine.includes(DSCARD_MARKER)) {
    problems.push(`${rel} hat ${DSCARD_MARKER} nicht in Zeile 1`);
  }
}

export function checkTokens({ rootDir = REPO_ROOT } = {}) {
  const problems = [];

  const lock = readLock(rootDir, problems);
  if (lock) checkHashDrift(rootDir, lock, problems);

  const mockupRels = listHtmlRels(rootDir, MCP_MOCKUP_DIR, problems);
  const widgetRels = listHtmlRels(rootDir, WIDGET_DIR, problems);

  for (const rel of widgetRels) assertNoImport(rootDir, rel, problems);

  for (const rel of mockupRels) assertDsCardLine1(rootDir, rel, problems);

  return { ok: problems.length === 0, problems };
}

export function writeTokenLock({ rootDir = REPO_ROOT } = {}) {
  const hashes = {};
  for (const rel of HASHED_RELS) hashes[rel] = hashFile(join(rootDir, rel));
  const lock = { _comment: LOCK_COMMENT, algo: HASH_ALGO, hashes };
  const absLock = join(rootDir, LOCK_REL);
  mkdirSync(dirname(absLock), { recursive: true });
  writeFileSync(absLock, JSON.stringify(lock, null, JSON_INDENT) + "\n");
  return lock;
}

function runCli() {
  if (process.argv.includes(WRITE_FLAG)) {
    writeTokenLock({});
    console.log(`${LOG_PREFIX} Lock neu geschrieben: ${LOCK_REL}`);
    return 0;
  }
  const { ok, problems } = checkTokens({});
  if (ok) {
    console.log(`${LOG_PREFIX} OK - Tokens synchron, Invarianten erfuellt.`);
    return 0;
  }
  for (const problem of problems) console.error(`${LOG_PREFIX} ${problem}`);
  return 1;
}

const isMain =
  fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (isMain) {
  try {
    process.exit(runCli());
  } catch (err) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${err.message}`);
    process.exit(1);
  }
}
