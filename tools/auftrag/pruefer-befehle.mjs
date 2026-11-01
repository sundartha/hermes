import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { env } from "node:process";

import { istIssue } from "../ziele/github.mjs";
import { stelleNach } from "./nachstellen.mjs";
import { abbruchOhneAbsicht, absichtFuerPr, vorgabenFuerPr } from "./pruefer-absicht.mjs";
import { gitAusgabe, istEigenesRepo, zuPruefendeCommits } from "./pruefer-auswahl.mjs";
import { artefaktName, bekanntesErgebnis, fruehereErgebnisse } from "./pruefer-gedaechtnis.mjs";
import { githubZugang } from "./pruefer-github.mjs";
import { AUSLOESER_LAUF, PRUEFER_LAUF, abschlussPruefbar, ausloesenderLauf, stammtAus } from "./pruefer-herkunft.mjs";
import { issueTitel, legeIssuesAn } from "./pruefer-issues.mjs";
import {
  ANMELDUNG_GRUND,
  LIMIT_GRUND,
  TOKEN_GRUND,
  nichtGelaufen,
  pruefeCommit,
} from "./pruefer-lauf.mjs";
import {
  ABLAGE_DATEI,
  BLOCKER,
  ERGEBNIS_DATEI,
  FORMAT,
  GEPRUEFT,
  NACHSTELLUNG_DATEI,
  SCHWEREN,
  ablageAus,
  ergebnisAus,
  nachstellungAus,
  reproduzierbareBlocker,
} from "./pruefer-schema.mjs";
import { belegeUmgehungen } from "./pruefer-umgehung.mjs";
import { KONTEXT, urteileMitZweck } from "./pruefer-urteil.mjs";
import { PRUEFER_ZWECK, statusZweck, zweckZeilen } from "./pruefer-zweck.mjs";

export const PRUEFER_OPTIONEN = new Map([
  ["artefakt", ["head"]],
  ["pruefen", ["head", "pr-branch", "aus"]],
  ["nachstellen", ["ergebnis", "pr", "basis", "aus"]],
  ["entscheiden", ["ergebnis"]],
  ["ablegen", ["ablage", "repo"]],
]);
const ABLAGE_GRUND = "Sicherheitsbezug, nicht öffentlich";
const ABLAGE_TITEL = "Sicherheit: ";
const ABLAGE_TITEL_BLOCKER = `Sicherheit ${BLOCKER}: `;
const STOP_GRUENDE = new Set([LIMIT_GRUND, ANMELDUNG_GRUND, TOKEN_GRUND]);
const ISSUE_IM_TEXT = /\b(?:closes|fixes|resolves)\s+#(\d+)\b/i;
const PHASEN_BRANCH = /^phase\/(\d+)-/;
const MAX_DATEI_BYTES = 16_777_216;
const JOB_GRENZE_MS = 21_600_000;
const RESERVE_MS = 1_800_000;
const KURZ = 12;
const OFFEN_GRUND = "Lauf vorzeitig beendet";
const MERGE_GRUND = "Merge-Commit im PR, bitte rebasen";
const ZIEL_BRANCH = "master";
const ZWISCHENDATEI = ".ergebnis.json.neu";
const JSON_EINRUECKUNG = 2;
const FEHLER = "error";
const EXIT_HERKUNFT = 1;
const EXIT_BEFUNDE = 1;
const EXIT_NICHT_GELAUFEN = 3;
const NUR_LOKAL =
  "Lokaler Vorab-Lauf: kein Prüfer-Ergebnis, kein Status, kein Issue, kein Merge-Signal. Maßgeblich bleibt der Prüfer auf GitHub.";

function falscheHerkunft(herkunft) {
  console.error(
    `Der auslösende Lauf stammt nicht aus .github/workflows/${herkunft.datei} mit dem Ereignis ${herkunft.ereignis}; der Prüfer setzt keinen Status.`,
  );
  return EXIT_HERKUNFT;
}

function unpruefbarerAbschluss(ausloeser) {
  console.error(
    `Der auslösende Lauf endete mit ${ausloeser?.conclusion ?? "keinem Ergebnis"}; der Prüfer startet nur nach success oder failure und setzt keinen Status.`,
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

async function issueZumPr(github, pr, branch) {
  const nummer = ISSUE_IM_TEXT.exec(pr.body ?? "")?.[1] ?? PHASEN_BRANCH.exec(branch)?.[1];
  if (nummer === undefined) return null;
  try {
    const eintrag = await github.hole(`/issues/${nummer}`);
    if (!istIssue(eintrag)) return { nummer, title: "", body: null };
    return { nummer, title: eintrag.title, body: eintrag.body ?? "" };
  } catch {
    return { nummer, title: "", body: null };
  }
}

function auftragstext(issue) {
  return issue?.body == null ? "" : `Issue #${issue.nummer}: ${issue.title}\n\n${issue.body}`;
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
  const ausloeser = ausloesenderLauf();
  if (!(await stammtAus(github, ausloeser, AUSLOESER_LAUF))) return falscheHerkunft(AUSLOESER_LAUF);
  if (!abschlussPruefbar(ausloeser)) return unpruefbarerAbschluss(ausloeser);
  const name = artefaktName((await offenerPr(github, optionen.head)).number);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `artefakt=${name}\n`);
  console.log(`Artefakt-Name: ${name}`);
  return 0;
}

export function jobRestzeit({ start = performance.timeOrigin, jetzt = Date.now } = {}) {
  const ende = start + JOB_GRENZE_MS - RESERVE_MS;
  return () => ende - jetzt();
}

function uebernommen(commit, bekannt) {
  const { sha, kritisch, letzter } = commit;
  return { ...bekannt, sha, kritisch, letzter, uebernommen: true };
}

function vorlaeufig(commit, frueher) {
  const bekannt = bekanntesErgebnis(frueher, commit);
  return bekannt ? uebernommen(commit, bekannt) : nichtGelaufen(commit, OFFEN_GRUND);
}

async function einerVon(commit, { frueher, abbruch, kontext }) {
  if (commit.merge) return nichtGelaufen(commit, MERGE_GRUND);
  const bekannt = bekanntesErgebnis(frueher, commit);
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
  const ablage = [];
  let abbruch = abbruchOhneAbsicht(kontext.absicht);
  schreibe(ergebnisse);
  for (const commit of commits) {
    const { ablage: hinweise = [], ...eintrag } = await einerVon(commit, { frueher, abbruch, kontext });
    ablage.push(...hinweise.map((befund) => ({ sha: eintrag.sha, befund })));
    ergebnisse.push(eintrag);
    meldeCommit(eintrag);
    schreibe(ergebnisse);
    if (!abbruch && STOP_GRUENDE.has(eintrag.grund)) abbruch = `${eintrag.grund}, nicht gestartet`;
  }
  return { ergebnisse, ablage };
}

function legeAblageBereit({ ablage: ordner }, hinweise) {
  if (env.GITHUB_OUTPUT && hinweise.length > 0) appendFileSync(env.GITHUB_OUTPUT, `hinweise=${hinweise.length}\n`);
  if (!ordner) {
    console.log(`Sicherheitshinweise ohne Ablage: ${hinweise.length}.`);
    return;
  }
  mkdirSync(ordner, { recursive: true });
  const inhalt = { format: FORMAT, hinweise };
  writeFileSync(join(ordner, ABLAGE_DATEI), `${JSON.stringify(inhalt)}\n`);
  console.log(`Sicherheitshinweise für die Ablage: ${hinweise.length}.`);
}

function ablageImArtefakt({ ablage, aus }) {
  if (!ablage) return false;
  const abstand = relative(resolve(aus), resolve(ablage));
  return abstand !== ".." && !abstand.startsWith(`..${sep}`) && !isAbsolute(abstand);
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

function nimmToken() {
  const token = env.CLAUDE_CODE_OAUTH_TOKEN ?? "";
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return token;
}

function mitLetztem(commits) {
  return commits.map((commit, index) => ({ ...commit, letzter: index === commits.length - 1 }));
}

async function pruefeUndLege(optionen, { auswahl, frueher, kontext, kopf }) {
  const alle = mitLetztem(auswahl.commits);
  const offen = (fertig) => alle.slice(fertig.length).map((commit) => vorlaeufig(commit, frueher));
  const schreibe = (fertig) =>
    schreibeErgebnis(optionen.aus, { ...kopf, commits: [...fertig, ...offen(fertig)] });
  const mitPr = { ...kontext, aus: optionen.aus, basis: kopf.basis, commits: alle, restzeit: jobRestzeit() };
  const { ergebnisse, ablage } = await pruefeAlle(alle, frueher, { kontext: mitPr, schreibe });
  const commits = belegeUmgehungen(ergebnisse, {
    root: kontext.root,
    basis: kopf.basis,
    head: kopf.head,
    auftragstext: kontext.auftragstext,
    nachrichten: alle.map(({ nachricht }) => nachricht),
  });
  schreibeErgebnis(optionen.aus, { ...kopf, commits });
  legeAblageBereit(optionen, ablage);
  meldeSumme({ ...kopf, commits });
  return commits;
}

async function pruefen(optionen, root, { github = githubZugang(), programm } = {}) {
  const token = nimmToken();
  const ausloeser = ausloesenderLauf();
  if (!(await stammtAus(github, ausloeser, AUSLOESER_LAUF))) return falscheHerkunft(AUSLOESER_LAUF);
  if (!abschlussPruefbar(ausloeser)) return unpruefbarerAbschluss(ausloeser);
  const { head, "pr-branch": branch, "pr-repo": prRepo } = optionen;
  if (ablageImArtefakt(optionen)) throw new Error("Die Ablage darf nicht im Ordner --aus liegen, der hochgeladen wird.");
  const pr = await offenerPr(github, head);
  const basis = basisVon(pr, head, root);
  const auswahl = zuPruefendeCommits({ basis, head, branch, prRepo, root });
  const frueher = await gedaechtnis(github, pr.number, auswahl);
  const issue = await issueZumPr(github, pr, branch);
  const fork = Boolean(prRepo) && !istEigenesRepo(prRepo);
  const kontext = {
    root,
    token,
    programm,
    ciLauf: ausloeser.html_url ?? "",
    auftragstext: auftragstext(issue),
    absicht: absichtFuerPr({ branch, issue, fork, basis, head, root }),
    vorgaben: vorgabenFuerPr({ fork, basis, head, root }),
  };
  const kopf = {
    format: FORMAT,
    head,
    basis,
    branch,
    pr: pr.number,
    probeBranch: auswahl.probeBranch,
  };
  await pruefeUndLege(optionen, { auswahl, frueher, kontext, kopf });
  return 0;
}

function urteilFuer(ergebnis, { head, nachstellung }) {
  if (ergebnis === null)
    return { state: FEHLER, description: "Prüfer nicht gelaufen: kein Ergebnis", issues: [], zweck: PRUEFER_ZWECK.NICHT_GELAUFEN };
  if (head && ergebnis.head !== head) {
    return {
      state: FEHLER,
      description: "Prüfer nicht gelaufen: Ergebnis gehört zu einem anderen Commit",
      issues: [],
      zweck: PRUEFER_ZWECK.NICHT_GELAUFEN,
    };
  }
  if (!nachstellung) return urteileMitZweck({ ...ergebnis, nachstellung: null });
  const erlaubt = new Set(reproduzierbareBlocker(ergebnis).map(({ schluessel }) => schluessel));
  return urteileMitZweck({
    ...ergebnis,
    nachstellung: nachstellungAus(leseDatei(nachstellung, NACHSTELLUNG_DATEI) ?? "", erlaubt),
  });
}

function laufAdresse() {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: lauf } = env;
  return server && repo && lauf ? `${server}/${repo}/actions/runs/${lauf}` : undefined;
}

function grundOhneStatus(optionen, ziel, ausloeser) {
  if (!optionen.nachstellung && !abschlussPruefbar(ausloeser))
    return `Der auslösende Lauf endete mit ${ausloeser.conclusion}`;
  return ziel ? null : "Kein Head-Commit bekannt";
}

async function entscheiden(optionen, root, { github = githubZugang() } = {}) {
  const herkunft = optionen.nachstellung ? PRUEFER_LAUF : AUSLOESER_LAUF;
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
    `Prüfer: ${urteil.state} (${urteil.description}); Issues neu ${issues.neu}, Kommentare neu ${issues.kommentare}, schon vorhanden ${issues.vorhanden}.`,
  );
  for (const zeile of zweckZeilen(statusZweck(urteil))) console.log(zeile);
  return 0;
}

async function ablegen(optionen, root, { github = githubZugang({ repo: optionen.repo }) } = {}) {
  const hinweise = ablageAus(leseDatei(optionen.ablage, ABLAGE_DATEI) ?? "");
  if (hinweise === null) throw new Error(`${ABLAGE_DATEI} fehlt oder ist ungültig.`);
  const issues = hinweise.map(({ sha, befund }) => ({
    titel: `${befund.schwere === BLOCKER ? ABLAGE_TITEL_BLOCKER : ABLAGE_TITEL}${issueTitel(befund)}`,
    sha,
    befund,
    grund: ABLAGE_GRUND,
    kommentarBeiDoppel: true,
  }));
  const ergebnis = await legeIssuesAn(issues, github);
  console.log(
    `Ablage ${github.repo}: Issues neu ${ergebnis.neu}, Kommentare neu ${ergebnis.kommentare}, schon offen ${ergebnis.vorhanden}.`,
  );
  return 0;
}

function lokalerExit(commits) {
  if (commits.some(({ zustand }) => zustand !== GEPRUEFT)) return EXIT_NICHT_GELAUFEN;
  const befunde = commits.flatMap((commit) => commit.befunde);
  return befunde.some(({ schwere }) => schwere === BLOCKER) ? EXIT_BEFUNDE : 0;
}

async function lokal(optionen, root, { github = githubZugang(), programm } = {}) {
  const token = nimmToken();
  if (ablageImArtefakt(optionen)) throw new Error("Die Ablage darf nicht im Ordner --aus liegen.");
  const head = gitAusgabe(["rev-parse", "HEAD"], root).trim();
  const branch = gitAusgabe(["rev-parse", "--abbrev-ref", "HEAD"], root).trim();
  const basis = gitAusgabe(["merge-base", optionen.basis, head], root).trim();
  const auswahl = zuPruefendeCommits({ basis, head, branch, prRepo: "", root });
  if (auswahl.commits.length === 0) throw new Error(`Keine Commits zwischen ${optionen.basis} und HEAD.`);
  const issue = await issueZumPr(github, { body: `Closes #${optionen.issue}` }, branch);
  if (issue.body === null) throw new Error(`Issue #${optionen.issue} nicht lesbar; ohne Issue-Text wiche die Eingabe von der CI ab.`);
  const absicht = absichtFuerPr({ branch, issue, basis, head, root });
  const vorgaben = vorgabenFuerPr({ basis, head, root });
  const kontext = { root, token, programm, ciLauf: "", auftragstext: auftragstext(issue), absicht, vorgaben };
  const kopf = { format: FORMAT, head, basis, branch, pr: null, probeBranch: false, lokal: true };
  const commits = await pruefeUndLege(optionen, { auswahl, frueher: new Map(), kontext, kopf });
  console.log(NUR_LOKAL);
  return lokalerExit(commits);
}

const UNTERBEFEHLE = new Map([
  ["artefakt", artefakt],
  ["pruefen", pruefen],
  ["nachstellen", (optionen) => stelleNach(optionen)],
  ["entscheiden", entscheiden],
  ["ablegen", ablegen],
]);

export function pruefer(art, optionen, root) {
  const befehl = UNTERBEFEHLE.get(art);
  return befehl(optionen, root);
}

export { artefakt, pruefen, entscheiden, ablegen, lokal };
