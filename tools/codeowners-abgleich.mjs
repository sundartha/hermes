import { readFileSync } from "node:fs";
import { join } from "node:path";

const CODEOWNERS_FILE = ".github/CODEOWNERS";
const ROLE_SPECIFIC_PATH_BY_ROLE_FILE = {
  ".claude/rollen/bau.json": "test/**",
  ".claude/rollen/test.json": "src/**",
};
const EDIT_RULE_PATTERN = /^Edit\((.+)\)$/;
const ROOT_ANCHOR_PATTERN = /^\//;
const ANY_DIRECTORY_PREFIX_PATTERN = /^\*\*\//;
const DIRECTORY_SUFFIX = "/";
const WHITESPACE_PATTERN = /\s+/;

function canonicalPath(pattern) {
  const path = pattern.replace(ROOT_ANCHOR_PATTERN, "").replace(ANY_DIRECTORY_PREFIX_PATTERN, "");
  return path.endsWith(DIRECTORY_SUFFIX) ? `${path}**` : path;
}

function codeownersPaths(root) {
  const lines = readFileSync(join(root, CODEOWNERS_FILE), "utf8").split("\n");
  const entries = lines.map((line) => line.trim()).filter((line) => line !== "");
  return new Set(entries.map((entry) => canonicalPath(entry.split(WHITESPACE_PATTERN)[0])));
}

function deniedEditPaths(root, roleFile) {
  const { permissions } = JSON.parse(readFileSync(join(root, roleFile), "utf8"));
  const editRules = permissions.deny.map((rule) => EDIT_RULE_PATTERN.exec(rule)).filter(Boolean);
  const paths = editRules.map((match) => canonicalPath(match[1]));
  return new Set(paths.filter((path) => path !== ROLE_SPECIFIC_PATH_BY_ROLE_FILE[roleFile]));
}

function pathsMissingIn(source, other) {
  return [...source].filter((path) => !other.has(path));
}

function findingsForRoleFile(root, roleFile, ownedPaths) {
  const deniedPaths = deniedEditPaths(root, roleFile);
  return [
    ...pathsMissingIn(ownedPaths, deniedPaths).map(
      (path) => `nur in ${CODEOWNERS_FILE}, nicht in ${roleFile}: ${path}`,
    ),
    ...pathsMissingIn(deniedPaths, ownedPaths).map(
      (path) => `nur in ${roleFile}, nicht in ${CODEOWNERS_FILE}: ${path}`,
    ),
  ];
}

const [, , root = "."] = process.argv;
const ownedPaths = codeownersPaths(root);
const findings = Object.keys(ROLE_SPECIFIC_PATH_BY_ROLE_FILE).flatMap((roleFile) =>
  findingsForRoleFile(root, roleFile, ownedPaths),
);
for (const finding of findings) console.error(finding);
if (findings.length > 0) process.exitCode = 1;
