import { abrufLaufBefund, gh, ghRepo, mitUrteilAbgeschlossen } from "./gh.mjs";

const PR_EREIGNIS = "pull_request";
const PR_REFERENZ = /^refs\/pull\/([1-9]\d*)\/merge$/;
const SEITENGROESSE = 100;
const MODUS_SCHATTEN = "schatten";
const MODUS_AN = "an";
const MODUS_AUS = "aus";
const MODI = new Set([MODUS_SCHATTEN, MODUS_AN, MODUS_AUS]);

export function pullRequestNummer(umgebung) {
  if (umgebung.GITHUB_EVENT_NAME !== PR_EREIGNIS) return null;
  const treffer = PR_REFERENZ.exec(String(umgebung.GITHUB_REF));
  return treffer === null ? null : Number(treffer[1]);
}

function modusVon(umgebung) {
  const angabe = umgebung.MUTATION_UEBERNAHME_PR;
  return angabe === undefined || angabe === "" ? MODUS_SCHATTEN : angabe;
}

function laeufeDesBranches(umgebung) {
  const zweig = encodeURIComponent(String(umgebung.GITHUB_HEAD_REF));
  const abfrage = `event=${PR_EREIGNIS}&branch=${zweig}&status=completed&per_page=${SEITENGROESSE}`;
  return JSON.parse(gh(["api", `repos/${ghRepo()}/actions/workflows/ci.yml/runs?${abfrage}`])).workflow_runs ?? [];
}

export function vorlaufImPullRequest(umgebung, pullRequest) {
  const modus = modusVon(umgebung);
  if (!MODI.has(modus)) return { grund: `MUTATION_UEBERNAHME_PR hat den unbekannten Wert ${JSON.stringify(modus)}` };
  if (modus === MODUS_AUS) return { grund: "die Übernahme im Pull Request ist ausgeschaltet" };
  if (!umgebung.GITHUB_HEAD_REF) return { grund: "der Zweig des Pull Requests ist unbekannt" };
  const herkunft = { ereignis: PR_EREIGNIS, pullRequest };
  const frueher = laeufeDesBranches(umgebung)
    .filter((lauf) => lauf.id < Number(umgebung.GITHUB_RUN_ID) && mitUrteilAbgeschlossen(lauf) && abrufLaufBefund(lauf, ghRepo(), herkunft) === null)
    .sort((links, rechts) => rechts.id - links.id);
  if (frueher.length === 0) return { grund: "kein früherer abgeschlossener Lauf dieses Pull Requests" };
  return { id: frueher[0].id, herkunft, uebernimmt: modus === MODUS_AN };
}
