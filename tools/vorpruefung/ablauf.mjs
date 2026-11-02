import { spawnSync } from "node:child_process";

import { REMOTE } from "../auftrag/sperren.mjs";
import { gh, ghRepo, LAUF_FERTIG, loescheWegwerfZweig, loeseWorkflowAus } from "../mutationspruefung/gh.mjs";

const WORKFLOW = "vorpruefung.yml";
const PAKET_BRANCH = /^paket\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const ERWARTETER_STAND = /^(?:neu|[0-9a-f]{40})$/;
const NEU = "neu";
const VORPRUEF_PRAEFIX = "vorpruefung/";
const GRUEN = "success";
const SUCHVERSUCHE = 6;
const SUCHABSTAND_MS = 10_000;
const BEOBACHTUNGEN = 480;
const BEOBACHTUNGSTAKT_S = "60";
export const EXIT_GRUEN = 0;
export const EXIT_ROT = 1;
export const EXIT_ABBRUCH = 2;

class Abbruch extends Error {}

function git(argumente, root) {
  return spawnSync("git", argumente, { cwd: root, encoding: "utf8" });
}

function gitAusgabe(argumente, root) {
  const lauf = git(argumente, root);
  if (lauf.status === EXIT_GRUEN) return lauf.stdout.trim();
  throw new Abbruch(`git ${argumente.join(" ")} endete mit Exit ${lauf.status}: ${String(lauf.stderr ?? "").trim()}`);
}

function paketName(branch) {
  const treffer = PAKET_BRANCH.exec(branch ?? "");
  if (treffer === null || branch.includes("..") || branch.endsWith(".lock") || branch.endsWith(".")) {
    throw new Abbruch("nur Branches der Form paket/<name>");
  }
  return treffer[1];
}

function lease(branch, erwartet) {
  if (!ERWARTETER_STAND.test(erwartet ?? "")) throw new Abbruch("--erwartet ist der volle sha, der zuletzt nach upstream gepusht wurde, oder neu");
  return erwartet === NEU ? `refs/heads/${branch}:` : `refs/heads/${branch}:${erwartet}`;
}

function offenerPr(repo, branch) {
  const nummern = gh(["pr", "list", "-R", repo, "--head", branch, "--state", "open", "--json", "number", "--jq", ".[].number"]).split("\n").filter(Boolean);
  if (nummern.length > 1) throw new Abbruch(`mehr als ein offener PR für ${branch}: ${nummern.join(", ")}`);
  return nummern[0] ?? "";
}

function refspec(stand, ziel) {
  return `${stand}:refs/heads/${ziel}`;
}

function pushe(root, ziel, schalter) {
  const lauf = git(["push", "--no-follow-tags", "--recurse-submodules=no", ...schalter, REMOTE, ziel], root);
  return { gruen: lauf.status === EXIT_GRUEN, meldung: `${lauf.stdout ?? ""}${lauf.stderr ?? ""}`.trim() };
}

function loeseAus({ repo, vorRef, branch, stand, pr }, zeiten) {
  return loeseWorkflowAus({ repo, workflow: WORKFLOW, ref: vorRef, eingaben: { branch, stand, pr }, stand }, zeiten);
}

function laufStand(repo, lauf) {
  return JSON.parse(gh(["run", "view", lauf, "-R", repo, "--json", "status,conclusion,headSha,url,jobs"]));
}

function warteAufLauf(repo, lauf, zeiten) {
  for (let beobachtung = 1; beobachtung <= zeiten.beobachtungen; beobachtung++) {
    spawnSync("gh", ["run", "watch", lauf, "-R", repo, "-i", zeiten.takt, "--exit-status", "--compact"], { stdio: "ignore" });
    const stand = laufStand(repo, lauf);
    if (stand.status === LAUF_FERTIG) return stand;
  }
  throw new Abbruch(`Lauf ${lauf} ist nach ${zeiten.beobachtungen} Beobachtungen nicht fertig`);
}

function roteJobs(stand) {
  return (stand.jobs ?? []).filter(({ conclusion }) => conclusion !== GRUEN && conclusion !== "skipped").map(({ name, conclusion }) => `  ${name}: ${conclusion}`);
}

function urteil(stand, erwartet) {
  if (stand.headSha !== erwartet) return { exitCode: EXIT_ABBRUCH, zeilen: [`Abbruch: die Vorprüfung ${stand.url} lief am Stand ${stand.headSha}, nicht am Stand ${erwartet}; der PR bleibt, wie er ist.`] };
  if (stand.conclusion === GRUEN) return { exitCode: EXIT_GRUEN, zeilen: [`Vorprüfung grün: ${stand.url}`] };
  const kopf = `Vorprüfung ${stand.conclusion || "ohne Ergebnis"}: ${stand.url}. Der PR bleibt auf dem alten Stand.`;
  return { exitCode: EXIT_ROT, zeilen: [kopf, ...roteJobs(stand), `Befunde: gh run view ${stand.url.split("/").at(-1)} --log-failed`] };
}

async function pruefeAufGithub(abruf, zeiten) {
  const vorab = pushe(abruf.root, refspec(abruf.stand, abruf.vorRef), ["--force"]);
  if (!vorab.gruen) return { exitCode: EXIT_ROT, zeilen: [`Push nach ${REMOTE}/${abruf.vorRef} abgelehnt; der PR bleibt auf dem alten Stand.`, vorab.meldung] };
  try {
    const lauf = await loeseAus(abruf, zeiten);
    console.log(`Vorprüfung läuft: https://github.com/${abruf.repo}/actions/runs/${lauf}`);
    return urteil(warteAufLauf(abruf.repo, lauf, zeiten), abruf.stand);
  } finally {
    loescheWegwerfZweig(abruf.repo, abruf.vorRef);
  }
}

function aktualisierePr({ root, branch, stand }, leaseWert) {
  const push = pushe(root, refspec(stand, branch), [`--force-with-lease=${leaseWert}`]);
  if (!push.gruen) return { exitCode: EXIT_ROT, zeilen: [`Push nach ${REMOTE}/${branch} abgelehnt; der PR bleibt auf dem alten Stand.`, push.meldung] };
  return { exitCode: EXIT_GRUEN, zeilen: [`${REMOTE}/${branch} = ${stand}. Das ist der erwartete sha für deinen nächsten paket-push; notiere ihn.`] };
}

const ZEITEN = { suchabstandMs: SUCHABSTAND_MS, suchversuche: SUCHVERSUCHE, beobachtungen: BEOBACHTUNGEN, takt: BEOBACHTUNGSTAKT_S };

export async function vorpruefenUndPushen({ root, branch, erwartet }, zeiten = ZEITEN) {
  try {
    const name = paketName(branch);
    const leaseWert = lease(branch, erwartet);
    const repo = ghRepo();
    const stand = gitAusgabe(["rev-parse", "--verify", `refs/heads/${branch}`], root);
    const abruf = { root, repo, branch, stand, vorRef: `${VORPRUEF_PRAEFIX}${name}`, pr: offenerPr(repo, branch) };
    const ergebnis = await pruefeAufGithub(abruf, zeiten);
    if (ergebnis.exitCode !== EXIT_GRUEN) return ergebnis;
    const push = aktualisierePr(abruf, leaseWert);
    return { exitCode: push.exitCode, zeilen: [...ergebnis.zeilen, ...push.zeilen] };
  } catch (fehler) {
    return { exitCode: EXIT_ABBRUCH, zeilen: [`Abbruch: ${fehler.message}; der PR bleibt auf dem alten Stand.`] };
  }
}
