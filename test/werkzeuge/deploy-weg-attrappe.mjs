import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { einstellungenLesen } from "../../tools/deploy-weg/einstellungen.mjs";

const SHA_LAENGE = 40;
export const COMMIT_C = "c".repeat(SHA_LAENGE);
export const COMMIT_P = "a".repeat(SHA_LAENGE);
export const PR_KOPF = "b".repeat(SHA_LAENGE);
export const NEUERER = "d".repeat(SHA_LAENGE);
export const REPO = "sundartha/hermes";
export const DEPLOY_ID = "dep-probeneu";
export const ALTER_DEPLOY = "dep-probealt";
export const RENDER_SCHLUESSEL = "rnd_probeschluessel_geheim";
export const DEPLOY_TOKEN = "d".repeat(SHA_LAENGE);
export const GITHUB_TOKEN = "ghs_probe_token";
export const SERVICE_ID = "srv-probe";
export const ACTIONS_APP = 15368;
export const HTTP_OK = 200;
export const HTTP_ANGELEGT = 201;
export const HTTP_ANGENOMMEN = 202;
export const HTTP_NICHT_ANGEMELDET = 401;
export const HTTP_NICHT_GEFUNDEN = 404;
export const HTTP_KONFLIKT = 409;
const RENDER_SERVICE_PFAD = "/render/v1/services/" + SERVICE_ID;
export const DEPLOYS_PFAD = RENDER_SERVICE_PFAD + "/deploys";
export const KURZE_TAKTE = Object.freeze({ taktMs: 1000, schutzgrenzeMs: 5000 });
export const KURZE_DEPLOY_TAKTE = Object.freeze({
  anrufe: KURZE_TAKTE,
  status: KURZE_TAKTE,
  healthz: KURZE_TAKTE,
});
const ANGELEGT = "angelegt";
const LOKAL = "127.0.0.1";
const PR_NUMMER = 7;
const NEUES_ISSUE = 99;
const WERKZEUG = fileURLToPath(new URL("../../tools/deploy-weg.mjs", import.meta.url));
const MASTER = "master";

function stagingLauf(commit) {
  return {
    head_sha: commit,
    conclusion: "success",
    event: "push",
    head_branch: MASTER,
    head_repository: { full_name: REPO },
    repository: { full_name: REPO },
  };
}

export function weltAnlegen(abweichung = {}) {
  return {
    produktion: [COMMIT_P],
    merker: new Set(),
    staging: [COMMIT_C],
    mcpStatus: HTTP_NICHT_ANGEMELDET,
    laufend: [0],
    ausloesenStatus: HTTP_ANGELEGT,
    deployStatus: ["build_in_progress", "update_in_progress", "live"],
    alteDeploys: [],
    vergleiche: {},
    pulls: [
      {
        number: PR_NUMMER,
        merged_at: "2026-10-01T10:00:00Z",
        merge_commit_sha: COMMIT_C,
        head: { sha: PR_KOPF },
        base: { ref: MASTER, repo: { full_name: REPO } },
      },
    ],
    regeln: [
      { type: "pull_request", parameters: {} },
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [
            { context: "CI", integration_id: ACTIONS_APP },
            { context: "Freigabe-Prüfung", integration_id: ACTIONS_APP },
          ],
        },
      },
    ],
    checks: [
      { name: "CI", app: { id: ACTIONS_APP }, conclusion: "success" },
      { name: "Freigabe-Prüfung", app: { id: ACTIONS_APP }, conclusion: "success" },
    ],
    stagingLaeufe: [stagingLauf(COMMIT_C)],
    issues: [],
    ...abweichung,
  };
}

function naechster(folge) {
  return folge.length > 1 ? folge.shift() : folge[0];
}

function vergleichsWort(welt, basis, kopf) {
  const eintrag = welt.vergleiche[basis + "..." + kopf];
  if (eintrag !== undefined) return eintrag;
  if (basis === kopf) return "identical";
  if (basis === MASTER) return "behind";
  return basis === COMMIT_P || kopf === NEUERER ? "ahead" : "behind";
}

function vergleichAntwort(welt) {
  return ([, basis, kopf]) => [HTTP_OK, { status: vergleichsWort(welt, basis, kopf) }];
}

function githubRouten(welt) {
  return [
    ["GET", /^\/compare\/(\w+)\.\.\.(\w+)$/, vergleichAntwort(welt)],
    ["GET", /^\/commits\/\w+\/pulls\?/, () => [HTTP_OK, welt.pulls]],
    ["GET", /^\/rules\/branches\/master$/, () => [welt.regelnStatus ?? HTTP_OK, welt.regeln]],
    [
      "GET",
      /^\/commits\/\w+\/check-runs\?(.*)$/,
      ([, query]) => {
        const name = new URLSearchParams(query).get("check_name");
        return [HTTP_OK, { check_runs: welt.checks.filter((lauf) => lauf.name === name) }];
      },
    ],
    [
      "GET",
      /^\/actions\/workflows\/staging\.yml\/runs\?/,
      () => [HTTP_OK, { workflow_runs: welt.stagingLaeufe }],
    ],
    ["GET", /^\/issues\?/, () => [welt.issuesStatus ?? HTTP_OK, welt.issues]],
    ["PATCH", /^\/issues\/(\d+)$/, ([, nummer]) => [HTTP_OK, { number: Number(nummer) }]],
    ["POST", /^\/issues$/, () => [HTTP_ANGELEGT, { number: NEUES_ISSUE }]],
  ];
}

function deployEintrag(id) {
  return { cursor: id, deploy: { id, commit: { id: COMMIT_C }, trigger: "api", status: "queued" } };
}

function renderRouten(welt) {
  return [
    [
      "POST",
      /^\/deploys$/,
      () => {
        welt.merker.add(ANGELEGT);
        const angelegt = welt.ausloesenStatus === HTTP_ANGELEGT;
        return [welt.ausloesenStatus, angelegt ? deployEintrag(DEPLOY_ID).deploy : null];
      },
    ],
    [
      "GET",
      /^\/deploys\?limit=20$/,
      () => {
        const alte = welt.alteDeploys.map(deployEintrag);
        return [HTTP_OK, welt.merker.has(ANGELEGT) ? [deployEintrag(DEPLOY_ID), ...alte] : alte];
      },
    ],
    [
      "GET",
      /^\/deploys\/([\w-]+)$/,
      ([, id]) => [HTTP_OK, { id, status: naechster(welt.deployStatus) }],
    ],
    ["POST", /^\/deploys\/([\w-]+)\/cancel$/, ([, id]) => [HTTP_OK, { id, status: "canceled" }]],
  ];
}

function hermesRouten(welt) {
  return [
    ["GET", /^\/prod\/healthz$/, () => [HTTP_OK, { ok: true, commit: naechster(welt.produktion) }]],
    [
      "GET",
      /^\/prod\/intern\/anrufe-laufend$/,
      (_treffer, eintrag) =>
        eintrag.kopf === "Bearer " + DEPLOY_TOKEN
          ? [HTTP_OK, { laufend: naechster(welt.laufend) }]
          : [HTTP_NICHT_ANGEMELDET, {}],
    ],
    [
      "GET",
      /^\/staging\/healthz$/,
      () => [HTTP_OK, { ok: true, commit: naechster(welt.staging) }],
    ],
    ["POST", /^\/staging\/mcp$/, () => [welt.mcpStatus, {}]],
  ];
}

function bereiche(welt) {
  return [
    ["/gh/repos/" + REPO, githubRouten(welt)],
    [RENDER_SERVICE_PFAD, renderRouten(welt)],
    ["", hermesRouten(welt)],
  ];
}

function beantworten(welt, eintrag) {
  for (const [praefix, routen] of bereiche(welt)) {
    if (!eintrag.pfad.startsWith(praefix)) continue;
    const rest = praefix === "" ? eintrag.pfad : eintrag.pfad.slice(praefix.length);
    for (const [methode, muster, antwort] of routen) {
      const treffer = muster.exec(rest);
      if (methode === eintrag.methode && treffer !== null) return antwort(treffer, eintrag);
    }
  }
  return [HTTP_NICHT_GEFUNDEN, {}];
}

async function koerperLesen(anfrage) {
  let roh = "";
  for await (const stueck of anfrage) roh += stueck;
  return roh === "" ? null : JSON.parse(roh);
}

export async function attrappeStarten(kontext, welt) {
  const anfragen = [];
  const server = createServer(async (anfrage, antwort) => {
    const eintrag = {
      methode: anfrage.method,
      pfad: anfrage.url,
      kopf: anfrage.headers.authorization ?? "",
      koerper: await koerperLesen(anfrage),
    };
    anfragen.push(eintrag);
    const [status, inhalt] = beantworten(welt, eintrag);
    antwort.writeHead(status, { "content-type": "application/json" });
    antwort.end(inhalt === null ? "" : JSON.stringify(inhalt));
  });
  server.listen(0, LOKAL);
  await once(server, "listening");
  kontext.after(() => server.close());
  return { basis: "http://" + LOKAL + ":" + server.address().port, anfragen, welt };
}

export function umgebungFuer(basis, mehr = {}) {
  return {
    GITHUB_TOKEN,
    GITHUB_REPOSITORY: REPO,
    GITHUB_API_URL: basis + "/gh",
    GITHUB_SERVER_URL: basis + "/server",
    GITHUB_RUN_ID: "4711",
    GITHUB_EVENT_NAME: "workflow_run",
    GITHUB_EVENT_PATH: "/nicht-gelesen.json",
    GITHUB_ACTOR: "",
    GITHUB_TRIGGERING_ACTOR: "",
    GITHUB_REF: "",
    GITHUB_OUTPUT: "",
    STAGING_URL: basis + "/staging",
    PRODUKTION_URL: basis + "/prod",
    ABSICHTLICH_ROT: "",
    RENDER_API_KEY: RENDER_SCHLUESSEL,
    RENDER_API_URL: basis + "/render/v1",
    RENDER_SERVICE_ID: SERVICE_ID,
    HERMES_DEPLOY_TOKEN: DEPLOY_TOKEN,
    ...mehr,
  };
}

export function sammler() {
  const zeilen = [];
  return { zeilen, ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)) };
}

export function einstellungenFuer(befehl, basis, mehr) {
  return einstellungenLesen(befehl, umgebungFuer(basis, mehr), sammler().ausgabe);
}

export function testUhr() {
  const stand = { ms: 0 };
  const wartezeiten = [];
  return {
    wartezeiten,
    jetzt: () => stand.ms,
    warten: async (ms) => {
      wartezeiten.push(ms);
      stand.ms += ms;
    },
  };
}

export function anfragenAn(attrappe, methode, muster) {
  return attrappe.anfragen.filter(
    (eintrag) => eintrag.methode === methode && muster.test(eintrag.pfad),
  );
}

export function laufEreignis(abweichung = {}) {
  const lauf = { ...stagingLauf(COMMIT_C), ...abweichung };
  return { name: "workflow_run", nutzlast: { workflow_run: lauf } };
}

export function handEreignis({ login = "Antonio20045", ref = "refs/heads/master" } = {}) {
  return {
    name: "workflow_dispatch",
    nutzlast: {
      ref,
      inputs: { commit: COMMIT_C },
      sender: { login },
      repository: { full_name: REPO },
    },
  };
}

export function abdruckAttrappe(ergebnis = { geaendert: false, teile: [] }) {
  const aufrufe = [];
  const vergleichen = async (rahmen) => {
    aufrufe.push(rahmen);
    if (ergebnis instanceof Error) throw ergebnis;
    return ergebnis;
  };
  return { aufrufe, vergleichen };
}

export function temporaerOrdner(kontext) {
  const ordner = mkdtempSync(join(tmpdir(), "deploy-weg-"));
  kontext.after(() => rmSync(ordner, { recursive: true, force: true }));
  return ordner;
}

export async function werkzeugStarten(argumente, umgebung) {
  const kind = spawn(process.execPath, [WERKZEUG, ...argumente], {
    env: { PATH: process.env.PATH ?? "", ...umgebung },
  });
  let ausgabe = "";
  kind.stdout.on("data", (teil) => (ausgabe += teil));
  kind.stderr.on("data", (teil) => (ausgabe += teil));
  const [status] = await once(kind, "close");
  return { status, ausgabe };
}

export async function entscheidenMit(kontext, optionen = {}) {
  const { entscheiden } = await import("../../tools/deploy-weg/entscheiden.mjs");
  const { welt = {}, ereignis = laufEreignis(), abdruck = abdruckAttrappe(), mehr = {} } = optionen;
  const attrappe = await attrappeStarten(kontext, weltAnlegen(welt));
  const einstellungen = einstellungenFuer("entscheiden", attrappe.basis, mehr);
  const { zeilen, ausgabe } = sammler();
  const vergleichen = abdruck.vergleichen;
  const ergebnis = await entscheiden({ einstellungen, ereignis, ausgabe, vergleichen });
  return { ergebnis, text: zeilen.join("\n"), attrappe, abdruck };
}
