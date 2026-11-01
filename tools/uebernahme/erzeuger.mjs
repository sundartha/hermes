import { entpacke } from "../auftrag/pruefer-gedaechtnis.mjs";
import { laufHerkunftBefund } from "../lauf-herkunft.mjs";
import { jobFehler, jobsDesLaufs } from "../tests-ausmisten/festgehalten.mjs";
import { git, prNummerAus } from "../warteschlange/gleicher-stand.mjs";
import { festhaltungImProtokoll, pruefsumme } from "./festhaltung.mjs";

export const MAX_ALTER_MS = 86_400_000;
const LAEUFE_JE_ABFRAGE = 100;
const WARTESCHLANGEN_ZWEIG = "gh-readonly-queue/master/";
const MERGE_GROUP = "merge_group";
const PULL_REQUEST = "pull_request";
const NUR_BAUM = "^{tree}";
const TEIL_JOB = /^(.+) (\d+)\/(\d+)$/;

export const CI = {
  datei: "ci.yml",
  jobName: "Tests",
  artefakt: (teil) => `testlaufzeit-teil-${teil}`,
  bericht: () => "dateien.jsonl",
};

export const PRUEFLEITER = {
  datei: "pruefleiter.yml",
  jobName: "Prüfleiter Werkzeugtests",
  artefakt: (teil) => `werkzeugteil-${teil}`,
  bericht: (teil) => `werkzeugteil-${teil}.jsonl`,
};

export const QUELLEN = {
  push: { ci: [{ workflow: CI, ereignis: MERGE_GROUP }] },
  [MERGE_GROUP]: {
    ci: [
      { workflow: CI, ereignis: PULL_REQUEST },
      { workflow: PRUEFLEITER, ereignis: PULL_REQUEST },
    ],
    pruefleiter: [{ workflow: PRUEFLEITER, ereignis: PULL_REQUEST }],
  },
};

export function baumVon(sha, wurzel) {
  const lesen = () => git(["rev-parse", `${sha}${NUR_BAUM}`], { root: wurzel }).trim();
  try {
    return lesen();
  } catch {
    try {
      git(["fetch", "--quiet", "--no-tags", "origin", sha], { root: wurzel });
      return lesen();
    } catch {
      return undefined;
    }
  }
}

function laufBefund(lauf, repo, { workflow, ereignis }) {
  const zweig = ereignis === MERGE_GROUP ? WARTESCHLANGEN_ZWEIG : "";
  return laufHerkunftBefund(lauf, repo, {
    pfad: `.github/workflows/${workflow.datei}`,
    ereignis,
    zweig,
    nichtWorkflow: `gehört nicht zum Workflow ${workflow.datei} mit Ereignis ${ereignis}`,
    nichtZweig: `lief nicht auf einem Zweig mit dem Vorsatz ${zweig}`,
  });
}

async function laeufeDerWarteschlange(github, { workflow }, jetzt) {
  const seit = encodeURIComponent(`>=${new Date(jetzt - MAX_ALTER_MS).toISOString()}`);
  const abfrage = `event=${MERGE_GROUP}&status=completed&created=${seit}&per_page=${LAEUFE_JE_ABFRAGE}`;
  return (await github.hole(`/actions/workflows/${workflow.datei}/runs?${abfrage}`)).workflow_runs;
}

async function laeufeDesPullRequests(github, { workflow }, ref) {
  const nummer = prNummerAus(ref);
  if (nummer === null) return [];
  const { head } = await github.hole(`/pulls/${nummer}`);
  const zweig = encodeURIComponent(head.ref);
  const abfrage = `event=${PULL_REQUEST}&status=completed&branch=${zweig}&per_page=${LAEUFE_JE_ABFRAGE}`;
  const { workflow_runs: laeufe } = await github.hole(
    `/actions/workflows/${workflow.datei}/runs?${abfrage}`,
  );
  return laeufe.filter((lauf) => lauf.pull_requests?.some((pr) => pr.number === nummer));
}

function neuesteZuerst(laeufe) {
  return [...laeufe].sort((neuer, aelter) => Date.parse(aelter.created_at) - Date.parse(neuer.created_at));
}

export async function kandidaten(github, quelle, { ref, jetzt, repo }) {
  const laeufe =
    quelle.ereignis === MERGE_GROUP
      ? await laeufeDerWarteschlange(github, quelle, jetzt)
      : await laeufeDesPullRequests(github, quelle, ref);
  const frisch = laeufe.filter((lauf) => jetzt - Date.parse(lauf.created_at) <= MAX_ALTER_MS);
  return neuesteZuerst(frisch).filter((lauf) => laufBefund(lauf, repo, quelle) === null);
}

function teilJobs(jobs, workflow) {
  const teile = jobs
    .map((job) => ({ job, treffer: TEIL_JOB.exec(job.name) }))
    .filter(({ treffer }) => treffer?.[1] === workflow.jobName)
    .map(({ job, treffer }) => ({ name: job.name, teil: Number(treffer[2]), von: Number(treffer[3]) }));
  const vollstaendig = teile.length > 0 && teile.every(({ von }) => von === teile.length);
  if (!vollstaendig) throw new Error(`Die Teiljobs „${workflow.jobName}“ sind nicht vollständig`);
  return teile;
}

async function protokollVon(github, jobs, name) {
  const job = jobs.find((kandidat) => kandidat.name === name);
  return (await github.roh(`/actions/jobs/${job.id}/logs`)).toString("utf8");
}

function festhaltungBefund(festhaltung, { baum, kennung }) {
  if (festhaltung === undefined) return "nennt die Festhaltung nicht genau einmal";

  if (festhaltung.kennung.node !== kennung.node) return "lief mit einer anderen Node-Version";
  if (festhaltung.kennung.image !== kennung.image) return "lief auf einem anderen Runner-Image";
  if (festhaltung.wackelig > 0) return "hatte wackelige Tests";
  return null;
}

async function berichtVon(github, laufId, { workflow, teil }) {
  const name = workflow.artefakt(teil);
  const liste = await github.alle(`/actions/runs/${laufId}/artifacts`, (antwort) => antwort.artifacts);
  const passend = liste.filter((artefakt) => artefakt.name === name);
  if (passend.length !== 1) throw new Error(`Artefakt ${name} gibt es ${passend.length}-mal`);
  const dateien = entpacke(await github.roh(`/actions/artifacts/${passend[0].id}/zip`));
  const inhalt = dateien.get(workflow.bericht(teil));
  if (inhalt === undefined) throw new Error(`Artefakt ${name} enthält ${workflow.bericht(teil)} nicht`);
  return inhalt;
}

function berichtZeilen(inhalt) {
  const zeilen = inhalt.toString("utf8").split("\n");
  return zeilen.filter((zeile) => zeile.trim() !== "").map((zeile) => JSON.parse(zeile));
}

async function pruefeTeil(github, lauf, { workflow, jobs, teil, erwartet }) {
  const jobName = `${workflow.jobName} ${teil.teil}/${teil.von}`;
  const fehler = jobFehler(jobs, jobName);
  if (fehler) throw new Error(fehler);
  const festhaltung = festhaltungImProtokoll(
    await protokollVon(github, jobs, jobName),
    workflow.artefakt(teil.teil),
  );
  const befund = festhaltungBefund(festhaltung, erwartet);
  if (befund) throw new Error(`Job „${jobName}“ ${befund}`);
  const inhalt = await berichtVon(github, lauf.id, { workflow, teil: teil.teil });
  if (pruefsumme(inhalt) !== festhaltung.summe) {
    throw new Error(`Das Artefakt ${workflow.artefakt(teil.teil)} passt nicht zur Prüfsumme im Protokoll`);
  }
  return berichtZeilen(inhalt);
}

export async function pruefeLauf(github, lauf, { workflow, erwartet }) {
  try {
    const jobs = await jobsDesLaufs(github, lauf.id);
    const zeilen = new Map();
    for (const teil of teilJobs(jobs, workflow)) {
      for (const zeile of await pruefeTeil(github, lauf, { workflow, jobs, teil, erwartet })) {
        zeilen.set(zeile.datei, [...(zeilen.get(zeile.datei) ?? []), zeile]);
      }
    }
    return { lauf, workflow: workflow.datei, zeilen };
  } catch (grund) {
    return { lauf, workflow: workflow.datei, grund: grund.message };
  }
}

export async function erzeugerFuer(github, quelle, { baum, ref, jetzt, repo, wurzel, erwartet }) {
  const treffer = [];
  for (const lauf of await kandidaten(github, quelle, { ref, jetzt, repo })) {
    if (baumVon(lauf.head_sha, wurzel) === baum) treffer.push(lauf);
  }
  if (treffer.length === 0) {
    return { workflow: quelle.workflow.datei, grund: "kein Lauf mit gleichem Baum gefunden" };
  }
  const ergebnisse = [];
  for (const lauf of treffer) {
    const geprueft = await pruefeLauf(github, lauf, { workflow: quelle.workflow, erwartet });
    if (geprueft.zeilen) return geprueft;
    ergebnisse.push(geprueft);
  }
  return ergebnisse[0];
}
