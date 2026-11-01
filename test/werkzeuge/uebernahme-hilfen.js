import { githubZugang } from "../../tools/auftrag/pruefer-github.mjs";
import { festhaltungsZeile, pruefsumme } from "../../tools/uebernahme/festhaltung.mjs";
import { scheinApi } from "./ausmisten/hilfen.mjs";
import { zipMitEinerDatei } from "./pruefer/zip.mjs";
import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

export const REPOSITORY = "sundartha/hermes";
export const JETZT = Date.parse("2026-11-01T12:00:00Z");
export const KENNUNG = { node: "v22.1.0", image: "ubuntu24-20261020.1" };
export const DATEI_A = "test/a.test.js";
export const DATEI_B = "test/werkzeuge/b.test.js";
const STUNDE_MS = 3_600_000;
const SCHEIN_TOKEN = "schein-token";
const ERSTE_NUMMER = 100;

export function zweiBaeume(context) {
  const ordner = probeRepository(context, { [DATEI_A]: "eins\n" });
  const lies = (ausdruck) => runIn(ordner, "git", ["rev-parse", ausdruck]).stdout.trim();
  const kopf = { sha: lies("HEAD"), baum: lies("HEAD^{tree}") };
  writeFiles(ordner, { [DATEI_A]: "zwei\n" });
  commitAll(ordner, "Zweiter Stand");
  return { ordner, kopf, anderer: { sha: lies("HEAD"), baum: lies("HEAD^{tree}") } };
}

export function berichtText(ergebnisse) {
  return ergebnisse
    .map(([datei, bestanden, zusatz = {}]) => `${JSON.stringify({ datei, bestanden, ...zusatz })}\n`)
    .join("");
}

function festhaltungsProtokoll(teil, { bericht, baum, kennung }) {
  const festhaltung = {
    name: teil.artefakt,
    summe: pruefsumme(bericht),
    baum,
    kennung,
    wackelig: 0,
    ...teil.festhaltung,
  };
  return teil.ohneFesthaltung ? "kein Protokoll\n" : `2026-11-01T11:00:00Z ${festhaltungsZeile(festhaltung)}\n`;
}

function teilRouten({ laufId, baum, teile, von, kennung }) {
  const routen = new Map();
  const jobs = [];
  const artefakte = [];
  teile.forEach((teil, index) => {
    const nummer = index + 1;
    const jobId = laufId * ERSTE_NUMMER + nummer;
    const artefaktId = laufId * ERSTE_NUMMER * ERSTE_NUMMER + nummer;
    const bericht = berichtText(teil.dateien);
    const abgelegt = teil.manipuliert ? berichtText([[DATEI_A, true], ["test/fremd.test.js", true]]) : bericht;
    jobs.push({ id: jobId, name: `${teil.jobName} ${nummer}/${von}`, conclusion: teil.conclusion ?? "success" });
    artefakte.push({ id: artefaktId, name: teil.artefakt });
    routen.set(`GET /repos/${REPOSITORY}/actions/jobs/${jobId}/logs`, Buffer.from(festhaltungsProtokoll(teil, { bericht, baum, kennung })));
    routen.set(`GET /repos/${REPOSITORY}/actions/artifacts/${artefaktId}/zip`, zipMitEinerDatei(teil.berichtDatei, abgelegt));
  });
  routen.set(`GET /repos/${REPOSITORY}/actions/runs/${laufId}/jobs`, { total_count: jobs.length, jobs });
  routen.set(`GET /repos/${REPOSITORY}/actions/runs/${laufId}/artifacts`, { total_count: artefakte.length, artifacts: artefakte });
  return routen;
}

export function erzeugerLauf({ id, workflow, ereignis, kopf, teile, lauf = {}, baum = kopf.baum, kennung = KENNUNG }) {
  const von = teile.length;
  return {
    lauf: {
      id,
      path: `.github/workflows/${workflow}`,
      event: ereignis,
      head_branch: ereignis === "merge_group" ? "gh-readonly-queue/master/pr-5-abc" : "paket/x",
      head_sha: kopf.sha,
      head_repository: { full_name: REPOSITORY },
      repository: { full_name: REPOSITORY },
      created_at: new Date(JETZT - STUNDE_MS).toISOString(),
      html_url: `https://github.example/runs/${id}`,
      pull_requests: ereignis === "pull_request" ? [{ number: 5 }] : [],
      ...lauf,
    },
    routen: teilRouten({ laufId: id, baum, teile, von, kennung }),
  };
}

export function laufListe(workflow, laeufe) {
  return new Map([[`GET /repos/${REPOSITORY}/actions/workflows/${workflow}/runs`, { workflow_runs: laeufe }]]);
}

export function pullRequestRoute(nummer = 5) {
  return new Map([[`GET /repos/${REPOSITORY}/pulls/${nummer}`, { head: { ref: "paket/x", sha: "0".repeat(40) } }]]);
}

export function vereint(...tabellen) {
  return new Map(tabellen.flatMap((tabelle) => [...tabelle]));
}

export async function schein(context, routen) {
  const { url, anfragen } = await scheinApi(context, routen);
  const github = githubZugang({ api: url, token: SCHEIN_TOKEN, repo: REPOSITORY });
  return { github, url, anfragen };
}
