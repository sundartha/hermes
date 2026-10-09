import { KONTEXT } from "../auftrag/pruefer-urteil.mjs";
import { CI_DATEI, kommentiere, offeneIssues } from "./github.mjs";

export const BOT = "sundartha-agent[bot]";
export const BOT_EMAIL = "340129717+sundartha-agent[bot]@users.noreply.github.com";
export const BRANCH_PRAEFIX = "aufraeumen/";
const EIGENER_BRANCH = /^aufraeumen\/([a-z]+)-[\w-]+$/;
const EIGENER_TITEL = /^Aufräumen: [a-z]+ in (.+)$/;
const NICHT_ROT = new Set(["success", "action_required", "skipped", "neutral"]);
const ROTER_STATUS = new Set(["failure", "error"]);
const PR_EREIGNIS = "pull_request";
const WARTESCHLANGE = "merge_group";

export function prTitel(sorte, datei) {
  return `Aufräumen: ${sorte} in ${datei}`;
}

export function istEigenerPr(pr) {
  const branch = pr.head?.ref ?? "";
  return pr.user?.login === BOT && EIGENER_BRANCH.test(branch);
}

function eigenerPr(pr) {
  return {
    nummer: pr.number,
    sorte: EIGENER_BRANCH.exec(pr.head.ref)[1],
    datei: EIGENER_TITEL.exec(pr.title ?? "")?.[1] ?? "",
    branch: pr.head.ref,
    offen: pr.state === "open",
    gemergt: Boolean(pr.merged_at),
    geschlossen: pr.closed_at ?? "",
    basis: pr.base?.sha ?? "",
    kopf: pr.head.sha,
    erstellt: pr.created_at ?? "",
  };
}

export async function eigenePrs(github, zustand) {
  const alle = await github.alle(`/pulls?state=${zustand}`, (liste) => liste);
  return alle.filter(istEigenerPr).map(eigenerPr).sort((links, rechts) => rechts.nummer - links.nummer);
}

function neuesterAbgeschlossener(laeufe) {
  const abgeschlossen = laeufe.filter(({ status }) => status === "completed");
  return abgeschlossen.toSorted((links, rechts) => rechts.run_number - links.run_number)[0] ?? null;
}

function ciLaeufe(laeufe, repo) {
  return (laeufe ?? []).filter(
    ({ path, head_repository: herkunft }) =>
      (path ?? "").startsWith(`.github/workflows/${CI_DATEI}`) && herkunft?.full_name === repo,
  );
}

function gehoertZu(lauf, pr) {
  const nummern = (lauf.pull_requests ?? []).map(({ number }) => number);
  return lauf.head_branch === pr.branch || nummern.includes(pr.nummer);
}

async function roterPrueferStatus(github, pr) {
  const { statuses = [] } = await github.hole(`/commits/${pr.kopf}/status`);
  const pruefer = statuses.find(({ context }) => context === KONTEXT);
  if (!pruefer || !ROTER_STATUS.has(pruefer.state)) return null;
  return { html_url: pruefer.target_url ?? "", conclusion: `${KONTEXT}: ${pruefer.state}` };
}

export async function roterLauf(github, pr) {
  const { workflow_runs: prLaeufe } = await github.hole(
    `/actions/runs?head_sha=${pr.kopf}&event=${PR_EREIGNIS}&per_page=100`,
  );
  const { workflow_runs: schlange } = await github.hole(
    `/actions/workflows/${CI_DATEI}/runs?event=${WARTESCHLANGE}&per_page=100`,
  );
  const eigeneSchlange = (schlange ?? []).filter(({ head_branch: branch }) =>
    (branch ?? "").startsWith(`gh-readonly-queue/master/pr-${pr.nummer}-`),
  );
  const eigenePrLaeufe = ciLaeufe(prLaeufe, github.repo).filter((lauf) => gehoertZu(lauf, pr));
  const kandidaten = [eigenePrLaeufe, ciLaeufe(eigeneSchlange, github.repo)].map(neuesterAbgeschlossener);
  const rot = kandidaten.find((lauf) => lauf !== null && !NICHT_ROT.has(lauf.conclusion));
  return rot ?? (await roterPrueferStatus(github, pr));
}

export async function schliesseRotenPr(github, pr, { lauf, roter }) {
  await kommentiere(
    github,
    pr.nummer,
    `Geschlossen vom Lauf ${lauf}: Der CI-Lauf ${roter.html_url ?? ""} endete mit ${roter.conclusion}. Die Datei ${pr.datei} bleibt verworfen, bis sie sich auf master ändert.`,
  );
  await github.sende("PATCH", `/pulls/${pr.nummer}`, { state: "closed" });
  const titel = `Aus der Warteschlange gefallen: #${pr.nummer}`;
  const gefallen = (await offeneIssues(github)).filter((issue) => issue.title === titel);
  for (const issue of gefallen) {
    await kommentiere(github, issue.number, `Der PR #${pr.nummer} ist geschlossen (Lauf ${lauf}).`);
    await github.sende("PATCH", `/issues/${issue.number}`, { state: "closed", state_reason: "not_planned" });
  }
}
