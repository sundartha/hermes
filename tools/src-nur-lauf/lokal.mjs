import { spawnSync } from "node:child_process";
import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { git } from "../auftrag/git.mjs";

const PRUEFUNG = fileURLToPath(new URL("../src-nur-lauf.mjs", import.meta.url));
const EXIT_ABBRUCH = 2;

function gh(argumente) {
  const lauf = spawnSync(env.HERMES_GH ?? "gh", argumente, { encoding: "utf8" });
  return lauf.status === 0 ? lauf.stdout.trim() : "";
}

function alsListe(text) {
  try {
    const wert = JSON.parse(text);
    return Array.isArray(wert) ? wert : [];
  } catch {
    return [];
  }
}

function offenerPullRequest() {
  const zweig = git(["branch", "--show-current"], { cwd: "." }).trim();
  if (zweig === "") return { hinweis: "kein Zweig ausgecheckt" };
  const offen = alsListe(gh(["pr", "list", "--head", zweig, "--state", "open", "--json", "number"]));
  const nummer = offen.length === 1 ? offen[0].number : undefined;
  return Number.isInteger(nummer) ? { nummer: String(nummer), zweig } : { hinweis: `kein eindeutiger offener PR für den Zweig ${zweig}` };
}

function githubZugang() {
  return {
    GITHUB_TOKEN: env.GITHUB_TOKEN || gh(["auth", "token"]),
    GITHUB_REPOSITORY: env.GITHUB_REPOSITORY || gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]),
  };
}

function aufrufFuer(basis, { nummer, zweig, hinweis }) {
  if (nummer === undefined) {
    console.log(`src-nur-lauf lokal: ${hinweis}; geprüft ohne --pr, also ohne Altbestand-Ausnahme.`);
    return { argumente: ["--basis", basis], umgebung: env };
  }
  console.log(`src-nur-lauf lokal: PR #${nummer} des Zweigs ${zweig}; geprüft wie der Pflicht-Check im PR.`);
  return { argumente: ["--basis", basis, "--ereignis", "pull_request", "--pr", nummer], umgebung: { ...env, ...githubZugang() } };
}

const { values } = parseArgs({ options: { basis: { type: "string" } } });
if (values.basis === undefined) throw new Error("Aufruf: node tools/src-nur-lauf/lokal.mjs --basis <sha>");
const { argumente, umgebung } = aufrufFuer(values.basis, offenerPullRequest());
const lauf = spawnSync(execPath, [PRUEFUNG, ...argumente], { stdio: "inherit", env: umgebung });
process.exitCode = lauf.status ?? EXIT_ABBRUCH;
