import { env } from "node:process";

import { githubZugang } from "../auftrag/pruefer-github.mjs";

export const CI_DATEI = "ci.yml";
const ERFOLG = "success";
const ABGESCHLOSSEN = "completed";
const NICHT_GEFUNDEN = /HTTP 404$/;
const SCHON_DA = /HTTP 422$/;
const LABEL_FARBE = "5319e7";

export function nimmGithubToken() {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || "";
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return token;
}

export function nimmGithubZugang() {
  return githubZugang({ token: nimmGithubToken() });
}

export function istIssue(eintrag) {
  return eintrag.pull_request === undefined;
}

export async function issuesMitLabel(github, label, zustand = "all") {
  const pfad = `/issues?state=${zustand}&labels=${encodeURIComponent(label)}`;
  return (await github.alle(pfad, (liste) => liste)).filter(istIssue);
}

export async function offeneIssues(github) {
  return (await github.alle("/issues?state=open", (liste) => liste)).filter(istIssue);
}

export async function kommentare(github, nummer) {
  return github.alle(`/issues/${nummer}/comments`, (liste) => liste);
}

export async function kommentiere(github, nummer, text) {
  return github.sende("POST", `/issues/${nummer}/comments`, { body: text });
}

export async function stelleLabelSicher(github, name, beschreibung) {
  try {
    await github.hole(`/labels/${encodeURIComponent(name)}`);
    return;
  } catch (fehler) {
    if (!NICHT_GEFUNDEN.test(fehler.message)) throw fehler;
  }
  try {
    await github.sende("POST", "/labels", { name, color: LABEL_FARBE, description: beschreibung });
  } catch (fehler) {
    if (!SCHON_DA.test(fehler.message)) throw fehler;
  }
}

async function ersterLauf(github, pfad) {
  const { workflow_runs: laeufe } = await github.hole(pfad);
  return laeufe?.[0] ?? null;
}

export function letzterCiLauf(github, { abgeschlossen = false } = {}) {
  const status = abgeschlossen ? `&status=${ABGESCHLOSSEN}` : "";
  return ersterLauf(github, `/actions/workflows/${CI_DATEI}/runs?branch=master&event=push${status}&per_page=1`);
}

const GELAUFEN = new Set(["success", "failure"]);
const DURCHSUCHTE_LAEUFE = 20;

async function hatGearbeitet(github, lauf, schritt) {
  const { jobs = [] } = await github.hole(`/actions/runs/${lauf.id}/jobs`);
  const schritte = jobs.flatMap(({ steps = [] }) => steps);
  return schritte.some(({ name, conclusion }) => name === schritt && GELAUFEN.has(conclusion));
}

export async function letzterBearbeitenderLauf(github, { workflow, schritt }) {
  const pfad = `/actions/workflows/${workflow}/runs?branch=master&status=${ABGESCHLOSSEN}&per_page=${DURCHSUCHTE_LAEUFE}`;
  const { workflow_runs: laeufe = [] } = await github.hole(pfad);
  for (const lauf of laeufe) {
    if (await hatGearbeitet(github, lauf, schritt)) return lauf;
  }
  return null;
}

export function istGruen(lauf) {
  return lauf?.status === ABGESCHLOSSEN && lauf.conclusion === ERFOLG;
}

export function laeuft(lauf) {
  return lauf !== null && lauf.status !== ABGESCHLOSSEN;
}
