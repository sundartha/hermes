import { spawnSync } from "node:child_process";
import { env } from "node:process";

import { repositoryName, rest } from "../testschutz/github.mjs";
import { completedRun } from "../testschutz/neustart.mjs";
import { KONTEXT } from "./herkunft.mjs";

const ZIELBRANCH = "master";
const ERFOLG = "success";
const FEHLSCHLAG = "failure";
const EXIT_GRUEN = 0;

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

export async function oeffneOderNeustarten({ bot, branch, kopf, gruen, pr }, aktionen) {
  const [besitzer] = bot.repo.split("/");
  const kopfAngabe = encodeURIComponent(`${besitzer}:${branch}`);
  const offen = await bot.hole(`/pulls?state=open&head=${kopfAngabe}&base=${ZIELBRANCH}`);
  const vorhanden = offen.find(({ head }) => head?.ref === branch);
  if (vorhanden === undefined && !gruen) return "Rot: kein PR geöffnet, kein Auto-Merge.";
  if (vorhanden === undefined) {
    const neu = await bot.sende("POST", "/pulls", { ...pr(), head: branch, base: ZIELBRANCH });
    aktionen.autoMerge(neu.number, bot.repo);
    return `PR #${neu.number} geöffnet, Auto-Merge eingeschaltet.`;
  }
  if (vorhanden.head.sha !== kopf) {
    return `PR #${vorhanden.number} steht schon auf ${vorhanden.head.sha}; dieser Lauf hat ${kopf} gemessen, nichts geändert.`;
  }
  if (gruen) aktionen.autoMerge(vorhanden.number, bot.repo);
  else aktionen.autoMergeAus(vorhanden.number, bot.repo);
  const schalter = gruen ? "Auto-Merge eingeschaltet" : "Auto-Merge abgeschaltet";
  return `PR #${vorhanden.number}: ${schalter}, ${await aktionen.neustart(kopf)}.`;
}
