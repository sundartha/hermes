import { spawnSync } from "node:child_process";
import { env } from "node:process";
import { setTimeout as warte } from "node:timers/promises";

import { laufHerkunftBefund } from "../lauf-herkunft.mjs";

const STANDARD_REPO = "sundartha/hermes";
const EXIT_GRUEN = 0;
export const MAX_GH_AUSGABE = 268_435_456;
export const LAUF_FERTIG = "completed";
const MS_JE_SEKUNDE = 1000;
const SUCHLISTE = "10";
const LAUF_URL = /\/actions\/runs\/(\d+)/;
const WORKFLOW_PFAD = ".github/workflows/ci.yml";
export const ABRUF_EREIGNIS = "workflow_dispatch";
export const ABRUF_ZWEIG = "lauf-mutation/";
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

async function sucheLauf(suche, zeiten, versuch = 1) {
  await warte(zeiten.suchabstandMs);
  const { repo, workflow, ref, seit, stand } = suche;
  const laeufe = JSON.parse(gh(["run", "list", "-R", repo, "-w", workflow, "-b", ref, "-e", ABRUF_EREIGNIS, "--json", "databaseId,headSha,createdAt", "-L", SUCHLISTE]));
  const neu = laeufe
    .filter((lauf) => Date.parse(lauf.createdAt) >= seit && (stand === undefined || lauf.headSha === stand))
    .sort((frueher, spaeter) => Date.parse(spaeter.createdAt) - Date.parse(frueher.createdAt));
  if (neu.length > 0) return String(neu[0].databaseId);
  if (versuch >= zeiten.suchversuche) throw new Error(`kein Lauf von ${workflow} auf ${ref}${stand === undefined ? "" : ` am Stand ${stand}`} nach ${zeiten.suchversuche} Suchen gefunden`);
  return sucheLauf(suche, zeiten, versuch + 1);
}

export async function loeseWorkflowAus({ repo, workflow, ref, eingaben, stand }, zeiten) {
  const seit = Math.floor(Date.now() / MS_JE_SEKUNDE) * MS_JE_SEKUNDE;
  const felder = Object.entries(eingaben).flatMap(([name, wert]) => ["-f", `${name}=${wert}`]);
  const ausgabe = gh(["workflow", "run", workflow, "-R", repo, "--ref", ref, ...felder]);
  const treffer = LAUF_URL.exec(ausgabe);
  return treffer ? treffer[1] : sucheLauf({ repo, workflow, ref, seit, stand }, zeiten);
}

export function loescheWegwerfZweig(repo, zweig) {
  try {
    gh(["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${zweig}`]);
  } catch (fehler) {
    console.error(`Hinweis: Wegwerf-Branch ${zweig} nicht gelöscht: ${fehler.message}`);
  }
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
