import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const BASE_BRANCH = "master";
const DEFAULT_KIND = "rotprobe";
const ARGUMENT_NAMES = ["paket", "fall", "patch-datei"];
const USAGE = `Aufruf: node tools/rotprobe.mjs ${ARGUMENT_NAMES.map((name) => `<${name}>`).join(" ")} [--art rotprobe|beleg]`;
const GITHUB_REPO_PATTERN = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/;
const PULL_REQUEST_NUMBER_PATTERN = /\/pull\/(\d+)\s*$/;
const EXIT_FAILURE = 1;
const TEXTS_BY_BRANCH_PREFIX = {
  "rotprobe/": {
    title: (paket, fall) => `Rot-Probe ${paket}: ${fall}`,
    subject: (fall) => `Baue den Verstoß „${fall}“ für die Rot-Probe ein`,
    reason: "Die Rot-Probe zeigt, dass GitHub diesen Verstoß auch ohne lokale Hooks stoppt.",
  },
  "beleg/": {
    title: (paket, fall) => `Beleg ${paket}: ${fall}`,
    subject: (fall) => `Füge den Beleg „${fall}“ hinzu`,
    reason: "Der Beleg führt die verlangten Läufe auf GitHub aus.",
  },
};

function parseOptions() {
  const { values, positionals } = parseArgs({
    options: { art: { type: "string", default: DEFAULT_KIND } },
    allowPositionals: true,
  });
  if (positionals.length !== ARGUMENT_NAMES.length) throw new Error(USAGE);
  const [paket, fall, patchFile] = positionals;
  return { branch: `${values.art}/${paket}-${fall}`, paket, fall, patchFile: resolve(patchFile) };
}

function run(command, args, input) {
  const result = spawnSync(command, args, { encoding: "utf8", input });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} ist gescheitert: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function textsForBranch(branch) {
  const prefix = Object.keys(TEXTS_BY_BRANCH_PREFIX).find((candidate) =>
    branch.startsWith(candidate),
  );
  if (prefix === undefined) {
    throw new Error(`Der Branch ${branch} beginnt weder mit rotprobe/ noch mit beleg/.`);
  }
  return TEXTS_BY_BRANCH_PREFIX[prefix];
}

function upstreamRepository() {
  const url = run("git", ["remote", "get-url", "upstream"]);
  const match = GITHUB_REPO_PATTERN.exec(url);
  if (match === null) throw new Error(`upstream zeigt nicht auf GitHub: ${url}`);
  return match[1];
}

function checkCleanWorktree() {
  if (run("git", ["status", "--porcelain", "--untracked-files=no"]) !== "") {
    throw new Error("Der Arbeitsbaum hat uncommittete Änderungen.");
  }
}

function commitAndPush({ branch, patchFile, message }) {
  const startBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  run("git", ["switch", "-q", "-c", branch]);
  try {
    run("git", ["apply", "--index", patchFile]);
    run("git", ["commit", "-q", "--no-verify", "-F", "-"], message);
    run("git", ["push", "-q", "--no-verify", "-u", "upstream", branch]);
  } finally {
    run("git", ["switch", "-q", startBranch]);
  }
}

function openDraftPullRequest({ repository, branch, title, body }) {
  const url = run("gh", [
    "pr",
    "create",
    "--repo",
    repository,
    "--draft",
    "--base",
    BASE_BRANCH,
    "--head",
    branch,
    "--title",
    title,
    "--body",
    body,
  ]);
  const match = PULL_REQUEST_NUMBER_PATTERN.exec(url);
  if (match === null) throw new Error(`gh hat keine PR-Adresse geliefert: ${url}`);
  return match[1];
}

function main() {
  const { branch, paket, fall, patchFile } = parseOptions();
  const texts = textsForBranch(branch);
  const repository = upstreamRepository();
  checkCleanWorktree();
  run("git", ["apply", "--check", patchFile]);
  const message = `${texts.subject(fall)}\n\nWarum: ${texts.reason}\n\nPaket: ${paket}\n`;
  commitAndPush({ branch, patchFile, message });
  const title = texts.title(paket, fall);
  const body = `Entwurfs-PR für Paket ${paket} mit genau einem Commit. ${texts.reason} Der PR wird nach dem CI-Lauf geschlossen.`;
  console.log(openDraftPullRequest({ repository, branch, title, body }));
}

try {
  main();
} catch (error) {
  console.error(`Abbruch: ${error.message}`);
  process.exitCode = EXIT_FAILURE;
}
