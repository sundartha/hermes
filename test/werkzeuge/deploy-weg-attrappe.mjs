import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { einstellungenLesen } from "../../tools/deploy-weg/einstellungen.mjs";
import { DEPLOY_TAKTE } from "../../tools/deploy-weg/takt.mjs";

const SHA_LAENGE = 40;
export const COMMIT_C = "c".repeat(SHA_LAENGE);
export const COMMIT_P = "a".repeat(SHA_LAENGE);
export const PR_KOPF = "b".repeat(SHA_LAENGE);
export const NEUERER = "d".repeat(SHA_LAENGE);
export const REPO = "sundartha/hermes";
export const DEPLOY_ID = "dep-probeneu";
export const ROLLBACK_ID = "dep-proberueck";
export const ALTER_DEPLOY = "dep-probealt";
export const RENDER_SCHLUESSEL = "rnd_probeschluessel_geheim";
export const DEPLOY_TOKEN = "d".repeat(SHA_LAENGE);
export const GITHUB_TOKEN = "ghs_probe_token";
export const SERVICE_ID = "srv-probe";
export const ACTIONS_APP = 15368;
export const HTTP_OK = 200;
export const HTTP_ANGELEGT = 201;
export const HTTP_ANGENOMMEN = 202;
export const KEINE_ANTWORT = 0;
export const HTTP_NICHT_ANGEMELDET = 401;
export const HTTP_NICHT_GEFUNDEN = 404;
export const HTTP_KONFLIKT = 409;
export const RENDER_SERVICE_PFAD = "/render/v1/services/" + SERVICE_ID;
export const DEPLOYS_PFAD = RENDER_SERVICE_PFAD + "/deploys";
export const KURZE_TAKTE = Object.freeze({ taktMs: 1000, schutzgrenzeMs: 5000 });
export const KURZE_DEPLOY_TAKTE = Object.freeze({
  ...DEPLOY_TAKTE,
  anrufe: KURZE_TAKTE,
  status: KURZE_TAKTE,
  healthz: KURZE_TAKTE,
});
const ANGELEGT = "angelegt";
const ZURUECKGEROLLT = "zurueckgerollt";
const JSON_TYP = "application/json";
const HTML_TYP = "text/html; charset=utf-8";
export const LADESEITE = Object.freeze([
  HTTP_OK,
  "<!doctype html><title>Service waking up</title><p>Loading</p>",
  HTML_TYP,
]);
export const HTML_MIT_COMMIT = Object.freeze([HTTP_OK, { ok: true, commit: COMMIT_P }, HTML_TYP]);
export const JSON_OHNE_COMMIT = Object.freeze([HTTP_OK, { ok: true }]);
const LIVE = "live";
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
    wach: [true],
    schlafAntwort: LADESEITE,
    healthzDauerMs: [0],
    merker: new Set(),
    staging: [COMMIT_C],
    mcpStatus: HTTP_NICHT_ANGEMELDET,
    laufend: [0],
    ausloesenStatus: HTTP_ANGELEGT,
    neuInListe: [true],
    deployStatus: ["build_in_progress", "update_in_progress", "live"],
    alteDeploys: [],
    deployListe: null,
    listeNachRollback: null,
    listeStatus: HTTP_OK,
    dienst: [{ autoDeploy: "no", autoDeployTrigger: "off" }],
    dienstStatus: [HTTP_OK],
    aendernStatus: HTTP_OK,
    rollbackStatus: HTTP_ANGELEGT,
    rollbackAntwort: { id: ROLLBACK_ID, trigger: "rollback", status: "created" },
    ereignisStatus: HTTP_OK,
    ereignisse: [],
    pausen: [false],
    pauseAntwort: null,
    pauseGelesen: null,
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

function gezeigteListe(welt) {
  const spaeter = welt.merker.has(ZURUECKGEROLLT) && welt.listeNachRollback !== null;
  return spaeter ? welt.listeNachRollback : welt.deployListe;
}

function deployListe(welt) {
  if (welt.deployListe !== null) {
    const liste = gezeigteListe(welt).map((deploy) => ({ cursor: deploy.id, deploy }));
    return [welt.listeStatus, liste];
  }
  const alte = welt.alteDeploys.map(deployEintrag);
  const sichtbar = welt.merker.has(ANGELEGT) && naechster(welt.neuInListe);
  return [HTTP_OK, sichtbar ? [deployEintrag(DEPLOY_ID), ...alte] : alte];
}

function dienstRouten(welt) {
  return [
    ["GET", /^$/, () => [naechster(welt.dienstStatus), naechster(welt.dienst)]],
    ["PATCH", /^$/, (_treffer, eintrag) => [welt.aendernStatus, eintrag.koerper]],
    [
      "POST",
      /^\/rollback$/,
      () => {
        welt.merker.add(ZURUECKGEROLLT);
        return [welt.rollbackStatus, welt.rollbackAntwort];
      },
    ],
    ["GET", /^\/events\?/, () => [welt.ereignisStatus, welt.ereignisse]],
  ];
}

function renderRouten(welt) {
  return [
    ...dienstRouten(welt),
    [
      "POST",
      /^\/deploys$/,
      () => {
        welt.merker.add(ANGELEGT);
        const angelegt = welt.ausloesenStatus === HTTP_ANGELEGT;
        return [welt.ausloesenStatus, angelegt ? deployEintrag(DEPLOY_ID).deploy : null];
      },
    ],
    ["GET", /^\/deploys\?limit=20$/, () => deployListe(welt)],
    [
      "GET",
      /^\/deploys\/([\w-]+)$/,
      ([, id]) => {
        const status = naechster(welt.deployStatus);
        if (status === LIVE) welt.merker.add(LIVE);
        return [HTTP_OK, { id, status }];
      },
    ],
    ["POST", /^\/deploys\/([\w-]+)\/cancel$/, ([, id]) => [HTTP_OK, { id, status: "canceled" }]],
  ];
}

function produktionCommit(welt) {
  return welt.merker.has(LIVE) ? welt.produktion.at(-1) : welt.produktion[0];
}

function produktionHealthz(welt, uhr) {
  return () => {
    uhr?.vorstellen(naechster(welt.healthzDauerMs));
    if (!naechster(welt.wach)) return welt.schlafAntwort;
    return [HTTP_OK, { ok: true, commit: produktionCommit(welt) }];
  };
}

function mitToken(antwort) {
  return (_treffer, eintrag) =>
    eintrag.kopf === "Bearer " + DEPLOY_TOKEN
      ? antwort(eintrag)
      : [HTTP_NICHT_ANGEMELDET, { error: "unauthorized" }];
}

function pauseSetzen(welt) {
  return mitToken((eintrag) => {
    welt.pausen.push(eintrag.koerper.an);
    return [HTTP_OK, { an: welt.pauseAntwort ?? welt.pausen.at(-1) }];
  });
}

function pauseLesen(welt) {
  return mitToken(() => [HTTP_OK, { an: welt.pauseGelesen ?? welt.pausen.at(-1) }]);
}

function anrufpauseRouten(welt) {
  return [
    ["GET", /^\/prod\/intern\/anrufpause$/, pauseLesen(welt)],
    ["POST", /^\/prod\/intern\/anrufpause$/, pauseSetzen(welt)],
  ];
}

function hermesRouten(welt, uhr) {
  return [
    ...anrufpauseRouten(welt),
    ["GET", /^\/prod\/healthz$/, produktionHealthz(welt, uhr)],
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
    ["POST", /^\/(?:staging|prod)\/mcp$/, () => [welt.mcpStatus, {}]],
  ];
}

function bereiche(welt, uhr) {
  return [
    ["/gh/repos/" + REPO, githubRouten(welt)],
    [RENDER_SERVICE_PFAD, renderRouten(welt)],
    ["", hermesRouten(welt, uhr)],
  ];
}

function beantworten(alleBereiche, eintrag) {
  for (const [praefix, routen] of alleBereiche) {
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

function koerperText(inhalt) {
  if (inhalt === null) return "";
  return typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt);
}

export async function attrappeStarten(kontext, welt, uhr = null) {
  const anfragen = [];
  const alleBereiche = bereiche(welt, uhr);
  const server = createServer(async (anfrage, antwort) => {
    const eintrag = {
      methode: anfrage.method,
      pfad: anfrage.url,
      kopf: anfrage.headers.authorization ?? "",
      koerper: await koerperLesen(anfrage),
      zeit: uhr === null ? null : uhr.jetzt(),
    };
    anfragen.push(eintrag);
    const [status, inhalt, typ = JSON_TYP] = beantworten(alleBereiche, eintrag);
    if (status === KEINE_ANTWORT) {
      antwort.destroy();
      return;
    }
    antwort.writeHead(status, { "content-type": typ });
    antwort.end(koerperText(inhalt));
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
    vorstellen: (ms) => {
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

export async function ohneAnfragenStarten(kontext, argumentListen) {
  const attrappe = await attrappeStarten(kontext, weltAnlegen());
  const laeufe = [];
  for (const argumente of argumentListen) {
    laeufe.push(await werkzeugStarten(argumente, umgebungFuer(attrappe.basis)));
  }
  return { attrappe, laeufe };
}

export async function entscheidenMit(kontext, optionen = {}) {
  const { entscheiden } = await import("../../tools/deploy-weg/entscheiden.mjs");
  const { welt = {}, ereignis = laufEreignis(), abdruck = abdruckAttrappe(), mehr = {} } = optionen;
  const uhr = testUhr();
  const attrappe = await attrappeStarten(kontext, weltAnlegen(welt), uhr);
  const einstellungen = einstellungenFuer("entscheiden", attrappe.basis, mehr);
  const { zeilen, ausgabe } = sammler();
  const vergleichen = abdruck.vergleichen;
  const ergebnis = await entscheiden({ einstellungen, ereignis, ausgabe, vergleichen, uhr });
  return { ergebnis, text: zeilen.join("\n"), attrappe, abdruck, uhr };
}
