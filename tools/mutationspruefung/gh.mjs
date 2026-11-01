import { spawnSync } from "node:child_process";
import { env } from "node:process";

import { laufHerkunftBefund } from "../lauf-herkunft.mjs";

const STANDARD_REPO = "sundartha/hermes";
const EXIT_GRUEN = 0;
export const MAX_GH_AUSGABE = 268_435_456;
export const LAUF_FERTIG = "completed";
export const ABGESCHLOSSEN = new Set(["success", "failure"]);
const WORKFLOW_PFAD = ".github/workflows/ci.yml";
const ABRUF_EREIGNIS = "workflow_dispatch";
const ABRUF_ZWEIG = "lauf-mutation/";
const ABRUF = {
  pfad: WORKFLOW_PFAD,
  ereignis: ABRUF_EREIGNIS,
  zweig: ABRUF_ZWEIG,
  nichtWorkflow: "gehört nicht zum Abruf des Workflows CI",
  nichtZweig: "lief nicht auf einem lauf-mutation-Zweig",
};

export function ghRepo() {
  return env.GITHUB_REPOSITORY || STANDARD_REPO;
}

export function gh(argumente) {
  const lauf = spawnSync("gh", argumente, { encoding: "utf8", maxBuffer: MAX_GH_AUSGABE });
  if (lauf.status === EXIT_GRUEN) return lauf.stdout;
  throw new Error(`gh ${argumente.join(" ")} endete mit Exit ${lauf.status}: ${String(lauf.stderr ?? "").trim()}`);
}

export function mitUrteilAbgeschlossen(lauf) {
  return lauf.status === LAUF_FERTIG && ABGESCHLOSSEN.has(lauf.conclusion);
}

function gehoertZumPullRequest(lauf, pullRequest) {
  return Array.isArray(lauf.pull_requests) && lauf.pull_requests.some(({ number }) => number === pullRequest);
}

function pullRequestBefund(lauf, repo, herkunft) {
  const erwartung = { ...ABRUF, ereignis: herkunft.ereignis, zweig: "", nichtWorkflow: "gehört nicht zum Workflow CI eines Pull Requests" };
  const befund = laufHerkunftBefund(lauf, repo, erwartung);
  if (befund !== null) return befund;
  return gehoertZumPullRequest(lauf, herkunft.pullRequest) ? null : "gehört nicht zu diesem Pull Request";
}

export function abrufLaufBefund(lauf, repo, herkunft = ABRUF) {
  if (herkunft.pullRequest === undefined) return laufHerkunftBefund(lauf, repo, ABRUF);
  return pullRequestBefund(lauf, repo, herkunft);
}
