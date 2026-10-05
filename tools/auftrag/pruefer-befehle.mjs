import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { stelleNach } from "./nachstellen.mjs";
import { gitAusgabe, zuPruefendeCommits } from "./pruefer-auswahl.mjs";
import { fruehereErgebnisse } from "./pruefer-gedaechtnis.mjs";
import { githubZugang } from "./pruefer-github.mjs";
import { legeIssuesAn } from "./pruefer-issues.mjs";
import {
  ANMELDUNG_GRUND,
  LIMIT_GRUND,
  TOKEN_GRUND,
  nichtGelaufen,
  pruefeCommit,
} from "./pruefer-lauf.mjs";
import {
  ERGEBNIS_DATEI,
  FORMAT,
  NACHSTELLUNG_DATEI,
  SCHWEREN,
  ergebnisAus,
  nachstellungAus,
  reproduzierbareBlocker,
} from "./pruefer-schema.mjs";
import { KONTEXT, urteile } from "./pruefer-urteil.mjs";

export const PRUEFER_OPTIONEN = new Map([
  ["pruefen", ["head", "pr-branch", "aus"]],
  ["nachstellen", ["ergebnis", "pr", "basis", "aus"]],
  ["entscheiden", ["ergebnis"]],
]);
const STOP_GRUENDE = new Set([LIMIT_GRUND, ANMELDUNG_GRUND, TOKEN_GRUND]);
const ISSUE_IM_TEXT = /\b(?:closes|fixes|resolves)\s+#(\d+)\b/i;
const PHASEN_BRANCH = /^phase\/(\d+)-/;
const MAX_DATEI_BYTES = 16_777_216;
const KURZ = 12;
const JSON_EINRUECKUNG = 2;
const ERFOLG = "success";
const FEHLER = "error";

function ereignisDaten() {
  try {
    return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8"));
  } catch {
    return null;
  }
}

export function leseDatei(ordner, name) {
  const datei = join(ordner ?? "", name);
  if (!ordner || !existsSync(datei)) return null;
  const info = lstatSync(datei);
  return info.isFile() && info.size <= MAX_DATEI_BYTES ? readFileSync(datei, "utf8") : null;
}

async function offenerPr(github, head) {
  const passend = (liste) => liste.find((pr) => pr.state === "open" && pr.head?.sha === head);
  const direkt = passend(await github.hole(`/commits/${head}/pulls`));
  const pr = direkt ?? passend(await github.alle("/pulls?state=open", (liste) => liste));
  if (!pr) throw new Error(`Kein offener PR mit dem Head-Commit ${head}.`);
  return pr;
}

function basisVon(pr, head, root) {
  for (const kandidat of [pr.base.sha, `origin/${pr.base.ref}`, "HEAD"]) {
    try {
      return gitAusgabe(["merge-base", kandidat, head], root).trim();
    } catch {
      continue;
    }
  }
  throw new Error(`Keine gemeinsame Basis für ${head} gefunden.`);
}

async function auftragstext(github, pr, branch) {
  const nummer = ISSUE_IM_TEXT.exec(pr.body ?? "")?.[1] ?? PHASEN_BRANCH.exec(branch)?.[1];
  if (nummer === undefined) return "";
  try {
    const issue = await github.hole(`/issues/${nummer}`);
    return `Issue #${nummer}: ${issue.title}\n\n${issue.body ?? ""}`;
  } catch {
    return "";
  }
}

async function gedaechtnis(github, branch) {
  try {
    return await fruehereErgebnisse({ github, branch, laufId: Number(env.GITHUB_RUN_ID) });
  } catch (fehler) {
    console.log(`Frühere Ergebnisse nicht lesbar: ${fehler.message}`);
    return new Map();
  }
}

async function pruefeAlle(commits, frueher, kontext) {
  const ergebnisse = [];
  let abbruch = "";
  for (const commit of commits) {
    const bekannt = frueher.get(commit.patchId);
    if (bekannt)
      ergebnisse.push({
        ...bekannt,
        sha: commit.sha,
        kritisch: commit.kritisch,
        uebernommen: true,
      });
    else if (abbruch) ergebnisse.push(nichtGelaufen(commit, abbruch));
    else ergebnisse.push(await pruefeCommit(commit, kontext));
    const grund = ergebnisse.at(-1).grund;
    if (!abbruch && STOP_GRUENDE.has(grund)) abbruch = `${grund}, nicht gestartet`;
  }
  return ergebnisse;
}

function melde(ergebnis) {
  const befunde = ergebnis.commits.flatMap((commit) => commit.befunde);
  const jeSchwere = SCHWEREN.map(
    (schwere) => `${schwere} ${befunde.filter((befund) => befund.schwere === schwere).length}`,
  );
  for (const { sha, zustand, grund, uebernommen, zaehler } of ergebnis.commits) {
    const kosten = zaehler ? `, Tokens ${zaehler.tokens}, Züge ${zaehler.zuege}` : "";
    console.log(
      `Commit ${sha.slice(0, KURZ)}: ${uebernommen ? "übernommen" : zustand}${grund ? ` (${grund})` : ""}${kosten}`,
    );
  }
  console.log(
    `Prüfer: ${ergebnis.commits.length} Commits, ${ergebnis.weggelassen.length} eigene Paket-Commits weggelassen; Befunde ${jeSchwere.join(", ")}.`,
  );
}

async function pruefen(optionen, root, { github = githubZugang(), programm } = {}) {
  const token = env.CLAUDE_CODE_OAUTH_TOKEN ?? "";
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const { head, "pr-branch": branch, aus } = optionen;
  const pr = await offenerPr(github, head);
  const basis = basisVon(pr, head, root);
  const auswahl = zuPruefendeCommits({ basis, head, branch, root });
  const frueher = auswahl.probeBranch ? new Map() : await gedaechtnis(github, branch);
  const ciLauf = ereignisDaten()?.workflow_run?.html_url ?? "";
  const kontext = {
    root,
    token,
    programm,
    ciLauf,
    auftragstext: await auftragstext(github, pr, branch),
  };
  const commits = await pruefeAlle(auswahl.commits, frueher, kontext);
  const ergebnis = {
    format: FORMAT,
    head,
    basis,
    branch,
    pr: pr.number,
    probeBranch: auswahl.probeBranch,
    weggelassen: auswahl.weggelassen,
    commits,
  };
  mkdirSync(aus, { recursive: true });
  writeFileSync(join(aus, ERGEBNIS_DATEI), `${JSON.stringify(ergebnis, null, JSON_EINRUECKUNG)}\n`);
  melde(ergebnis);
  return 0;
}

function urteilFuer(ergebnis, { head, nachstellung }) {
  if (ergebnis === null)
    return { state: FEHLER, description: "Prüfer nicht gelaufen: kein Ergebnis", issues: [] };
  if (head && ergebnis.head !== head) {
    return {
      state: FEHLER,
      description: "Prüfer nicht gelaufen: Ergebnis gehört zu einem anderen Commit",
      issues: [],
    };
  }
  if (!nachstellung) return urteile({ ...ergebnis, nachstellung: null });
  const erlaubt = new Set(reproduzierbareBlocker(ergebnis).map(({ schluessel }) => schluessel));
  return urteile({
    ...ergebnis,
    nachstellung: nachstellungAus(leseDatei(nachstellung, NACHSTELLUNG_DATEI) ?? "", erlaubt),
  });
}

function laufAdresse() {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: lauf } = env;
  return server && repo && lauf ? `${server}/${repo}/actions/runs/${lauf}` : undefined;
}

function grundOhneStatus(optionen, ziel) {
  const ausloeser = ereignisDaten()?.workflow_run;
  if (!optionen.nachstellung && ausloeser && ausloeser.conclusion !== ERFOLG)
    return "Der auslösende Lauf ist nicht grün";
  return ziel ? null : "Kein Head-Commit bekannt";
}

async function entscheiden(optionen, root, { github = githubZugang() } = {}) {
  const ergebnis = ergebnisAus(leseDatei(optionen.ergebnis, ERGEBNIS_DATEI) ?? "");
  const ziel = optionen.head ?? ergebnis?.head;
  const ohneStatus = grundOhneStatus(optionen, ziel);
  if (ohneStatus) {
    console.log(`${ohneStatus}; der Prüfer setzt keinen Status.`);
    return 0;
  }
  const urteil = urteilFuer(ergebnis, optionen);
  const status = {
    state: urteil.state,
    context: KONTEXT,
    description: urteil.description,
    target_url: laufAdresse(),
  };
  await github.sende("POST", `/statuses/${ziel}`, status);
  const issues = await legeIssuesAn(urteil.issues, github);
  console.log(
    `Prüfer: ${urteil.state} (${urteil.description}); Issues neu ${issues.neu}, schon offen ${issues.vorhanden}.`,
  );
  return 0;
}

const UNTERBEFEHLE = new Map([
  ["pruefen", pruefen],
  ["nachstellen", (optionen) => stelleNach(optionen)],
  ["entscheiden", entscheiden],
]);

export function pruefer(art, optionen, root) {
  const befehl = UNTERBEFEHLE.get(art);
  return befehl(optionen, root);
}

export { pruefen, entscheiden };
