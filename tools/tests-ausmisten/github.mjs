import { spawnSync } from "node:child_process";
import { env } from "node:process";

import { repositoryName, rest } from "../testschutz/github.mjs";
import { completedRun } from "../testschutz/neustart.mjs";
import { KONTEXT } from "./herkunft.mjs";

const ZIELBRANCH = "master";
const ERFOLG = "success";
const FEHLSCHLAG = "failure";
const EXIT_GRUEN = 0;
const KOMMENTAR = "COMMENTED";
const ZUGESTIMMT = "APPROVED";
export const FREIGEBER = "Antonio20045";

export function prTitel(bereich) {
  return `Paket 37: ${KONTEXT} ${bereich}`;
}

export async function setzeStatus(github, { kopf, gruen, beschreibung, adresse }) {
  await github.sende("POST", `/statuses/${kopf}`, {
    state: gruen ? ERFOLG : FEHLSCHLAG,
    target_url: adresse,
    description: beschreibung,
    context: KONTEXT,
  });
}

export async function testschutzNeuStarten(kopf) {
  const lauf = await completedRun(kopf);
  if (lauf === undefined) return `kein Testschutz-Lauf für ${kopf}`;
  await rest("POST", `/repos/${repositoryName().full}/actions/runs/${lauf.id}/rerun`);
  return `Testschutz-Lauf ${lauf.id} neu gestartet`;
}

function gh(befehl) {
  const lauf = spawnSync("gh", befehl, { encoding: "utf8", env });
  if (lauf.status === EXIT_GRUEN) return;
  throw new Error(
    `gh ${befehl.join(" ")} endete mit Exit ${lauf.status}: ${String(lauf.stderr ?? "").trim()}`,
  );
}

export function schalteAutoMergeEin(nummer, repo) {
  gh(["pr", "merge", String(nummer), "--repo", repo, "--auto", "--rebase"]);
}

export function schalteAutoMergeAus(nummer, repo) {
  gh(["pr", "merge", String(nummer), "--repo", repo, "--disable-auto"]);
}

async function offenerPr(github, branch) {
  const [besitzer] = github.repo.split("/");
  const kopfAngabe = encodeURIComponent(`${besitzer}:${branch}`);
  const offen = await github.hole(`/pulls?state=open&head=${kopfAngabe}&base=${ZIELBRANCH}`);
  return offen.find(({ head }) => head?.ref === branch);
}

export async function freigegeben(github, { branch, kopf }) {
  const pr = await offenerPr(github, branch);
  if (pr?.head?.sha !== kopf) return false;
  const reviews = await github.alle(`/pulls/${pr.number}/reviews`, (antwort) => antwort);
  const letzte = reviews
    .filter(({ user, state }) => user?.login === FREIGEBER && state !== KOMMENTAR)
    .at(-1);
  return letzte?.state === ZUGESTIMMT && letzte.commit_id === kopf;
}

async function oeffne({ bot, branch, gruen, pr }, aktionen) {
  const neu = await bot.sende("POST", "/pulls", { ...pr(), head: branch, base: ZIELBRANCH });
  if (!gruen)
    return `PR #${neu.number} geöffnet, ohne Auto-Merge: Freigabe von ${FREIGEBER} nötig.`;
  aktionen.autoMerge(neu.number, bot.repo);
  return `PR #${neu.number} geöffnet, Auto-Merge eingeschaltet.`;
}

async function schalte(vorhanden, { bot, kopf, gruen, freigabe, pr }, aktionen) {
  if (gruen || freigabe)
    await bot.sende("PATCH", `/pulls/${vorhanden.number}`, { body: pr().body });
  if (gruen) aktionen.autoMerge(vorhanden.number, bot.repo);
  else aktionen.autoMergeAus(vorhanden.number, bot.repo);
  const schalter = gruen ? "Auto-Merge eingeschaltet" : "Auto-Merge abgeschaltet";
  return `PR #${vorhanden.number}: ${schalter}, ${await aktionen.neustart(kopf)}.`;
}

export async function oeffneOderNeustarten(ziel, aktionen) {
  const vorhanden = await offenerPr(ziel.bot, ziel.branch);
  if (vorhanden === undefined && !ziel.gruen && !ziel.freigabe)
    return "Rot: kein PR geöffnet, kein Auto-Merge.";
  if (vorhanden === undefined) return oeffne(ziel, aktionen);
  if (vorhanden.head.sha !== ziel.kopf) {
    return `PR #${vorhanden.number} steht schon auf ${vorhanden.head.sha}; dieser Lauf hat ${ziel.kopf} gemessen, nichts geändert.`;
  }
  return schalte(vorhanden, ziel, aktionen);
}
