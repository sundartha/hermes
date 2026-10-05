import { spawnSync } from "node:child_process";

import { githubZugang } from "../auftrag/pruefer-github.mjs";
import {
  adresseDiesesLaufs,
  ciLauf,
  git,
  patchIdZwischen,
  holeKopf,
  prNummerAus,
  zusammenfuehrungsbasis,
} from "./gleicher-stand.mjs";

const KONTEXT = "Prüfer";
const ERSTELLER = "github-actions[bot]";
const ERFOLG = "success";
const FEHLSCHLAG = "failure";
const MASTER = "origin/master";
const KURZ = 7;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;

async function statusAmKopf(github, kopf) {
  const statusse = await github.hole(`/commits/${kopf}/statuses`);
  return statusse.find(({ context }) => context === KONTEXT) ?? null;
}

function gleicheAenderung({ warteschlange, commits, kopf }, root) {
  const vorher = `${warteschlange}~${commits}`;
  const inDerWarteschlange = patchIdZwischen(vorher, warteschlange, root);
  const amKopf = patchIdZwischen(zusammenfuehrungsbasis(kopf, MASTER, root), kopf, root);
  return inDerWarteschlange !== "" && inDerWarteschlange === amKopf;
}

function urteil({ status, gleich, kopf }) {
  const kurz = kopf.slice(0, KURZ);
  if (status?.state !== ERFOLG || status?.creator?.login !== ERSTELLER) {
    return {
      state: FEHLSCHLAG,
      description: `kein Prüfer-Status success von ${ERSTELLER} am PR-Kopf ${kurz}`,
    };
  }
  if (!gleich) {
    return { state: FEHLSCHLAG, description: `Änderung weicht vom PR-Kopf ${kurz} ab` };
  }
  return { state: ERFOLG, description: `übernommen vom PR-Kopf ${kurz}, gleiche Änderung` };
}

async function bewerte(github, { nummer, warteschlange }, root) {
  const pull = await github.hole(`/pulls/${nummer}`);
  const kopf = holeKopf(nummer, String(pull?.head?.sha ?? ""), root);
  const commits = Number(pull?.commits);
  const gleich = gleicheAenderung({ warteschlange, commits, kopf }, root);
  return urteil({ status: await statusAmKopf(github, kopf), gleich, kopf });
}

function liegtAufMaster(sha, root) {
  const lauf = spawnSync("git", ["merge-base", "--is-ancestor", sha, MASTER], { cwd: root });
  return lauf.status === 0;
}

export async function prueferStatus(_werte, root, github = githubZugang()) {
  const lauf = await ciLauf(github, ["merge_group"]);
  const nummer = prNummerAus(lauf?.head_branch);
  if (lauf === null || nummer === null) {
    console.error("Der auslösende Lauf ist kein Lauf von ci.yml in der Warteschlange.");
    return EXIT_FEHLER;
  }
  const warteschlange = lauf.head_sha;
  git(["fetch", "--quiet", "--no-tags", "origin", "master", warteschlange], { root });
  const status = await bewerte(github, { nummer, warteschlange }, root);
  const kurz = warteschlange.slice(0, KURZ);
  if (liegtAufMaster(warteschlange, root)) {
    console.log(
      `Prüfer-Status nicht gesetzt: ${kurz} liegt schon auf master; würde ${status.state} setzen (${status.description}).`,
    );
    return EXIT_OK;
  }
  await github.sende("POST", `/statuses/${warteschlange}`, {
    ...status,
    context: KONTEXT,
    target_url: adresseDiesesLaufs() ?? undefined,
  });
  console.log(`Prüfer-Status ${status.state} auf ${kurz}: ${status.description}.`);
  return EXIT_OK;
}
