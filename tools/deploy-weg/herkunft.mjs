import { APPROVERS } from "../wochenbericht/entscheidungen.mjs";
import { COMMIT_MUSTER, statusWort } from "./ausgabe.mjs";

const HTTP_OK = 200;
const MASTER = "master";
const MASTER_REF = "refs/heads/master";
const GITHUB_ACTIONS_APP = 15368;
const SEITE = "100";
const STAGING_LAEUFE = "/actions/workflows/staging.yml/runs";
const ERFOLG = "success";

export function grund(schluessel, werte = {}) {
  return Object.freeze({ schluessel, werte });
}

export function githubFehler(schritt, http) {
  return grund("rot_github", { schritt, http });
}

export function gueltigerCommit(wert) {
  return typeof wert === "string" && COMMIT_MUSTER.test(wert) ? wert : null;
}

function vonPushAufMaster(lauf) {
  return lauf.event === "push" && lauf.head_branch === MASTER;
}

function imEigenenRepo(lauf, repository) {
  return (
    lauf.head_repository?.full_name === repository && lauf.repository?.full_name === repository
  );
}

export function ausStagingLauf(lauf, repository) {
  if (lauf === null || typeof lauf !== "object") {
    return { commit: null, gruende: [grund("rot_ereignis")], hand: false };
  }
  const gruende = [];
  if (lauf.conclusion !== ERFOLG) {
    gruende.push(grund("rot_staging_nicht_gruen", { status: statusWort(lauf.conclusion) }));
  }
  if (!vonPushAufMaster(lauf)) gruende.push(grund("rot_staging_kein_push"));
  if (!imEigenenRepo(lauf, repository)) gruende.push(grund("rot_fremdes_repo"));
  const commit = gueltigerCommit(lauf.head_sha);
  if (commit === null) gruende.push(grund("rot_ereignis"));
  return { commit, gruende, hand: false };
}

function alleFreigebend(akteure) {
  return akteure.length > 0 && akteure.every((login) => APPROVERS.includes(login));
}

function freigebendeAkteure(nutzlast, einstellungen) {
  return alleFreigebend([nutzlast.sender?.login, ...einstellungen.akteure].filter(Boolean));
}

export function notfallErlaubt(einstellungen, ausgabe) {
  if (!einstellungen.inActions || alleFreigebend(einstellungen.akteure)) return true;
  ausgabe.melde("rot_hand_nutzer");
  return false;
}

function aufMaster(nutzlast, einstellungen) {
  return nutzlast.ref === MASTER_REF && [null, MASTER_REF].includes(einstellungen.ref);
}

function handGruende(nutzlast, einstellungen) {
  const gruende = [];
  if (!freigebendeAkteure(nutzlast, einstellungen)) gruende.push(grund("rot_hand_nutzer"));
  if (!aufMaster(nutzlast, einstellungen)) gruende.push(grund("rot_hand_ref"));
  if (nutzlast.repository?.full_name !== einstellungen.repository) {
    gruende.push(grund("rot_fremdes_repo"));
  }
  return gruende;
}

function gruenerStagingLauf(lauf, { commit, repository }) {
  return (
    lauf?.head_sha === commit &&
    lauf.conclusion === ERFOLG &&
    vonPushAufMaster(lauf) &&
    imEigenenRepo(lauf, repository)
  );
}

async function stagingLaufFuer({ github, commit }) {
  const filter = new URLSearchParams({
    event: "push",
    branch: MASTER,
    status: ERFOLG,
    head_sha: commit,
    per_page: SEITE,
  });
  const { status, daten } = await github.lesen(STAGING_LAEUFE + "?" + filter.toString());
  if (status !== HTTP_OK) return [githubFehler("staging_lauf", status)];
  const laeufe = Array.isArray(daten?.workflow_runs) ? daten.workflow_runs : [];
  const rahmen = { commit, repository: github.repository };
  if (laeufe.some((lauf) => gruenerStagingLauf(lauf, rahmen))) return [];
  return [grund("rot_hand_kein_staging")];
}

export async function ausHandStart({ nutzlast, einstellungen, github }) {
  const gruende = handGruende(nutzlast, einstellungen);
  const commit = gueltigerCommit(nutzlast.inputs?.commit);
  if (commit === null) gruende.push(grund("rot_hand_commit"));
  else gruende.push(...(await stagingLaufFuer({ github, commit })));
  return { commit, gruende, hand: true };
}

function gemergtAufMaster(pr, { commit, repository }) {
  const basis = pr?.base;
  return (
    Boolean(pr?.merged_at) &&
    pr.merge_commit_sha === commit &&
    basis?.ref === MASTER &&
    basis.repo?.full_name === repository
  );
}

export async function prKopf({ github, commit }) {
  const { status, daten } = await github.lesen("/commits/" + commit + "/pulls?per_page=" + SEITE);
  if (status !== HTTP_OK) return { gruende: [githubFehler("pr", status)], kopf: null };
  const rahmen = { commit, repository: github.repository };
  const prs = Array.isArray(daten) ? daten : [];
  const pr = prs.find((eintrag) => gemergtAufMaster(eintrag, rahmen));
  const kopf = gueltigerCommit(pr?.head?.sha);
  if (kopf === null) return { gruende: [grund("rot_kein_pr")], kopf };
  return { gruende: [], kopf };
}

function pflichtChecks(regeln) {
  if (!Array.isArray(regeln)) return [];
  return regeln
    .filter((regel) => regel?.type === "required_status_checks")
    .flatMap((regel) => regel.parameters?.required_status_checks ?? [])
    .filter((pflicht) => typeof pflicht?.context === "string");
}

function checkUrteil(laeufe, pflicht) {
  const check = pflicht.context;
  if (laeufe.length === 0) return [grund("rot_check_fehlt", { check })];
  const erwartet = pflicht.integration_id ?? GITHUB_ACTIONS_APP;
  const vonActions = laeufe.filter((lauf) => lauf.app?.id === GITHUB_ACTIONS_APP);
  if (erwartet !== GITHUB_ACTIONS_APP || vonActions.length === 0) {
    return [grund("rot_check_app", { check })];
  }
  const rot = vonActions.find((lauf) => lauf.conclusion !== ERFOLG);
  if (rot === undefined) return [];
  return [grund("rot_check_nicht_gruen", { check, status: statusWort(rot.conclusion) })];
}

async function checkPruefen({ github, kopf, pflicht }) {
  const filter = new URLSearchParams({
    check_name: pflicht.context,
    filter: "latest",
    per_page: SEITE,
  });
  const pfad = "/commits/" + kopf + "/check-runs?" + filter.toString();
  const { status, daten } = await github.lesen(pfad);
  if (status !== HTTP_OK) return [githubFehler("check_runs", status)];
  const alle = Array.isArray(daten?.check_runs) ? daten.check_runs : [];
  return checkUrteil(
    alle.filter((lauf) => lauf?.name === pflicht.context),
    pflicht,
  );
}

export async function checksPruefen({ github, kopf }) {
  const { status, daten } = await github.lesen("/rules/branches/" + MASTER);
  if (status !== HTTP_OK) return [githubFehler("pflicht_checks", status)];
  const pflichten = pflichtChecks(daten);
  if (pflichten.length === 0) return [grund("rot_keine_pflicht_checks")];
  const gruende = [];
  for (const pflicht of pflichten) gruende.push(...(await checkPruefen({ github, kopf, pflicht })));
  return gruende;
}
