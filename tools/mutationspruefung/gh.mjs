import { spawnSync } from "node:child_process";
import { env } from "node:process";

const STANDARD_REPO = "sundartha/hermes";
const EXIT_GRUEN = 0;
export const MAX_GH_AUSGABE = 268_435_456;
export const LAUF_FERTIG = "completed";
const WORKFLOW_PFAD = ".github/workflows/ci.yml";
const ABRUF_EREIGNIS = "workflow_dispatch";
const ABRUF_ZWEIG = "lauf-mutation/";
const COMMIT = /^[0-9a-f]{40}$/;

export function ghRepo() {
  return env.GITHUB_REPOSITORY || STANDARD_REPO;
}

export function gh(argumente) {
  const lauf = spawnSync("gh", argumente, { encoding: "utf8", maxBuffer: MAX_GH_AUSGABE });
  if (lauf.status === EXIT_GRUEN) return lauf.stdout;
  throw new Error(`gh ${argumente.join(" ")} endete mit Exit ${lauf.status}: ${String(lauf.stderr ?? "").trim()}`);
}

export function abrufLaufBefund(lauf, repo) {
  const bedingungen = [
    [lauf.path === WORKFLOW_PFAD && lauf.event === ABRUF_EREIGNIS, "gehört nicht zum Abruf des Workflows CI"],
    [String(lauf.head_branch).startsWith(ABRUF_ZWEIG), "lief nicht auf einem lauf-mutation-Zweig"],
    [lauf.repository?.full_name === repo && lauf.head_repository?.full_name === repo, "stammt nicht aus diesem Repository"],
    [COMMIT.test(String(lauf.head_sha)), "nennt keinen Commit"],
  ];
  const verletzt = bedingungen.find(([erfuellt]) => !erfuellt);
  return verletzt === undefined ? null : verletzt[1];
}
