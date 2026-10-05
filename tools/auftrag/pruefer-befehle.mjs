import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { stelleNach } from "./nachstellen.mjs";
import { gitAusgabe, zuPruefendeCommits } from "./pruefer-auswahl.mjs";
import { artefaktName, fruehereErgebnisse } from "./pruefer-gedaechtnis.mjs";
import { githubZugang } from "./pruefer-github.mjs";
import { CI_LAUF, PRUEFER_LAUF, ausloesenderLauf, stammtAus } from "./pruefer-herkunft.mjs";
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
  ["artefakt", ["head"]],
  ["pruefen", ["head", "pr-branch", "aus"]],
  ["nachstellen", ["ergebnis", "pr", "basis", "aus"]],
  ["entscheiden", ["ergebnis"]],
]);
const STOP_GRUENDE = new Set([LIMIT_GRUND, ANMELDUNG_GRUND, TOKEN_GRUND]);
const ISSUE_IM_TEXT = /\b(?:closes|fixes|resolves)\s+#(\d+)\b/i;
const PHASEN_BRANCH = /^phase\/(\d+)-/;
const MAX_DATEI_BYTES = 16_777_216;
const KURZ = 12;
const OFFEN_GRUND = "Lauf vorzeitig beendet";
const MERGE_GRUND = "Merge-Commit im PR, bitte rebasen";
const ZIEL_BRANCH = "master";
const ZWISCHENDATEI = ".ergebnis.json.neu";
const JSON_EINRUECKUNG = 2;
const ERFOLG = "success";
const FEHLER = "error";
const EXIT_HERKUNFT = 1;

function falscheHerkunft(herkunft) {
  console.error(
    `Der auslösende Lauf stammt nicht aus .github/workflows/${herkunft.datei} mit dem Ereignis ${herkunft.ereignis}; der Prüfer setzt keinen Status.`,
  );
  return EXIT_HERKUNFT;
}

export function leseDatei(ordner, name) {
  const datei = join(ordner ?? "", name);
  if (!ordner || !existsSync(datei)) return null;
  const info = lstatSync(datei);
  return info.isFile() && info.size <= MAX_DATEI_BYTES ? readFileSync(datei, "utf8") : null;
}

async function offenerPr(github, head) {
  const passend = (liste) =>
    liste.find(
      (pr) => pr.state === "open" && pr.head?.sha === head && pr.base?.ref === ZIEL_BRANCH,
    );
  const direkt = passend(await github.hole(`/commits/${head}/pulls`));
  const pr = direkt ?? passend(await github.alle("/pulls?state=open", (liste) => liste));
  if (!pr) throw new Error(`Kein offener PR nach ${ZIEL_BRANCH} mit dem Head-Commit ${head}.`);
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

async function gedaechtnis(github, pr, auswahl) {
  if (auswahl.probeBranch || auswahl.commits.length === 0) return new Map();
  try {
    return await fruehereErgebnisse({ github, pr });
  } catch (fehler) {
    console.log(`Frühere Ergebnisse nicht lesbar: ${fehler.message}`);
    return new Map();
  }
}

async function artefakt(optionen, root, { github = githubZugang() } = {}) {
  if (!(await stammtAus(github, ausloesenderLauf(), CI_LAUF))) return falscheHerkunft(CI_LAUF);
  const name = artefaktName((await offenerPr(github, optionen.head)).number);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `artefakt=${name}\n`);
  console.log(`Artefakt-Name: ${name}`);
  return 0;
}

function uebernommen(commit, bekannt) {
  return { ...bekannt, sha: commit.sha, kritisch: commit.kritisch, uebernommen: true };
}

function vorlaeufig(commit, frueher) {
  const bekannt = frueher.get(commit.patchId);
  return bekannt ? uebernommen(commit, bekannt) : nichtGelaufen(commit, OFFEN_GRUND);
}

async function einerVon(commit, { frueher, abbruch, kontext }) {
  if (commit.merge) return nichtGelaufen(commit, MERGE_GRUND);
  const bekannt = frueher.get(commit.patchId);
  if (bekannt) return uebernommen(commit, bekannt);
  if (abbruch) return nichtGelaufen(commit, abbruch);
  return pruefeCommit(commit, kontext);
}

function meldeCommit({ sha, zustand, grund, uebernommen: frueher, zaehler }) {
  const kosten = zaehler ? `, Tokens ${zaehler.tokens}, Züge ${zaehler.zuege}` : "";
  console.log(
    `Commit ${sha.slice(0, KURZ)}: ${frueher ? "übernommen" : zustand}${grund ? ` (${grund})` : ""}${kosten}`,
  );
}

async function pruefeAlle(commits, frueher, { kontext, schreibe }) {
  const ergebnisse = [];
  let abbruch = "";
  schreibe(ergebnisse);
  for (const commit of commits) {
    const eintrag = await einerVon(commit, { frueher, abbruch, kontext });
    ergebnisse.push(eintrag);
    meldeCommit(eintrag);
    schreibe(ergebnisse);
    if (!abbruch && STOP_GRUENDE.has(eintrag.grund)) abbruch = `${eintrag.grund}, nicht gestartet`;
  }
  return ergebnisse;
}

function schreibeErgebnis(aus, ergebnis) {
  mkdirSync(aus, { recursive: true });
  const zwischen = join(aus, ZWISCHENDATEI);
  writeFileSync(zwischen, `${JSON.stringify(ergebnis, null, JSON_EINRUECKUNG)}\n`);
  renameSync(zwischen, join(aus, ERGEBNIS_DATEI));
}

function meldeSumme(ergebnis) {
  const befunde = ergebnis.commits.flatMap((commit) => commit.befunde);
  const jeSchwere = SCHWEREN.map(
    (schwere) => `${schwere} ${befunde.filter((befund) => befund.schwere === schwere).length}`,
  );
  console.log(`Prüfer: ${ergebnis.commits.length} Commits; Befunde ${jeSchwere.join(", ")}.`);
}

async function pruefen(optionen, root, { github = githubZugang(), programm } = {}) {
  const token = env.CLAUDE_CODE_OAUTH_TOKEN ?? "";
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const ausloeser = ausloesenderLauf();
  if (!(await stammtAus(github, ausloeser, CI_LAUF))) return falscheHerkunft(CI_LAUF);
  const { head, "pr-branch": branch, "pr-repo": prRepo, aus } = optionen;
  const pr = await offenerPr(github, head);
  const basis = basisVon(pr, head, root);
  const auswahl = zuPruefendeCommits({ basis, head, branch, prRepo, root });
  const frueher = await gedaechtnis(github, pr.number, auswahl);
  const kontext = {
    root,
    token,
    programm,
    ciLauf: ausloeser.html_url ?? "",
    auftragstext: await auftragstext(github, pr, branch),
  };
  const kopf = {
    format: FORMAT,
    head,
    basis,
    branch,
    pr: pr.number,
    probeBranch: auswahl.probeBranch,
  };
  const offen = (fertig) =>
    auswahl.commits.slice(fertig.length).map((commit) => vorlaeufig(commit, frueher));
  const schreibe = (fertig) =>
    schreibeErgebnis(aus, { ...kopf, commits: [...fertig, ...offen(fertig)] });
  const commits = await pruefeAlle(auswahl.commits, frueher, { kontext, schreibe });
  meldeSumme({ ...kopf, commits });
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

function grundOhneStatus(optionen, ziel, ausloeser) {
  if (!optionen.nachstellung && ausloeser.conclusion !== ERFOLG)
    return "Der auslösende Lauf ist nicht grün";
  return ziel ? null : "Kein Head-Commit bekannt";
}

async function entscheiden(optionen, root, { github = githubZugang() } = {}) {
  const herkunft = optionen.nachstellung ? PRUEFER_LAUF : CI_LAUF;
  const ausloeser = ausloesenderLauf();
  if (!(await stammtAus(github, ausloeser, herkunft))) return falscheHerkunft(herkunft);
  const ergebnis = ergebnisAus(leseDatei(optionen.ergebnis, ERGEBNIS_DATEI) ?? "");
  const ziel = optionen.head ?? ergebnis?.head;
  const ohneStatus = grundOhneStatus(optionen, ziel, ausloeser);
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
  ["artefakt", artefakt],
  ["pruefen", pruefen],
  ["nachstellen", (optionen) => stelleNach(optionen)],
  ["entscheiden", entscheiden],
]);

export function pruefer(art, optionen, root) {
  const befehl = UNTERBEFEHLE.get(art);
  return befehl(optionen, root);
}

export { artefakt, pruefen, entscheiden };
